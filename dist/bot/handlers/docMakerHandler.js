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
const pdfGeneratorService_1 = require("../../services/pdfGeneratorService");
const grammy_1 = require("grammy");
const settingsService_1 = require("../../services/settingsService");
const BACKUP_CHANNEL_ID = process.env.ARCHIVE_GROUP_ID || process.env.CHANNEL_ID || '';
// ─── Utilities ─────────────────────────────────────────────────────────────────
function smartWrap(text, pageSize) {
    // A4 = 595 width. Padding = 40 on each side -> 515 usable.
    // 14pt Arabic avg width ~ 7pt. 515 / 7 = ~73 chars. Using 65 for safety.
    // For A5 (420 x 595), usable 340. 340 / 7 = ~48. Using 40 for safety.
    const isA5 = pageSize === 'A5';
    const MAX_CHARS = isA5 ? 40 : 65;
    const words = text.split(/\s+/);
    const lines = [];
    let currentLine = '';
    for (const word of words) {
        if (!currentLine) {
            currentLine = word;
        }
        else if (currentLine.length + 1 + word.length <= MAX_CHARS) {
            currentLine += ' ' + word;
        }
        else {
            lines.push(currentLine);
            currentLine = word;
        }
    }
    if (currentLine) {
        lines.push(currentLine);
    }
    return lines;
}
// ─── Instruction message ───────────────────────────────────────────────────────
const DOC_MAKER_INSTRUCTION = `✨ <b>صانع المستندات والكتب</b>\n\n` +
    `📌 <b>كيفية الاستخدام:</b>\n\n` +
    `▸ أرسل النص أو العبارة التي تريد إضافتها\n` +
    `▸ ستظهر لك أزرار لاختيار موضع النص:\n` +
    `   [ ➡️ يمين ] [ ↔️ وسط ] [ ⬅️ يسار ]\n\n` +
    `📐 <b>للأسطر الفارغة:</b>\n` +
    `▸ أرسل <code>فارغ</code> ← لسطر فارغ واحد\n` +
    `▸ أرسل <code>فارغ 2</code> ← لسطرين فارغين\n` +
    `▸ أرسل <code>فارغ 3</code> ← لثلاثة أسطر فارغة\n` +
    `(وهكذا لأي عدد تريده)\n\n` +
    `⚠️ <b>ملاحظة:</b> النص لن يلمس حواف المستند أبداً — هناك هوامش احترافية على جميع الجوانب.`;
