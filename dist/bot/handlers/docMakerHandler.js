"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleDocMakerCallback = handleDocMakerCallback;
exports.handleDocMakerMessage = handleDocMakerMessage;
const User_1 = require("../../database/models/User");
const grammy_1 = require("grammy");
const settingsService_1 = require("../../services/settingsService");
const previewGeneratorService_1 = require("../../services/previewGeneratorService");
const BACKUP_CHANNEL_ID = process.env.ARCHIVE_GROUP_ID || process.env.CHANNEL_ID || '';
function smartWrap(text, pageSize) {
    const MAX_CHARS = pageSize === 'A5' ? 40 : 65;
    const words = text.split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
        if (!cur) {
            cur = w;
        }
        else if (cur.length + 1 + w.length <= MAX_CHARS) {
            cur += ' ' + w;
        }
        else {
            lines.push(cur);
            cur = w;
        }
    }
    if (cur)
        lines.push(cur);
    return lines;
}
const DOC_MAKER_INSTRUCTION = `✨ <b>صانع المستندات والكتب</b>\n\n` +
    `📌 <b>كيفية الاستخدام:</b>\n\n` +
    `▸ أرسل النص أو العبارة التي تريد إضافتها\n` +
    `▸ ستظهر لك أزرار لاختيار موضع النص:\n` +
    `   [ ➡️ يمين ] [ ↔️ وسط ] [ ⬅️ يسار ]\n\n` +
    `📐 <b>للأسطر الفارغة:</b>\n` +
    `▸ أرسل <code>فارغ</code> ← لسطر فارغ واحد\n` +
    `▸ أرسل <code>فارغ 2</code> ← لسطرين فارغين\n` +
    `▸ أرسل <code>فارغ 3</code> ← لثلاثة أسطر فارغة\n\n` +
    `⚠️ <b>ملاحظة:</b> النص لن يلمس حواف المستند أبداً — هناك هوامش احترافية.`;
