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
exports.handleProEditConfirm = handleProEditConfirm;
exports.handleProEditConfirmV2 = handleProEditConfirmV2;
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
    ctx.session.proEditMenuMessageId = undefined;
    // Task 8 Fix: Show ONE combined message with image buttons (no separate text step)
    await showProImageEditMenu(ctx);
}
// ── Task 8 Fix: showProImageEditMenu ───────────────────────────────────────────────
async function showProImageEditMenu(ctx) {
    const totalImages = ctx.session.lastImageCount ?? 0;
    const rows = [];
    if (totalImages > 0) {
        // One button per image, one image per row (each page = one row)
        for (let n = 1; n <= totalImages; n++) {
            const isDone = ctx.session.proEditImages?.[n] != null;
            rows.push([{
                    text: isDone ? '✅ ' + n : String(n),
                    callback_data: 'pro_edit_img_' + n,
                    style: 'primary'
                }]);
        }
    }
    // Text-edit button always at top
    rows.unshift([{ text: '✏️ تعديل النص', callback_data: 'pro_edit_text', style: 'primary' }]);
    rows.push([{ text: 'موافق ✅', callback_data: 'pro_edit_confirm', style: 'success' }]);
    rows.push([{ text: 'إلغاء', callback_data: 'cancel', style: 'danger' }]);
    const editCount = ctx.session.editCount ?? 0;
    const remaining = 3 - editCount;
    const imageCount = ctx.session.lastImageCount ?? 0;
    const caption = '✏️ تعديل المستند\n\n' +
        '• اضغط "تعديل النص" لتعديل محتوى المستند\n' +
        (imageCount > 0
            ? '• اضغط رقم الصورة لاستبدالها (كل صف = صفحة)\n'
            : '') +
        '• اضغط موافق عند الانتهاء\n\n' +
        '📊 التعديلات المتبقية: ' + remaining + '/3';
    const sentMsg = await ctx.reply(caption, { reply_markup: { inline_keyboard: rows } });
    ctx.session.proEditMenuMessageId = sentMsg.message_id;
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
    // Task 8 Fix: save file_id directly (no download needed at capture time)
    if (!ctx.session.proEditImages)
        ctx.session.proEditImages = {};
    ctx.session.proEditImages[page] = fileId;
    ctx.session.proEditCurrentImgPage = null; // Clear lock
    // Task 8 Fix: Edit the original buttons message in-place to show ✅ on button N
    const menuMsgId = ctx.session.proEditMenuMessageId;
    if (false && menuMsgId && ctx.chat?.id) { // BUG 2 FIX: never edit buttons message after image upload
        try {
            // Rebuild keyboard with updated ✅ marks
            const pagesImageCount = ctx.session.lastImageCountPerPage ?? [];
            const rows = [];
            let imgNum = 1;
            for (let p = 0; p < pagesImageCount.length; p++) {
                const row = [];
                for (let i = 0; i < pagesImageCount[p]; i++) {
                    const n = imgNum;
                    const isDone = ctx.session.proEditImages?.[n] != null;
                    row.push({ text: isDone ? '✅ ' + n : String(n), callback_data: 'pro_edit_img_' + n });
                    imgNum++;
                }
                if (row.length > 0)
                    rows.push(row);
            }
            // Fallback row
            if (rows.length === 0 && (ctx.session.lastImageCount ?? 0) > 0) {
                const row = [];
                for (let n = 1; n <= (ctx.session.lastImageCount ?? 0); n++) {
                    const isDone = ctx.session.proEditImages?.[n] != null;
                    row.push({ text: isDone ? '✅ ' + n : String(n), callback_data: 'pro_edit_img_' + n });
                }
                rows.push(row);
            }
            rows.push([{ text: 'موافق', callback_data: 'pro_edit_confirm' }]);
            rows.push([{ text: 'إلغاء', callback_data: 'cancel' }]);
            // @ts-ignore
            await ctx.api.editMessageReplyMarkup(ctx.chat.id, menuMsgId, {
                reply_markup: { inline_keyboard: rows }
            }).catch(() => { }); // Never crash if edit fails
        }
        catch (_) { /* silent */ }
    }
    await ctx.reply('✅ صورة ' + page + ' جاهزة');
    return true;
}
// ── FIX 6: Proper pro_edit_confirm handler ────────────────────────────────────
async function handleProEditConfirm(ctx) {
    await ctx.answerCallbackQuery().catch(() => { });
    const editCount = ctx.session.editCount ?? 0;
    if (editCount >= 3) {
        await ctx.reply('\u26a0\ufe0f استخدمت جميع تعديلاتك الـ 3 لهذا المستند.');
        return;
    }
    const hasTextEdit = !!(ctx.session.proEditText?.trim());
    const hasImageEdit = Object.keys(ctx.session.proEditImages ?? {}).length > 0;
    if (!hasTextEdit && !hasImageEdit) {
        await ctx.reply('\u26a0\ufe0f لم تقم بأي تعديل. اضغط رقم صورة أو عدّل النص أولاً.');
        return;
    }
    // Deduct 2 points for nizo_pro edits
    if (ctx.session.lastPdfMode === 'nizo_pro') {
        const u = await User_1.User.findOne({ telegramId: ctx.from.id });
        if ((u?.dailyQuota ?? 0) < 2) {
            await ctx.reply('\u26a0\ufe0f رصيدك غير كافٍ. تحتاج 2 نقاط للتعديل.');
            return;
        }
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id }, { $inc: { dailyQuota: -2 } });
    }
    const originalText = ctx.session.lastAiGeneratedText ||
        ctx.session.lastGeneratedDoc?.text || '';
    if (!originalText) {
        await ctx.reply('\u26a0\ufe0f انتهت صلاحية التعديل، أنشئ مستنداً جديداً.');
        return;
    }
    const pageCount = ctx.session.lastAiDocPages || ctx.session.lastGeneratedDoc?.pageCount || 1;
    const loadingState = await (0, loading_1.showDynamicLoading)(ctx, '\u270f\ufe0f جاري تطبيق التعديلات');
    const finalPrompt = (ctx.session.lastOriginalPrompt ?? '') +
        '\n\n════ طلب التعديل من العميل ════\n' +
        (hasTextEdit ? (ctx.session.proEditText ?? 'لا توجد تعديلات نصية') : 'طبّق تعديلات الصور المحددة فقط') +
        '\n══════════════════════════════\n\n' +
        '⚠️ أوامر صارمة جداً للتعديل (CRITICAL INSTRUCTIONS):\n' +
        '1. يجب عليك إعادة كتابة المستند بالكامل من البداية للنهاية مع تطبيق التعديل المطلوب فقط.\n' +
        '2. إياك أن تختصر النص أو تكتب عبارات مثل "الباقي كما هو". أريد المستند كاملاً.\n' +
        '3. يجب أن تعيد جميع علامات الصور [IMAGE: Keyword] في أماكنها الصحيحة تماماً كما كانت في النص الأصلي، لكي لا يختل التصميم.\n' +
        '4. أعطني المستند النهائي كاملاً الآن.';
    try {
        const response = await aiClient.chat.completions.create({
            model: process.env.REPLICATE_AI_MODEL_ID || 'anthropic/claude-3-haiku',
            messages: [
                {
                    role: 'system',
                    content: `You are a silent document editor. Apply the user's edits and return the COMPLETE edited document in Arabic Markdown only. Keep exact same structure and page count (${pageCount} pages). No explanations.\n\nORIGINAL DOCUMENT:\n${originalText}`
                },
                {
                    role: 'user',
                    content: finalPrompt
                }
            ],
            temperature: 0.3,
        });
        const editedText = response.choices[0]?.message?.content ?? '';
        if (!editedText.trim())
            throw new Error('AI returned empty content.');
        const cleanMarkdown = editedText.replace(/^```[a-z]*\n?/gm, '').replace(/```$/gm, '');
        await loadingState.stop();
        const pdfPath = await (0, aiPdfService_1.generateAiPDF)(cleanMarkdown, ctx.session.aiDocStyle || 'default');
        await ctx.replyWithDocument(new grammy_1.InputFile(pdfPath, `NizoAI_Doc_Edited_${Date.now()}.pdf`), {
            caption: `\u2705 <b>تم تطبيق التعديلات بنجاح!</b>\n\ud83c\udfa8 القالب: ${(ctx.session.aiDocStyle || 'default').toUpperCase()}`,
            parse_mode: 'HTML'
        });
        ctx.session.lastAiGeneratedText = cleanMarkdown;
        ctx.session.lastGeneratedDoc = { text: cleanMarkdown, pageCount, originalCost: 0 };
        ctx.session.editCount = editCount + 1;
        const remaining = 3 - ctx.session.editCount;
        ctx.session.proEditText = null;
        ctx.session.proEditImages = {};
        ctx.session.proEditCurrentImgPage = null;
        ctx.session.awaitingProEditText = false;
        await (0, textOutput_1.sendTextChunksWithEditButton)(ctx, cleanMarkdown);
        if (remaining > 0) {
            await ctx.reply(`\u2705 تم التعديل (${ctx.session.editCount}/3)\nمتبقي: ${remaining} تعديلات`, {
                reply_markup: {
                    inline_keyboard: [[
                            { text: `\u270f\ufe0f تعديل (${remaining} متبقية)`, callback_data: 'edit_pdf_doc' }
                        ]]
                }
            });
        }
        else {
            await ctx.reply('\u2705 تم التعديل. لا تعديلات إضافية متاحة لهذا المستند.');
        }
    }
    catch (err) {
        try {
            await loadingState.stop();
        }
        catch { /* silent */ }
        if (ctx.session.lastPdfMode === 'nizo_pro') {
            await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id }, { $inc: { dailyQuota: 2 } });
        }
        const e = err instanceof Error ? err : new Error(String(err));
        console.error('[ProEditConfirm] Error:', e.message);
        await ctx.reply('\u26a0\ufe0f حدث خطأ أثناء التعديل. تم إعادة نقاطك تلقائياً.');
    }
}
// ── BUG 3 + BUG 4: handleProEditConfirmV2 ────────────────────────────────────
// BUG 4: No 3-edit limit. Each confirm costs: free_pro→3 dailyQuota, nizo_pro→2 dailyQuota
// BUG 3: Image-only edits skip AI — replace img tags in stored HTML directly
async function handleProEditConfirmV2(ctx) {
    await ctx.answerCallbackQuery().catch(() => { });
    const hasTextEdit = !!(ctx.session.proEditText?.trim());
    const hasImageEdit = Object.keys(ctx.session.proEditImages ?? {}).length > 0;
    if (!hasTextEdit && !hasImageEdit) {
        await ctx.reply('⚠️ لم تقم بأي تعديل. اضغط رقم صورة أو عدّل النص أولاً.');
        return;
    }
    const userId = ctx.from?.id;
    if (!userId)
        return;
    // BUG 4: Balance check — use dailyQuota (the only balance field in User schema)
    if (ctx.session.lastPdfMode === 'free_pro') {
        const user = await User_1.User.findOne({ telegramId: userId });
        if ((user?.dailyQuota ?? 0) < 3) {
            await ctx.reply('⚠️ رصيدك غير كافٍ. تحتاج 3 نقاط للتعديل.');
            return;
        }
        await User_1.User.findOneAndUpdate({ telegramId: userId }, { $inc: { dailyQuota: -3 } });
    }
    if (ctx.session.lastPdfMode === 'nizo_pro') {
        const user = await User_1.User.findOne({ telegramId: userId });
        if ((user?.dailyQuota ?? 0) < 2) {
            await ctx.reply('⚠️ رصيدك غير كافٍ. تحتاج 2 نقاط للتعديل.');
            return;
        }
        await User_1.User.findOneAndUpdate({ telegramId: userId }, { $inc: { dailyQuota: -2 } });
    }
    // BUG 3: Image-only path — skip AI, replace img tags in stored HTML
    const storedHtml = ctx.session.lastGeneratedHtml;
    if (!hasTextEdit && hasImageEdit) {
        const loadingState = await (0, loading_1.showDynamicLoading)(ctx, '🖼️ جاري استبدال الصور');
        try {
            // If no cached HTML, regenerate it first
            let editedHtml = storedHtml;
            if (!editedHtml) {
                const originalMd = ctx.session.lastAiGeneratedText || ctx.session.lastGeneratedDoc?.text || '';
                if (!originalMd) {
                    await ctx.reply('⚠️ انتهت صلاحية التعديل، أنشئ مستنداً جديداً.');
                    return;
                }
                const { html: freshHtml } = await (0, aiPdfService_1.generateAiPDFAndHtml)(originalMd, ctx.session.aiDocStyle || 'default');
                editedHtml = freshHtml;
            }
            const botToken = process.env.DOC_BOT_TOKEN || process.env.BOT_TOKEN || '';
            // Replace each requested image by 1-based index in HTML
            const imgEntries = Object.entries(ctx.session.proEditImages ?? {}).sort(([a], [b]) => parseInt(a) - parseInt(b));
            for (const [idxStr, fileId] of imgEntries) {
                const imgIndex = parseInt(idxStr) - 1; // 0-based
                try {
                    // Download from Telegram
                    const fileInfoRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`, { signal: AbortSignal.timeout(10000) });
                    if (!fileInfoRes.ok)
                        continue;
                    const fileInfoData = await fileInfoRes.json();
                    const filePath = fileInfoData.result?.file_path;
                    if (!filePath)
                        continue;
                    const fileRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`, { signal: AbortSignal.timeout(15000) });
                    if (!fileRes.ok)
                        continue;
                    const base64 = Buffer.from(await fileRes.arrayBuffer()).toString('base64');
                    const dataUri = `data:image/jpeg;base64,${base64}`;
                    // Replace Nth <img src="..."> in HTML (0-based)
                    let count = 0;
                    editedHtml = editedHtml.replace(/(<img[^>]+src=")[^"]*(")/g, (match, pre, post) => {
                        if (count === imgIndex) {
                            count++;
                            return pre + dataUri + post;
                        }
                        count++;
                        return match;
                    });
                }
                catch (imgErr) {
                    console.error(`[ProEditV2] Image ${idxStr} replace error:`, imgErr);
                }
            }
            await loadingState.stop();
            const pdfPath = await (0, aiPdfService_1.generateAiPDFFromHtml)(editedHtml);
            await ctx.replyWithDocument(new grammy_1.InputFile(pdfPath, `NizoAI_Doc_Edited_${Date.now()}.pdf`), { caption: '✅ <b>تم استبدال الصور بنجاح!</b>', parse_mode: 'HTML' });
            // Update stored HTML and reset edit state
            ctx.session.lastGeneratedHtml = editedHtml;
            ctx.session.proEditText = null;
            ctx.session.proEditImages = {};
            ctx.session.proEditCurrentImgPage = null;
            ctx.session.awaitingProEditText = false;
            // BUG 4: Unlimited — show edit button again
            await ctx.reply('✅ تم التعديل بنجاح!', {
                reply_markup: {
                    inline_keyboard: [[
                            // @ts-ignore
                            { text: '✏️ تعديل', callback_data: 'edit_pdf_doc', style: 'primary' }
                        ]]
                }
            });
        }
        catch (err) {
            try {
                await loadingState.stop();
            }
            catch { /* silent */ }
            // Refund
            const refundAmt = ctx.session.lastPdfMode === 'free_pro' ? 3 : 2;
            if (ctx.session.lastPdfMode === 'free_pro' || ctx.session.lastPdfMode === 'nizo_pro') {
                await User_1.User.findOneAndUpdate({ telegramId: userId }, { $inc: { dailyQuota: refundAmt } });
            }
            const e = err instanceof Error ? err.message : String(err);
            console.error('[ProEditV2 ImageOnly] Error:', e);
            await ctx.reply('⚠️ حدث خطأ أثناء استبدال الصور. تم إعادة نقاطك.');
        }
        return;
    }
    // Text edit path (with or without images) — call AI
    const originalText = ctx.session.lastAiGeneratedText || ctx.session.lastGeneratedDoc?.text || '';
    if (!originalText) {
        await ctx.reply('⚠️ انتهت صلاحية التعديل، أنشئ مستنداً جديداً.');
        return;
    }
    const pageCount = ctx.session.lastAiDocPages || ctx.session.lastGeneratedDoc?.pageCount || 1;
    const loadingState = await (0, loading_1.showDynamicLoading)(ctx, '✏️ جاري تطبيق التعديلات');
    const finalPrompt = (ctx.session.lastOriginalPrompt ?? '') +
        '\n\n════ طلب التعديل من العميل ════\n' +
        (ctx.session.proEditText ?? 'لا توجد تعديلات نصية') +
        '\n══════════════════════════════\n\n' +
        '⚠️ أوامر صارمة جداً للتعديل (CRITICAL INSTRUCTIONS):\n' +
        '1. يجب عليك إعادة كتابة المستند بالكامل من البداية للنهاية مع تطبيق التعديل المطلوب فقط.\n' +
        '2. إياك أن تختصر النص أو تكتب عبارات مثل "الباقي كما هو". أريد المستند كاملاً.\n' +
        '3. يجب أن تعيد جميع علامات الصور [IMAGE: Keyword] في أماكنها الصحيحة تماماً كما كانت في النص الأصلي، لكي لا يختل التصميم.\n' +
        '4. أعطني المستند النهائي كاملاً الآن.';
    try {
        const response = await aiClient.chat.completions.create({
            model: process.env.REPLICATE_AI_MODEL_ID || 'anthropic/claude-3-haiku',
            messages: [
                {
                    role: 'system',
                    content: `You are a silent document editor. Apply the user's edits and return the COMPLETE edited document in Arabic Markdown only. Keep exact same structure and page count (${pageCount} pages). No explanations.\n\nORIGINAL DOCUMENT:\n${originalText}`
                },
                { role: 'user', content: finalPrompt }
            ],
            temperature: 0.3,
        });
        const editedText = response.choices[0]?.message?.content ?? '';
        if (!editedText.trim())
            throw new Error('AI returned empty content.');
        const cleanMarkdown = editedText.replace(/^```[a-z]*\n?/gm, '').replace(/```$/gm, '');
        await loadingState.stop();
        // BUG 3: use generateAiPDFAndHtml to cache the HTML
        const { pdfPath, html: newHtml } = await (0, aiPdfService_1.generateAiPDFAndHtml)(cleanMarkdown, ctx.session.aiDocStyle || 'default');
        await ctx.replyWithDocument(new grammy_1.InputFile(pdfPath, `NizoAI_Doc_Edited_${Date.now()}.pdf`), {
            caption: `✅ <b>تم تطبيق التعديلات بنجاح!</b>\n🎨 القالب: ${(ctx.session.aiDocStyle || 'default').toUpperCase()}`,
            parse_mode: 'HTML'
        });
        ctx.session.lastAiGeneratedText = cleanMarkdown;
        ctx.session.lastGeneratedDoc = { text: cleanMarkdown, pageCount, originalCost: 0 };
        ctx.session.lastGeneratedHtml = newHtml; // BUG 3: cache for future image-only edits
        ctx.session.proEditText = null;
        ctx.session.proEditImages = {};
        ctx.session.proEditCurrentImgPage = null;
        ctx.session.awaitingProEditText = false;
        // BUG 4: Unlimited — always show edit button
        await ctx.reply('✅ تم التعديل بنجاح!', {
            reply_markup: {
                inline_keyboard: [[
                        // @ts-ignore
                        { text: '✏️ تعديل', callback_data: 'edit_pdf_doc', style: 'primary' }
                    ]]
            }
        });
    }
    catch (err) {
        try {
            await loadingState.stop();
        }
        catch { /* silent */ }
        const refundAmt = ctx.session.lastPdfMode === 'free_pro' ? 3 : 2;
        if (ctx.session.lastPdfMode === 'free_pro' || ctx.session.lastPdfMode === 'nizo_pro') {
            await User_1.User.findOneAndUpdate({ telegramId: userId }, { $inc: { dailyQuota: refundAmt } });
        }
        const e = err instanceof Error ? err.message : String(err);
        console.error('[ProEditV2 TextEdit] Error:', e);
        await ctx.reply('⚠️ حدث خطأ أثناء التعديل. تم إعادة نقاطك تلقائياً.');
    }
}
//# sourceMappingURL=editWorkflow.js.map