const COMPILE_KB = {
    inline_keyboard: [
        [{ text: '📥 إنهاء وتصدير PDF', callback_data: 'doc_compile' }],
        [{ text: '🔄 إعادة', callback_data: 'doc_redo' }],
    ],
};
function generateControlPanel() {
    return {
        inline_keyboard: [
            [
                { text: '📤 تصدير الآن', callback_data: 'doc_compile' },
                { text: '✏️ تعديل سطر', callback_data: 'doc_edit_line' }
            ],
            [
                { text: '🔄 إعادة آخر سطر', callback_data: 'doc_redo' },
                { text: '📋 عرض الأسطر', callback_data: 'doc_view' }
            ]
        ]
    };
}
// ══════════════════════════════════════════════════════════════════════════════
// CALLBACK HANDLER
// ══════════════════════════════════════════════════════════════════════════════
async function handleDocMakerCallback(ctx) {
    if (!ctx.session)
        return false;
    if (!ctx.from)
        return false;
    ctx.session.pendingBatchFiles ??= [];
    const data = ctx.callbackQuery?.data;
    if (!data)
        return false;
    // ── Lock guard: doc_maker_start bypasses callbackHandler's lockMap ────────
    if (data === 'doc_maker_start') {
        const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
        const isAdminUser = adminIds.includes(ctx.from.id.toString());
        if (!isAdminUser) {
            const lockSettings = await (0, settingsService_1.getSettings)();
            const isLocked = lockSettings.locks.btn_doc_maker === true;
            if (isLocked) {
                const bypassUser = await User_1.User.findOne({ telegramId: ctx.from.id.toString() }).select('canBypassLocks');
                if (!bypassUser?.canBypassLocks) {
                    await ctx.answerCallbackQuery({
                        text: '⚠️ هذا القسم مغلق مؤقتاً للتحديث. متاح حالياً للمطورين والمشتركين المعتمدين فقط.',
                        show_alert: true,
                    }).catch(() => { });
                    return true;
                }
            }
        }
    }
    // Only handle recognised doc-maker callbacks
    const docCallbacks = [
        'doc_maker_start', 'doc_maker_cancel',
        'doc_type_text', 'doc_type_image',
        'doc_compile', 'doc_continue', 'doc_finish',
        'align_right', 'align_center', 'align_left',
        'doc_redo', 'doc_edit_line', 'doc_view', 'doc_edit_after'
    ];
    const isDocCallback = docCallbacks.includes(data) || data.startsWith('doc_tpl_') || data.startsWith('doc_size_');
    if (!isDocCallback)
        return false;
    const telegramId = ctx.from.id.toString();
    // ── Entry: Ask Type ──────────────────────────────────────────────────────
    if (data === 'doc_maker_start') {
        await ctx.answerCallbackQuery();
        await ctx.reply('📝 <b>صانع المستندات والكتب</b>\n\nاختر نوع المستند:', {
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
    // ── Step 1 → 2: Doc Type Selected -> Ask Template ────────────────────────
    if (data === 'doc_type_text' || data === 'doc_type_image') {
        await ctx.answerCallbackQuery();
        ctx.session.docType = data === 'doc_type_text' ? 'text' : 'image';
        await ctx.editMessageText('🎨 <b>اختر نموذج التصميم:</b>\n\n' +
            '1️⃣ كلاسيكي نظيف (إطار رفيع)\n' +
            '2️⃣ احترافي مع رأس وتذييل\n' +
            '3️⃣ زوايا مزخرفة — خط كبير\n' +
            '4️⃣ أشرطة جانبية — خط مضغوط\n' +
            '5️⃣ إطار مزدوج أنيق\n\n' +
            '<i>اختر النموذج المناسب لمستندك:</i>', {
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
    // ── Step 2 → 3: Template Selected -> Ask Size ─────────────────────────────
    if (data.startsWith('doc_tpl_')) {
        await ctx.answerCallbackQuery();
        ctx.session.templateId = parseInt(data.replace('doc_tpl_', ''), 10);
        await ctx.editMessageText('📐 <b>اختر مقاس الصفحة:</b>', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'A4 (افتراضي)', callback_data: 'doc_size_A4' }, { text: 'A5', callback_data: 'doc_size_A5' }],
                    [{ text: 'Letter', callback_data: 'doc_size_Letter' }, { text: 'B5', callback_data: 'doc_size_B5' }],
                    [{ text: 'Legal', callback_data: 'doc_size_Legal' }, { text: 'Executive', callback_data: 'doc_size_Executive' }],
                    [{ text: '❌ إلغاء', callback_data: 'doc_maker_cancel' }],
                ],
            },
        });
        return true;
    }
    // ── Step 3 → 4: Size Selected -> Enable Text Input Mode ───────────────────
    if (data.startsWith('doc_size_')) {
        await ctx.answerCallbackQuery();
        ctx.session.pageSize = data.replace('doc_size_', '');
        // NOW enable text input state
        ctx.session.isInDocMaker = true;
        ctx.session.documentLines = [];
        ctx.session.tempLine = null;
        await ctx.editMessageText(DOC_MAKER_INSTRUCTION, {
            parse_mode: 'HTML',
            reply_markup: COMPILE_KB,
        });
        return true;
    }
    // ── Cancel ────────────────────────────────────────────────────────────────
    if (data === 'doc_maker_cancel') {
        await ctx.answerCallbackQuery({ text: 'تم الإلغاء ❌' });
        ctx.session.isInDocMaker = false;
        ctx.session.documentLines = [];
        ctx.session.tempLine = null;
        await ctx.deleteMessage().catch(() => { });
        return true;
    }
    // ── Alignment callbacks ───────────────────────────────────────────────────
    if (data === 'align_right' || data === 'align_center' || data === 'align_left') {
        await ctx.answerCallbackQuery();
        const tempLine = ctx.session.tempLine;
        if (!tempLine) {
            await ctx.editMessageText('⚠️ انتهت صلاحية النص. أرسل النص مجدداً.').catch(() => { });
            return true;
        }
        const alignMap = {
            align_right: 'right',
            align_center: 'center',
            align_left: 'left',
        };
        if (!ctx.session.documentLines)
            ctx.session.documentLines = [];
        const pageSize = ctx.session.pageSize || 'A4';
        // Check if we are editing an existing line
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
            await ctx.editMessageText(`✅ تم تعديل السطر بنجاح!\n\n📄 <b>المستند الحالي:</b>\n${preview}`, {
                parse_mode: 'HTML',
                reply_markup: generateControlPanel()
            }).catch(() => { });
            return true;
        }
        // Normal add line
        const wrappedLines = smartWrap(tempLine, pageSize);
        for (const chunk of wrappedLines) {
            ctx.session.documentLines.push({ text: chunk, align: alignMap[data] });
        }
        ctx.session.tempLine = null;
        const lines = ctx.session.documentLines;
        const preview = lines.map((l, i) => `${i + 1}. ${l.text ? l.text.substring(0, 30) + '...' : '[فارغ]'}`).join('\n');
        await ctx.editMessageText(`✅ تمت إضافة النص بنجاح\n\n📄 <b>المستند الحالي:</b>\n${preview}`, {
            parse_mode: 'HTML',
            reply_markup: generateControlPanel()
        }).catch(() => { });
        return true;
    }
    // ── Compile & deliver ─────────────────────────────────────────────────────
    if (data === 'doc_compile') {
        const lines = ctx.session.documentLines ?? [];
        if (lines.length === 0) {
            await ctx.answerCallbackQuery({ text: '⚠️ لم تضف أي محتوى بعد!', show_alert: true });
            return true;
        }
        await ctx.answerCallbackQuery();
        const processingMsg = await ctx.reply('⏳ جاري إنشاء ملف PDF... الرجاء الانتظار');
        try {
            const { generateDocumentFromLines } = await Promise.resolve().then(() => __importStar(require('../../services/pdfGeneratorService')));
            const pdfBuffer = await generateDocumentFromLines(lines);
            const fileName = `NizoDoc_${Date.now()}.pdf`;
            await ctx.api.deleteMessage(ctx.chat.id, processingMsg.message_id).catch(() => { });
            const { incrementGlobalCounter } = await Promise.resolve().then(() => __importStar(require('../../services/statsService')));
            await incrementGlobalCounter();
            await ctx.replyWithDocument(new grammy_1.InputFile(pdfBuffer, fileName), {
                caption: `✅ <b>تم إنشاء المستند بنجاح!</b>\n\n` +
                    `📄 الأسطر: ${lines.length}\n` +
                    `📐 المقاس: A4`,
                parse_mode: 'HTML',
            });
            // Silent archive
            if (BACKUP_CHANNEL_ID) {
                await ctx.api.sendDocument(BACKUP_CHANNEL_ID, new grammy_1.InputFile(pdfBuffer, fileName), { caption: `📦 أرشيف صانع المستندات\n🆔 ${telegramId}`, disable_notification: true }).catch(() => { });
            }
            // Post-export choice
            await ctx.reply('🎉 <b>تم تصدير مستندك!</b>\n\nاختر الإجراء التالي:', {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[
                            { text: '📝 مواصلة من آخر سطر', callback_data: 'doc_continue' },
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
    // ── Redo (doc_redo) ───────────────────────────────────────────────────────
    if (data === 'doc_redo') {
        await ctx.answerCallbackQuery();
        if (!ctx.session.documentLines || ctx.session.documentLines.length === 0) {
            await ctx.editMessageText('⚠️ المستند فارغ لا يوجد شيء لحذفه!').catch(() => { });
            return true;
        }
        ctx.session.documentLines.pop();
        ctx.session.tempLine = null;
        ctx.session.awaitingLineEditIndex = false;
        ctx.session.awaitingLineEditText = false;
        const lines = ctx.session.documentLines;
        if (lines.length === 0) {
            await ctx.editMessageText('🗑️ تم حذف آخر سطر.\n\nالمستند فارغ الآن. أرسل النص البديل:', { reply_markup: COMPILE_KB }).catch(() => { });
        }
        else {
            const preview = lines.map((l, i) => `${i + 1}. ${l.text ? l.text.substring(0, 30) + '...' : '[فارغ]'}`).join('\n');
            await ctx.editMessageText(`🗑️ تم حذف آخر سطر. أرسل النص البديل:\n\n📄 <b>المستند الحالي:</b>\n${preview}`, { parse_mode: 'HTML', reply_markup: generateControlPanel() }).catch(() => { });
        }
        return true;
    }
    // ── Edit Line (doc_edit_line) ──────────────────────────────────────────────
    if (data === 'doc_edit_line') {
        await ctx.answerCallbackQuery();
        ctx.session.awaitingLineEditIndex = true;
        await ctx.reply('✏️ أرسل <b>رقم السطر</b> الذي تريد تعديله:', { parse_mode: 'HTML' });
        return true;
    }
    // ── Edit After Export (doc_edit_after) ─────────────────────────────────────
    if (data === 'doc_edit_after') {
        await ctx.answerCallbackQuery();
        ctx.session.isInDocMaker = true;
        ctx.session.awaitingLineEditIndex = true;
        const lines = ctx.session.documentLines || [];
        const preview = lines.map((l, i) => `${i + 1}. ${l.text || '[فارغ]'}`).join('\n');
        await ctx.reply(`📋 <b>أسطر المستند:</b>\n\n${preview}\n\n✏️ أرسل <b>رقم السطر</b> الذي تريد تعديله:`, { parse_mode: 'HTML' });
        return true;
    }
    // ── View Lines (doc_view) ─────────────────────────────────────────────────
    if (data === 'doc_view') {
        await ctx.answerCallbackQuery();
        const lines = ctx.session.documentLines || [];
        if (lines.length === 0) {
            await ctx.reply('⚠️ المستند فارغ.');
            return true;
        }
        const fullText = lines.map((l, i) => `${i + 1}. ${l.text || '[فارغ]'}`).join('\n');
        await ctx.reply(`📋 <b>محتوى المستند الحالي:</b>\n\n${fullText}`, { parse_mode: 'HTML' });
        return true;
    }
    // ── Compile & deliver ─────────────────────────────────────────────────────
    if (data === 'doc_compile') {
        const lines = ctx.session.documentLines ?? [];
        if (lines.length === 0) {
            await ctx.answerCallbackQuery({ text: '⚠️ لم تضف أي محتوى بعد!', show_alert: true });
            return true;
        }
        await ctx.answerCallbackQuery();
        const processingMsg = await ctx.reply('⏳ جاري إنشاء ملف PDF... الرجاء الانتظار');
        try {
            const pdfBuffer = await (0, pdfGeneratorService_1.generateDocumentFromLines)(lines);
            const fileName = `NizoDoc_${Date.now()}.pdf`;
            await ctx.api.deleteMessage(ctx.chat.id, processingMsg.message_id).catch(() => { });
            const { incrementGlobalCounter } = await Promise.resolve().then(() => __importStar(require('../../services/statsService')));
            await incrementGlobalCounter();
            await ctx.replyWithDocument(new grammy_1.InputFile(pdfBuffer, fileName), {
                caption: `✅ <b>تم إنشاء المستند بنجاح!</b>\n\n` +
                    `📄 الأسطر: ${lines.length}\n` +
                    `📐 المقاس: A4`,
                parse_mode: 'HTML',
            });
            // Silent archive
            if (BACKUP_CHANNEL_ID) {
                await ctx.api.sendDocument(BACKUP_CHANNEL_ID, new grammy_1.InputFile(pdfBuffer, fileName), { caption: `📦 أرشيف صانع المستندات\n🆔 ${telegramId}`, disable_notification: true }).catch(() => { });
            }
            // Post-export choice
            await ctx.reply('🎉 <b>تم تصدير مستندك!</b>\n\nاختر الإجراء التالي:', {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[
                            { text: '📝 مواصلة من آخر سطر', callback_data: 'doc_continue' },
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
    // ── Continue (keep lines, resend instruction) ─────────────────────────────
    if (data === 'doc_continue') {
        await ctx.answerCallbackQuery();
        ctx.session.tempLine = null;
        await ctx.editMessageReplyMarkup(undefined).catch(() => { });
        await ctx.reply(DOC_MAKER_INSTRUCTION, {
            parse_mode: 'HTML',
            reply_markup: COMPILE_KB,
        });
        return true;
    }
    // ── Finish (reset all state) ──────────────────────────────────────────────
    if (data === 'doc_finish') {
        await ctx.answerCallbackQuery();
        ctx.session.isInDocMaker = false;
        ctx.session.documentLines = [];
        ctx.session.tempLine = null;
        ctx.session.awaitingLineEditIndex = false;
        ctx.session.awaitingLineEditText = false;
        ctx.session.editingLineIndex = undefined;
        await ctx.editMessageText('✅ تم إنهاء المستند. يمكنك البدء من جديد.').catch(() => { });
        return true;
    }
    return false;
}
// ══════════════════════════════════════════════════════════════════════════════
// MESSAGE HANDLER
// ══════════════════════════════════════════════════════════════════════════════
async function handleDocMakerMessage(ctx) {
    if (!ctx.session)
        return false;
    if (!ctx.from)
        return false;
    if (!ctx.session.isInDocMaker)
        return false;
    const text = ctx.message?.text?.trim();
    if (!text)
        return false;
    // 1. HARD RULE — ignore commands (prevents ObjectParameterError crash)
    if (text.startsWith('/'))
        return false;
    // 1.5 Handle line editing states
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
    if (ctx.session.awaitingLineEditText) {
        ctx.session.tempLine = text;
        await ctx.reply(`📝 <b>اختر محاذاة النص الجديد:</b>\n\n<code>${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>`, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[
                        { text: '➡️ يمين', callback_data: 'align_right' },
                        { text: '↔️ وسط', callback_data: 'align_center' },
                        { text: '⬅️ يسار', callback_data: 'align_left' },
                    ]],
            },
        });
        return true;
    }
    // 2. Empty line detection: "فارغ" or "فارغ N"
    const emptyMatch = text.match(/^فارغ(\s+(\d+))?$/);
    if (emptyMatch) {
        const rawN = emptyMatch[2] ? parseInt(emptyMatch[2], 10) : 1;
        const n = Math.min(Math.max(rawN, 1), 20); // cap at 20 for safety
        if (!ctx.session.documentLines)
            ctx.session.documentLines = [];
        for (let i = 0; i < n; i++) {
            ctx.session.documentLines.push({ text: '', align: 'right' });
        }
        const lines = ctx.session.documentLines;
        const preview = lines.map((l, i) => `${i + 1}. ${l.text ? l.text.substring(0, 30) + '...' : '[فارغ]'}`).join('\n');
        await ctx.reply(`✅ تمت إضافة ${n} سطر فارغ\n\n📄 <b>المستند الحالي:</b>\n${preview}`, { parse_mode: 'HTML', reply_markup: generateControlPanel() });
        return true;
    }
    // 3. Normal text → save to tempLine, show alignment keyboard
    ctx.session.tempLine = text;
    await ctx.reply(`📝 <b>اختر محاذاة النص:</b>\n\n<code>${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>`, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [[
                    { text: '➡️ يمين', callback_data: 'align_right' },
                    { text: '↔️ وسط', callback_data: 'align_center' },
                    { text: '⬅️ يسار', callback_data: 'align_left' },
                ]],
        },
    });
    return true;
}
//# sourceMappingURL=docMakerHandler.js.map