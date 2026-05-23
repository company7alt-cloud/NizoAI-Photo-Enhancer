"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleEditPdfDocCallback = handleEditPdfDocCallback;
exports.handleEditPdfDocMessage = handleEditPdfDocMessage;
exports.handleAutoEdit = handleAutoEdit;
exports.handleProEdit = handleProEdit;
exports.showProImageEditMenu = showProImageEditMenu;
exports.processAutoEditMessage = processAutoEditMessage;
exports.processProEditTextMessage = processProEditTextMessage;
exports.processProEditImageUpload = processProEditImageUpload;
const User_1 = require("../../database/models/User");
const loading_1 = require("../../utils/loading");
const aiPdfService_1 = require("../../services/aiPdfService");
const textOutput_1 = require("./textOutput");
const grammy_1 = require("grammy");
// We need to import OpenAI to do callAI for edits
const openai_1 = __importDefault(require("openai"));
const aiClient = new openai_1.default({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY ?? '',
});
async function handleEditPdfDocCallback(ctx) {
    // ── Task 5: Route by PDF mode ──────────────────────────────────────────────
    const pdfMode = ctx.session?.lastPdfMode ?? 'free_auto';
    if (pdfMode === 'free_auto' || pdfMode === 'nizo_auto') {
        await ctx.answerCallbackQuery().catch(() => { });
        await handleAutoEdit(ctx);
        return;
    }
    if (pdfMode === 'free_pro' || pdfMode === 'nizo_pro') {
        await ctx.answerCallbackQuery().catch(() => { });
        await handleProEdit(ctx);
        return;
    }
    const originalText = ctx.session.lastAiGeneratedText || ctx.session.lastGeneratedDoc?.text;
    if (!originalText) {
        await ctx.answerCallbackQuery({
            text: '⚠️ انتهت صلاحية التعديل، أنشئ مستنداً جديداً',
            show_alert: true
        });
        return;
    }
    await ctx.answerCallbackQuery();
    ctx.session.awaitingEditRequest = true;
    ctx.session.workflowState = 'waiting_for_doc_edit'; // keep for backward compat
    await ctx.reply('✏️ أرسل التعديلات المطلوبة وسيتم تطبيقها على المستند:');
}
async function handleEditPdfDocMessage(ctx) {
    const userId = ctx.from?.id;
    if (!userId || !ctx.message?.text)
        return;
    const user = await User_1.User.findOne({ telegramId: userId });
    if (!user)
        return;
    const originalText = ctx.session.lastAiGeneratedText || ctx.session.lastGeneratedDoc?.text;
    if (!originalText) {
        ctx.session.workflowState = null;
        ctx.session.awaitingEditRequest = false;
        return;
    }
    const pageCount = ctx.session.lastAiDocPages || ctx.session.lastGeneratedDoc?.pageCount || 1;
    const originalCost = ctx.session.lastGeneratedDoc?.originalCost || 0;
    const editCost = originalCost > 0 ? Math.ceil(originalCost / 2) : 1;
    if (user.dailyQuota < editCost) {
        await ctx.reply(`رصيدك (${user.dailyQuota}) غير كافٍ. تحتاج ${editCost} نقاط للتعديل.`);
        ctx.session.workflowState = null;
        return;
    }
    const loadingState = await (0, loading_1.showDynamicLoading)(ctx, '✏️ جاري تطبيق التعديلات');
    // Atomic deduction
    await User_1.User.updateOne({ _id: user._id }, { $inc: { dailyQuota: -editCost } });
    try {
        const response = await aiClient.chat.completions.create({
            model: process.env.REPLICATE_AI_MODEL_ID || 'anthropic/claude-3-haiku',
            messages: [
                {
                    role: 'system',
                    content: `You are a silent document editor. You NEVER ask questions. You NEVER explain. You NEVER respond in English.
YOUR ONLY JOB: Apply the user's edit request directly to the original document and return the COMPLETE edited document — nothing else.

ABSOLUTE RULES:
1. OUTPUT ONLY: Return the full edited document in Arabic Markdown. No preamble, no explanation, no questions, no comments.
2. APPLY SILENTLY: Whatever the user asks — name change, image change, content change — just do it. No confirmation needed.
3. SAME STRUCTURE: Keep exact same formatting, headings, sections, and page count (${pageCount} pages).
4. ARABIC ONLY: The document must stay in Arabic. Never switch to English.
5. IMAGES: If user asks to change images, replace the relevant [IMAGE: old keyword] tags with [IMAGE: new English keyword] in the correct sections.
6. NEVER ask "Shall I proceed?", "Would you like?", or any question. Just output the edited document immediately.
7. No religious symbols or phrases anywhere.

ORIGINAL DOCUMENT TO EDIT:
${originalText}`
                },
                { role: 'user', content: ctx.message.text }
            ],
            temperature: 0.3,
        });
        const editedText = response.choices[0]?.message?.content ?? '';
        if (!editedText.trim())
            throw new Error('AI returned empty content.');
        // Clean markdown blocks
        const cleanMarkdown = editedText.replace(/^```[a-z]*\n?/gm, '').replace(/```$/gm, '');
        await loadingState.stop();
        // Generate new PDF
        const pdfPath = await (0, aiPdfService_1.generateAiPDF)(cleanMarkdown, ctx.session.aiDocStyle || 'default');
        await ctx.replyWithDocument(new grammy_1.InputFile(pdfPath, `NizoAI_Doc_Edited_${Date.now()}.pdf`), {
            caption: `✅ <b>تم تطبيق التعديلات بنجاح!</b>\n🎨 القالب: ${(ctx.session.aiDocStyle || 'default').toUpperCase()}`,
            parse_mode: 'HTML'
        });
        // Send the chunks and edit button
        await (0, textOutput_1.sendTextChunksWithEditButton)(ctx, cleanMarkdown);
        // Update session state
        ctx.session.lastGeneratedDoc = {
            text: cleanMarkdown,
            pageCount: pageCount,
            originalCost: editCost
        };
        ctx.session.lastAiGeneratedText = cleanMarkdown;
        ctx.session.awaitingEditRequest = false;
        ctx.session.workflowState = null;
    }
    catch (err) {
        try {
            await loadingState.stop();
        }
        catch { }
        await User_1.User.updateOne({ _id: user._id }, { $inc: { dailyQuota: editCost } }); // refund
        console.error('[EditWorkflow] Error:', err?.message || err);
        const errMsg = err?.message || '';
        const userMsg = errMsg.includes('quota') || errMsg.includes('rate')
            ? '⚠️ الخدمة مشغولة الآن، حاول مرة أخرى بعد دقيقة. تم إعادة نقاطك.'
            : errMsg.includes('empty')
                ? '⚠️ النموذج لم يُرجع محتوى، حاول مرة أخرى. تم إعادة نقاطك.'
                : '⚠️ حدث خطأ أثناء التعديل. تم إعادة نقاطك تلقائياً.';
        await ctx.reply(userMsg);
        ctx.session.workflowState = null;
        ctx.session.awaitingEditRequest = false;
    }
}
// ── Task 6: Auto Mode Edit Handler ────────────────────────────────────────────
async function handleAutoEdit(ctx) {
    const user = await User_1.User.findOne({ telegramId: ctx.from.id });
    const editCount = ctx.session.editCount ?? 0;
    if (editCount >= 1) {
        await ctx.reply('⚠️ لقد استخدمت التعديل المتاح لهذا المستند.\n' +
            'يمكنك إنشاء مستند جديد للحصول على تعديل جديد.');
        return;
    }
    if (ctx.session.lastPdfMode === 'nizo_auto') {
        if ((user?.dailyQuota ?? 0) < 2) {
            await ctx.reply('⚠️ رصيدك غير كافٍ. تحتاج 2 نقاط للتعديل.');
            return;
        }
    }
    // FIX Vulnerability 2: set flag BEFORE waiting for user input
    ctx.session.awaitingAutoEdit = true;
    await ctx.reply('✏️ أرسل التعديلات المطلوبة وسيتم تطبيقها على المستند:');
}
// ── Task 7: Pro Mode Edit Handler ─────────────────────────────────────────────
async function handleProEdit(ctx) {
    const editCount = ctx.session.editCount ?? 0;
    const maxEdits = 3;
    if (editCount >= maxEdits) {
        await ctx.reply('⚠️ لقد استخدمت جميع تعديلاتك الـ 3 لهذا المستند.');
        return;
    }
    if (ctx.session.lastPdfMode === 'nizo_pro') {
        const user = await User_1.User.findOne({ telegramId: ctx.from.id });
        if ((user?.dailyQuota ?? 0) < 2) {
            await ctx.reply('⚠️ رصيدك غير كافٍ. تحتاج 2 نقاط للتعديل.');
            return;
        }
    }
    ctx.session.proEditText = null;
    ctx.session.proEditImages = {};
    ctx.session.proEditCurrentImgPage = null;
    ctx.session.awaitingProEditText = false;
    await ctx.reply('✏️ تعديل المستند\n\n' +
        'الجزء 1: تعديل النص\n' +
        'هل تريد تعديل النص؟', {
        reply_markup: {
            inline_keyboard: [
                // @ts-ignore
                [{ text: 'تعديل النص', callback_data: 'pro_edit_text', style: 'primary' }],
                // @ts-ignore
                [{ text: 'تخطي', callback_data: 'pro_edit_skip_text', style: 'primary' }],
                // @ts-ignore
                [{ text: 'إلغاء', callback_data: 'cancel', style: 'danger' }],
            ]
        }
    });
}
// ── Task 7: showProImageEditMenu helper ───────────────────────────────────────
async function showProImageEditMenu(ctx) {
    const imageCount = ctx.session.lastImageCount ?? 0;
    const imageButtons = [];
    for (let i = 1; i <= imageCount; i++) {
        const isDone = ctx.session.proEditImages?.[i] != null;
        imageButtons.push([{
                // @ts-ignore
                text: isDone ? '✅ الصورة ' + i : 'الصورة ' + i,
                callback_data: 'pro_edit_img_' + i,
                style: 'primary'
            }]);
    }
    imageButtons.push([
        // @ts-ignore
        { text: 'موافق — تطبيق التعديلات', callback_data: 'pro_edit_confirm', style: 'success' }
    ]);
    imageButtons.push([
        // @ts-ignore
        { text: 'إلغاء', callback_data: 'cancel', style: 'danger' }
    ]);
    await ctx.reply('🖼️ الجزء 2: تعديل الصور\n\n' +
        'اضغط رقم الصورة التي تريد تغييرها\n' +
        '(يمكنك تغيير أكثر من صورة)', { reply_markup: { inline_keyboard: imageButtons } });
}
// ── Task 8: Message Handlers for Auto/Pro Edits ──────────────────────────────
async function processAutoEditMessage(ctx) {
    const text = ctx.message?.text;
    if (!text)
        return;
    ctx.session.awaitingAutoEdit = false;
    // Route back to the main edit logic acting as a single text edit
    ctx.session.workflowState = 'waiting_for_doc_edit';
    ctx.session.editCount = (ctx.session.editCount ?? 0) + 1;
    await handleEditPdfDocMessage(ctx);
}
async function processProEditTextMessage(ctx) {
    const text = ctx.message?.text;
    if (!text)
        return;
    ctx.session.awaitingProEditText = false;
    ctx.session.proEditText = text;
    await ctx.reply('✅ تم استلام التعديلات النصية.');
    await showProImageEditMenu(ctx);
}
async function processProEditImageUpload(ctx) {
    if (ctx.session.proEditCurrentImgPage == null)
        return false;
    let fileId;
    if (ctx.message?.photo) {
        fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    }
    else if (ctx.message?.document && ctx.message.document.mime_type?.startsWith('image/')) {
        fileId = ctx.message.document.file_id;
    }
    if (!fileId)
        return false;
    const page = ctx.session.proEditCurrentImgPage;
    try {
        const file = await ctx.api.getFile(fileId);
        const filePath = file.file_path;
        if (!filePath)
            throw new Error('File path not found');
        const res = await fetch(`https://api.telegram.org/file/bot${process.env.DOC_BOT_TOKEN}/${filePath}`);
        const arrayBuffer = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        if (!ctx.session.proEditImages)
            ctx.session.proEditImages = {};
        ctx.session.proEditImages[page] = buffer.toString('base64');
        ctx.session.proEditCurrentImgPage = null; // Clear lock
        await ctx.reply(`✅ تم استلام الصورة البديلة لرقم ${page}.`);
        await showProImageEditMenu(ctx);
        return true; // Handled
    }
    catch (error) {
        console.error('Error fetching image for Pro Edit:', error);
        await ctx.reply('❌ حدث خطأ أثناء معالجة الصورة. حاول مجدداً.');
        return true;
    }
}
//# sourceMappingURL=editWorkflow.js.map