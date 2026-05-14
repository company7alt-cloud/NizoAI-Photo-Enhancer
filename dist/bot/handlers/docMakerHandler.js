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
exports.smartWrap = smartWrap;
exports.renderActiveSession = renderActiveSession;
exports.handleDocMakerCallback = handleDocMakerCallback;
exports.handleDocMakerMessage = handleDocMakerMessage;
exports.showImageFormatMenu = showImageFormatMenu;
const User_1 = require("../../database/models/User");
const grammy_1 = require("grammy");
const settingsService_1 = require("../../services/settingsService");
const previewGeneratorService_1 = require("../../services/previewGeneratorService");
function buildFormattingKeyboard(fmt) {
    const isR = fmt.align === 'right' ? '✅ يمين' : '➡️ يمين';
    const isC = fmt.align === 'center' ? '✅ وسط' : '↔️ وسط';
    const isL = fmt.align === 'left' ? '✅ يسار' : '⬅️ يسار';
    const b = fmt.bold ? '✅ عريض' : '𝐁 عريض';
    const it = fmt.italic ? '✅ مائل' : '𝐼 مائل';
    const ul = fmt.underline ? '✅ تحته خط' : 'U̲ تحته خط';
    const sm = fmt.size === 'small' ? '✅ صغير' : '🔡 صغير';
    const nm = (!fmt.size || fmt.size === 'normal') ? '✅ عادي' : '🔤 عادي';
    const lg = fmt.size === 'large' ? '✅ كبير' : '🔠 كبير';
    const qt = fmt.style === 'quote' ? '✅ اقتباس' : '" اقتباس';
    const dv = fmt.style === 'divider' ? '✅ فاصل' : '— فاصل';
    const hl = fmt.style === 'highlight' ? '✅ مميز' : '★ مميز';
    const clRed = fmt.color === '#FF0000' ? '✅ أحمر' : '🔴 أحمر';
    const clYel = fmt.color === '#FFD700' ? '✅ أصفر' : '🟡 أصفر';
    const clBlu = fmt.color === '#1565C0' ? '✅ أزرق' : '🔵 أزرق';
    const clDef = !fmt.color ? '✅ افتراضي' : '⚫ افتراضي';
    const customLabel = (fmt.color && !['#FF0000', '#FFD700', '#1565C0'].includes(fmt.color))
        ? `✅ مخصص: ${fmt.color}`
        : '🎨 اختيار ذاتي (كود اللون)';
    const rows = [
        [
            { text: isR, callback_data: 'fmt_align_right' },
            { text: isC, callback_data: 'fmt_align_center' },
            { text: isL, callback_data: 'fmt_align_left' },
        ],
        [
            { text: b, callback_data: 'style_bold' },
            { text: it, callback_data: 'style_italic' },
            { text: ul, callback_data: 'style_underline' },
        ],
        [
            { text: sm, callback_data: 'size_small' },
            { text: nm, callback_data: 'size_normal' },
            { text: lg, callback_data: 'size_large' },
        ],
        [
            { text: qt, callback_data: 'style_quote' },
            { text: dv, callback_data: 'style_divider' },
            { text: hl, callback_data: 'style_highlight' },
        ],
        [
            { text: clRed, callback_data: 'color_red' },
            { text: clYel, callback_data: 'color_yellow' },
            { text: clBlu, callback_data: 'color_blue' },
            { text: clDef, callback_data: 'color_default' },
        ],
        [
            { text: customLabel, callback_data: 'color_custom' }
        ],
        [
            { text: '✅ تطبيق وإضافة للمستند', callback_data: 'fmt_apply' }
        ],
        [
            { text: '🔙 رجوع', callback_data: 'doc_format_back' }
        ]
    ];
    return { inline_keyboard: rows };
}
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
function estimatePageCount(lines, _pageSize = 'A4') {
    const LINES_PER_PAGE = 40;
    let totalLines = 0;
    for (const line of lines) {
        if (line.type === 'image' || line.type === 'image_row') {
            totalLines += (line.imageLines || 5);
        }
        else if (line.type === 'text') {
            if (!line.text || line.text.trim() === '') {
                totalLines += 1;
            }
            else if (line.size === 'large') {
                totalLines += 2;
            }
            else {
                totalLines += 1;
            }
        }
        else if (line.style === 'divider') {
            totalLines += 1;
        }
        else {
            totalLines += 1;
        }
    }
    return Math.max(1, Math.ceil(totalLines / LINES_PER_PAGE));
}
const COMPILE_KB = {
    inline_keyboard: [
        [{ text: '📤 تصدير الآن', callback_data: 'doc_export_pdf' }],
        [{ text: '↩️ إعادة آخر سطر', callback_data: 'doc_undo_last' }],
    ],
};
function controlPanel() {
    return {
        inline_keyboard: [
            [
                { text: '📤 تصدير الآن', callback_data: 'doc_export_pdf' },
                { text: '✏️ تعديل سطر', callback_data: 'doc_edit_line' }
            ],
            [
                { text: '↩️ إعادة آخر سطر', callback_data: 'doc_undo_last' },
                { text: '📄 صفحة جديدة', callback_data: 'doc_new_page' }
            ],
            [{ text: '📋 عرض الأسطر', callback_data: 'doc_view_lines' }],
            [{ text: '🚪 إنهاء الجلسة', callback_data: 'doc_cancel_end' }]
        ]
    };
}
const SIZE_KB = {
    inline_keyboard: [
        [{ text: 'A4 (افتراضي)', callback_data: 'doc_size_A4' }, { text: 'A5', callback_data: 'doc_size_A5' }],
        [{ text: 'Letter', callback_data: 'doc_size_Letter' }, { text: 'B5', callback_data: 'doc_size_B5' }],
        [{ text: 'Legal', callback_data: 'doc_size_Legal' }, { text: 'Executive', callback_data: 'doc_size_Executive' }],
        [{ text: '📐 مقاس مخصص', callback_data: 'doc_custom_size' }],
        [{ text: '🔙 رجوع', callback_data: 'doc_tpl_back' }],
    ],
};
async function renderActiveSession(ctx) {
    const lines = ctx.session.documentLines || [];
    const preview = lines.map((l, i) => {
        if (l.type === 'image')
            return `${i + 1}. 🖼 [صورة]`;
        if (l.type === 'image_row' || l.rowImages)
            return `${i + 1}. 🖼 [سطر صور]`;
        return `${i + 1}. ${l.text ? l.text.substring(0, 30) + '...' : '[فارغ]'}`;
    }).join('\n');
    const text = lines.length > 0
        ? `📄 <b>المستند:</b>\n${preview}`
        : `📄 <b>المستند فارغ.</b>\nأرسل نصاً أو صورة للبدء.`;
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: controlPanel() });
    await refreshPreview(ctx);
}
async function refreshPreview(ctx) {
    if (!ctx.session.previewMessageId || !ctx.chat)
        return;
    try {
        const png = await (0, previewGeneratorService_1.generatePreviewPNG)({
            templateId: ctx.session.templateId || 1,
            pageSize: ctx.session.pageSize || 'A4',
            lines: ctx.session.documentLines || [],
            selectedFont: ctx.session.selectedFont,
            docBgColor: ctx.session.docBgColor,
            docTextColor: ctx.session.docTextColor,
        });
        const tplName = previewGeneratorService_1.TEMPLATE_NAMES[ctx.session.templateId || 1] || '';
        await ctx.api.editMessageMedia(ctx.chat.id, ctx.session.previewMessageId, {
            type: 'photo',
            media: new grammy_1.InputFile(png, 'preview.png'),
            caption: `🖼 <b>معاينة مباشرة</b> · ${tplName} · ${ctx.session.pageSize || 'A4'}\n📝 ${(ctx.session.documentLines || []).length} سطر\n🔤 الخط: ${ctx.session.selectedFont || 'Amiri'} — سيظهر في PDF النهائي`,
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
        'doc_type_text', 'doc_type_image', 'doc_type_image_locked',
        'doc_compile', 'doc_continue', 'doc_finish', 'doc_export_pdf',
        'doc_export_confirm', 'doc_export_cancel', 'doc_back_to_session_keep',
        'align_right', 'align_center', 'align_left',
        'style_bold', 'style_italic', 'style_underline',
        'size_small', 'size_normal', 'size_large',
        'style_quote', 'style_divider', 'style_highlight',
        'doc_undo_last', 'doc_edit_line', 'doc_view_lines', 'doc_edit_after', 'doc_new_page',
        'doc_tpl_confirm', 'doc_tpl_back',
        'doc_end_session', 'doc_confirm_end', 'doc_cancel_end',
        'doc_format_back', 'doc_custom_size', 'doc_template_colored',
        'doc_back_to_session',
        'doc_img_align_locked',
        'doc_row_add_image', 'doc_row_caption_skip', 'doc_row_finish',
        'doc_colored_approve', 'doc_colored_back',
        'color_red', 'color_yellow', 'color_blue', 'color_default',
        'color_custom', 'color_custom_cancel', 'fmt_apply'
    ];
    const isDoc = docCallbacks.includes(data) ||
        data.startsWith('doc_bg_') ||
        data.startsWith('doc_txt_') ||
        data.startsWith('doc_tpl_') ||
        data.startsWith('doc_size_') ||
        data.startsWith('doc_font_') ||
        data.startsWith('doc_img_space_') ||
        data.startsWith('doc_img_fmt_') ||
        data.startsWith('doc_img_mask_') ||
        data.startsWith('doc_row_caption_') ||
        data.startsWith('fmt_align_') ||
        data.startsWith('color_');
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
                    [{ text: '🖼 مستند مصور 🔒', callback_data: 'doc_type_image_locked' }],
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
        ctx.session.docBgColor = undefined;
        ctx.session.docTextColor = undefined;
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
                    [{ text: '🎨 تصميم نموذج ملون (احترافي)', callback_data: 'doc_template_colored' }],
                    [{ text: '❌ إلغاء', callback_data: 'doc_maker_cancel' }],
                ],
            },
        });
        return true;
    }
    if (data.startsWith('doc_tpl_') && data !== 'doc_tpl_confirm' && data !== 'doc_tpl_back') {
        ctx.session.docBgColor = undefined;
        ctx.session.docTextColor = undefined;
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
    // ── Custom Size → ask for width ──────────────────────────────────────────
    if (data === 'doc_custom_size') {
        try {
            await ctx.answerCallbackQuery();
            ctx.session.awaitingCustomWidth = true;
            ctx.session.awaitingCustomHeight = false;
            ctx.session.customSizeWidth = undefined;
            await ctx.editMessageCaption({
                caption: '📐 <b>مقاس مخصص</b>\n\nأرسل <b>العرض</b> بالسنتيمتر (مثال: 21):',
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'doc_tpl_back' }]] },
            }).catch(() => { });
        }
        catch (e) {
            console.error('[DocMaker] custom_size error:', e);
        }
        return true;
    }
    // ── Standard Size Selected → Show Font Menu ───────────────────────────
    if (data.startsWith('doc_size_')) {
        await ctx.answerCallbackQuery();
        ctx.session.pageSize = data.replace('doc_size_', '');
        ctx.session.awaitingCustomWidth = false;
        ctx.session.awaitingCustomHeight = false;
        await ctx.editMessageCaption({
            caption: '🔤 <b>اختر خط المستند:</b>\n\nسيُطبَّق هذا الخط على كامل النص في PDF.',
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✒️ Omnia Serif', callback_data: 'doc_font_Omnia' }],
                    [{ text: '✨ Modern Pro 2024', callback_data: 'doc_font_ModernPro' }],
                    [{ text: '🎙 خط إذاعة ثمانية', callback_data: 'doc_font_Thamanya' }],
                    [{ text: '📜 الخط الرسمي — Amiri', callback_data: 'doc_font_Amiri' }],
                    [{ text: '📱 Cairo العصري', callback_data: 'doc_font_Cairo' }],
                    [{ text: '❌ إلغاء', callback_data: 'doc_cancel_end' }],
                ],
            },
        }).catch(() => { });
        return true;
    }
    // ── Font Selected → Start Session ────────────────────────────────────
    if (data.startsWith('doc_font_')) {
        await ctx.answerCallbackQuery();
        ctx.session.selectedFont = data.replace('doc_font_', '');
        ctx.session.docState = 'active';
        ctx.session.isInDocMaker = true;
        ctx.session.documentLines = [];
        ctx.session.tempLine = null;
        ctx.session.tempFormatting = null;
        ctx.session.tempImage = undefined;
        // Update preview photo caption, remove keyboard
        if (ctx.session.previewMessageId && ctx.chat) {
            try {
                const png = await (0, previewGeneratorService_1.generatePreviewPNG)({
                    templateId: ctx.session.templateId || 1,
                    pageSize: ctx.session.pageSize || 'A4',
                    lines: [],
                    selectedFont: ctx.session.selectedFont,
                });
                const tplName = previewGeneratorService_1.TEMPLATE_NAMES[ctx.session.templateId || 1] || '';
                await ctx.api.editMessageMedia(ctx.chat.id, ctx.session.previewMessageId, {
                    type: 'photo',
                    media: new grammy_1.InputFile(png, 'preview.png'),
                    caption: `🖼 <b>معاينة مباشرة</b> · ${tplName} · ${ctx.session.pageSize || 'A4'}\n📝 0 سطر`,
                    parse_mode: 'HTML',
                });
            }
            catch { /* silent */ }
        }
        await ctx.reply('✅ <b>بدأت الجلسة بنجاح!</b>\n\n' +
            '📝 أرسل نصاً أو صورة لإضافتها للمستند.\n\n' +
            '⚠️ <i>البوت الآن في وضع المستند — لن يستجيب لأوامر تحسين الصور حتى تنهي الجلسة.</i>', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📥 إنهاء وتصدير PDF', callback_data: 'doc_compile' }],
                ],
            },
        });
        await ctx.reply(DOC_MAKER_INSTRUCTION, { parse_mode: 'HTML', reply_markup: COMPILE_KB });
        return true;
    }
    // ── Full-bleed cover image ──────────────────────────────────────────────
    if (data === 'doc_img_full_cover') {
        await ctx.answerCallbackQuery();
        if (!ctx.session.tempImage?.fileId)
            return true;
        ctx.session.documentLines = ctx.session.documentLines || [];
        ctx.session.documentLines.push({
            type: 'image_cover',
            fileId: ctx.session.tempImage.fileId,
        });
        ctx.session.tempImage = undefined;
        ctx.session.rowImages = undefined;
        ctx.session.docState = 'active';
        await ctx.deleteMessage().catch(() => { });
        const total = ctx.session.documentLines.length;
        const pages = estimatePageCount(ctx.session.documentLines, ctx.session.pageSize);
        await ctx.reply(`✅ تمت إضافة الغلاف للمستند!\n📄 الأسطر: ${total} | الصفحات: ~${pages}`);
        await renderActiveSession(ctx);
        return true;
    }
    // ── Image: Spacing selection ─────────────────────────────────────
    if (data.startsWith('doc_img_space_')) {
        if (!ctx.session.tempImage?.fileId) {
            await ctx.answerCallbackQuery({ text: '⚠️ انتهت الجلسة، أرسل الصورة مجدداً.' });
            return true;
        }
        const val = data.replace('doc_img_space_', '');
        if (val === 'custom') {
            ctx.session.docState = 'awaiting_custom_img_lines';
            await ctx.editMessageText('✍️ <b>أرسل عدد الأسطر</b> (رقم بين 1 و50):', {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[
                            { text: '🔙 إلغاء', callback_data: 'doc_back_to_session' }
                        ]]
                }
            });
            return true;
        }
        ctx.session.tempImage.lines = parseInt(val);
        await showImageFormatMenu(ctx);
        return true;
    }
    // ── Image: Back / cancel ────────────────────────────────────────────
    if (data === 'doc_back_to_session') {
        await ctx.answerCallbackQuery();
        ctx.session.tempImage = undefined;
        ctx.session.docState = 'active';
        await ctx.deleteMessage().catch(() => { });
        await renderActiveSession(ctx);
        return true;
    }
    // ── Cancel ─────────────────────────────────────────────────────────────────────────────
    if (data === 'doc_maker_cancel') {
        await ctx.answerCallbackQuery({ text: 'تم الإلغاء ❌' });
        ctx.session.isInDocMaker = false;
        ctx.session.documentLines = [];
        ctx.session.tempLine = null;
        ctx.session.tempFormatting = null;
        ctx.session.previewMessageId = undefined;
        await ctx.deleteMessage().catch(() => { });
        return true;
    }
    if (data === 'fmt_align_right') {
        if (!ctx.session.tempFormatting) {
            await ctx.answerCallbackQuery();
            return true;
        }
        ctx.session.tempFormatting.align = 'right';
        await ctx.answerCallbackQuery('✅');
        try {
            const kb = buildFormattingKeyboard(ctx.session.tempFormatting);
            const linePreview = ctx.session.tempLine || '';
            await ctx.editMessageText(`📝 <b>اختر تنسيق النص:</b>\n\n${linePreview}`, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: kb.inline_keyboard }
            });
        }
        catch (e) {
            console.error('[FMT] editMessage failed:', e);
        }
        return true;
    }
    if (data === 'fmt_align_center') {
        if (!ctx.session.tempFormatting) {
            await ctx.answerCallbackQuery();
            return true;
        }
        ctx.session.tempFormatting.align = 'center';
        await ctx.answerCallbackQuery('✅');
        try {
            const kb = buildFormattingKeyboard(ctx.session.tempFormatting);
            const linePreview = ctx.session.tempLine || '';
            await ctx.editMessageText(`📝 <b>اختر تنسيق النص:</b>\n\n${linePreview}`, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: kb.inline_keyboard }
            });
        }
        catch (e) {
            console.error('[FMT] editMessage failed:', e);
        }
        return true;
    }
    if (data === 'fmt_align_left') {
        if (!ctx.session.tempFormatting) {
            await ctx.answerCallbackQuery();
            return true;
        }
        ctx.session.tempFormatting.align = 'left';
        await ctx.answerCallbackQuery('✅');
        try {
            const kb = buildFormattingKeyboard(ctx.session.tempFormatting);
            const linePreview = ctx.session.tempLine || '';
            await ctx.editMessageText(`📝 <b>اختر تنسيق النص:</b>\n\n${linePreview}`, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: kb.inline_keyboard }
            });
        }
        catch (e) {
            console.error('[FMT] editMessage failed:', e);
        }
        return true;
    }
    if (data === 'color_red') {
        if (!ctx.session.tempFormatting) {
            await ctx.answerCallbackQuery();
            return true;
        }
        ctx.session.tempFormatting.color = '#FF0000';
        await ctx.answerCallbackQuery('✅');
        try {
            const kb = buildFormattingKeyboard(ctx.session.tempFormatting);
            const linePreview = ctx.session.tempLine || '';
            await ctx.editMessageText(`📝 <b>اختر تنسيق النص:</b>\n\n${linePreview}`, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: kb.inline_keyboard }
            });
        }
        catch (e) {
            console.error('[FMT] editMessage failed:', e);
        }
        return true;
    }
    if (data === 'color_yellow') {
        if (!ctx.session.tempFormatting) {
            await ctx.answerCallbackQuery();
            return true;
        }
        ctx.session.tempFormatting.color = '#FFD700';
        await ctx.answerCallbackQuery('✅');
        try {
            const kb = buildFormattingKeyboard(ctx.session.tempFormatting);
            const linePreview = ctx.session.tempLine || '';
            await ctx.editMessageText(`📝 <b>اختر تنسيق النص:</b>\n\n${linePreview}`, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: kb.inline_keyboard }
            });
        }
        catch (e) {
            console.error('[FMT] editMessage failed:', e);
        }
        return true;
    }
    if (data === 'color_blue') {
        if (!ctx.session.tempFormatting) {
            await ctx.answerCallbackQuery();
            return true;
        }
        ctx.session.tempFormatting.color = '#1565C0';
        await ctx.answerCallbackQuery('✅');
        try {
            const kb = buildFormattingKeyboard(ctx.session.tempFormatting);
            const linePreview = ctx.session.tempLine || '';
            await ctx.editMessageText(`📝 <b>اختر تنسيق النص:</b>\n\n${linePreview}`, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: kb.inline_keyboard }
            });
        }
        catch (e) {
            console.error('[FMT] editMessage failed:', e);
        }
        return true;
    }
    if (data === 'color_default') {
        if (!ctx.session.tempFormatting) {
            await ctx.answerCallbackQuery();
            return true;
        }
        ctx.session.tempFormatting.color = undefined;
        await ctx.answerCallbackQuery('✅');
        try {
            const kb = buildFormattingKeyboard(ctx.session.tempFormatting);
            const linePreview = ctx.session.tempLine || '';
            await ctx.editMessageText(`📝 <b>اختر تنسيق النص:</b>\n\n${linePreview}`, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: kb.inline_keyboard }
            });
        }
        catch (e) {
            console.error('[FMT] editMessage failed:', e);
        }
        return true;
    }
    if (data === 'color_custom') {
        if (!ctx.session.tempFormatting)
            return true;
        ctx.session.awaitingCustomColor = true;
        await ctx.answerCallbackQuery('🎨 أرسل كود اللون الآن');
        const promptMsg = await ctx.reply('🎨 <b>أرسل كود اللون بصيغة HEX</b>\nمثال: #E91E63', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[
                        { text: '❌ إلغاء', callback_data: 'color_custom_cancel' }
                    ]]
            }
        });
        ctx.session.customColorPromptId = promptMsg.message_id;
        return true;
    }
    if (data === 'color_custom_cancel') {
        await ctx.answerCallbackQuery();
        ctx.session.awaitingCustomColor = false;
        ctx.session.customColorPromptId = undefined;
        await ctx.deleteMessage().catch(() => { });
        return true;
    }
    if (data === 'fmt_apply') {
        if (!ctx.session.tempLine || !ctx.session.tempFormatting) {
            await ctx.answerCallbackQuery('⚠️ لا يوجد نص للحفظ');
            return true;
        }
        ctx.session.documentLines = ctx.session.documentLines || [];
        ctx.session.documentLines.push({
            type: 'text',
            text: ctx.session.tempLine,
            align: ctx.session.tempFormatting.align,
            bold: ctx.session.tempFormatting.bold,
            italic: ctx.session.tempFormatting.italic,
            underline: ctx.session.tempFormatting.underline,
            size: ctx.session.tempFormatting.size,
            style: ctx.session.tempFormatting.style,
            color: ctx.session.tempFormatting.color
        });
        const total = ctx.session.documentLines.length;
        const pages = estimatePageCount(ctx.session.documentLines, ctx.session.pageSize);
        ctx.session.tempLine = undefined;
        ctx.session.tempFormatting = undefined;
        await ctx.answerCallbackQuery('✅ تمت الإضافة');
        try {
            await ctx.editMessageText(`✅ <b>تمت إضافة السطر للمستند!</b>\n\n` +
                `📄 الأسطر: ${total} | الصفحات: ~${pages}\n\n` +
                'أرسل نصاً أو صورة، أو اضغط تصدير.', {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '📤 تصدير الآن', callback_data: 'doc_export_pdf' },
                            { text: '↩️ إعادة آخر سطر', callback_data: 'doc_undo_last' }
                        ],
                        [
                            { text: '📄 صفحة جديدة', callback_data: 'doc_new_page' },
                            { text: '📋 عرض الأسطر', callback_data: 'doc_view_lines' }
                        ],
                        [{ text: '🚪 إنهاء الجلسة', callback_data: 'doc_cancel_end' }]
                    ]
                }
            });
        }
        catch (e) {
            console.error('[FMT] apply editMessage failed:', e);
        }
        return true;
    }
    // ── Smart Export Confirmation ──────────────────────────────────────────────
    if (data === 'doc_export_pdf') {
        const lines = ctx.session.documentLines || [];
        const estimatedPages = estimatePageCount(lines, ctx.session.pageSize);
        if (estimatedPages > 40) {
            await ctx.editMessageText('🚫 <b>المستند كبير جداً!</b>\n\n' +
                `📄 عدد الصفحات المتوقع: <b>${estimatedPages} صفحة</b>\n\n` +
                'الحد المسموح به هو 40 صفحة.\n' +
                'للحصول على صلاحية تصدير حتى 1000 صفحة تواصل مع المطور.', {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[
                            { text: '🔙 العودة للجلسة', callback_data: 'doc_back_to_session_keep' }
                        ]]
                }
            });
            return true;
        }
        let cost;
        if (estimatedPages <= 3)
            cost = 1;
        else if (estimatedPages <= 5)
            cost = 2;
        else if (estimatedPages <= 10)
            cost = 3;
        else if (estimatedPages <= 20)
            cost = 4;
        else
            cost = 5;
        ctx.session.pendingExportCost = cost;
        ctx.session.pendingExportPages = estimatedPages;
        await ctx.editMessageText('📤 <b>تأكيد التصدير</b>\n\n' +
            `📄 مستندك مكوّن من <b>~${estimatedPages} صفحة</b>\n` +
            `💳 سيتم خصم <b>${cost} محاولة</b> من رصيدك\n\n` +
            'هل أنت موافق على المتابعة؟', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[
                        { text: `✅ موافق — خصم ${cost} محاولة`, callback_data: 'doc_export_confirm' },
                        { text: '❌ إلغاء', callback_data: 'doc_export_cancel' }
                    ]]
            }
        });
        return true;
    }
    if (data === 'doc_export_confirm') {
        const cost = ctx.session.pendingExportCost || 1;
        // Fetch real user from database
        const user = await User_1.User.findOne({ telegramId });
        if (!user)
            return true;
        if (user.dailyQuota < cost) {
            await ctx.editMessageText('❌ <b>رصيدك غير كافٍ!</b>\n\n' +
                `💳 رصيدك الحالي: <b>${user.dailyQuota} محاولة</b>\n` +
                `💸 المطلوب: <b>${cost} محاولات</b>\n\n` +
                'أضف رصيداً للمتابعة.', {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[
                            { text: '🔙 العودة', callback_data: 'doc_back_to_session_keep' }
                        ]]
                }
            });
            return true;
        }
        // Deduct attempts from real database
        await User_1.User.updateOne({ telegramId }, { $inc: { dailyQuota: -cost } });
        await ctx.editMessageText('⏳ <b>جاري إنشاء ملف PDF...</b>', { parse_mode: 'HTML' });
        try {
            const { generateDocumentFromLines } = await Promise.resolve().then(() => __importStar(require('../../services/pdfGeneratorService')));
            const safeLines = (ctx.session.documentLines ?? []).filter(l => l !== null && l !== undefined);
            const result = await generateDocumentFromLines(safeLines, ctx.session.pageSize || 'A4', ctx.session.selectedFont || 'Amiri', ctx.session.docBgColor, ctx.session.docTextColor);
            const pdfBuffer = result.buffer;
            const realPages = result.pageCount;
            if (!pdfBuffer || pdfBuffer.length === 0) {
                throw new Error('PDF buffer is empty');
            }
            const { incrementGlobalCounter } = await Promise.resolve().then(() => __importStar(require('../../services/statsService')));
            await incrementGlobalCounter();
            const fileName = `document_${Date.now()}.pdf`;
            const { InputFile } = await Promise.resolve().then(() => __importStar(require('grammy')));
            await ctx.replyWithDocument(new InputFile(pdfBuffer, fileName), {
                caption: '✅ <b>مستندك جاهز!</b>\n' +
                    `📄 الصفحات: ${realPages}\n` +
                    `🔤 الخط: ${ctx.session.selectedFont || 'Amiri'}\n` +
                    `💳 تم خصم: ${cost} محاولة`,
                parse_mode: 'HTML'
            });
            if (BACKUP_CHANNEL_ID) {
                await ctx.api.sendDocument(BACKUP_CHANNEL_ID, new InputFile(pdfBuffer, fileName), {
                    caption: `📦 أرشيف صانع المستندات\n🆔 ${telegramId}`, disable_notification: true,
                }).catch(() => { });
            }
            ctx.session.pendingExportCost = undefined;
            ctx.session.pendingExportPages = undefined;
        }
        catch (err) {
            console.error('[EXPORT] Failed:', err?.message, err?.stack);
            // Refund on failure — real database rollback
            await User_1.User.updateOne({ telegramId }, { $inc: { dailyQuota: cost } });
            await ctx.reply('❌ <b>فشل إنشاء المستند.</b>\n' +
                'تم استرداد محاولاتك تلقائياً.\n\n' +
                `<code>${err?.message || 'unknown error'}</code>`, { parse_mode: 'HTML' });
        }
        return true;
    }
    if (data === 'doc_export_cancel') {
        ctx.session.pendingExportCost = undefined;
        ctx.session.pendingExportPages = undefined;
        await ctx.editMessageText('↩️ <b>تم إلغاء التصدير.</b>\nيمكنك الاستمرار في تعديل المستند.', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[
                        { text: '📤 تصدير PDF', callback_data: 'doc_export_pdf' }
                    ]]
            }
        });
        return true;
    }
    if (data === 'doc_back_to_session_keep') {
        ctx.session.pendingExportCost = undefined;
        ctx.session.pendingExportPages = undefined;
        await ctx.editMessageText('↩️ <b>عدت للجلسة.</b>\nأرسل نصاً أو صورة، أو اضغط تصدير.', {
            parse_mode: 'HTML',
            reply_markup: controlPanel()
        });
        return true;
    }
    // ── Redo ───────────────────────────────────────────────────────────────────
    if (data === 'doc_undo_last') {
        const lines = ctx.session.documentLines || [];
        if (lines.length === 0) {
            await ctx.answerCallbackQuery('⚠️ لا يوجد أسطر للحذف');
            return true;
        }
        const removed = lines.pop();
        ctx.session.documentLines = lines;
        const preview = removed?.type === 'image' || removed?.type === 'image_row'
            ? '[صورة]'
            : (removed?.text?.substring(0, 30) || '[فارغ]');
        const pages = estimatePageCount(lines, ctx.session.pageSize);
        await ctx.answerCallbackQuery('✅ تم الحذف');
        await ctx.editMessageText(`↩️ <b>تم حذف السطر الأخير:</b>\n<i>${preview}</i>\n\n` +
            `📄 الأسطر الآن: ${lines.length} | الصفحات: ~${pages}`, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '📤 تصدير الآن', callback_data: 'doc_export_pdf' },
                        { text: '↩️ إعادة آخر سطر', callback_data: 'doc_undo_last' }
                    ],
                    [
                        { text: '📄 صفحة جديدة', callback_data: 'doc_new_page' },
                        { text: '📋 عرض الأسطر', callback_data: 'doc_view_lines' }
                    ],
                    [{ text: '🚪 إنهاء الجلسة', callback_data: 'doc_cancel_end' }]
                ]
            }
        }).catch(() => { });
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
        ctx.session.tempFormatting = null;
        const total = ctx.session.documentLines.length;
        const pages = estimatePageCount(ctx.session.documentLines, ctx.session.pageSize);
        await ctx.reply(`✅ تم حفظ الصفحة. ابدأ كتابة الصفحة التالية:\n📄 الأسطر: ${total} | الصفحات: ~${pages}`, { reply_markup: controlPanel() });
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
    if (data === 'doc_view_lines') {
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
        ctx.session.tempFormatting = null;
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
        ctx.session.tempFormatting = null;
        ctx.session.awaitingLineEditIndex = false;
        ctx.session.awaitingLineEditText = false;
        ctx.session.editingLineIndex = undefined;
        ctx.session.previewMessageId = undefined;
        await ctx.editMessageText('✅ تم إنهاء المستند. يمكنك البدء من جديد.').catch(() => { });
        return true;
    }
    // ── Formatting toggles ─────────────────────────────────────────────────────
    if (data === 'style_bold') {
        if (!ctx.session.tempFormatting) {
            await ctx.answerCallbackQuery();
            return true;
        }
        ctx.session.tempFormatting.bold = !ctx.session.tempFormatting.bold;
        await ctx.answerCallbackQuery('✅');
        try {
            const kb = buildFormattingKeyboard(ctx.session.tempFormatting);
            const linePreview = ctx.session.tempLine || '';
            await ctx.editMessageText(`📝 <b>اختر تنسيق النص:</b>\n\n${linePreview}`, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: kb.inline_keyboard }
            });
        }
        catch (e) {
            console.error('[FMT] editMessage failed:', e);
        }
        return true;
    }
    if (data === 'style_italic') {
        if (!ctx.session.tempFormatting) {
            await ctx.answerCallbackQuery();
            return true;
        }
        ctx.session.tempFormatting.italic = !ctx.session.tempFormatting.italic;
        await ctx.answerCallbackQuery('✅');
        try {
            const kb = buildFormattingKeyboard(ctx.session.tempFormatting);
            const linePreview = ctx.session.tempLine || '';
            await ctx.editMessageText(`📝 <b>اختر تنسيق النص:</b>\n\n${linePreview}`, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: kb.inline_keyboard }
            });
        }
        catch (e) {
            console.error('[FMT] editMessage failed:', e);
        }
        return true;
    }
    if (data === 'style_underline') {
        if (!ctx.session.tempFormatting) {
            await ctx.answerCallbackQuery();
            return true;
        }
        ctx.session.tempFormatting.underline = !ctx.session.tempFormatting.underline;
        await ctx.answerCallbackQuery('✅');
        try {
            const kb = buildFormattingKeyboard(ctx.session.tempFormatting);
            const linePreview = ctx.session.tempLine || '';
            await ctx.editMessageText(`📝 <b>اختر تنسيق النص:</b>\n\n${linePreview}`, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: kb.inline_keyboard }
            });
        }
        catch (e) {
            console.error('[FMT] editMessage failed:', e);
        }
        return true;
    }
    if (data === 'size_small') {
        if (!ctx.session.tempFormatting) {
            await ctx.answerCallbackQuery();
            return true;
        }
        ctx.session.tempFormatting.size = 'small';
        await ctx.answerCallbackQuery('✅');
        try {
            const kb = buildFormattingKeyboard(ctx.session.tempFormatting);
            const linePreview = ctx.session.tempLine || '';
            await ctx.editMessageText(`📝 <b>اختر تنسيق النص:</b>\n\n${linePreview}`, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: kb.inline_keyboard }
            });
        }
        catch (e) {
            console.error('[FMT] editMessage failed:', e);
        }
        return true;
    }
    if (data === 'size_normal') {
        if (!ctx.session.tempFormatting) {
            await ctx.answerCallbackQuery();
            return true;
        }
        ctx.session.tempFormatting.size = 'normal';
        await ctx.answerCallbackQuery('✅');
        try {
            const kb = buildFormattingKeyboard(ctx.session.tempFormatting);
            const linePreview = ctx.session.tempLine || '';
            await ctx.editMessageText(`📝 <b>اختر تنسيق النص:</b>\n\n${linePreview}`, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: kb.inline_keyboard }
            });
        }
        catch (e) {
            console.error('[FMT] editMessage failed:', e);
        }
        return true;
    }
    if (data === 'size_large') {
        if (!ctx.session.tempFormatting) {
            await ctx.answerCallbackQuery();
            return true;
        }
        ctx.session.tempFormatting.size = 'large';
        await ctx.answerCallbackQuery('✅');
        try {
            const kb = buildFormattingKeyboard(ctx.session.tempFormatting);
            const linePreview = ctx.session.tempLine || '';
            await ctx.editMessageText(`📝 <b>اختر تنسيق النص:</b>\n\n${linePreview}`, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: kb.inline_keyboard }
            });
        }
        catch (e) {
            console.error('[FMT] editMessage failed:', e);
        }
        return true;
    }
    if (data === 'style_quote') {
        if (!ctx.session.tempFormatting) {
            await ctx.answerCallbackQuery();
            return true;
        }
        ctx.session.tempFormatting.style = ctx.session.tempFormatting.style === 'quote' ? 'normal' : 'quote';
        await ctx.answerCallbackQuery('✅');
        try {
            const kb = buildFormattingKeyboard(ctx.session.tempFormatting);
            const linePreview = ctx.session.tempLine || '';
            await ctx.editMessageText(`📝 <b>اختر تنسيق النص:</b>\n\n${linePreview}`, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: kb.inline_keyboard }
            });
        }
        catch (e) {
            console.error('[FMT] editMessage failed:', e);
        }
        return true;
    }
    if (data === 'style_divider') {
        if (!ctx.session.tempFormatting) {
            await ctx.answerCallbackQuery();
            return true;
        }
        ctx.session.tempFormatting.style = ctx.session.tempFormatting.style === 'divider' ? 'normal' : 'divider';
        await ctx.answerCallbackQuery('✅');
        try {
            const kb = buildFormattingKeyboard(ctx.session.tempFormatting);
            const linePreview = ctx.session.tempLine || '';
            await ctx.editMessageText(`📝 <b>اختر تنسيق النص:</b>\n\n${linePreview}`, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: kb.inline_keyboard }
            });
        }
        catch (e) {
            console.error('[FMT] editMessage failed:', e);
        }
        return true;
    }
    if (data === 'style_highlight') {
        if (!ctx.session.tempFormatting) {
            await ctx.answerCallbackQuery();
            return true;
        }
        ctx.session.tempFormatting.style = ctx.session.tempFormatting.style === 'highlight' ? 'normal' : 'highlight';
        await ctx.answerCallbackQuery('✅');
        try {
            const kb = buildFormattingKeyboard(ctx.session.tempFormatting);
            const linePreview = ctx.session.tempLine || '';
            await ctx.editMessageText(`📝 <b>اختر تنسيق النص:</b>\n\n${linePreview}`, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: kb.inline_keyboard }
            });
        }
        catch (e) {
            console.error('[FMT] editMessage failed:', e);
        }
        return true;
    }
    // ── Format Back Button ───────────────────────────────────────────────────────
    if (data === 'doc_format_back') {
        ctx.session.tempLine = undefined;
        ctx.session.tempFormatting = undefined;
        await ctx.answerCallbackQuery('↩️ إلغاء');
        try {
            await ctx.editMessageText('↩️ <b>تم إلغاء النص.</b>\nأرسل نصاً جديداً أو صورة.', {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[
                            { text: '📤 تصدير PDF', callback_data: 'doc_export_pdf' }
                        ]]
                }
            });
        }
        catch (e) {
            console.error('[FMT] back editMessage failed:', e);
        }
        return true;
    }
    // ── End Session ───────────────────────────────────────────────────────────
    if (data === 'doc_end_session') {
        try {
            await ctx.answerCallbackQuery();
            await ctx.reply('⚠️ سيتم حذف جميع بيانات مشروعك نهائياً. هل أنت متأكد؟', { reply_markup: { inline_keyboard: [[
                            { text: '✅ نعم، إنهاء', callback_data: 'doc_confirm_end' },
                            { text: '❌ لا، العودة', callback_data: 'doc_cancel_end' },
                        ]] } });
        }
        catch (e) {
            console.error('[DocMaker] end_session error:', e);
        }
        return true;
    }
    if (data === 'doc_confirm_end') {
        try {
            await ctx.answerCallbackQuery();
            ctx.session.documentLines = [];
            ctx.session.tempLine = null;
            ctx.session.tempFormatting = null;
            ctx.session.docType = undefined;
            ctx.session.templateId = undefined;
            ctx.session.pageSize = undefined;
            ctx.session.isInDocMaker = false;
            ctx.session.editingLineIndex = undefined;
            ctx.session.awaitingLineEditIndex = false;
            ctx.session.awaitingLineEditText = false;
            ctx.session.previewMessageId = undefined;
            await ctx.editMessageText('✅ تم إنهاء الجلسة. يمكنك البدء من جديد.', { reply_markup: undefined }).catch(() => { });
        }
        catch (e) {
            console.error('[DocMaker] confirm_end error:', e);
        }
        return true;
    }
    if (data === 'doc_cancel_end') {
        try {
            await ctx.answerCallbackQuery();
            await ctx.deleteMessage().catch(() => { });
        }
        catch (e) {
            console.error('[DocMaker] cancel_end error:', e);
        }
        return true;
    }
    // 1. Trigger Background Color Selection
    if (data === 'doc_template_colored') {
        await ctx.answerCallbackQuery();
        await ctx.editMessageText('🎨 <b>تصميم نموذج ملون (خطوة 1/2):</b>\n\nاختر <b>لون خلفية</b> المستند (ألوان هادئة واحترافية):', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'أسود هادئ 🖤', callback_data: 'doc_bg_#1A1A1A' },
                        { text: 'رمادي فاتح 🤍', callback_data: 'doc_bg_#F0F2F5' }
                    ],
                    [
                        { text: 'كحلي ليلي 🌌', callback_data: 'doc_bg_#1B263B' },
                        { text: 'مريمية هادئ 🌿', callback_data: 'doc_bg_#8F9779' }
                    ],
                    [
                        { text: 'بيج كلاسيكي 📜', callback_data: 'doc_bg_#FDF5E6' },
                        { text: 'عنابي داكن 🍷', callback_data: 'doc_bg_#4A232C' }
                    ],
                    [{ text: '🔙 رجوع للنماذج', callback_data: 'doc_type_text' }]
                ]
            }
        });
        return true;
    }
    // 2. Save Background & Trigger Text Color Selection
    if (data.startsWith('doc_bg_')) {
        await ctx.answerCallbackQuery();
        ctx.session.docBgColor = data.replace('doc_bg_', '');
        await ctx.editMessageText('🔤 <b>تصميم نموذج ملون (خطوة 2/2):</b>\n\nاختر <b>لون النص</b> المتناسق مع الخلفية:', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'أبيض ناصع ⚪', callback_data: 'doc_txt_#FFFFFF' },
                        { text: 'أسود فاحم ⚫', callback_data: 'doc_txt_#000000' }
                    ],
                    [
                        { text: 'رمادي داكن 🔘', callback_data: 'doc_txt_#333333' },
                        { text: 'ذهبي فاخر ✨', callback_data: 'doc_txt_#D4AF37' }
                    ],
                    [
                        { text: 'أزرق ملكي 🔵', callback_data: 'doc_txt_#1D3557' },
                        { text: 'أحمر قاني 🔴', callback_data: 'doc_txt_#8B0000' }
                    ],
                    [{ text: '🔙 رجوع لاختيار الخلفية', callback_data: 'doc_template_colored' }]
                ]
            }
        });
        return true;
    }
    // 3. Save Text Color → Bulletproof color preview via sharp { create }
    if (data.startsWith('doc_txt_')) {
        await ctx.answerCallbackQuery();
        ctx.session.docTextColor = data.replace('doc_txt_', '');
        ctx.session.selectedTemplate = 'colored';
        const bgColor = ctx.session.docBgColor || '#FFFFFF';
        const txtColor = ctx.session.docTextColor || '#000000';
        // Bulletproof: create solid background via { create }, composite SVG text on top.
        // sharp does NOT support %-based SVG dims reliably — always use absolute px.
        const W = 600, H = 800;
        const midY = Math.round(H * 0.45);
        const subY = Math.round(H * 0.56);
        const svgText = [
            `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`,
            `  <text x="${W / 2}" y="${midY}" font-family="sans-serif" font-size="38" font-weight="bold"`,
            `        fill="${txtColor}" text-anchor="middle" dominant-baseline="middle">معاينة النموذج الملون</text>`,
            `  <text x="${W / 2}" y="${subY}" font-family="sans-serif" font-size="18"`,
            `        fill="${txtColor}" text-anchor="middle" dominant-baseline="middle" opacity="0.75">خلفية: ${bgColor}  ·  نص: ${txtColor}</text>`,
            `</svg>`,
        ].join('\n');
        try {
            const sharpLib = (await Promise.resolve().then(() => __importStar(require('sharp')))).default;
            // Parse hex color → RGBA for sharp background
            const hex = bgColor.replace('#', '');
            const r = parseInt(hex.slice(0, 2), 16) || 0;
            const g = parseInt(hex.slice(2, 4), 16) || 0;
            const b = parseInt(hex.slice(4, 6), 16) || 0;
            const previewBuffer = await sharpLib({
                create: { width: W, height: H, channels: 4, background: { r, g, b, alpha: 1 } },
            })
                .composite([{ input: Buffer.from(svgText), blend: 'over' }])
                .png()
                .toBuffer();
            await ctx.deleteMessage().catch(() => { });
            const sent = await ctx.replyWithPhoto(new grammy_1.InputFile(previewBuffer, 'color_preview.png'), {
                caption: `🎨 <b>معاينة النموذج: ملون</b>\n\n` +
                    `<b>خلفية:</b> <code>${bgColor}</code>  ·  <b>نص:</b> <code>${txtColor}</code>\n\n` +
                    `هذه معاينة مبدئية للألوان. اضغط ✅ موافق للمتابعة.`,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [[
                            { text: '✅ موافق', callback_data: 'doc_colored_approve' },
                            { text: '🔙 رجوع', callback_data: 'doc_colored_back' },
                        ]] },
            });
            // Store as previewMessageId so native doc_custom_size can editMessageCaption on it
            ctx.session.previewMessageId = sent.message_id;
        }
        catch (err) {
            console.error('[PREVIEW] Color preview failed:', err);
            await ctx.editMessageText(`✅ <b>تم حفظ الألوان</b> (خلفية: ${bgColor} · نص: ${txtColor})\n\nاضغط متابعة للمتابعة:`, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [[
                            { text: 'متابعة ➡️', callback_data: 'doc_colored_approve' },
                        ]] },
            }).catch(() => ctx.reply(`✅ تم حفظ الألوان. اضغط متابعة:`));
        }
        return true;
    }
    // 4. Colored approve → EXACTLY the same as doc_tpl_confirm: editMessageCaption + SIZE_KB
    if (data === 'doc_colored_approve') {
        await ctx.answerCallbackQuery();
        // Use editMessageCaption on the preview photo (same as native doc_tpl_confirm flow)
        await ctx.editMessageCaption({
            caption: '📐 <b>اختر مقاس الصفحة:</b>',
            parse_mode: 'HTML',
            reply_markup: SIZE_KB,
        }).catch(() => { });
        return true;
    }
    // 5. Colored back → re-show text color selection
    if (data === 'doc_colored_back') {
        await ctx.answerCallbackQuery();
        await ctx.deleteMessage().catch(() => { });
        await ctx.reply('🔤 <b>تصميم نموذج ملون (خطوة 2/2):</b>\n\nاختر <b>لون النص</b> المتناسق مع الخلفية:', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'أبيض ناصع ⚪', callback_data: 'doc_txt_#FFFFFF' },
                        { text: 'أسود فاحم ⚫', callback_data: 'doc_txt_#000000' },
                    ],
                    [
                        { text: 'رمادي داكن 🔘', callback_data: 'doc_txt_#333333' },
                        { text: 'ذهبي فاخر ✨', callback_data: 'doc_txt_#D4AF37' },
                    ],
                    [
                        { text: 'أزرق ملكي 🔵', callback_data: 'doc_txt_#1D3557' },
                        { text: 'أحمر قاني 🔴', callback_data: 'doc_txt_#8B0000' },
                    ],
                    [{ text: '🔙 رجوع لاختيار الخلفية', callback_data: 'doc_template_colored' }],
                ],
            },
        });
        return true;
    }
    // ── A) Locked alignment (used in row) ────────────────────────────────────
    if (data === 'doc_img_align_locked') {
        await ctx.answerCallbackQuery({ text: '🔒 هذه المحاذاة مستخدمة في هذا السطر', show_alert: true });
        return true;
    }
    // ── B) Alignment / Mask buttons (set on tempImage) ───────────────────────
    if (data.startsWith('doc_img_fmt_') || data.startsWith('doc_img_mask_')) {
        if (!ctx.session.tempImage)
            return true;
        if (data.startsWith('doc_img_fmt_')) {
            ctx.session.tempImage.align = data.replace('doc_img_fmt_', '');
        }
        else if (data.startsWith('doc_img_mask_')) {
            ctx.session.tempImage.mask = data.replace('doc_img_mask_', '');
        }
        // Acknowledge the click immediately so the button doesn't load infinitely
        await ctx.answerCallbackQuery();
        // Calling this will now correctly UPDATE the existing message with the ✅ checks
        await showImageFormatMenu(ctx);
        return true;
    }
    // ── C) Add current image to row, await next image ────────────────────
    if (data === 'doc_row_add_image') {
        if (!ctx.session.tempImage?.fileId || !ctx.session.tempImage.align || !ctx.session.tempImage.mask) {
            await ctx.answerCallbackQuery({ text: '⚠️ أكمل إعداد الصورة الحالية أولاً', show_alert: true });
            return true;
        }
        const rowImages = ctx.session.rowImages || [];
        if (rowImages.length >= 3) {
            await ctx.answerCallbackQuery({ text: '⚠️ لا يمكن إضافة أكثر من 3 صور في سطر واحد', show_alert: true });
            return true;
        }
        rowImages.push({
            fileId: ctx.session.tempImage.fileId,
            lines: ctx.session.tempImage.lines || 5,
            align: ctx.session.tempImage.align,
            mask: ctx.session.tempImage.mask,
        });
        ctx.session.rowImages = rowImages;
        ctx.session.tempImage = undefined;
        ctx.session.awaitingNextRowImage = true;
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(`✅ تم حفظ الصورة ${rowImages.length}\n\n🖼 أرسل الصورة الإضافية الآن:\n` +
            `تنبيه: يجب ألا يتجاوز حجمها ${rowImages[0].lines} سطر (نفس حجم الأولى)`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[
                        { text: '🔙 إلغاء وإنهاء السطر', callback_data: 'doc_row_finish' }
                    ]] } });
        return true;
    }
    // ── D) Request caption for a specific row image ────────────────────
    if (data.startsWith('doc_row_caption_') && data !== 'doc_row_caption_skip') {
        const rawId = data.replace('doc_row_caption_', '');
        if (rawId === 'temp') {
            ctx.session.tempCaptionTarget = 'temp';
            ctx.session.docState = 'awaiting_row_caption';
            await ctx.answerCallbackQuery();
            await ctx.editMessageText(`📝 أرسل النص الذي تريده تحت الصورة الحالية:`, { reply_markup: { inline_keyboard: [[
                            { text: '❌ تخطي بدون تسمية', callback_data: 'doc_row_caption_skip' }
                        ]] } });
            return true;
        }
        const idx = parseInt(rawId, 10);
        const rowImages = ctx.session.rowImages || [];
        if (isNaN(idx) || idx < 0 || idx >= rowImages.length) {
            await ctx.answerCallbackQuery({ text: '⚠️ صورة غير موجودة', show_alert: true });
            return true;
        }
        ctx.session.tempCaptionTarget = idx;
        ctx.session.docState = 'awaiting_row_caption';
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(`📝 أرسل النص الذي تريده تحت الصورة ${idx + 1}:`, { reply_markup: { inline_keyboard: [[
                        { text: '❌ تخطي بدون تسمية', callback_data: 'doc_row_caption_skip' }
                    ]] } });
        return true;
    }
    // ── E) Skip caption ──────────────────────────────────────────
    if (data === 'doc_row_caption_skip') {
        ctx.session.tempCaptionTarget = undefined;
        ctx.session.docState = 'active';
        await ctx.answerCallbackQuery();
        await showImageFormatMenu(ctx);
        return true;
    }
    // ── F) Finish the row and commit to documentLines ──────────────────
    if (data === 'doc_row_finish') {
        const rowImages = ctx.session.rowImages || [];
        if (ctx.session.tempImage?.fileId && ctx.session.tempImage.align && ctx.session.tempImage.mask) {
            rowImages.push({
                fileId: ctx.session.tempImage.fileId,
                lines: ctx.session.tempImage.lines || 5,
                align: ctx.session.tempImage.align,
                mask: ctx.session.tempImage.mask,
                caption: ctx.session.tempImage.caption
            });
        }
        if (rowImages.length === 0) {
            await ctx.answerCallbackQuery({ text: '⚠️ لا توجد صور لإضافتها', show_alert: true });
            return true;
        }
        // Safely save to document lines
        ctx.session.documentLines = ctx.session.documentLines || [];
        ctx.session.documentLines.push({
            type: 'image_row',
            rowImages: rowImages,
            imageLines: rowImages[0].lines, // Fallback line height
            align: 'center'
        });
        // Wipe all temporary row data
        ctx.session.rowImages = undefined;
        ctx.session.tempImage = undefined;
        ctx.session.awaitingNextRowImage = false;
        ctx.session.tempCaptionTarget = undefined;
        ctx.session.docState = 'active';
        await ctx.answerCallbackQuery({ text: '✅ تمت إضافة السطر للمستند!' });
        await ctx.deleteMessage().catch(() => { });
        await ctx.deleteMessage().catch(() => { });
        await renderActiveSession(ctx);
        return true;
    }
    return false;
}
// ── MESSAGE HANDLER ────────────────────────────────────────────────────────────
async function handleDocMakerMessage(ctx) {
    if (!ctx.session || !ctx.from)
        return false;
    const rawText = ctx.message?.text || '';
    const trimmedInput = rawText.trim();
    const emptyLineMatch = trimmedInput.match(/^(فارغ|فارع|فراغ|فاضي|فاضية|empty)\s*(\d{1,2})?$/i);
    if (emptyLineMatch && ctx.session.isInDocMaker) {
        const count = Math.min(Math.max(1, parseInt(emptyLineMatch[2] || '1')), 20);
        ctx.session.documentLines = ctx.session.documentLines || [];
        for (let i = 0; i < count; i++) {
            ctx.session.documentLines.push({ type: 'text', text: '' });
        }
        const total = ctx.session.documentLines.length;
        const pages = estimatePageCount(ctx.session.documentLines, ctx.session.pageSize);
        await ctx.reply(`✅ <b>تمت إضافة ${count} سطر فارغ</b>\n` +
            `📄 إجمالي الأسطر: ${total} | الصفحات: ~${pages}\n\n` +
            'أرسل المزيد أو اضغط تصدير.', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '📤 تصدير الآن', callback_data: 'doc_export_pdf' },
                        { text: '↩️ إعادة آخر سطر', callback_data: 'doc_undo_last' }
                    ],
                    [
                        { text: '📄 صفحة جديدة', callback_data: 'doc_new_page' },
                        { text: '📋 عرض الأسطر', callback_data: 'doc_view_lines' }
                    ],
                    [{ text: '🚪 إنهاء الجلسة', callback_data: 'doc_cancel_end' }]
                ]
            }
        });
        await refreshPreview(ctx);
        return true; // NEVER reaches format menu
    }
    if (ctx.session.awaitingCustomColor) {
        const hexText = ctx.message?.text?.trim();
        if (!hexText)
            return false;
        if (!/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(hexText)) {
            await ctx.reply('❌ كود غير صحيح\n\nأرسل بصيغة HEX مثل: #FF5733', { parse_mode: 'HTML' });
            return true;
        }
        if (ctx.session.tempFormatting) {
            ctx.session.tempFormatting = { ...ctx.session.tempFormatting, color: hexText };
        }
        ctx.session.awaitingCustomColor = false;
        // Delete user's message
        await ctx.deleteMessage().catch(() => { });
        // Delete bot's prompt message
        if (ctx.session.customColorPromptId && ctx.chat) {
            await ctx.api.deleteMessage(ctx.chat.id, ctx.session.customColorPromptId).catch(() => { });
            ctx.session.customColorPromptId = undefined;
        }
        await ctx.reply(`✅ تم تحديد اللون: ${hexText}\n\nاضغط ✅ تطبيق في رسالة التنسيق للحفظ.`, { parse_mode: 'HTML' });
        return true;
    }
    // ── CAPTION INTERCEPTOR (MUST BE ABSOLUTE FIRST) ─────────────────────────────
    if (ctx.session.docState === 'awaiting_row_caption' && ctx.session.tempCaptionTarget !== undefined) {
        const captionText = ctx.message?.text?.trim();
        if (!captionText)
            return false;
        if (ctx.session.tempCaptionTarget === 'temp' && ctx.session.tempImage) {
            ctx.session.tempImage.caption = captionText;
        }
        else if (typeof ctx.session.tempCaptionTarget === 'number') {
            const rowImgs = ctx.session.rowImages || [];
            if (rowImgs[ctx.session.tempCaptionTarget]) {
                rowImgs[ctx.session.tempCaptionTarget].caption = captionText;
            }
        }
        ctx.session.tempCaptionTarget = undefined;
        ctx.session.docState = 'active';
        await ctx.reply('✅ تم حفظ النص بنجاح!');
        await showImageFormatMenu(ctx);
        return true; // HALT — do NOT fall through to any safety trap
    }
    // If tempImage exists and message is a number → it is a line count input
    if (ctx.session?.tempImage?.fileId && ctx.message?.text) {
        const num = parseInt(ctx.message.text.trim());
        if (!isNaN(num) && num >= 1 && num <= 50) {
            ctx.session.tempImage.lines = num;
            ctx.session.docState = 'active';
            await showImageFormatMenu(ctx);
            return true;
        }
        // Non-number text while image pending → block it
        await ctx.reply('⚠️ <b>أكمل إعدادات الصورة أولاً</b>\nأو اضغط إلغاء.', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[
                        { text: '🔙 إلغاء الصورة والعودة', callback_data: 'doc_back_to_session' }
                    ]]
            }
        });
        return true;
    }
    const text = trimmedInput;
    if (!text || text.startsWith('/'))
        return false;
    // HARD STOP: never process text as doc-content during image configuration
    if (ctx.session?.docState === 'awaiting_custom_img_lines') {
        return false; // number input is handled by the session trap — do not touch it
    }
    if (ctx.session?.docState === 'active' && ctx.session?.tempImage?.fileId) {
        return false; // user has a pending image — do not open text format menu
    }
    // ── Custom size: step 1 — awaiting width (cm) ────────────────────────────
    if (ctx.session.awaitingCustomWidth) {
        try {
            const w = parseFloat(text);
            if (isNaN(w) || w < 5 || w > 200) {
                await ctx.reply('⚠️ الرجاء إرسال رقم صحيح بين 5 و 200');
                return true;
            }
            ctx.session.customSizeWidth = w;
            ctx.session.awaitingCustomWidth = false;
            ctx.session.awaitingCustomHeight = true;
            await ctx.reply('📐 أرسل <b>الارتفاع</b> بالسنتيمتر (مثال: 29.7):', { parse_mode: 'HTML' });
        }
        catch (e) {
            console.error('[DocMaker] custom width error:', e);
        }
        return true;
    }
    // ── Custom size: step 2 — awaiting height (cm) ──────────────────────────
    if (ctx.session.awaitingCustomHeight) {
        try {
            const h = parseFloat(text);
            if (isNaN(h) || h < 5 || h > 200) {
                await ctx.reply('⚠️ الرجاء إرسال رقم صحيح بين 5 و 200');
                return true;
            }
            const wCm = ctx.session.customSizeWidth;
            const CM_TO_PT = 28.35;
            const label = `${wCm}×${h} سم`;
            ctx.session.awaitingCustomHeight = false;
            ctx.session.customSizeDims = { width: wCm * CM_TO_PT, height: h * CM_TO_PT, label };
            ctx.session.pageSize = label;
            ctx.session.isInDocMaker = true;
            ctx.session.documentLines = [];
            ctx.session.tempLine = null;
            ctx.session.tempFormatting = null;
            await ctx.reply(`✅ <b>تم تحديد المقاس: ${label}</b>\n\nابدأ الكتابة:`, { parse_mode: 'HTML', reply_markup: COMPILE_KB });
            await ctx.reply(DOC_MAKER_INSTRUCTION, { parse_mode: 'HTML' });
        }
        catch (e) {
            console.error('[DocMaker] custom height error:', e);
        }
        return true;
    }
    // For all remaining steps the user must be inside an active doc maker session
    if (!ctx.session.isInDocMaker)
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
        if (ctx.session.tempLine) {
            await ctx.deleteMessage().catch(() => { });
            return true;
        }
        ctx.session.tempLine = text;
        ctx.session.tempFormatting = ctx.session.tempFormatting || {
            align: 'right',
            bold: false,
            italic: false,
            underline: false,
            size: 'normal',
            style: 'normal'
        };
        await ctx.reply(`📝 <b>اختر تنسيق النص الجديد:</b>\n\n${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}`, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: buildFormattingKeyboard(ctx.session.tempFormatting).inline_keyboard
            }
        });
        return true;
    }
    // Enforce Alignment Selection
    // FIXED: Do NOT delete or resend the formatting message.
    // Just delete the user's new message silently and do nothing else.
    // The existing formatting message stays visible with all its buttons.
    if (ctx.session.tempLine) {
        await ctx.deleteMessage().catch(() => { });
        return true;
    }
    ctx.session.tempLine = text;
    ctx.session.tempFormatting = ctx.session.tempFormatting || {
        align: 'right',
        bold: false,
        italic: false,
        underline: false,
        size: 'normal',
        style: 'normal'
    };
    await ctx.reply(`📝 <b>اختر تنسيق النص:</b>\n\n${text}`, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: buildFormattingKeyboard(ctx.session.tempFormatting).inline_keyboard
        }
    });
    return true;
}
// ── Image Format Menu Helper ───────────────────────────────────────────────────
async function showImageFormatMenu(ctx) {
    const rowImages = ctx.session.rowImages || [];
    const usedAligns = rowImages.map((img) => img.align).filter(Boolean);
    // Current active selections
    const currentAlign = ctx.session.tempImage?.align;
    const currentMask = ctx.session.tempImage?.mask;
    const isTempReady = currentAlign && currentMask;
    const keyboard = [
        // 1. Align (Show ✅ if currently selected, 🔒 if used in row)
        [
            {
                text: currentAlign === 'right' ? '✅ يمين' : (usedAligns.includes('right') ? '🔒 يمين' : '➡️ يمين'),
                callback_data: usedAligns.includes('right') ? 'doc_img_align_locked' : 'doc_img_fmt_right'
            },
            {
                text: currentAlign === 'center' ? '✅ وسط' : (usedAligns.includes('center') ? '🔒 وسط' : '↔️ وسط'),
                callback_data: usedAligns.includes('center') ? 'doc_img_align_locked' : 'doc_img_fmt_center'
            },
            {
                text: currentAlign === 'left' ? '✅ يسار' : (usedAligns.includes('left') ? '🔒 يسار' : '⬅️ يسار'),
                callback_data: usedAligns.includes('left') ? 'doc_img_align_locked' : 'doc_img_fmt_left'
            },
        ],
        // 2. Mask (Show ✅ if currently selected)
        [
            { text: currentMask === 'circle' ? '✅ دائري' : '⭕ دائري', callback_data: 'doc_img_mask_circle' },
            { text: currentMask === 'rounded' ? '✅ حواف ناعمة' : '🔲 حواف ناعمة', callback_data: 'doc_img_mask_rounded' },
            { text: currentMask === 'square' ? '✅ مربع عادي' : '⬛ مربع عادي', callback_data: 'doc_img_mask_square' },
        ]
    ];
    // Reveal advanced options ONLY when both align and mask are selected
    if (isTempReady) {
        keyboard.push([{ text: ctx.session.tempImage?.caption ? '✏️ تعديل النص تحت الصورة' : '📝 إضافة نص تحت الصورة', callback_data: 'doc_row_caption_temp' }]);
        if (rowImages.length < 2) {
            keyboard.push([{ text: '🖼 إضافة صورة بجانبها في نفس السطر', callback_data: 'doc_row_add_image' }]);
        }
        keyboard.push([{ text: '✅ إتمام التعديلات وإضافة للمستند', callback_data: 'doc_row_finish' }]);
    }
    // Captions for already saved images in this row
    const captionBtns = rowImages.map((img, idx) => ({
        text: img.caption ? `✏️ تعديل نص صورة ${idx + 1}` : `📝 نص صورة ${idx + 1}`, callback_data: `doc_row_caption_${idx}`
    }));
    if (captionBtns.length > 0)
        keyboard.push(captionBtns);
    keyboard.push([{ text: '🔙 رجوع وإلغاء الصورة', callback_data: 'doc_back_to_session' }]);
    const text = '🎨 <b>تنسيق الصورة:</b>\n\nاختر <b>المحاذاة</b> وشكل <b>الإطار</b> كلاهما معاً ثم تُحفَظ الصورة تلقائياً:';
    const options = { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } };
    // CRITICAL FIX: Prevent crashes and message duplication.
    // If it's a button click (callbackQuery), EDIT the message in place.
    // If it's a photo upload or text message, SEND a new message.
    if (ctx.callbackQuery) {
        try {
            await ctx.editMessageText(text, options);
        }
        catch (err) {
            await ctx.reply(text, options); // Fallback just in case
        }
    }
    else {
        await ctx.reply(text, options);
    }
}
//# sourceMappingURL=docMakerHandler.js.map