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
        [{ text: '❌ إلغاء', callback_data: 'doc_maker_cancel' }],
    ],
};
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
    const DOC_CALLBACKS = [
        'doc_maker_start', 'doc_maker_cancel',
        'doc_compile', 'doc_continue', 'doc_finish',
        'align_right', 'align_center', 'align_left',
    ];
    if (!DOC_CALLBACKS.includes(data))
        return false;
    const telegramId = ctx.from.id.toString();
    // ── Entry ─────────────────────────────────────────────────────────────────
    if (data === 'doc_maker_start') {
        await ctx.answerCallbackQuery();
        ctx.session.isInDocMaker = true;
        ctx.session.documentLines = [];
        ctx.session.tempLine = null;
        await ctx.reply(DOC_MAKER_INSTRUCTION, {
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
        const alignLabel = {
            align_right: 'اليمين ➡️',
            align_center: 'الوسط ↔️',
            align_left: 'اليسار ⬅️',
        };
        if (!ctx.session.documentLines)
            ctx.session.documentLines = [];
        ctx.session.documentLines.push({ text: tempLine, align: alignMap[data] });
        ctx.session.tempLine = null;
        const count = ctx.session.documentLines.length;
        await ctx.editMessageText(`✅ تمت إضافة السطر بمحاذاة ${alignLabel[data]}\n📝 إجمالي الأسطر: ${count}`).catch(() => { });
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
            await ctx.reply('🎉 <b>تم تصدير مستندك!</b>\n\nهل تريد متابعة الإضافة إلى نفس المستند أم إنهائه؟', {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[
                            { text: '📝 متابعة', callback_data: 'doc_continue' },
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
        await ctx.editMessageText('✅ تم إنهاء المستند بنجاح. يمكنك البدء من جديد متى شئت.').catch(() => { });
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
        const total = ctx.session.documentLines.length;
        await ctx.reply(`✅ تمت إضافة ${n} سطر فارغ\n📝 إجمالي الأسطر: ${total}`, { reply_markup: COMPILE_KB });
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