const COMPILE_KB = {
    inline_keyboard: [
        [{ text: '📥 إنهاء وتصدير PDF', callback_data: 'doc_compile' }],
        [{ text: '🔄 إعادة', callback_data: 'doc_redo' }],
    ],
};
function controlPanel() {
    return {
        inline_keyboard: [
            [{ text: '📤 تصدير الآن', callback_data: 'doc_compile' }, { text: '✏️ تعديل سطر', callback_data: 'doc_edit_line' }],
            [{ text: '🔄 إعادة آخر سطر', callback_data: 'doc_redo' }, { text: '📄 صفحة جديدة', callback_data: 'doc_new_page' }],
            [{ text: '📋 عرض الأسطر', callback_data: 'doc_view' }],
        ],
    };
}
const SIZE_KB = {
    inline_keyboard: [
        [{ text: 'A4 (افتراضي)', callback_data: 'doc_size_A4' }, { text: 'A5', callback_data: 'doc_size_A5' }],
        [{ text: 'Letter', callback_data: 'doc_size_Letter' }, { text: 'B5', callback_data: 'doc_size_B5' }],
        [{ text: 'Legal', callback_data: 'doc_size_Legal' }, { text: 'Executive', callback_data: 'doc_size_Executive' }],
        [{ text: '🔙 رجوع', callback_data: 'doc_tpl_back' }],
    ],
};
async function refreshPreview(ctx) {
    if (!ctx.session.previewMessageId || !ctx.chat)
        return;
    try {
        const png = await (0, previewGeneratorService_1.generatePreviewPNG)({
            templateId: ctx.session.templateId || 1,
            pageSize: ctx.session.pageSize || 'A4',
            lines: ctx.session.documentLines || [],
        });
        const tplName = previewGeneratorService_1.TEMPLATE_NAMES[ctx.session.templateId || 1] || '';
        await ctx.api.editMessageMedia(ctx.chat.id, ctx.session.previewMessageId, {
            type: 'photo',
            media: new grammy_1.InputFile(png, 'preview.png'),
            caption: `🖼 <b>معاينة مباشرة</b> · ${tplName} · ${ctx.session.pageSize || 'A4'}\n📝 ${(ctx.session.documentLines || []).length} سطر`,
            parse_mode: 'HTML',
        });
    }
    catch { /* silent */ }
}
// ── CALLBACK HANDLER ─────────────────────────────────────────────────────────
async function handleDocMakerCallback(ctx) {
    if (!ctx.session || !ctx.from)
        return false;
    ctx.session.pendingBatchFiles ??= [];
    const data = ctx.callbackQuery?.data;
    if (!data)
        return false;
    if (data === 'doc_maker_start') {
        const adminIds = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim());
        if (!adminIds.includes(ctx.from.id.toString())) {
            const lock = await (0, settingsService_1.getSettings)();
            if (lock.locks.btn_doc_maker === true) {
                const u = await User_1.User.findOne({ telegramId: ctx.from.id.toString() }).select('canBypassLocks');
                if (!u?.canBypassLocks) {
                    await ctx.answerCallbackQuery({ text: '⚠️ هذا القسم مغلق مؤقتاً.', show_alert: true }).catch(() => { });
                    return true;
                }
            }
        }
    }
    const docCallbacks = [
        'doc_maker_start', 'doc_maker_cancel',
        'doc_type_text', 'doc_type_image',
        'doc_compile', 'doc_continue', 'doc_finish',
        'align_right', 'align_center', 'align_left',
        'doc_redo', 'doc_edit_line', 'doc_view', 'doc_edit_after', 'doc_new_page',
        'doc_tpl_confirm', 'doc_tpl_back',
    ];
    const isDoc = docCallbacks.includes(data) || data.startsWith('doc_tpl_') || data.startsWith('doc_size_');
    if (!isDoc)
        return false;
    const telegramId = ctx.from.id.toString();
    // ── Entry ─────────────────────────────────────────────────────────────────
    if (data === 'doc_maker_start') {
        await ctx.answerCallbackQuery();
        await ctx.reply('📝 <b>صانع المستندات</b>\n\nاختر نوع المستند:', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📄 مستند نصي', callback_data: 'doc_type_text' }],
                    [{ text: '🖼 مستند مصور', callback_data: 'doc_type_image' }],
                    [{ text: '❌ إلغاء', callback_data: 'doc_maker_cancel' }],
                ],
            },
        });
        return true;
    }
    // ── Type Selected → Template Selection ───────────────────────────────────
    if (data === 'doc_type_text' || data === 'doc_type_image') {
        await ctx.answerCallbackQuery();
        ctx.session.docType = data === 'doc_type_text' ? 'text' : 'image';
        await ctx.editMessageText('🎨 <b>اختر نموذج التصميم:</b>\n\n' +
            '1️⃣ كلاسيكي نظيف (إطار رفيع)\n' +
            '2️⃣ احترافي مع رأس وتذييل\n' +
            '3️⃣ زوايا مزخرفة\n' +
            '4️⃣ أشرطة جانبية\n' +
            '5️⃣ إطار مزدوج أنيق\n\n' +
            '<i>اختر النموذج المناسب:</i>', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '1️⃣ كلاسيكي', callback_data: 'doc_tpl_1' }, { text: '2️⃣ احترافي', callback_data: 'doc_tpl_2' }],
                    [{ text: '3️⃣ زوايا', callback_data: 'doc_tpl_3' }, { text: '4️⃣ أشرطة', callback_data: 'doc_tpl_4' }],
                    [{ text: '5️⃣ إطار مزدوج', callback_data: 'doc_tpl_5' }],
                    [{ text: '❌ إلغاء', callback_data: 'doc_maker_cancel' }],
                ],
            },
        });
        return true;
    }
    // ── Template Selected → Send Preview Photo ────────────────────────────────
    if (data.startsWith('doc_tpl_') && data !== 'doc_tpl_confirm' && data !== 'doc_tpl_back') {
        await ctx.answerCallbackQuery();
        const tplId = parseInt(data.replace('doc_tpl_', ''), 10);
        ctx.session.templateId = tplId;
        let png;
        try {
            png = await (0, previewGeneratorService_1.generatePreviewPNG)({ templateId: tplId, pageSize: ctx.session.pageSize || 'A4', lines: [] });
        }
        catch {
            await ctx.reply('⚠️ تعذّر توليد المعاينة. اختر المقاس:', { reply_markup: SIZE_KB });
            return true;
        }
        // Delete current text message, send photo
        await ctx.deleteMessage().catch(() => { });
        const sent = await ctx.replyWithPhoto(new grammy_1.InputFile(png, 'preview.png'), {
            caption: `🎨 <b>معاينة النموذج: ${previewGeneratorService_1.TEMPLATE_NAMES[tplId]}</b>\n\nهذه معاينة مبدئية للإطار. اضغط ✅ موافق للمتابعة.`,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[
                        { text: '✅ موافق', callback_data: 'doc_tpl_confirm' },
                        { text: '🔙 رجوع', callback_data: 'doc_tpl_back' },
                    ]],
            },
        });
        ctx.session.previewMessageId = sent.message_id;
        return true;
    }
    // ── Confirm Template → Show Size Selection (edit caption) ─────────────────
    if (data === 'doc_tpl_confirm') {
        await ctx.answerCallbackQuery();
        await ctx.editMessageCaption({
            caption: '📐 <b>اختر مقاس الصفحة:</b>',
            parse_mode: 'HTML',
            reply_markup: SIZE_KB,
        }).catch(() => { });
        return true;
    }
    // ── Back from Preview → Restore Template List ─────────────────────────────
    if (data === 'doc_tpl_back') {
        await ctx.answerCallbackQuery();
        await ctx.deleteMessage().catch(() => { });
        ctx.session.previewMessageId = undefined;
        await ctx.reply('🎨 <b>اختر نموذج التصميم:</b>\n\n' +
            '1️⃣ كلاسيكي · 2️⃣ احترافي · 3️⃣ زوايا · 4️⃣ أشرطة · 5️⃣ إطار مزدوج', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '1️⃣ كلاسيكي', callback_data: 'doc_tpl_1' }, { text: '2️⃣ احترافي', callback_data: 'doc_tpl_2' }],
                    [{ text: '3️⃣ زوايا', callback_data: 'doc_tpl_3' }, { text: '4️⃣ أشرطة', callback_data: 'doc_tpl_4' }],
                    [{ text: '5️⃣ إطار مزدوج', callback_data: 'doc_tpl_5' }],
                    [{ text: '❌ إلغاء', callback_data: 'doc_maker_cancel' }],
                ],
            },
        });
        return true;
    }
    // ── Size Selected → Init + Send Instruction + Update Preview ─────────────
    if (data.startsWith('doc_size_')) {
        await ctx.answerCallbackQuery();
        ctx.session.pageSize = data.replace('doc_size_', '');
        ctx.session.isInDocMaker = true;
        ctx.session.documentLines = [];
        ctx.session.tempLine = null;
        // Update the preview photo for correct size, remove keyboard
        if (ctx.session.previewMessageId && ctx.chat) {
            try {
                const png = await (0, previewGeneratorService_1.generatePreviewPNG)({
                    templateId: ctx.session.templateId || 1,
                    pageSize: ctx.session.pageSize,
                    lines: [],
                });
                const tplName = previewGeneratorService_1.TEMPLATE_NAMES[ctx.session.templateId || 1] || '';
                await ctx.api.editMessageMedia(ctx.chat.id, ctx.session.previewMessageId, {
                    type: 'photo',
                    media: new grammy_1.InputFile(png, 'preview.png'),
                    caption: `🖼 <b>معاينة مباشرة</b> · ${tplName} · ${ctx.session.pageSize}\n📝 0 سطر`,
                    parse_mode: 'HTML',
                });
            }
            catch { /* silent */ }
        }
        await ctx.reply(DOC_MAKER_INSTRUCTION, { parse_mode: 'HTML', reply_markup: COMPILE_KB });
        return true;
    }
    // ── Cancel ─────────────────────────────────────────────────────────────────
    if (data === 'doc_maker_cancel') {
        await ctx.answerCallbackQuery({ text: 'تم الإلغاء ❌' });
        ctx.session.isInDocMaker = false;
        ctx.session.documentLines = [];
        ctx.session.tempLine = null;
        ctx.session.previewMessageId = undefined;
        await ctx.deleteMessage().catch(() => { });
        return true;
    }
    // ── Alignment ─────────────────────────────────────────────────────────────
    if (data === 'align_right' || data === 'align_center' || data === 'align_left') {
        await ctx.answerCallbackQuery();
        const tempLine = ctx.session.tempLine;
        if (!tempLine) {
            await ctx.editMessageText('⚠️ انتهت صلاحية النص. أرسل النص مجدداً.').catch(() => { });
            return true;
        }
        const alignMap = {
            align_right: 'right', align_center: 'center', align_left: 'left',
        };
        if (!ctx.session.documentLines)
            ctx.session.documentLines = [];
        const pageSize = ctx.session.pageSize || 'A4';
        if (ctx.session.editingLineIndex !== undefined) {
            const idx = ctx.session.editingLineIndex;
            if (idx >= 0 && idx < ctx.session.documentLines.length) {
                ctx.session.documentLines[idx] = { text: tempLine, align: alignMap[data] };
            }
            ctx.session.editingLineIndex = undefined;
            ctx.session.awaitingLineEditText = false;
            ctx.session.tempLine = null;
            const lines = ctx.session.documentLines;
            const preview = lines.map((l, i) => `${i + 1}. ${l.text ? l.text.substring(0, 30) + '...' : '[فارغ]'}`).join('\n');
            await ctx.editMessageText(`✅ تم تعديل السطر!\n\n📄 <b>المستند:</b>\n${preview}`, { parse_mode: 'HTML', reply_markup: controlPanel() }).catch(() => { });
            await refreshPreview(ctx);
            return true;
        }
        const wrapped = smartWrap(tempLine, pageSize);
        for (const chunk of wrapped)
            ctx.session.documentLines.push({ text: chunk, align: alignMap[data] });
        ctx.session.tempLine = null;
        const lines = ctx.session.documentLines;
        const preview = lines.map((l, i) => `${i + 1}. ${l.text ? l.text.substring(0, 30) + '...' : '[فارغ]'}`).join('\n');
        await ctx.editMessageText(`✅ تمت إضافة النص\n\n📄 <b>المستند:</b>\n${preview}`, { parse_mode: 'HTML', reply_markup: controlPanel() }).catch(() => { });
        await refreshPreview(ctx);
        return true;
    }
    // ── Compile ────────────────────────────────────────────────────────────────
    if (data === 'doc_compile') {
        if (!ctx.session.documentLines || ctx.session.documentLines.length === 0) {
            await ctx.reply('⚠️ لا يوجد محتوى للتصدير');
            return true;
        }
        await ctx.answerCallbackQuery();
        const processingMsg = await ctx.reply('⏳ جاري إنشاء ملف PDF...');
        try {
            const { generateDocumentFromLines } = await Promise.resolve().then(() => __importStar(require('../../services/pdfGeneratorService')));
            const { buffer: pdfBuffer, pageCount } = await generateDocumentFromLines(ctx.session.documentLines, ctx.session.pageSize || 'A4');
            const fileName = `NizoDoc_${Date.now()}.pdf`;
            await ctx.api.deleteMessage(ctx.chat.id, processingMsg.message_id).catch(() => { });
            const { incrementGlobalCounter } = await Promise.resolve().then(() => __importStar(require('../../services/statsService')));
            await incrementGlobalCounter();
            await ctx.replyWithDocument(new grammy_1.InputFile(pdfBuffer, fileName), {
                caption: `✅ <b>تم تصدير المستند!</b>\n\n📄 عدد الصفحات: ${pageCount}\n📐 المقاس: ${ctx.session.pageSize || 'A4'}`,
                parse_mode: 'HTML',
            });
            if (BACKUP_CHANNEL_ID) {
                await ctx.api.sendDocument(BACKUP_CHANNEL_ID, new grammy_1.InputFile(pdfBuffer, fileName), {
                    caption: `📦 أرشيف صانع المستندات\n🆔 ${telegramId}`, disable_notification: true,
                }).catch(() => { });
            }
            await ctx.reply('🎉 <b>تم تصدير مستندك!</b>\n\nاختر الإجراء التالي:', {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[
                            { text: '📝 مواصلة', callback_data: 'doc_continue' },
                            { text: '✏️ تعديل', callback_data: 'doc_edit_after' },
                            { text: '✅ إتمام', callback_data: 'doc_finish' },
                        ]],
                },
            });
        }
        catch (err) {
            console.error('[DocMaker] compile error:', err);
            await ctx.api.deleteMessage(ctx.chat.id, processingMsg.message_id).catch(() => { });
            await ctx.reply('❌ حدث خطأ أثناء إنشاء المستند. حاول مرة أخرى.');
        }
        return true;
    }
    // ── Redo ───────────────────────────────────────────────────────────────────
    if (data === 'doc_redo') {
        await ctx.answerCallbackQuery();
        if (!ctx.session.documentLines || ctx.session.documentLines.length === 0) {
            await ctx.editMessageText('⚠️ المستند فارغ!').catch(() => { });
            return true;
        }
        ctx.session.documentLines.pop();
        ctx.session.tempLine = null;
        ctx.session.awaitingLineEditIndex = false;
        ctx.session.awaitingLineEditText = false;
        const lines = ctx.session.documentLines;
        if (lines.length === 0) {
            await ctx.editMessageText('🗑️ تم حذف آخر سطر.\n\nالمستند فارغ. أرسل النص البديل:', { reply_markup: COMPILE_KB }).catch(() => { });
        }
        else {
            const preview = lines.map((l, i) => `${i + 1}. ${l.text ? l.text.substring(0, 30) + '...' : '[فارغ]'}`).join('\n');
            await ctx.editMessageText(`🗑️ تم حذف آخر سطر.\n\n📄 <b>المستند:</b>\n${preview}`, { parse_mode: 'HTML', reply_markup: controlPanel() }).catch(() => { });
        }
        await refreshPreview(ctx);
        return true;
    }
    // ── New Page ───────────────────────────────────────────────────────────────
    if (data === 'doc_new_page') {
        await ctx.answerCallbackQuery();
        if (!ctx.session.documentLines)
            ctx.session.documentLines = [];
        ctx.session.documentLines.push({ text: '---PAGE_BREAK---', align: 'right' });
        ctx.session.tempLine = null;
        await ctx.reply('✅ تم حفظ الصفحة. ابدأ كتابة الصفحة التالية:', { reply_markup: controlPanel() });
        return true;
    }
    // ── Edit Line ──────────────────────────────────────────────────────────────
    if (data === 'doc_edit_line') {
        await ctx.answerCallbackQuery();
        ctx.session.awaitingLineEditIndex = true;
        await ctx.reply('✏️ أرسل <b>رقم السطر</b> الذي تريد تعديله:', { parse_mode: 'HTML' });
        return true;
    }
    // ── Edit After Export ──────────────────────────────────────────────────────
    if (data === 'doc_edit_after') {
        await ctx.answerCallbackQuery();
        ctx.session.isInDocMaker = true;
        ctx.session.awaitingLineEditIndex = true;
        const lines = ctx.session.documentLines || [];
        const preview = lines.map((l, i) => `${i + 1}. ${l.text || '[فارغ]'}`).join('\n');
        await ctx.reply(`📋 <b>أسطر المستند:</b>\n\n${preview}\n\n✏️ أرسل <b>رقم السطر</b>:`, { parse_mode: 'HTML' });
        return true;
    }
    // ── View Lines ─────────────────────────────────────────────────────────────
    if (data === 'doc_view') {
        await ctx.answerCallbackQuery();
        const lines = ctx.session.documentLines || [];
        if (lines.length === 0) {
            await ctx.reply('⚠️ المستند فارغ.');
            return true;
        }
        const fullText = lines.map((l, i) => `${i + 1}. ${l.text || '[فارغ]'}`).join('\n');
        await ctx.reply(`📋 <b>محتوى المستند:</b>\n\n${fullText}`, { parse_mode: 'HTML' });
        return true;
    }
    // ── Continue ───────────────────────────────────────────────────────────────
    if (data === 'doc_continue') {
        await ctx.answerCallbackQuery();
        ctx.session.tempLine = null;
        await ctx.editMessageReplyMarkup(undefined).catch(() => { });
        await ctx.reply(DOC_MAKER_INSTRUCTION, { parse_mode: 'HTML', reply_markup: COMPILE_KB });
        return true;
    }
    // ── Finish ─────────────────────────────────────────────────────────────────
    if (data === 'doc_finish') {
        await ctx.answerCallbackQuery();
        ctx.session.isInDocMaker = false;
        ctx.session.documentLines = [];
        ctx.session.tempLine = null;
        ctx.session.awaitingLineEditIndex = false;
        ctx.session.awaitingLineEditText = false;
        ctx.session.editingLineIndex = undefined;
        ctx.session.previewMessageId = undefined;
        await ctx.editMessageText('✅ تم إنهاء المستند. يمكنك البدء من جديد.').catch(() => { });
        return true;
    }
    return false;
}
// ── MESSAGE HANDLER ────────────────────────────────────────────────────────────
async function handleDocMakerMessage(ctx) {
    if (!ctx.session || !ctx.from || !ctx.session.isInDocMaker)
        return false;
    const text = ctx.message?.text?.trim();
    if (!text || text.startsWith('/'))
        return false;
    // Awaiting line index to edit
    if (ctx.session.awaitingLineEditIndex) {
        const idx = parseInt(text, 10) - 1;
        const lines = ctx.session.documentLines || [];
        if (isNaN(idx) || idx < 0 || idx >= lines.length) {
            await ctx.reply('❌ رقم السطر غير صحيح. أرسل الرقم الصحيح:');
            return true;
        }
        ctx.session.editingLineIndex = idx;
        ctx.session.awaitingLineEditIndex = false;
        ctx.session.awaitingLineEditText = true;
        await ctx.reply(`✏️ <b>السطر الحالي:</b>\n<code>${lines[idx].text || '[سطر فارغ]'}</code>\n\nأرسل النص الجديد:`, { parse_mode: 'HTML' });
        return true;
    }
    // Awaiting replacement text
    if (ctx.session.awaitingLineEditText) {
        ctx.session.tempLine = text;
        await ctx.reply(`📝 <b>اختر محاذاة النص الجديد:</b>\n\n<code>${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[
                        { text: '➡️ يمين', callback_data: 'align_right' },
                        { text: '↔️ وسط', callback_data: 'align_center' },
                        { text: '⬅️ يسار', callback_data: 'align_left' },
                    ]] },
        });
        return true;
    }
    // Empty line command
    const emptyMatch = text.match(/^فارغ(\s+(\d+))?$/);
    if (emptyMatch) {
        const n = Math.min(Math.max(emptyMatch[2] ? parseInt(emptyMatch[2], 10) : 1, 1), 20);
        if (!ctx.session.documentLines)
            ctx.session.documentLines = [];
        for (let i = 0; i < n; i++)
            ctx.session.documentLines.push({ text: '', align: 'right' });
        const lines = ctx.session.documentLines;
        const preview = lines.map((l, i) => `${i + 1}. ${l.text ? l.text.substring(0, 30) + '...' : '[فارغ]'}`).join('\n');
        await ctx.reply(`✅ تمت إضافة ${n} سطر فارغ\n\n📄 <b>المستند:</b>\n${preview}`, { parse_mode: 'HTML', reply_markup: controlPanel() });
        await refreshPreview(ctx);
        return true;
    }
    // Normal text → alignment selection
    ctx.session.tempLine = text;
    await ctx.reply(`📝 <b>اختر محاذاة النص:</b>\n\n<code>${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[
                    { text: '➡️ يمين', callback_data: 'align_right' },
                    { text: '↔️ وسط', callback_data: 'align_center' },
                    { text: '⬅️ يسار', callback_data: 'align_left' },
                ]] },
    });
    return true;
}
//# sourceMappingURL=docMakerHandler.js.map