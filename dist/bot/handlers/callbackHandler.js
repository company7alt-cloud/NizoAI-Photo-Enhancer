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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.callbackHandler = callbackHandler;
// src/bot/handlers/callbackHandler.ts
const grammy_1 = require("grammy");
const sharp_1 = __importDefault(require("sharp"));
const uuid_1 = require("uuid");
const adm_zip_1 = __importDefault(require("adm-zip"));
const pdfkit_1 = __importDefault(require("pdfkit"));
const User_1 = require("../../database/models/User");
const validators_1 = require("../../utils/validators");
const imageService = __importStar(require("../../services/imageService"));
const adminAlert_1 = require("../../utils/adminAlert");
const BotSettings_1 = require("../../database/models/BotSettings");
const channelFundService_1 = require("../../services/channelFundService");
const FundCampaign_1 = require("../../database/models/FundCampaign");
const settingsService_1 = require("../../services/settingsService");
const onnxEnhanceService_1 = require("../../services/onnxEnhanceService");
const ForceSubChannel_1 = require("../../database/models/ForceSubChannel");
const GRID_CONFIGS = {
    30: { cols: 5, rows: 6 },
    40: { cols: 5, rows: 8 },
    50: { cols: 5, rows: 10 },
    70: { cols: 7, rows: 10 },
    80: { cols: 8, rows: 10 },
    100: { cols: 10, rows: 10 },
};
const ARCHIVE_GROUP_ID = process.env.ARCHIVE_GROUP_ID ?? '';
const CHANNEL_ID = process.env.CHANNEL_ID ?? '';
const BACKUP_CHANNEL_ID = ARCHIVE_GROUP_ID || CHANNEL_ID;
async function showFormatSelection(ctx, count, _upscale) {
    const isSingle = count === 1;
    const keyboard = [
        [
            { text: '🖼 PNG', callback_data: 'fconv_png' },
            { text: '🖼 JPG', callback_data: 'fconv_jpg' },
            { text: '🖼 WEBP', callback_data: 'fconv_webp' },
        ],
        [
            { text: '🖼 AVIF', callback_data: 'fconv_avif' },
            { text: '🖼 TIFF', callback_data: 'fconv_tiff' },
        ],
    ];
    // Add PDF and SVG only for single image
    if (isSingle) {
        keyboard.push([
            { text: '📄 PDF', callback_data: 'fconv_pdf' },
            { text: '🎨 SVG', callback_data: 'fconv_svg' },
        ]);
    }
    keyboard.push([{ text: '❌ إلغاء', callback_data: 'convert_format_cancel' }]);
    await ctx.reply(`🔄 <b>اختر الصيغة التي تريد التحويل إليها:</b>\n` +
        (isSingle ? '📄 PDF و SVG متاحان للصورة الواحدة فقط' : ''), {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard },
    });
}
async function callbackHandler(ctx) {
    const data = ctx.callbackQuery?.data;
    if (!data || !ctx.from)
        return;
    // ── Admin User Control Handlers ──────────────────────────────────────────
    if (data === 'admin_user_control') {
        const adminIds = (process.env.ADMIN_IDS || '').split(',');
        if (!adminIds.includes(ctx.from.id.toString()))
            return;
        await ctx.editMessageText('👥 <b>لوحة التحكم في العملاء</b>\n\nاختر الإجراء المطلوب:', {
            parse_mode: 'HTML',
            reply_markup: new grammy_1.InlineKeyboard()
                .text('🚫 حظر العميل', 'auc_ban').text('⚠️ تقييد العميل', 'auc_restrict').row()
                .text('✅ فك الحظر', 'auc_unban').text('♻️ فك التقييد', 'auc_unrestrict').row()
                .text('ℹ️ معلومات العميل', 'auc_info').row()
                .text('🔙 رجوع', 'admin_panel')
        }).catch(() => { });
        return;
    }
    if (['auc_ban', 'auc_restrict', 'auc_unban', 'auc_unrestrict', 'auc_info'].includes(data)) {
        const adminIds = (process.env.ADMIN_IDS || '').split(',');
        if (!adminIds.includes(ctx.from.id.toString()))
            return;
        const actionMap = {
            auc_ban: 'حظر', auc_restrict: 'تقييد', auc_unban: 'فك حظر',
            auc_unrestrict: 'فك تقييد', auc_info: 'استعلام عن'
        };
        await User_1.User.updateOne({ telegramId: ctx.from.id.toString() }, { $set: { adminActionState: data } });
        await ctx.editMessageText(`قم بإرسال <b>ID</b> العميل المراد <b>${actionMap[data]}</b>:\n\n(أو اضغط إلغاء)`, {
            parse_mode: 'HTML',
            reply_markup: new grammy_1.InlineKeyboard().text('❌ إلغاء', 'admin_cancel_action')
        }).catch(() => { });
        return;
    }
    if (data === 'admin_cancel_action') {
        const adminIds = (process.env.ADMIN_IDS || '').split(',');
        if (!adminIds.includes(ctx.from.id.toString()))
            return;
        await User_1.User.updateOne({ telegramId: ctx.from.id.toString() }, { $set: { adminActionState: '', adminTargetId: '' } });
        await ctx.editMessageText('تم الإلغاء ❌').catch(() => { });
        return;
    }
    if (data.startsWith('auc_confirm_')) {
        const adminIds = (process.env.ADMIN_IDS || '').split(',');
        if (!adminIds.includes(ctx.from.id.toString()))
            return;
        const parts = data.split('_'); // auc_confirm_ban_12345
        const action = parts[2];
        const targetId = parts[3];
        const targetUser = await User_1.User.findOne({ telegramId: targetId });
        if (!targetUser) {
            await ctx.answerCallbackQuery({ text: 'العميل غير موجود!' });
            return;
        }
        let msg = '';
        if (action === 'ban') {
            await User_1.User.updateOne({ telegramId: targetId }, { $set: { isBanned: true, isPermBanned: false } });
            msg = 'تم حظر العميل بنجاح 🚫';
            await ctx.api.sendMessage(targetId, "⚠️ <b>عذراً منك صديقي!</b>\n\nتم حظر حسابك من استخدام خدمات البوت.\nإذا كنت تعتقد أن هناك خطأ أو لبس في هذا الحظر، يمكنك فتح محادثة مع الإدارة لمراجعة حسابك.", { parse_mode: 'HTML', reply_markup: new grammy_1.InlineKeyboard().text('💬 فتح محادثة مع الإدارة', 'user_appeal') }).catch(() => { });
        }
        else if (action === 'restrict') {
            await User_1.User.updateOne({ telegramId: targetId }, { $set: { isRestricted: true } });
            msg = 'تم تقييد العميل بنجاح ⚠️';
        }
        else if (action === 'unban' || action === 'unrestrict') {
            await User_1.User.updateOne({ telegramId: targetId }, { $set: { isBanned: false, isRestricted: false, isPermBanned: false, isAppealing: false } });
            msg = 'تم فك القيود عن العميل ✅';
            await ctx.api.sendMessage(targetId, "✅ <b>تم مراجعة حسابك ورفع القيود!</b>\nيمكنك الآن استخدام البوت بشكل طبيعي.", { parse_mode: 'HTML' }).catch(() => { });
        }
        await User_1.User.updateOne({ telegramId: ctx.from.id.toString() }, { $set: { adminActionState: '', adminTargetId: '' } });
        await ctx.editMessageText(msg).catch(() => { });
        return;
    }
    if (data === 'user_appeal') {
        await User_1.User.updateOne({ telegramId: ctx.from.id.toString() }, { $set: { isAppealing: true } });
        await ctx.editMessageText("📝 <b>تواصل مع الإدارة:</b>\n\nاكتب رسالتك أو شكواك في رسالة واحدة وسنقوم بإرسالها للإدارة فوراً.", { parse_mode: 'HTML' }).catch(() => { });
        return;
    }
    if (data.startsWith('auc_permban_')) {
        const targetId = data.replace('auc_permban_', '');
        await User_1.User.updateOne({ telegramId: targetId }, { $set: { isPermBanned: true, isAppealing: false } });
        const msgText = ctx.callbackQuery?.message?.text || '';
        await ctx.editMessageText(msgText + '\n\n💀 <b>تم الحظر النهائي (لن تصلك رسائله).</b>', { entities: ctx.callbackQuery?.message?.entities }).catch(() => { });
        return;
    }
    // ── Handle open_filters_menu (inline button from start menu) ────────────────
    if (data === 'open_filters_menu') {
        await ctx.answerCallbackQuery().catch(() => { });
        const filterMenuSettings = await (0, settingsService_1.getSettings)();
        const filterMenuAdminIds = (process.env.ADMIN_IDS || '').split(',');
        const isFilterMenuAdmin = filterMenuAdminIds.includes(ctx.from.id.toString());
        if (filterMenuSettings.locks.btn_filters && !isFilterMenuAdmin) {
            await ctx.answerCallbackQuery({ text: '🔒 قسم الفلاتر مغلق مؤقتاً', show_alert: true }).catch(() => { });
            return;
        }
        await ctx.reply('🎨 <b>فلاتر ومعالجة الصور الاحترافية</b>\n\n' +
            'اختر الفلتر الذي تريد تطبيقه على صورتك:\n\n' +
            '👤 <b>تصفية الوجه</b> — يحسن الملامح ويزيل التشويش\n' +
            '🎨 <b>تلوين الصور القديمة</b> — يلون الأبيض والأسود\n' +
            '🌸 <b>تحويل إلى أنمي</b> — يحول صورتك لأنمي احترافي\n' +
            '✨ <b>تأثير جيبلي فني</b> — فن رقمي ساحر', {
            parse_mode: 'HTML',
            reply_markup: new grammy_1.InlineKeyboard()
                .text('👤 تصفية الوجه', 'filter_face').text('🎨 تلوين الصور', 'filter_color').row()
                .text('🌸 تحويل أنمي', 'filter_anime').text('✨ تأثير جيبلي', 'filter_ghibli').row()
                .text('🪄 ترميم الصور القديمة', 'filter_restore').row()
                .text('❌ إلغاء', 'cancel_filter')
        });
        return;
    }
    // ── Handle custom restore filter ──────────────────────────────────────────────
    if (data.startsWith('filter_')) {
        const originalFileId = ctx.session?.activeImageFileId || ctx.session?.pendingFile?.fileId;
        if (!originalFileId) {
            if (data === 'filter_restore') {
                if (ctx.session)
                    ctx.session.awaitingFilterAction = 'filter_restore';
                await ctx.editMessageText(`📸 <b>أرسل الصورة الآن:</b>\n\nقم بإرسال الصورة القديمة أو المشققة ليتم ترميمها وإصلاحها فوراً.`, { parse_mode: 'HTML' }).catch(() => { });
                return;
            }
            await ctx.answerCallbackQuery({
                text: '⚠️ لم يتم العثور على صورة في الجلسة. أرسل الصورة أولاً ثم حاول مرة أخرى.',
                show_alert: true
            });
            return;
        }
        if (data === 'filter_restore') {
            await ctx.answerCallbackQuery('⏳ جاري ترميم وإصلاح الصورة...');
            try {
                const tgFile = await ctx.api.getFile(originalFileId);
                const imageUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;
                const { processImageFilter } = await Promise.resolve().then(() => __importStar(require('../../services/imageService')));
                const processedImageBuffer = await processImageFilter(imageUrl, 'restore');
                const archiveChatId = process.env.ARCHIVE_CHANNEL_ID || process.env.ARCHIVE_GROUP_ID || process.env.CHANNEL_ID;
                if (archiveChatId) {
                    await ctx.api.sendMediaGroup(archiveChatId, [
                        { type: 'photo', media: originalFileId, caption: `👤 العميل: ${ctx.from?.id}\n📷 الصورة الأصلية (قبل)` },
                        { type: 'photo', media: new grammy_1.InputFile(processedImageBuffer, 'Restored_Photo.jpg'), caption: `✨ الصورة المرممة (بعد)` }
                    ]).catch((err) => console.error('[ARCHIVE ERROR]', err));
                }
                const docInputFile = new grammy_1.InputFile(processedImageBuffer, 'Restored_Photo.jpg');
                await ctx.replyWithDocument(docInputFile, {
                    caption: '✅ <b>تم ترميم وإصلاح الصورة بنجاح!</b>\n\nاختر الصيغة التي تريد تحويل الصورة إليها:',
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '🖼 PNG', callback_data: 'conv_png' },
                                { text: '🖼 JPG', callback_data: 'conv_jpg' },
                                { text: '🖼 WEBP', callback_data: 'conv_webp' },
                            ],
                            [
                                { text: '🖼 AVIF', callback_data: 'conv_avif' },
                                { text: '🖼 TIFF', callback_data: 'conv_tiff' },
                            ],
                        ]
                    }
                });
                await ctx.deleteMessage().catch(() => { });
            }
            catch (err) {
                console.error('[RESTORE FILTER ERROR]', err);
                await ctx.reply('❌ عذراً، حدث خطأ أثناء عملية ترميم الصورة.');
            }
            return;
        }
    }
    // ── Handle filter selection ───────────────────────────────────────────────────
    if (['filter_face', 'filter_color', 'filter_anime', 'filter_ghibli'].includes(data)) {
        await ctx.answerCallbackQuery().catch(() => { });
        const costMap = {
            face: 2, color: 2, anime: 3, ghibli: 3
        };
        const filterType = data.replace('filter_', '');
        const cost = costMap[filterType];
        const filterUser = await User_1.User.findOne({ telegramId: ctx.from.id.toString() });
        if (!filterUser)
            return;
        const filterAdminIds = (process.env.ADMIN_IDS || '').split(',');
        const isFilterAdmin = filterAdminIds.includes(ctx.from.id.toString());
        if (!isFilterAdmin && filterUser.dailyQuota < cost) {
            await ctx.reply(`⚠️ رصيدك غير كافٍ!\nتحتاج <b>${cost} محاولات</b> لهذا الفلتر.\nرصيدك الحالي: <b>${filterUser.dailyQuota}</b>`, { parse_mode: 'HTML' });
            return;
        }
        await User_1.User.updateOne({ telegramId: ctx.from.id.toString() }, { $set: {
                awaitingFilterImage: true,
                selectedFilterType: filterType,
                awaitingCustomEraserImage: false,
                awaitingCustomEraserZone: false,
                awaitingNanoBananaImage: false,
                awaitingAutoEraserImage: false
            } });
        await ctx.editMessageText(`🖼️ <b>أرسل الصورة الآن</b>\n\n` +
            `سيتم تطبيق الفلتر خلال 30-60 ثانية ✨\n` +
            `⚡ <b>التكلفة: ${cost} محاولات</b>\n` +
            `💡 <i>تُخصم عند النجاح فقط</i>`, {
            parse_mode: 'HTML',
            reply_markup: new grammy_1.InlineKeyboard().text('❌ إلغاء', 'cancel_filter')
        }).catch(() => { });
        return;
    }
    // ── Handle cancel_filter ──────────────────────────────────────────────────────
    if (data === 'cancel_filter') {
        await ctx.answerCallbackQuery().catch(() => { });
        await User_1.User.updateOne({ telegramId: ctx.from.id.toString() }, { $set: { awaitingFilterImage: false, selectedFilterType: '' } });
        await ctx.editMessageText('تم الإلغاء ❌').catch(() => { });
        return;
    }
    if (data === 'show_global_stats') {
        const { getGlobalCounter } = await Promise.resolve().then(() => __importStar(require('../../services/statsService')));
        const total = await getGlobalCounter();
        await ctx.answerCallbackQuery({
            text: `🚀 إحصائيات البوت:\n\nتمت معالجة وتحسين أكثر من [ ${total} ] صورة وملف بنجاح عبر نظامنا الذكي! 🌟`,
            show_alert: true
        }).catch(() => { });
        return;
    }
    if (data === 'check_force_sub') {
        await ctx.answerCallbackQuery().catch(() => { });
        const userId = ctx.from.id;
        const channels = await ForceSubChannel_1.ForceSubChannel.find().sort({ order: 1 });
        if (channels.length === 0) {
            await ctx.deleteMessage().catch(() => { });
            return;
        }
        let allSubscribed = true;
        for (const ch of channels) {
            try {
                const member = await ctx.api.getChatMember(ch.channelId, userId);
                if (['left', 'kicked'].includes(member.status)) {
                    allSubscribed = false;
                    break;
                }
            }
            catch {
                // Cannot verify — allow user through (bot may have lost admin)
                // This prevents an infinite block loop
                console.error(`[CheckForceSub] Cannot verify channel ${ch.channelId}`);
            }
        }
        if (allSubscribed) {
            await ctx.answerCallbackQuery({
                text: '✅ تم التحقق! يمكنك استخدام البوت الآن 🎉',
                show_alert: true,
            }).catch(() => { });
            await ctx.deleteMessage().catch(() => { });
        }
        else {
            await ctx.answerCallbackQuery({
                text: '❌ لم تشترك في جميع القنوات بعد!',
                show_alert: true,
            }).catch(() => { });
        }
        return;
    }
    if (data.startsWith("eraser_fmt_")) {
        await ctx.answerCallbackQuery();
        const user = await User_1.User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user?.lastEraserResultBuffer) {
            await ctx.reply("❌ انتهت صلاحية الملف. أرسل الصورة مجدداً.");
            return;
        }
        const formatMap = {
            eraser_fmt_jpg: 'jpeg',
            eraser_fmt_png: 'png',
            eraser_fmt_webp: 'webp',
            eraser_fmt_gif: 'gif',
            eraser_fmt_tiff: 'tiff',
        };
        const targetFormat = formatMap[data];
        if (!targetFormat)
            return;
        const processingMsg = await ctx.reply(`⏳ جاري تحويل الصيغة إلى ${data.split('_')[2].toUpperCase()}...`);
        try {
            const inputBuffer = Buffer.from(user.lastEraserResultBuffer, 'base64');
            // Convert using sharp
            const convertedBuffer = await (0, sharp_1.default)(inputBuffer)
                .toFormat(targetFormat, {
                quality: 100,
                lossless: targetFormat === 'webp',
            })
                .toBuffer();
            await ctx.api.deleteMessage(ctx.chat.id, processingMsg.message_id).catch(() => { });
            const ext = targetFormat === 'jpeg' ? 'jpg' : targetFormat;
            const { incrementGlobalCounter } = await Promise.resolve().then(() => __importStar(require('../../services/statsService')));
            await incrementGlobalCounter();
            await ctx.replyWithDocument(new grammy_1.InputFile(convertedBuffer, `converted_${Date.now()}.${ext}`), {
                caption: `✅ تم التحويل إلى ${ext.toUpperCase()} بنجاح`,
            });
        }
        catch (err) {
            await ctx.api.deleteMessage(ctx.chat.id, processingMsg.message_id).catch(() => { });
            await ctx.reply("❌ فشل التحويل. حاول مرة أخرى.");
            console.error("[EraserFmt] Error:", err.message);
        }
        return;
    }
    const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
    const isAdminUser = adminIds.includes(ctx.from.id.toString());
    const settings = await (0, settingsService_1.getSettings)();
    const locks = settings.locks;
    const lockMap = {
        'enhance_2k': locks.btn_2k,
        'enhance_4k': locks.btn_4k,
        'locked_8k': locks.btn_8k,
        'process_4k_ai': locks.btn_4kai,
        'locked_8k_ai': locks.btn_8kai,
        'nano_banana_start': locks.btn_nano,
        'eraser_start': locks.btn_eraser,
        'remove_watermark_auto': locks.btn_eraser,
        'doc_maker_start': locks.btn_doc_maker,
    };
    const bypassUser = await User_1.User.findOne({ telegramId: ctx.from.id }).select('canBypassLocks');
    const canBypass = isAdminUser || bypassUser?.canBypassLocks === true;
    if (!canBypass && lockMap[data] === true) {
        await ctx.answerCallbackQuery({
            text: '⚠️ هذا القسم مغلق مؤقتاً للتحديث. متاح حالياً للمطورين والمشتركين المعتمدين فقط.',
            show_alert: true
        }).catch(() => { });
        return;
    }
    // Admin callbacks are now handled at the bottom of this file
    if (data === 'toggle_fake_counter') {
        if (!isAdminUser)
            return;
        const { GlobalStat } = await Promise.resolve().then(() => __importStar(require('../../database/models/GlobalStat')));
        const config = await GlobalStat.findOne({ key: 'total_processed' });
        const newState = !(config?.isFakeCounterActive || false);
        await GlobalStat.updateOne({ key: 'total_processed' }, { $set: { isFakeCounterActive: newState } }, { upsert: true });
        await ctx.answerCallbackQuery({ text: 'تم تحديث حالة العداد الوهمي 🔄' }).catch(() => { });
        // Rebuild the admin keyboard correctly using InlineKeyboard
        const adminKeyboard = new grammy_1.InlineKeyboard()
            .text(`📈 العداد الوهمي: ${newState ? '✅ شغال' : '❌ متوقف'}`, 'toggle_fake_counter').row()
            .text('✏️ تعديل رسالة الترحيب', 'admin_edit_welcome').row()
            .text('🎁 تعديل عدد المحاولات اليومية', 'admin_edit_daily').row()
            .text('⚠️ تعديل رسالة انتهاء المحاولات', 'admin_edit_low').row()
            .text('📊 إحصائيات البوت', 'admin_stats').row()
            .text('🔍 البحث عن مستخدم', 'admin_search_user').row()
            .text('📢 إرسال إشعار لجميع المستخدمين', 'admin_broadcast').row()
            .text('🔧 وضع الصيانة', 'admin_maintenance').row()
            .text('📢 تمويل أعضاء قناة', 'start_fund_campaign').row()
            .text('⚙️ إدارة أزرار البوت (قفل/فتح)', 'admin_panel').row()
            .text('🔄 إعدادات زر تحويل الصيغة', 'admin_edit_convert_msg').row()
            .text('✏️ تعديل نصوص البوت', 'admin_edit_texts').row()
            .text('🎯 إدارة المحاولات', 'admin_manage_attempts').row()
            .text('🔗 إنشاء رابط مكافأة', 'admin_create_magic_link');
        await ctx.editMessageReplyMarkup(adminKeyboard).catch(() => { });
        return;
    }
    // ── STEP 1: Fetch FRESH user ──────────────────────────────────────────────────
    let user = await User_1.User.findOne({ telegramId: ctx.from.id });
    if (!user) {
        user = await User_1.User.create({
            telegramId: ctx.from.id,
            firstName: ctx.from.first_name ?? '',
            username: ctx.from.username,
            language: ctx.from.language_code ?? 'en',
            dailyQuota: 5,
            lastQuotaReset: new Date(),
        });
    }
    // ── STEP 2: Ban check ─────────────────────────────────────────────────────────
    if (user.isBanned) {
        void ctx.answerCallbackQuery({
            text: '🚫 عذراً، تم تقييد وصولك للبوت. للاستفسار تواصل مع المطور 💙',
            show_alert: true,
        }).catch(() => { });
        return;
    }
    // ── STEP 3: Auto-reset logic removed. User MUST click daily reward button. ──
    // ── STEP 4: Admin flag ────────────────────────────────────────────────────────
    const admin = (0, validators_1.isAdmin)(ctx.from.id);
    // ── STEP 5: Locked 8K ─────────────────────────────────────────────────────────
    if (data === 'locked_8k') {
        void ctx.answerCallbackQuery({
            text: '🔒 هذه الميزة مقفلة حالياً 💫\nتواصل مع المطور لفتح ميزة الـ 8K ✨',
            show_alert: true,
        }).catch(() => { });
        return;
    }
    if (data === 'locked_4k') {
        void ctx.answerCallbackQuery({
            text: '🔒 هذه الميزة مقفلة حالياً 💫\nتواصل مع المطور لفتح الميزة ✨',
            show_alert: true,
        }).catch(() => { });
        return;
    }
    // ── Helper: get Telegram file URL from session ────────────────────────────────
    const pendingFile = ctx.session?.pendingFile;
    const getTelegramFileUrl = async () => {
        if (!pendingFile?.fileId)
            return null;
        const tgFile = await ctx.api.getFile(pendingFile.fileId);
        if (!tgFile.file_path)
            return null;
        return `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;
    };
    // ── Helper: forward result to public channel ──────────────────────────────────
    const forwardToChannel = async (buf, fileName, resolution, jobId) => {
        if (!BACKUP_CHANNEL_ID)
            return;
        const actionUser = ctx.from;
        const userLink = actionUser?.username
            ? `@${actionUser.username}`
            : `<a href="tg://user?id=${actionUser?.id}">${actionUser?.first_name || 'مجهول'}</a>`;
        const caption = `📦 <b>نسخة أرشيفية</b>\n` +
            `━━━━━━━━━━━━━━\n` +
            `🆔 <b>User ID:</b> <code>${actionUser?.id}</code>\n` +
            `👤 <b>Username:</b> ${userLink}\n` +
            `🏷 <b>Job ID:</b> <code>${jobId}</code>\n` +
            `💎 <b>Resolution:</b> ${resolution}\n` +
            `📅 <b>Time:</b> ${new Date().toLocaleString('ar-SA')}\n` +
            `━━━━━━━━━━━━━━`;
        try {
            await ctx.api.sendDocument(BACKUP_CHANNEL_ID, new grammy_1.InputFile(buf, fileName), {
                disable_notification: true,
                caption: caption,
                parse_mode: 'HTML',
            });
        }
        catch (fwdErr) {
            console.error('[Archive Error]', fwdErr);
        }
    };
    // ── STEP 6: enhance_2k ───────────────────────────────────────────────────────
    if (data === 'enhance_2k') {
        const resolution = '2K';
        await ctx.answerCallbackQuery().catch(() => { });
        if (resolution !== '2K') {
            if (!admin && user.dailyQuota < 1) {
                await ctx.reply('🌙 أوه! انتهت محاولاتك اليومية 🥺\nعد غداً وستجد 5 محاولات جديدة بانتظارك 🎁✨');
                return;
            }
        }
        const telegramFileUrl = await getTelegramFileUrl();
        if (!telegramFileUrl) {
            await ctx.reply('❌ انتهت الجلسة. أرسل الصورة مجدداً.');
            return;
        }
        if (resolution !== '2K') {
            if (!admin) {
                user.dailyQuota -= 1;
                await user.save();
            }
        }
        const jobId = (0, uuid_1.v4)().substring(0, 8).toUpperCase();
        await ctx.editMessageText('⏳ جاري تحسين صورتك بدقة 2K...\nالرجاء الانتظار لحظات 🌟');
        if (ctx.session)
            ctx.session.pendingFile = undefined;
        try {
            const resultBuffer = await imageService.enhance(telegramFileUrl, '2K');
            user.totalEnhancements += 1;
            await user.save();
            const outputFileName = `NizoAI_2K_${jobId}.jpg`;
            const { incrementGlobalCounter } = await Promise.resolve().then(() => __importStar(require('../../services/statsService')));
            await incrementGlobalCounter();
            await ctx.replyWithDocument(new grammy_1.InputFile(resultBuffer, outputFileName), {
                caption: `🎉 صورتك جاهزة بدقة 2K! 🌟\n🏷 Job ID: ${jobId}\n⚡ محاولاتك المتبقية: ${user.dailyQuota}`,
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '🖼 PNG', callback_data: 'conv_png' },
                            { text: '🖼 JPG', callback_data: 'conv_jpg' },
                            { text: '🖼 WEBP', callback_data: 'conv_webp' },
                        ],
                        [
                            { text: '🖼 AVIF', callback_data: 'conv_avif' },
                            { text: '🖼 TIFF', callback_data: 'conv_tiff' },
                        ],
                    ],
                },
            });
            await ctx.deleteMessage().catch(() => { });
            // Forward to channel (silent — never affects user)
            void forwardToChannel(resultBuffer, outputFileName, '2K', jobId);
        }
        catch {
            if (resolution !== '2K') {
                if (!admin) {
                    user.dailyQuota += 1;
                    await user.save();
                }
            }
            await ctx.deleteMessage().catch(() => { });
            await ctx.reply('😔 عذراً حدث خطأ أثناء معالجة صورتك 🌸\nتم إعادة محاولتك تلقائياً ✨\nجرب مرة أخرى وسنكون معك 💙');
        }
        return;
    }
    // ── STEP 7: enhance_4k ───────────────────────────────────────────────────────
    if (data === 'enhance_4k') {
        await ctx.answerCallbackQuery().catch(() => { });
        if (!admin && user.dailyQuota < 2) {
            await ctx.reply(`💫 تحتاج محاولتين لدقة 4K الفائقة 🌟\nرصيدك الحالي: ${user.dailyQuota} محاولة 🥺\nاستخدم دقة 2K أو عد غداً لـ 5 محاولات جديدة 🎁`);
            return;
        }
        const telegramFileUrl = await getTelegramFileUrl();
        if (!telegramFileUrl) {
            await ctx.reply('❌ انتهت الجلسة. أرسل الصورة مجدداً.');
            return;
        }
        if (!admin) {
            user.dailyQuota -= 2;
            await user.save();
        }
        const jobId = (0, uuid_1.v4)().substring(0, 8).toUpperCase();
        await ctx.editMessageText('⚙️ جاري المعالجة بدقة 4K الفائقة ✨\nهذه العملية تستهلك محاولتين من رصيدك 💎\nالرجاء الانتظار، قد تستغرق دقيقة أو أكثر 🌸');
        ctx.session && (ctx.session.pendingFile = undefined);
        try {
            const resultBuffer = await imageService.enhance(telegramFileUrl, '4K');
            user.totalEnhancements += 1;
            await user.save();
            const outputFileName = `NizoAI_4K_${jobId}.jpg`;
            const { incrementGlobalCounter } = await Promise.resolve().then(() => __importStar(require('../../services/statsService')));
            await incrementGlobalCounter();
            await ctx.replyWithDocument(new grammy_1.InputFile(resultBuffer, outputFileName), {
                caption: `💎 صورتك جاهزة بدقة 4K الفائقة! ✨\n🏷 Job ID: ${jobId}\n⚡ محاولاتك المتبقية: ${user.dailyQuota}`,
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '🖼 PNG', callback_data: 'conv_png' },
                            { text: '🖼 JPG', callback_data: 'conv_jpg' },
                            { text: '🖼 WEBP', callback_data: 'conv_webp' },
                        ],
                        [
                            { text: '🖼 AVIF', callback_data: 'conv_avif' },
                            { text: '🖼 TIFF', callback_data: 'conv_tiff' },
                        ],
                    ],
                },
            });
            await ctx.deleteMessage().catch(() => { });
            // Forward to channel (silent — never affects user)
            void forwardToChannel(resultBuffer, outputFileName, '4K', jobId);
        }
        catch {
            if (!admin) {
                user.dailyQuota += 2;
                await user.save();
            }
            await ctx.deleteMessage().catch(() => { });
            await ctx.reply('😔 عذراً حدث خطأ أثناء معالجة صورتك بدقة 4K 🌸\nتم إعادة المحاولتين تلقائياً ✨\nجرب مرة أخرى وسنكون معك 💙');
        }
        return;
    }
    // ── process_4k_ai & locked_8k_ai ───────────────────────────────────────────
    if (data === 'locked_8k_ai') {
        void ctx.answerCallbackQuery({
            text: '🔒 هذه الميزة مقفلة. تواصل مع المدير لتفعيلها',
            show_alert: true,
        }).catch(() => { });
        return;
    }
    if (data === 'process_4k_ai') {
        // ── Resolve file ID, file name, and file size from message ──────────────
        const msg = ctx.callbackQuery?.message;
        let fileId;
        let fileSize = 0;
        let fileName = 'RealESRGAN_Enhanced.jpg';
        if (msg?.photo && msg.photo.length > 0) {
            const photo = msg.photo[msg.photo.length - 1];
            fileId = photo.file_id;
            fileSize = photo.file_size ?? 0;
        }
        else if (msg?.reply_to_message?.photo?.length > 0) {
            const photo = msg.reply_to_message.photo[msg.reply_to_message.photo.length - 1];
            fileId = photo.file_id;
            fileSize = photo.file_size ?? 0;
        }
        else if (msg?.document?.mime_type?.startsWith('image/')) {
            fileId = msg.document.file_id;
            fileSize = msg.document.file_size ?? 0;
            fileName = (msg.document.file_name?.replace(/\.[^/.]+$/, '') || 'RealESRGAN_Enhanced') + '.jpg';
        }
        else if (msg?.reply_to_message?.document?.mime_type?.startsWith('image/')) {
            fileId = msg.reply_to_message.document.file_id;
            fileSize = msg.reply_to_message.document.file_size ?? 0;
            fileName = (msg.reply_to_message.document.file_name?.replace(/\.[^/.]+$/, '') || 'RealESRGAN_Enhanced') + '.jpg';
        }
        // STEP 1 — Pre-checks (before any DB write) ──────────────────────────────
        if (!fileId) {
            await ctx.answerCallbackQuery({ text: 'عذراً، لم أتمكن من العثور على الصورة ❌', show_alert: true });
            return;
        }
        if (fileSize > 2 * 1024 * 1024) {
            await ctx.answerCallbackQuery({ text: '❌ حجم الصورة يتجاوز 2 ميجابايت. يرجى إرسال صورة أصغر.', show_alert: true });
            return;
        }
        // STEP 2 — Atomic lock + deduction (3 points) ───────────────────────────
        const lockedUser = await User_1.User.findOneAndUpdate({
            telegramId: ctx.from.id.toString(),
            isProcessingImage: { $ne: true },
            dailyQuota: { $gte: 3 },
        }, {
            $set: { isProcessingImage: true },
            $inc: { dailyQuota: -3 },
        }, { new: true });
        if (!lockedUser) {
            // Distinguish between «already processing» and «not enough quota»
            const check = await User_1.User.findOne({ telegramId: ctx.from.id.toString() });
            if (check?.isProcessingImage) {
                await ctx.answerCallbackQuery({ text: '⏳ جاري معالجة طلبك بالفعل. انتظر حتى ينتهي.', show_alert: true });
                return;
            }
            await ctx.answerCallbackQuery({ text: '❌ رصيدك غير كافٍ. هذا التحسين يتطلب 3 محاولات.', show_alert: true });
            return;
        }
        // Acknowledge the button press
        await ctx.answerCallbackQuery({ text: 'بدأ التحسين... ⏳' }).catch(() => { });
        // Delete the inline-keyboard message
        try {
            if (msg?.message_id && msg?.chat?.id) {
                await ctx.api.deleteMessage(msg.chat.id, msg.message_id);
            }
        }
        catch (_e) { /* ignore */ }
        let processingMsg = null;
        try {
            // STEP 3 — Queue status message ────────────────────────────────────────
            const queuePos = (0, onnxEnhanceService_1.getQueuePosition)();
            if (queuePos > 0) {
                processingMsg = await ctx.reply(`⏳ تم وضعك في طابور الانتظار (${queuePos} قبلك)...\nسيتم معالجة صورتك قريباً بتقنية RealESRGAN AI`);
            }
            else {
                processingMsg = await ctx.reply('🔬 جاري تحليل صورتك بنموذج RealESRGAN AI...\nقد يستغرق 30-60 ثانية');
            }
            // STEP 4 — Download image as Buffer ────────────────────────────────────
            const tgFile = await ctx.api.getFile(fileId);
            const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;
            const fetchRes = await fetch(fileUrl);
            if (!fetchRes.ok)
                throw new Error('download_failed');
            const inputBuffer = Buffer.from(await fetchRes.arrayBuffer());
            // STEP 5 — Run RealESRGAN ───────────────────────────────────────────────
            if (processingMsg) {
                await ctx.api
                    .editMessageText(processingMsg.chat.id, processingMsg.message_id, '✨ *جاري معالجة الصورة بلمسة سحرية...*\n⏳ يتم الآن رفع الدقة وإبراز التفاصيل المخفية، لحظات من فضلك.', { parse_mode: 'Markdown' })
                    .catch(() => { });
            }
            const resultBuffer = await (0, onnxEnhanceService_1.enhanceWithONNX)(inputBuffer);
            // Delete processing message
            if (processingMsg) {
                try {
                    await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id);
                }
                catch (_e) { }
                processingMsg = null;
            }
            // STEP 6 — Deliver to user ─────────────────────────────────────────────
            const { incrementGlobalCounter } = await Promise.resolve().then(() => __importStar(require('../../services/statsService')));
            await incrementGlobalCounter();
            await ctx.replyWithDocument(new grammy_1.InputFile(resultBuffer, fileName), {
                caption: '✨ تم التحسين بنموذج RealESRGAN AI ×4 | NizoAI Bot 🚀',
                reply_to_message_id: ctx.msg?.message_id,
            });
            // STEP 7 — Channel backup (untouched original logic) ───────────────────
            const actionUser = ctx.from;
            const userLink = actionUser?.username
                ? `@${actionUser.username}`
                : `<a href="tg://user?id=${actionUser?.id}">${actionUser?.first_name || 'مجهول'}</a>`;
            const archiveCaption = `📦 نسخة أرشيفية\n\n` +
                `🆔 User ID: ${actionUser?.id}\n` +
                `👤 Username: ${userLink}\n` +
                `💎 Resolution: RealESRGAN ×4\n` +
                `🕐 Time: ${new Date().toLocaleString('ar-SA')}`;
            await ctx.api.sendDocument(BACKUP_CHANNEL_ID, new grammy_1.InputFile(resultBuffer, fileName), { caption: archiveCaption, parse_mode: 'HTML' });
            if (CHANNEL_ID && CHANNEL_ID !== BACKUP_CHANNEL_ID) {
                try {
                    await ctx.api.sendDocument(CHANNEL_ID, new grammy_1.InputFile(resultBuffer, fileName), { caption: '✨ تمت المعالجة بنجاح', disable_notification: true });
                }
                catch (e) {
                    console.error('[RealESRGAN Channel Forward]', e);
                }
            }
        }
        catch (error) {
            // STEP 8 — Error handler + refund ──────────────────────────────────────
            // Do NOT refund if the error was a pre-download file-size rejection
            if (!(error instanceof Error && error.message === 'file_too_large')) {
                const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
                const isAdminCaller = adminIds.includes(ctx.from.id.toString());
                if (!isAdminCaller) {
                    await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $inc: { dailyQuota: 3 } });
                }
            }
            // Clean up any leftover processing message
            if (processingMsg) {
                try {
                    await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id);
                }
                catch (_e) { }
            }
            const errMsg = error instanceof Error && error.message === 'download_failed'
                ? '❌ فشل تحميل الصورة. تم إرجاع محاولاتك.'
                : '❌ حدث خطأ في المعالجة. تم إرجاع محاولاتك.';
            await ctx.reply(errMsg);
            console.error('[RealESRGAN Error]', error);
        }
        finally {
            // STEP 9 — Release lock (always) ────────────────────────────────────────
            await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { isProcessingImage: false } }).catch(() => { });
        }
        return;
    }
    // ── enhance_again ─────────────────────────────────────────────────────────────
    if (data === 'enhance_again') {
        await ctx.answerCallbackQuery().catch(() => { });
        await ctx.editMessageText('📸 أرسل الصورة الجديدة التي تريد تحسينها.');
        return;
    }
    // ══════════════════════════════════════
    // 🎁 الهدية اليومية
    // ══════════════════════════════════════
    if (data === 'claim_daily_reward') {
        try {
            const telegramId = ctx.from?.id.toString();
            if (!telegramId)
                return;
            const user = await User_1.User.findOne({ telegramId });
            if (!user)
                return;
            // ── Referral Gate: must have 2 successful referrals ──────────
            const referralCount = await User_1.User.countDocuments({
                referredBy: ctx.from.id.toString(),
                referralRewardClaimed: true
            });
            const REQUIRED_REFERRALS = 2;
            if (referralCount < REQUIRED_REFERRALS) {
                const botUsername = (await ctx.api.getMe()).username;
                const referralLink = `https://t.me/${botUsername}?start=${ctx.from.id}`;
                await ctx.answerCallbackQuery({
                    text: `تحتاج دعوة ${REQUIRED_REFERRALS - referralCount} شخص إضافي للحصول على الهدية`,
                    show_alert: true
                }).catch(() => { });
                await ctx.reply(`🎁 <b>الهدية اليومية</b>\n\n` +
                    `للحصول على هديتك اليومية، يجب أن تكون قد دعوت صديقين عبر رابطك الخاص أولاً.\n\n` +
                    `📊 <b>تقدمك:</b> ${referralCount} / ${REQUIRED_REFERRALS} دعوات ✅\n\n` +
                    `🔗 <b>رابط دعوتك:</b>\n<code>${referralLink}</code>\n\n` +
                    `شارك هذا الرابط مع صديقين، وبمجرد انضمامهم للبوت ستتمكن من استلام هديتك اليومية 🚀`, { parse_mode: 'HTML' });
                return;
            }
            const now = new Date();
            const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
            if (user.lastRewardDate) {
                const timePassed = now.getTime() - new Date(user.lastRewardDate).getTime();
                if (timePassed < TWENTY_FOUR_HOURS) {
                    const timeLeft = TWENTY_FOUR_HOURS - timePassed;
                    const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
                    const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
                    const claimTime = new Date(user.lastRewardDate).toLocaleTimeString('ar-SA', {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true,
                    });
                    await ctx.answerCallbackQuery({
                        text: `عذراً 🌹\nاستلمت هديتك اليومية الساعة ${claimTime}\nباقي لك: ${hoursLeft} ساعة و ${minutesLeft} دقيقة للاستلام القادم 🕐`,
                        show_alert: true
                    }).catch(() => { });
                    return;
                }
            }
            // Atomic update — prevents race conditions from double clicks
            await User_1.User.findOneAndUpdate({ telegramId }, {
                $inc: { dailyQuota: 5 },
                $set: { lastRewardDate: now },
            });
            await ctx.answerCallbackQuery({
                text: '🎉 مبروك! تمت إضافة 5 محاولات مجانية لحسابك.\nعُد غداً لاستلام هديتك الجديدة 🎁',
                show_alert: true
            }).catch(() => { });
        }
        catch (error) {
            console.error('[DailyReward] Error:', error);
            await (0, adminAlert_1.sendAdminAlert)(ctx, `Daily Reward Error: ${error.message}`);
        }
        return;
    }
    // ══════════════════════════════════════
    // 🛡️ أزرار الأدمن — حظر وتقييد
    // ══════════════════════════════════════
    if (data.startsWith('admin_ban_')) {
        if (!isAdminUser)
            return;
        const targetId = data.replace('admin_ban_', '');
        await User_1.User.findOneAndUpdate({ telegramId: targetId }, { isBanned: true });
        await ctx.answerCallbackQuery({ text: '✅ تم حظر العميل بنجاح!', show_alert: true }).catch(() => { });
        await ctx.editMessageReplyMarkup(undefined);
        return;
    }
    if (data.startsWith('admin_restrict_')) {
        if (!isAdminUser)
            return;
        const targetId = data.replace('admin_restrict_', '');
        await User_1.User.findOneAndUpdate({ telegramId: targetId }, { $set: { dailyQuota: 0, isRestricted: true } });
        await ctx.answerCallbackQuery({ text: '✅ تم تقييد العميل وتصفير محاولاته بنجاح!', show_alert: true }).catch(() => { });
        await ctx.editMessageReplyMarkup(undefined);
        return;
    }
    if (data === 'show_welcome') {
        await ctx.answerCallbackQuery().catch(() => { });
        const { startCommand } = await Promise.resolve().then(() => __importStar(require('../commands/start')));
        await startCommand(ctx);
        return;
    }
    if (data === 'report_to_dev') {
        await ctx.answerCallbackQuery().catch(() => { });
        const telegramId = ctx.from?.id.toString();
        await User_1.User.findOneAndUpdate({ telegramId }, { $set: { awaitingReport: true } });
        await ctx.reply('🌹 فضلاً أرسل لنا بلاغك (رسالة أو صورة)\nوسيتم الرد عليك في أسرع وقت ممكن 💬', {
            reply_markup: {
                inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'cancel_report' }]],
            },
        });
        return;
    }
    if (data === 'cancel_report') {
        await ctx.answerCallbackQuery({ text: 'تم الإلغاء' }).catch(() => { });
        const telegramId = ctx.from?.id.toString();
        await User_1.User.findOneAndUpdate({ telegramId }, { $set: { awaitingReport: false } });
        return;
    }
    if (data.startsWith('confirm_report_')) {
        await ctx.answerCallbackQuery();
        // Parse chatId and messageId from callback data
        const withoutPrefix = data.replace('confirm_report_', '');
        const underscoreIdx = withoutPrefix.indexOf('_');
        const sourceChatId = Number(withoutPrefix.substring(0, underscoreIdx));
        const sourceMessageId = Number(withoutPrefix.substring(underscoreIdx + 1));
        if (!sourceChatId || !sourceMessageId || isNaN(sourceChatId) || isNaN(sourceMessageId)) {
            await ctx.editMessageText('❌ انتهت صلاحية البلاغ. يرجى إرسال بلاغ جديد.').catch(() => { });
            return;
        }
        const adminIdsRaw = process.env.ADMIN_IDS || '';
        const adminIds = adminIdsRaw.split(',').map((id) => id.trim());
        const userId = ctx.from?.id;
        const firstName = ctx.from?.first_name || 'مجهول';
        const username = ctx.from?.username ? `@${ctx.from.username}` : 'لا يوجد معرف';
        const userLink = `tg://user?id=${userId}`;
        const reportHeader = `🚨 <b>بلاغ جديد من عميل</b>\n\n` +
            `👤 <b>العميل:</b> <a href="${userLink}">${firstName}</a>\n` +
            `🔗 <b>المعرف:</b> ${username}\n` +
            `🆔 <b>الـ ID:</b> <code>${userId}</code>\n` +
            `📅 <b>التوقيت:</b> ${new Date().toLocaleString('ar-SA')}`;
        let forwarded = false;
        for (const adminId of adminIds) {
            try {
                // Send header with user info and action buttons
                await ctx.api.sendMessage(Number(adminId), reportHeader, {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🚫 حظر العميل', callback_data: `admin_ban_${userId}` }],
                            [{ text: '🔒 تقييد العميل', callback_data: `admin_restrict_${userId}` }],
                            [{ text: '💬 فتح محادثة دعم', callback_data: `admin_support_${userId}` }],
                        ],
                    },
                });
                // Forward the original message (works for ALL types)
                await ctx.api.forwardMessage(Number(adminId), sourceChatId, sourceMessageId);
                forwarded = true;
            }
            catch (e) {
                console.error('[Report Forward] Error for admin', adminId, e);
            }
        }
        // Update confirmation message
        try {
            await ctx.editMessageText(forwarded
                ? '✅ <b>تم إرسال بلاغك للمطور بنجاح!</b>\n\nسيتم الرد عليك في أقرب وقت ممكن 🌹'
                : '❌ حدث خطأ أثناء إرسال البلاغ. حاول مجدداً.', { parse_mode: 'HTML' });
        }
        catch { }
        return;
    }
    // ══════════════════════════════════════
    // 💬 فتح جلسة دعم مع العميل
    // ══════════════════════════════════════
    if (data.startsWith('admin_support_')) {
        if (!isAdminUser)
            return;
        const targetUserId = data.replace('admin_support_', '');
        // Activate support session in DB
        await User_1.User.findOneAndUpdate({ telegramId: targetUserId }, { $set: { supportSessionActive: true, supportSessionAdminId: ctx.from?.id.toString() } });
        // Notify admin
        await ctx.answerCallbackQuery({ text: '✅ تم فتح المحادثة المباشرة' }).catch(() => { });
        await ctx.editMessageReplyMarkup(undefined);
        await ctx.api.sendMessage(ctx.from.id, `✅ <b>تم فتح المحادثة المباشرة مع العميل.</b>\n` +
            `أي رسالة أو صورة أو ملف ترسله الآن سيصل إليه مباشرة.\n` +
            `لإغلاق المحادثة، أرسل <code>/endchat</code> أو <b>اغلق المحادثة</b>`, { parse_mode: 'HTML' });
        // Notify user
        await ctx.api.sendMessage(targetUserId, `🛠 <b>تنبيه من فريق الدعم</b>\n\nلقد وصلنا تنبيهاً بأنك تواجه مشكلة.\nأحد مطوري البوت معك الآن وسيتم حل مشكلتك في أسرع وقت 💙`, { parse_mode: 'HTML' });
        return;
    }
    // ══════════════════════════════════════
    // 🛠 ADMIN PANEL HANDLERS
    // ══════════════════════════════════════
    // ── Stats ──
    if (data === 'admin_stats' && isAdminUser) {
        const totalUsers = await User_1.User.countDocuments();
        const bannedUsers = await User_1.User.countDocuments({ isBanned: true });
        const activeToday = await User_1.User.countDocuments({
            lastRewardDate: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        });
        await ctx.answerCallbackQuery().catch(() => { });
        await ctx.reply(`📊 <b>إحصائيات البوت</b>\n\n` +
            `👥 إجمالي المستخدمين: <b>${totalUsers}</b>\n` +
            `🚫 المحظورون: <b>${bannedUsers}</b>\n` +
            `🟢 نشطون اليوم: <b>${activeToday}</b>`, { parse_mode: 'HTML' });
        return;
    }
    // ── Edit Welcome Message ──
    if (data === 'admin_edit_welcome' && isAdminUser) {
        await ctx.answerCallbackQuery().catch(() => { });
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { awaitingReport: false, adminAwaitingInput: 'welcome_message' } });
        await ctx.reply('✏️ أرسل الآن النص الجديد لرسالة الترحيب:');
        return;
    }
    // ── Edit Daily Reward Amount ──
    if (data === 'admin_edit_daily' && isAdminUser) {
        await ctx.answerCallbackQuery().catch(() => { });
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { adminAwaitingInput: 'daily_reward_amount' } });
        await ctx.reply('🎁 أرسل العدد الجديد للمحاولات اليومية (مثال: 5):');
        return;
    }
    // ── Edit Low Attempts Warning ──
    if (data === 'admin_edit_low' && isAdminUser) {
        await ctx.answerCallbackQuery().catch(() => { });
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { adminAwaitingInput: 'low_attempts_warning' } });
        await ctx.reply('⚠️ أرسل الآن نص رسالة انتهاء المحاولات:');
        return;
    }
    // ── Broadcast ──
    if (data === 'admin_broadcast' && isAdminUser) {
        await ctx.answerCallbackQuery().catch(() => { });
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { adminAwaitingInput: 'broadcast' } });
        await ctx.reply('📢 أرسل الآن الرسالة التي تريد إرسالها لجميع المستخدمين:');
        return;
    }
    // ── Search User ──
    if (data === 'admin_search_user' && isAdminUser) {
        await ctx.answerCallbackQuery().catch(() => { });
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { adminAwaitingInput: 'search_user' } });
        await ctx.reply('🔍 أرسل الـ ID أو username للمستخدم:');
        return;
    }
    // ── Maintenance Mode ──
    if (data === 'admin_maintenance' && isAdminUser) {
        await ctx.answerCallbackQuery().catch(() => { });
        const current = await BotSettings_1.BotSettings.findOne({ key: 'maintenance_mode' });
        const currentVal = current?.value === 'true';
        await BotSettings_1.BotSettings.findOneAndUpdate({ key: 'maintenance_mode' }, { value: currentVal ? 'false' : 'true' }, { upsert: true });
        await ctx.reply(currentVal
            ? '✅ تم إيقاف وضع الصيانة — البوت يعمل الآن'
            : '🔧 تم تفعيل وضع الصيانة — البوت متوقف مؤقتاً');
        return;
    }
    // ── Unban user ──
    if (data.startsWith('admin_unban_') && isAdminUser) {
        const targetId = data.replace('admin_unban_', '');
        await User_1.User.findOneAndUpdate({ telegramId: targetId }, { isBanned: false });
        await ctx.answerCallbackQuery({ text: '✅ تم رفع الحظر' }).catch(() => { });
        await ctx.editMessageReplyMarkup(undefined);
        return;
    }
    // ── Add attempts to user ──
    if (data.startsWith('admin_addattempts_') && isAdminUser) {
        const targetId = data.replace('admin_addattempts_', '');
        await User_1.User.findOneAndUpdate({ telegramId: targetId }, { $inc: { dailyQuota: 5 } });
        await ctx.answerCallbackQuery({ text: '✅ تمت إضافة 5 محاولات' }).catch(() => { });
        return;
    }
    // ══════════════════════════════════════
    // 📢 تمويل أعضاء — بدء الحملة
    // ══════════════════════════════════════
    if (data === 'start_fund_campaign' && isAdminUser) {
        await ctx.answerCallbackQuery().catch(() => { });
        (0, channelFundService_1.startFundCampaignSetup)(ctx.from.id);
        await ctx.reply('📢 <b>إنشاء حملة تمويل أعضاء</b>\n\nأرسل رابط القناة أو المجموعة المراد تمويلها:', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[{ text: '↩️ رجوع', callback_data: 'cancel_fund_campaign' }]],
            },
        });
        return;
    }
    if (data === 'cancel_fund_campaign' && isAdminUser) {
        await ctx.answerCallbackQuery().catch(() => { });
        (0, channelFundService_1.clearFundCampaignState)(ctx.from.id);
        await ctx.reply('❌ تم إلغاء إنشاء الحملة.');
        return;
    }
    // ══════════════════════════════════════
    // 🎁 claim_reward_{channelId}
    // ══════════════════════════════════════
    if (data.startsWith('claim_reward_')) {
        const channelId = data.replace('claim_reward_', '');
        const userId = ctx.from.id;
        const result = await (0, channelFundService_1.claimChannelReward)(userId, channelId, ctx.api);
        if (result === 'REWARDED') {
            await ctx.answerCallbackQuery().catch(() => { });
            await ctx.reply('✅ تم التحقق! تم إضافة 5 محاولات لرصيدك 🎉\nاستمتع بتحسين صورك بجودة احترافية 🌟');
        }
        else if (result === 'ALREADY_CLAIMED') {
            await ctx.answerCallbackQuery({ text: 'لقد حصلت على مكافأة هذه القناة من قبل ✅', show_alert: true }).catch(() => { });
        }
        else if (result === 'PROCESSING') {
            await ctx.answerCallbackQuery({ text: 'جاري المعالجة، انتظر لحظة... ⏳', show_alert: false }).catch(() => { });
        }
        else if (result === 'NOT_MEMBER') {
            await ctx.answerCallbackQuery({
                text: 'عذراً! لم يتم التحقق من اشتراكك بعد ❌\nالرجاء الاشتراك في القناة أولاً عبر الرابط، ثم اضغط على الزر للحصول على مكافأتك 🎁',
                show_alert: true
            }).catch(() => { });
        }
        else if (result === 'ADMIN_BLOCKED') {
            await ctx.answerCallbackQuery({ text: '🚫 المشرف لا يمكنه المطالبة بمكافأة حملته.', show_alert: true }).catch(() => { });
        }
        else {
            await ctx.answerCallbackQuery({ text: '❌ الحملة غير موجودة أو انتهت.', show_alert: true }).catch(() => { });
        }
        return;
    }
    // ══════════════════════════════════════
    // 🗑 delete_broadcast_{campaignId}
    // ══════════════════════════════════════
    if (data.startsWith('delete_broadcast_') && isAdminUser) {
        await ctx.answerCallbackQuery({ text: 'جاري حذف الإذاعة... 🗑' }).catch(() => { });
        const campaignId = data.replace('delete_broadcast_', '');
        const campaign = await FundCampaign_1.FundCampaign.findById(campaignId);
        if (!campaign) {
            await ctx.reply('❌ لم يتم العثور على الحملة.');
            return;
        }
        let deleted = 0;
        let deleteFailed = 0;
        for (const { userId: uid, messageId } of campaign.broadcastMessages) {
            try {
                await ctx.api.deleteMessage(uid, messageId);
                deleted++;
            }
            catch (e) {
                deleteFailed++;
            }
        }
        await FundCampaign_1.FundCampaign.findByIdAndUpdate(campaignId, { isActive: false });
        await ctx.reply(`🗑 تم حذف الإذاعة:\n✅ حُذف: ${deleted}\n❌ فشل: ${deleteFailed}`);
        try {
            await ctx.deleteMessage();
        }
        catch (e) { }
        return;
    }
    // ══════════════════════════════════════
    // 🚀 Pro Enhance — Step 1: Quality
    // ══════════════════════════════════════
    if (data === 'pro_enhance_start') {
        await ctx.answerCallbackQuery().catch(() => { });
        await ctx.reply('🚀 <b>Pro Enhance</b>\n\n<b>الخطوة 1/3 — اختر جودة التحسين:</b>', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '⚡ سريع (جودة عالية)', callback_data: 'pro_q_fast' }],
                    [{ text: '💎 احترافي (جودة فائقة)', callback_data: 'pro_q_pro' }],
                    [{ text: '🏆 ماكس (أعلى جودة)', callback_data: 'pro_q_max' }],
                    [{ text: '❌ إلغاء', callback_data: 'pro_cancel' }],
                ],
            },
        });
        return;
    }
    // Step 1 answers → Step 2: Scale
    if (['pro_q_fast', 'pro_q_pro', 'pro_q_max'].includes(data)) {
        await ctx.answerCallbackQuery().catch(() => { });
        const qualityMap = {
            pro_q_fast: 'fast',
            pro_q_pro: 'pro',
            pro_q_max: 'max',
        };
        const quality = qualityMap[data];
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { 'proEnhanceSettings.quality': quality, 'proEnhanceSettings.scale': null, 'proEnhanceSettings.imageType': null } });
        await ctx.reply('🚀 <b>Pro Enhance</b>\n\n<b>الخطوة 2/3 — اختر مقياس التكبير:</b>', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '2x — تكبير مضاعف', callback_data: 'pro_s_2' }],
                    [{ text: '4x — تكبير رباعي (موصى به)', callback_data: 'pro_s_4' }],
                    [{ text: '❌ إلغاء', callback_data: 'pro_cancel' }],
                ],
            },
        });
        return;
    }
    // Step 2 answers → Step 3: Image Type
    if (['pro_s_2', 'pro_s_4'].includes(data)) {
        await ctx.answerCallbackQuery().catch(() => { });
        const scale = data === 'pro_s_2' ? '2' : '4';
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { 'proEnhanceSettings.scale': scale } });
        await ctx.reply('🚀 <b>Pro Enhance</b>\n\n<b>الخطوة 3/3 — نوع الصورة:</b>', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🖼 صورة عادية', callback_data: 'pro_t_photo' }],
                    [{ text: '👤 وجه / بورتريه', callback_data: 'pro_t_face' }],
                    [{ text: '🎨 رسم / أنمي / فن', callback_data: 'pro_t_art' }],
                    [{ text: '❌ إلغاء', callback_data: 'pro_cancel' }],
                ],
            },
        });
        return;
    }
    // Step 3 answers → Process
    if (['pro_t_photo', 'pro_t_face', 'pro_t_art'].includes(data)) {
        await ctx.answerCallbackQuery().catch(() => { });
        const typeMap = {
            pro_t_photo: 'photo',
            pro_t_face: 'face',
            pro_t_art: 'art',
        };
        const imageType = typeMap[data];
        const telegramId = ctx.from.id.toString();
        await User_1.User.findOneAndUpdate({ telegramId }, { $set: { 'proEnhanceSettings.imageType': imageType } });
        const freshUser = await User_1.User.findOne({ telegramId });
        const settings = freshUser?.proEnhanceSettings;
        // Smart cost calculation based on quality (Max = 3, others = 2)
        const enhanceCost = settings?.quality === 'max' ? 3 : 2;
        const costMsg = enhanceCost === 3
            ? `🏆 اخترت الجودة الفائقة (Max)\n⚠️ سيتم خصم <b>3 محاولات</b> من رصيدك.`
            : `💎 اخترت الجودة القوية\n⚠️ سيتم خصم <b>2 محاولة</b> من رصيدك.`;
        await ctx.reply(`🚀 <b>Pro Enhance — تأكيد</b>\n\n${costMsg}\n\nهل أنت موافق؟`, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '✅ نعم، ابدأ التحسين', callback_data: 'pro_confirm_yes' },
                        { text: '❌ لا، إلغاء', callback_data: 'pro_cancel' },
                    ],
                ],
            },
        });
        return;
    }
    // ══════════════════════════════════════
    // ✅ Pro Enhance — Confirmed, start processing
    // ══════════════════════════════════════
    if (data === 'pro_confirm_yes') {
        await ctx.answerCallbackQuery().catch(() => { });
        const userId = ctx.from.id;
        const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
        const isAdmin = adminIds.includes(userId.toString());
        const user = await User_1.User.findOne({ telegramId: userId.toString() });
        if (!user)
            return;
        const settings = user.proEnhanceSettings;
        if (!settings?.quality || !settings?.scale || !settings?.imageType) {
            await ctx.reply('❌ حدث خطأ في الإعدادات. يرجى البدء من جديد بالضغط على زر Pro Enhance.');
            return;
        }
        // Calculate cost
        const enhanceCost = settings.quality === 'max' ? 3 : 2;
        // Check quota (BUT DO NOT DEDUCT YET - wait for image)
        if (!isAdmin && user.dailyQuota < enhanceCost) {
            await ctx.reply(`⚠️ رصيدك غير كافٍ لهذا الخيار 🥺\n` +
                `تحتاج ${enhanceCost} محاولات، رصيدك الحالي: ${user.dailyQuota}\n\n` +
                `💎 لشراء محاولات إضافية تواصل مع الإدارة.`);
            return;
        }
        // Set awaiting image flag
        await User_1.User.findOneAndUpdate({ telegramId: userId.toString() }, { $set: { 'proEnhanceSettings.isAwaitingImage': true } });
        // Ask user to send image NOW
        await ctx.reply(`✅ تم حفظ إعداداتك بنجاح!\n\n` +
            `📸 أرسل <b>الصورة</b> الآن وسيبدأ التحسين فوراً 🚀\n` +
            `(يمكنك إرسالها كصورة عادية أو كملف للحفاظ على الجودة)\n\n` +
            `<i>ملاحظة: سيتم خصم ${isAdmin ? '0 (أدمن)' : enhanceCost} محاولات عند استلام الصورة.</i>`, { parse_mode: 'HTML' });
        return;
    }
    // Cancel Pro Enhance
    if (data === 'pro_cancel') {
        await ctx.answerCallbackQuery({ text: 'تم الإلغاء ❌' }).catch(() => { });
        return;
    }
    // ════════════════════════════════
    // Admin Panel
    // ════════════════════════════════
    if (data === 'admin_panel') {
        if (!isAdminUser)
            return;
        await ctx.answerCallbackQuery().catch(() => { });
        const buildAdminKeyboard = (l) => ({
            inline_keyboard: [
                [{ text: `${l.btn_2k ? '🔴 مقفل (متاح لك وللـ VIP)' : '🟢 مفتوح للجميع'} — 2K`, callback_data: 'atoggle_btn_2k' }],
                [{ text: `${l.btn_4k ? '🔴 مقفل (متاح لك وللـ VIP)' : '🟢 مفتوح للجميع'} — 4K`, callback_data: 'atoggle_btn_4k' }],
                [{ text: `${l.btn_8k ? '🔴 مقفل (متاح لك وللـ VIP)' : '🟢 مفتوح للجميع'} — 8K`, callback_data: 'atoggle_btn_8k' }],
                [{ text: `${l.btn_4kai ? '🔴 مقفل (متاح لك وللـ VIP)' : '🟢 مفتوح للجميع'} — 4K-Ai`, callback_data: 'atoggle_btn_4kai' }],
                [{ text: `${l.btn_8kai ? '🔴 مقفل (متاح لك وللـ VIP)' : '🟢 مفتوح للجميع'} — 8K-Ai`, callback_data: 'atoggle_btn_8kai' }],
                [{ text: `${l.btn_nano ? '🔴 مقفل (متاح لك وللـ VIP)' : '🟢 مفتوح للجميع'} — ✨ Nano AI`, callback_data: 'atoggle_btn_nano' }],
                [{ text: `${l.btn_eraser ? '🔴 مقفل (متاح لك وللـ VIP)' : '🟢 مفتوح للجميع'} — ✨ مُزيل العلامات المائية`, callback_data: 'atoggle_btn_eraser' }],
                [{ text: `${l.btn_doc_maker ? '🔴 مقفل (متاح لك وللـ VIP)' : '🟢 مفتوح للجميع'} — 📝 صانع المستندات`, callback_data: 'atoggle_btn_doc_maker' }],
                [{ text: `${l.btn_filters ? '🔴 مقفل' : '🟢 مفتوح'} — 🎨 فلاتر الصور`, callback_data: 'atoggle_btn_filters' }],
                [{ text: '🔑 سماح لشخص باستخدام الميزات المقفلة', callback_data: 'admin_grant_vip' }],
                [{ text: '📢 قنوات الاشتراك الإجباري', callback_data: 'admin_force_sub' }],
                [{ text: '🌟 تفعيل الأحجام الكبيرة (15MB)', callback_data: 'admin_vip_size' }],
                [{ text: '🎁 التوزيعات وعجلة الحظ', callback_data: 'admin_giveaway_start' }],
                [{ text: '❌ إغلاق', callback_data: 'admin_close' }],
            ]
        });
        await ctx.reply('<b>⚙️ لوحة تحكم الأدمن</b>\n🟢 = مفتوح للجميع | 🔴 = مقفل', { parse_mode: 'HTML', reply_markup: buildAdminKeyboard(locks) });
        return;
    }
    if (data === 'admin_grant_vip' && isAdminUser) {
        await ctx.answerCallbackQuery().catch(() => { });
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { adminAwaitingInput: 'grant_vip_id', adminTargetUserId: null } });
        await ctx.reply('🔑 <b>تجاوز أقفال الميزات</b>\n\nأرسل الـ ID الخاص بالمستخدم الذي تريد منحه صلاحية تجاوز الإغلاق:', { parse_mode: 'HTML' });
        return;
    }
    if (data.startsWith('atoggle_') && isAdminUser) {
        await ctx.answerCallbackQuery().catch(() => { });
        const field = data.replace('atoggle_', '');
        const newSettings = await (0, settingsService_1.toggleLock)(field);
        const newLocks = newSettings.locks;
        const buildAdminKeyboard = (l) => ({
            inline_keyboard: [
                [{ text: `${l.btn_2k ? '🔴 مقفل (متاح لك وللـ VIP)' : '🟢 مفتوح للجميع'} — 2K`, callback_data: 'atoggle_btn_2k' }],
                [{ text: `${l.btn_4k ? '🔴 مقفل (متاح لك وللـ VIP)' : '🟢 مفتوح للجميع'} — 4K`, callback_data: 'atoggle_btn_4k' }],
                [{ text: `${l.btn_8k ? '🔴 مقفل (متاح لك وللـ VIP)' : '🟢 مفتوح للجميع'} — 8K`, callback_data: 'atoggle_btn_8k' }],
                [{ text: `${l.btn_4kai ? '🔴 مقفل (متاح لك وللـ VIP)' : '🟢 مفتوح للجميع'} — 4K-Ai`, callback_data: 'atoggle_btn_4kai' }],
                [{ text: `${l.btn_8kai ? '🔴 مقفل (متاح لك وللـ VIP)' : '🟢 مفتوح للجميع'} — 8K-Ai`, callback_data: 'atoggle_btn_8kai' }],
                [{ text: `${l.btn_nano ? '🔴 مقفل (متاح لك وللـ VIP)' : '🟢 مفتوح للجميع'} — ✨ Nano AI`, callback_data: 'atoggle_btn_nano' }],
                [{ text: `${l.btn_eraser ? '🔴 مقفل (متاح لك وللـ VIP)' : '🟢 مفتوح للجميع'} — ✨ مُزيل العلامات المائية`, callback_data: 'atoggle_btn_eraser' }],
                [{ text: `${l.btn_doc_maker ? '🔴 مقفل (متاح لك وللـ VIP)' : '🟢 مفتوح للجميع'} — 📝 صانع المستندات`, callback_data: 'atoggle_btn_doc_maker' }],
                [{ text: `${l.btn_filters ? '🔴 مقفل' : '🟢 مفتوح'} — 🎨 فلاتر الصور`, callback_data: 'atoggle_btn_filters' }],
                [{ text: '🔑 سماح لشخص باستخدام الميزات المقفلة', callback_data: 'admin_grant_vip' }],
                [{ text: '📢 قنوات الاشتراك الإجباري', callback_data: 'admin_force_sub' }],
                [{ text: '🌟 تفعيل الأحجام الكبيرة (15MB)', callback_data: 'admin_vip_size' }],
                [{ text: '🎁 التوزيعات وعجلة الحظ', callback_data: 'admin_giveaway_start' }],
                [{ text: '❌ إغلاق', callback_data: 'admin_close' }],
            ]
        });
        await ctx.api.editMessageReplyMarkup(ctx.chat.id, ctx.msgId, { reply_markup: buildAdminKeyboard(newLocks) });
        return;
    }
    if (data === 'admin_vip_size') {
        await ctx.answerCallbackQuery();
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { adminAwaitingInput: 'vip_size_bypass' } });
        await ctx.reply('🌟 <b>تفعيل الأحجام الكبيرة (VIP)</b>\n\nأرسل الآن <b>ID</b> الخاص بالمستخدم لفتح الحد له إلى 15 ميجابايت:', { parse_mode: 'HTML' });
        return;
    }
    // ── Support Send Confirmation ─────────────────────────────────
    if (data.startsWith('confirm_support_send_') && isAdminUser) {
        await ctx.answerCallbackQuery().catch(() => { });
        const targetUserId = data.replace('confirm_support_send_', '');
        // The original message is the one this confirmation was replied to
        const originalMessage = ctx.callbackQuery?.message?.reply_to_message;
        if (!originalMessage) {
            await ctx.reply('❌ لم أتمكن من العثور على الرسالة الأصلية.');
            return;
        }
        try {
            // Copy the exact original message (text/photo/file) to the target user
            await ctx.api.copyMessage(targetUserId, originalMessage.chat.id, originalMessage.message_id);
            await ctx.editMessageReplyMarkup(undefined);
            await ctx.reply('✅ تم إرسال الرسالة للعميل بنجاح 💙');
        }
        catch (e) {
            await ctx.reply('❌ فشل إرسال الرسالة. ربما حظر العميل البوت.');
        }
        return;
    }
    if (data === 'cancel_support_send' && isAdminUser) {
        await ctx.answerCallbackQuery({ text: 'تم الإلغاء ❌' }).catch(() => { });
        await ctx.editMessageReplyMarkup(undefined);
        return;
    }
    if (data === 'admin_close' && isAdminUser) {
        await ctx.answerCallbackQuery().catch(() => { });
        await ctx.deleteMessage();
        return;
    }
    if (data === 'nano_banana_start') {
        await ctx.answerCallbackQuery().catch(() => { });
        // Fetch fresh user and check admin
        const nanoUser = await User_1.User.findOne({ telegramId: ctx.from.id.toString() });
        if (!nanoUser)
            return;
        const nanoAdminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
        const isNanoAdmin = nanoAdminIds.includes(ctx.from.id.toString());
        if (!isNanoAdmin && nanoUser.dailyQuota < 2) {
            await ctx.reply(`⚠️ رصيدك غير كافٍ!\n` +
                `تحتاج <b>2 محاولات</b> لاستخدام هذه الميزة ✨\n` +
                `رصيدك الحالي: <b>${nanoUser.dailyQuota}</b> محاولة`, { parse_mode: 'HTML' });
            return;
        }
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { awaitingNanoBananaImage: true } });
        // 60-second timeout: auto-cancel if no image received
        setTimeout(async () => {
            try {
                const checkUser = await User_1.User.findOne({ telegramId: ctx.from.id.toString() });
                if (checkUser?.awaitingNanoBananaImage) {
                    await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { awaitingNanoBananaImage: false } });
                    await ctx.api.sendMessage(ctx.from.id, '⏰ انتهى وقت الإرسال (60 ثانية).\nاضغط الزر مجدداً إذا أردت المتابعة ❌');
                }
            }
            catch (_e) { }
        }, 60_000);
        await ctx.reply('✨ <b>تحسين الصورة بالذكاء الاصطناعي</b>\n\n' +
            '📸 أرسل لي الصورة الآن وسأقوم بتحسينها احترافياً مع الحفاظ على هويتها الأصلية 100% 🚀\n\n' +
            '💎 <b>السعر: 2 محاولات</b>\n' +
            '<i>يمكنك إرسالها كصورة عادية أو كملف للحفاظ على الجودة</i>', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'cancel_nano_banana' }]]
            }
        });
        return;
    }
    if (data === 'cancel_nano_banana') {
        await ctx.answerCallbackQuery({ text: 'تم الإلغاء ❌' }).catch(() => { });
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { awaitingNanoBananaImage: false } });
        await ctx.deleteMessage().catch(() => { });
        return;
    }
    // ══════════════════════════════════════
    // 🖼 تحويل صيغة الملف
    // ══════════════════════════════════════
    if (['conv_png', 'conv_jpg', 'conv_webp', 'conv_avif', 'conv_tiff', 'conv_pdf', 'conv_svg'].includes(data)) {
        await ctx.answerCallbackQuery({ text: 'جاري تحويل الصيغة... ⏳' });
        const format = data.replace('conv_', '');
        const document = ctx.callbackQuery?.message?.document;
        if (!document) {
            await ctx.reply('❌ لم أتمكن من العثور على الملف الأصلي. أرسل الصورة مجدداً.');
            return;
        }
        // Telegram Bot API hard limit: cannot download files > 20MB
        if (document.file_size && document.file_size > 20 * 1024 * 1024) {
            await ctx.reply('❌ عذراً، حجم الملف يتجاوز 20 ميجابايت.\n' +
                'قيود تيليجرام تمنع تحويل الملفات الكبيرة جداً.');
            return;
        }
        const loadingMsg = await ctx.reply(`🔄 جاري التحويل إلى ${format.toUpperCase()}...`);
        try {
            // Download file from Telegram
            const tgFile = await ctx.api.getFile(document.file_id);
            if (!tgFile.file_path)
                throw new Error('لم يتم الحصول على مسار الملف من Telegram');
            const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;
            const response = await fetch(fileUrl);
            if (!response.ok)
                throw new Error(`فشل تحميل الملف: ${response.status}`);
            const inputBuffer = Buffer.from(await response.arrayBuffer());
            // Get original file size in MB
            const originalSizeMB = (document.file_size || 0) / (1024 * 1024);
            // Calculate max output size cap (max 2x original, never above 10MB)
            const maxOutputMB = Math.min(originalSizeMB * 2, 10);
            const maxOutputBytes = maxOutputMB * 1024 * 1024;
            let convertedBuffer;
            switch (format) {
                case 'png':
                    // PNG: compress to stay reasonable
                    convertedBuffer = await (0, sharp_1.default)(inputBuffer)
                        .png({ compressionLevel: 6, effort: 7 })
                        .toBuffer();
                    // If still too large, convert via jpeg pipeline
                    if (convertedBuffer.length > maxOutputBytes) {
                        convertedBuffer = await (0, sharp_1.default)(inputBuffer)
                            .png({ compressionLevel: 9 })
                            .toBuffer();
                    }
                    break;
                case 'jpg':
                    convertedBuffer = await (0, sharp_1.default)(inputBuffer)
                        .jpeg({ quality: 95, chromaSubsampling: '4:4:4', force: true })
                        .toBuffer();
                    break;
                case 'webp':
                    convertedBuffer = await (0, sharp_1.default)(inputBuffer)
                        .webp({ quality: 95, lossless: false, force: true })
                        .toBuffer();
                    break;
                case 'avif':
                    convertedBuffer = await (0, sharp_1.default)(inputBuffer)
                        .avif({ quality: 80, effort: 4, force: true })
                        .toBuffer();
                    break;
                case 'tiff':
                    convertedBuffer = await (0, sharp_1.default)(inputBuffer)
                        .tiff({ quality: 90, compression: 'lzw', force: true })
                        .toBuffer();
                    break;
                default:
                    throw new Error('صيغة غير مدعومة');
            }
            const ext = format === 'jpg' ? 'jpeg' : format;
            const newFileName = `NizoAI_${format.toUpperCase()}_${Date.now()}.${ext}`;
            // Delete loading message
            try {
                await ctx.api.deleteMessage(loadingMsg.chat.id, loadingMsg.message_id);
            }
            catch { }
            // Send converted file to user
            const { incrementGlobalCounter } = await Promise.resolve().then(() => __importStar(require('../../services/statsService')));
            await incrementGlobalCounter();
            await ctx.replyWithDocument(new grammy_1.InputFile(convertedBuffer, newFileName), {
                caption: `✅ تم التحويل إلى <b>${format.toUpperCase()}</b> بنجاح 🎉\n` +
                    `📐 الجودة والأبعاد الأصلية محفوظة 100%`,
                parse_mode: 'HTML',
            });
            // Silent archive to channel
            if (BACKUP_CHANNEL_ID) {
                const actionUser = ctx.from;
                const archiveUsername = actionUser?.username
                    ? `@${actionUser.username}`
                    : 'بدون يوزر';
                const fromFormat = (document.file_name?.split('.').pop()?.toUpperCase() ||
                    document.mime_type?.split('/').pop()?.toUpperCase() ||
                    'أصلي');
                const archiveCaption = `📦 <b>أرشيف تحويل صيغة</b>\n` +
                    `─────────────────\n` +
                    `🆔 User ID: <code>${actionUser?.id}</code>\n` +
                    `👤 Username: ${archiveUsername}\n` +
                    `🔄 التحويل: ${fromFormat} → ${format.toUpperCase()}\n` +
                    `🗓 Time: ${new Date().toLocaleString('ar-SA')}`;
                ctx.api.sendDocument(BACKUP_CHANNEL_ID, new grammy_1.InputFile(convertedBuffer, newFileName), {
                    caption: archiveCaption,
                    parse_mode: 'HTML',
                    disable_notification: true,
                }).catch((e) => console.error('[Conv Archive Error]:', e));
            }
        }
        catch (error) {
            console.error('[Conversion Error]:', error);
            // Delete loading message on error
            try {
                await ctx.api.deleteMessage(loadingMsg.chat.id, loadingMsg.message_id);
            }
            catch { }
            // Alert admin with full user info
            await (0, adminAlert_1.sendAdminAlert)(ctx, `Format Conversion Error (${format.toUpperCase()}): ${error.message}`);
            await ctx.reply('❌ حدث خطأ أثناء تحويل الملف.\n' +
                'تم إشعار المطور تلقائياً وسيتم حل المشكلة 💙');
        }
        return;
    }
    // ══════════════════════════════════════
    // 🔄 تحويل صيغة الصورة — بدء العملية
    // ══════════════════════════════════════
    if (data === 'convert_format_start') {
        await ctx.answerCallbackQuery();
        const telegramId = ctx.from.id.toString();
        await User_1.User.findOneAndUpdate({ telegramId }, { $set: { awaitingFormatConversion: true, pendingConversionFiles: [] } });
        await ctx.reply('🔄 <b>تحويل صيغة الصورة</b>\n\n' +
            '📎 أرسل الصورة الأولى كـ <b>مستند (ملف)</b> وليس كصورة عادية.\n\n' +
            '💡 <b>يمكنك إرسال أكثر من صورة!</b>\n' +
            'البوت سيسألك بعد كل صورة إن كنت تريد إضافة المزيد.\n\n' +
            '⚡ التحويل مجاني بدون خصم محاولات', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '❌ إلغاء', callback_data: 'convert_format_cancel' }],
                ],
            },
        });
        return;
    }
    if (data === 'convert_format_cancel') {
        await ctx.answerCallbackQuery({ text: 'تم الإلغاء ❌' });
        const telegramId = ctx.from.id.toString();
        await User_1.User.findOneAndUpdate({ telegramId }, { $set: { awaitingFormatConversion: false, pendingConversionFiles: [] } });
        return;
    }
    // ── More images: YES
    if (data === 'conv_batch_add') {
        const telegramId = ctx.from.id.toString();
        const currentUser = await User_1.User.findOne({ telegramId });
        const currentCount = currentUser?.pendingConversionFiles?.length || 0;
        if (currentCount >= 5) {
            await ctx.answerCallbackQuery({ text: '⚠️ وصلت للحد الأقصى (5 صور)', show_alert: true });
            return;
        }
        await ctx.answerCallbackQuery();
        await User_1.User.findOneAndUpdate({ telegramId }, { $set: { awaitingFormatConversion: true } });
        await ctx.reply('📎 أرسل الصورة التالية كـ <b>مستند (ملف)</b>:', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '❌ إلغاء', callback_data: 'convert_format_cancel' }],
                ],
            },
        });
        return;
    }
    // ── More images: NO → show format selection
    if (data === 'conv_batch_finish') {
        await ctx.answerCallbackQuery();
        const telegramId = ctx.from.id.toString();
        const currentUser = await User_1.User.findOne({ telegramId });
        const count = currentUser?.pendingConversionFiles?.length || 0;
        await User_1.User.findOneAndUpdate({ telegramId }, { $set: { awaitingFormatConversion: false } });
        await ctx.reply(`✅ تم استلام <b>${count}</b> صورة\n\n` +
            `📐 <b>هل تريد رفع دقة الصور أم تحويل الصيغة فقط؟</b>`, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✨ نعم، ارفع الدقة أيضاً', callback_data: 'conv_quality_upscale' }],
                    [{ text: '🔄 لا، تحويل الصيغة فقط (كما هي)', callback_data: 'conv_quality_original' }],
                    [{ text: '❌ إلغاء', callback_data: 'convert_format_cancel' }],
                ],
            },
        });
        return;
    }
    if (data === 'conv_quality_upscale') {
        await ctx.answerCallbackQuery();
        const telegramId = ctx.from.id.toString();
        await User_1.User.findOneAndUpdate({ telegramId }, { $set: { conversionUpscale: true } });
        // Show format selection
        const currentUser = await User_1.User.findOne({ telegramId });
        const count = currentUser?.pendingConversionFiles?.length || 0;
        await showFormatSelection(ctx, count, true);
        return;
    }
    if (data === 'conv_quality_original') {
        await ctx.answerCallbackQuery();
        const telegramId = ctx.from.id.toString();
        await User_1.User.findOneAndUpdate({ telegramId }, { $set: { conversionUpscale: false } });
        const currentUser = await User_1.User.findOne({ telegramId });
        const count = currentUser?.pendingConversionFiles?.length || 0;
        await showFormatSelection(ctx, count, false);
        return;
    }
    if (['fconv_png', 'fconv_jpg', 'fconv_webp', 'fconv_avif', 'fconv_tiff', 'fconv_pdf', 'fconv_svg'].includes(data)) {
        await ctx.answerCallbackQuery({ text: 'جاري المعالجة... ⏳' });
        const format = data.replace('fconv_', '');
        const telegramId = ctx.from.id.toString();
        const currentUser = await User_1.User.findOne({ telegramId });
        const fileIds = currentUser?.pendingConversionFiles || [];
        if (!fileIds.length) {
            await ctx.reply('❌ لا توجد صور. ابدأ من جديد.');
            return;
        }
        const loadingMsg = await ctx.reply(`⏳ جاري تحويل ${fileIds.length} صورة إلى ${format.toUpperCase()}...`);
        try {
            const ext = format === 'jpg' ? 'jpeg' : format;
            // Helper: convert single buffer to chosen format
            const convertBuffer = async (inputBuffer) => {
                switch (format) {
                    case 'png':
                        return (0, sharp_1.default)(inputBuffer).png({ compressionLevel: 6 }).toBuffer();
                    case 'jpg':
                        return (0, sharp_1.default)(inputBuffer)
                            .jpeg({ quality: 95, chromaSubsampling: '4:4:4', force: true }).toBuffer();
                    case 'webp':
                        return (0, sharp_1.default)(inputBuffer)
                            .webp({ quality: 95, lossless: false, force: true }).toBuffer();
                    case 'avif':
                        return (0, sharp_1.default)(inputBuffer)
                            .avif({ quality: 80, effort: 4, force: true }).toBuffer();
                    case 'tiff':
                        return (0, sharp_1.default)(inputBuffer)
                            .tiff({ quality: 90, compression: 'lzw', force: true }).toBuffer();
                    case 'pdf': {
                        // Convert image to PDF using pdfkit
                        const metadata = await (0, sharp_1.default)(inputBuffer).metadata();
                        const imgWidth = metadata.width || 800;
                        const imgHeight = metadata.height || 600;
                        const pdfBuffer = await new Promise((resolve, reject) => {
                            const doc = new pdfkit_1.default({
                                size: [imgWidth, imgHeight],
                                margin: 0,
                                autoFirstPage: true,
                            });
                            const chunks = [];
                            doc.on('data', (chunk) => chunks.push(chunk));
                            doc.on('end', () => resolve(Buffer.concat(chunks)));
                            doc.on('error', reject);
                            // Convert image to PNG first for PDF embedding
                            (0, sharp_1.default)(inputBuffer).png().toBuffer().then((pngBuffer) => {
                                doc.image(pngBuffer, 0, 0, { width: imgWidth, height: imgHeight });
                                doc.end();
                            }).catch(reject);
                        });
                        return pdfBuffer;
                    }
                    case 'svg': {
                        // Wrap image in SVG (embed as base64)
                        const metadata = await (0, sharp_1.default)(inputBuffer).metadata();
                        const imgWidth = metadata.width || 800;
                        const imgHeight = metadata.height || 600;
                        // Convert to PNG first for embedding
                        const pngBuffer = await (0, sharp_1.default)(inputBuffer).png().toBuffer();
                        const base64 = pngBuffer.toString('base64');
                        const svgContent = `<?xml version="1.0" encoding="UTF-8"?>\n` +
                            `<svg xmlns="http://www.w3.org/2000/svg" ` +
                            `xmlns:xlink="http://www.w3.org/1999/xlink" ` +
                            `width="${imgWidth}" height="${imgHeight}" ` +
                            `viewBox="0 0 ${imgWidth} ${imgHeight}">\n` +
                            `  <image xlink:href="data:image/png;base64,${base64}" ` +
                            `x="0" y="0" width="${imgWidth}" height="${imgHeight}"/>\n` +
                            `</svg>`;
                        return Buffer.from(svgContent, 'utf-8');
                    }
                    default:
                        throw new Error('صيغة غير مدعومة');
                }
            };
            // Download and convert all files
            const convertedFiles = [];
            for (let i = 0; i < fileIds.length; i++) {
                try {
                    const tgFile = await ctx.api.getFile(fileIds[i]);
                    if (!tgFile.file_path)
                        continue;
                    const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;
                    const response = await fetch(fileUrl);
                    if (!response.ok)
                        continue;
                    const inputBuffer = Buffer.from(await response.arrayBuffer());
                    const shouldUpscale = currentUser?.conversionUpscale === true;
                    let processBuffer = inputBuffer;
                    if (shouldUpscale && !['pdf', 'svg'].includes(format)) {
                        const meta = await (0, sharp_1.default)(inputBuffer).metadata();
                        const w = meta.width || 800;
                        const h = meta.height || 600;
                        processBuffer = await (0, sharp_1.default)(inputBuffer)
                            .resize({
                            width: Math.round(w * 2),
                            height: Math.round(h * 2),
                            fit: 'fill',
                            kernel: sharp_1.default.kernel.lanczos3,
                        })
                            .toBuffer();
                    }
                    const converted = await convertBuffer(processBuffer);
                    // const _mimeOk = !['pdf', 'svg'].includes(format);
                    convertedFiles.push({ buffer: converted, name: `image_${i + 1}.${ext}` });
                }
                catch (e) {
                    console.error(`[fconv] Error file ${i + 1}:`, e);
                }
            }
            if (!convertedFiles.length)
                throw new Error('فشل تحويل جميع الصور');
            try {
                await ctx.api.deleteMessage(loadingMsg.chat.id, loadingMsg.message_id);
            }
            catch { }
            const actionUser = ctx.from;
            // @ts-ignore — declared for potential future use; currently unused after caption refactor
            const userLink = actionUser?.username
                ? `@${actionUser.username}`
                : `<a href="tg://user?id=${actionUser?.id}">${actionUser?.first_name || 'مجهول'}</a>`;
            if (convertedFiles.length === 1) {
                // Single file → send as document
                const { buffer, name } = convertedFiles[0];
                const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2);
                const { incrementGlobalCounter } = await Promise.resolve().then(() => __importStar(require('../../services/statsService')));
                await incrementGlobalCounter();
                await ctx.replyWithDocument(new grammy_1.InputFile(buffer, name), {
                    caption: `✅ تم التحويل إلى <b>${format.toUpperCase()}</b> بنجاح! 🎉\n` +
                        `📦 <b>الحجم:</b> ${sizeMB} MB\n` +
                        `⚡ مجاني — لم يتم خصم أي محاولات`,
                    parse_mode: 'HTML',
                });
                // Silent archive
                if (BACKUP_CHANNEL_ID) {
                    const fconvUsername = actionUser?.username
                        ? `@${actionUser.username}`
                        : 'بدون يوزر';
                    ctx.api.sendDocument(BACKUP_CHANNEL_ID, new grammy_1.InputFile(buffer, name), {
                        caption: `📦 <b>أرشيف تحويل صيغة</b>\n` +
                            `─────────────────\n` +
                            `🆔 User ID: <code>${actionUser?.id}</code>\n` +
                            `👤 Username: ${fconvUsername}\n` +
                            `🔄 التحويل: أصلي → ${format.toUpperCase()}\n` +
                            `🗓 Time: ${new Date().toLocaleString('ar-SA')}`,
                        parse_mode: 'HTML',
                        disable_notification: true,
                    }).catch((e) => console.error('[fconv Archive]:', e));
                }
            }
            else {
                // Multiple files → ZIP using AdmZip
                const zip = new adm_zip_1.default();
                for (const { buffer, name } of convertedFiles) {
                    zip.addFile(name, buffer);
                }
                const zipBuffer = zip.toBuffer();
                const zipFileName = `NizoAI_Batch_${format.toUpperCase()}_${Date.now()}.zip`;
                const zipSizeMB = (zipBuffer.length / (1024 * 1024)).toFixed(2);
                const { incrementGlobalCounter } = await Promise.resolve().then(() => __importStar(require('../../services/statsService')));
                await incrementGlobalCounter();
                await ctx.replyWithDocument(new grammy_1.InputFile(zipBuffer, zipFileName), {
                    caption: `✅ <b>تم التحويل بنجاح!</b> 🎉\n` +
                        `📸 <b>عدد الصور:</b> ${convertedFiles.length}\n` +
                        `🔄 <b>الصيغة:</b> ${format.toUpperCase()}\n` +
                        `📦 <b>حجم الملف المضغوط:</b> ${zipSizeMB} MB\n` +
                        `⚡ مجاني — لم يتم خصم أي محاولات`,
                    parse_mode: 'HTML',
                });
                // Silent archive
                if (BACKUP_CHANNEL_ID) {
                    const fconvBatchUsername = actionUser?.username
                        ? `@${actionUser.username}`
                        : 'بدون يوزر';
                    ctx.api.sendDocument(BACKUP_CHANNEL_ID, new grammy_1.InputFile(zipBuffer, zipFileName), {
                        caption: `📦 <b>أرشيف تحويل صيغة</b>\n` +
                            `─────────────────\n` +
                            `🆔 User ID: <code>${actionUser?.id}</code>\n` +
                            `👤 Username: ${fconvBatchUsername}\n` +
                            `🔄 التحويل: أصلي → ${format.toUpperCase()}\n` +
                            `🗓 Time: ${new Date().toLocaleString('ar-SA')}`,
                        parse_mode: 'HTML',
                        disable_notification: true,
                    }).catch((e) => console.error('[fconv Batch Archive]:', e));
                }
            }
            // Reset state
            await User_1.User.findOneAndUpdate({ telegramId }, {
                $set: {
                    awaitingFormatConversion: false,
                    pendingConversionFiles: [],
                    conversionUpscale: false,
                }
            });
        }
        catch (error) {
            console.error('[fconv Error]:', error);
            try {
                await ctx.api.deleteMessage(loadingMsg.chat.id, loadingMsg.message_id);
            }
            catch { }
            await (0, adminAlert_1.sendAdminAlert)(ctx, `fconv Error (${format}): ${error.message}`);
            await ctx.reply('❌ حدث خطأ أثناء التحويل. تم إشعار المطور 💙');
            await User_1.User.findOneAndUpdate({ telegramId }, {
                $set: {
                    awaitingFormatConversion: false,
                    pendingConversionFiles: [],
                    conversionUpscale: false,
                }
            });
        }
        return;
    }
    if (data === 'admin_edit_convert_msg' && isAdminUser) {
        await ctx.answerCallbackQuery();
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { adminAwaitingInput: 'convert_button_message' } });
        await ctx.reply('🔄 أرسل النص الجديد لرسالة زر تحويل الصيغة:\n\n' +
            '(يدعم HTML: <b>عريض</b> و <i>مائل</i>)');
        return;
    }
    if (data === 'eraser_start') {
        await ctx.answerCallbackQuery().catch(() => { });
        const eraserUser = await User_1.User.findOne({ telegramId: ctx.from.id.toString() });
        if (!eraserUser)
            return;
        const eraserAdminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
        const isEraserAdmin = eraserAdminIds.includes(ctx.from.id.toString());
        if (!isEraserAdmin && eraserUser.dailyQuota < 1) {
            await ctx.reply(`⚠️ أوه لا! رصيدك خلص 🥺\n` +
                `تحتاج <b>محاولة واحدة</b> فقط للممحاة السحرية 🪄\n` +
                `رصيدك الحالي: <b>${eraserUser.dailyQuota}</b>\n\n` +
                `💡 احصل على محاولات مجانية من زر الهدية اليومية 🎁`, { parse_mode: 'HTML' });
            return;
        }
        await ctx.reply('✨ <b>مُزيل العلامات المائية — النظام الاحترافي</b>\n\n' +
            '📝 <b>الخطوة 1 من 2:</b>\n\n' +
            '1️⃣ افتح الصورة في أي تطبيق رسم\n' +
            '2️⃣ ارسم مربعاً أو خطاً <b>باللون الأحمر</b> 🔴 فوق العلامة المائية أو الشيء المراد حذفه\n' +
            '3️⃣ أرسل هذه الصورة المُعدَّلة هنا (صورة عادية أو ملف) 📎\n\n' +
            '💡 <b>ملاحظة:</b> البوت سيحفظ الموقع فقط، ثم يطلب منك الصورة الأصلية النظيفة\n\n' +
            '💎 <b>السعر: نقطتان (2)</b>', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'cancel_eraser' }]]
            }
        });
        // Set state: waiting for reference image (marked)
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { awaitingEraserImage: true, awaitingEraserOriginal: false } });
        return;
    }
    // ══════════════════════════════════════
    // 🧹 مُزيل النجمة التلقائي — one-shot auto watermark removal
    // ══════════════════════════════════════
    // القائمة الجديدة المزدوجة (تظهر للمستخدم أولاً)
    if (data === 'remove_watermark_auto') {
        await ctx.answerCallbackQuery().catch(() => { });
        await ctx.editMessageText(`✨ <b>وحدة التنقيح البصري الذكي</b>\n\nتعتمد هذه الأداة على خوارزميات الذكاء الاصطناعي التوليدي لتحليل بنية الصورة وإزالة أي عناصر أو علامات غير مرغوب فيها بدقة عالية دون تشويه المحتوى الأصلي.\n\n🔍 <b>اختر نوع المعالجة:</b>`, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✨ إزالة نجمة Gemini تلقائياً', callback_data: 'watermark_auto_gemini' }],
                    [{ text: '🖌️ إزالة عنصر مخصص', callback_data: 'watermark_custom_start' }]
                ]
            }
        }).catch(() => { });
        return;
    }
    // مسار إزالة النجمة القديم (يشتغل لما يضغط الزر الأول)
    if (data === 'watermark_auto_gemini') {
        await ctx.answerCallbackQuery().catch(() => { });
        const autoAdminIds = (process.env.ADMIN_IDS || '').split(',');
        const isAutoAdmin = autoAdminIds.includes(ctx.from.id.toString());
        const autoUser = await User_1.User.findOne({ telegramId: ctx.from.id.toString() });
        if (!autoUser)
            return;
        if (!isAutoAdmin && autoUser.dailyQuota < 1) {
            await ctx.reply(`⚠️ <b>عذراً، رصيدك غير كافٍ!</b>\nتحتاج محاولة واحدة على الأقل.\n💡 رصيدك الحالي: ${autoUser.dailyQuota}`, { parse_mode: 'HTML' });
            return;
        }
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { awaitingAutoEraserImage: true } });
        await ctx.reply('📸 أرسل لي الصورة الآن وسأقوم بإزالة نجمة Gemini من الزاوية تلقائياً.', {
            reply_markup: {
                inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'cancel_auto_eraser' }]]
            }
        });
        return;
    }
    if (data === 'watermark_custom_start') {
        await ctx.answerCallbackQuery().catch(() => { });
        const adminIds = process.env.ADMIN_IDS?.split(',') || [];
        const isAdminUser = adminIds.includes(ctx.from.id.toString());
        const customUser = await User_1.User.findOne({ telegramId: ctx.from.id.toString() });
        if (!customUser)
            return;
        if (customUser.dailyQuota < 2 && !isAdminUser) {
            await ctx.reply("⚠️ رصيدك الحالي غير كافٍ لهذه العملية.\nتحتاج على الأقل <b>2 محاولات</b> لتفعيل هذه الأداة.", { parse_mode: 'HTML' });
            return;
        }
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { awaitingCustomEraserImage: true } });
        await ctx.reply(`🖌️ <b>إزالة عنصر مخصص</b>\n\n📸 أرسل لي الصورة التي تريد تعديلها الآن.`, { parse_mode: 'HTML' });
        return;
    }
    async function buildMaskFromCells(rawBuffer, selectedCells, cols, rows) {
        const meta = await (0, sharp_1.default)(rawBuffer).metadata();
        const W = meta.width;
        const H = meta.height;
        const cellW = Math.floor(W / cols);
        const cellH = Math.floor(H / rows);
        let maskPipeline = (0, sharp_1.default)({
            create: { width: W, height: H, channels: 3,
                background: { r: 0, g: 0, b: 0 } }
        });
        const composites = [];
        for (const cellNum of selectedCells) {
            const idx = cellNum - 1;
            const col = idx % cols;
            const row = Math.floor(idx / cols);
            const x = Math.max(0, col * cellW - Math.round(cellW * 0.1));
            const y = Math.max(0, row * cellH - Math.round(cellH * 0.1));
            const w = Math.min(W - x, cellW + Math.round(cellW * 0.2));
            const h = Math.min(H - y, cellH + Math.round(cellH * 0.2));
            const whiteRect = await (0, sharp_1.default)({
                create: { width: w, height: h, channels: 3,
                    background: { r: 255, g: 255, b: 255 } }
            }).png().toBuffer();
            composites.push({ input: whiteRect, left: x, top: y });
        }
        const maskBuffer = await maskPipeline
            .composite(composites)
            .blur(6)
            .png()
            .toBuffer();
        return maskBuffer;
    }
    async function drawGridOnImage(inputBuffer, cols, rows) {
        const meta = await (0, sharp_1.default)(inputBuffer).metadata();
        const W = meta.width;
        const H = meta.height;
        const cellW = W / cols;
        const cellH = H / rows;
        const lineW = Math.max(1, Math.round(W / 600));
        const fontSize = Math.max(16, Math.min(Math.floor(cellW * 0.38), Math.floor(cellH * 0.48), 38));
        let svgParts = [];
        // Grid lines — vertical
        for (let c = 1; c < cols; c++) {
            const x = Math.round(c * cellW);
            svgParts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" ` +
                `stroke="white" stroke-width="${lineW}" opacity="0.85"/>`);
        }
        // Grid lines — horizontal
        for (let r = 1; r < rows; r++) {
            const y = Math.round(r * cellH);
            svgParts.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" ` +
                `stroke="white" stroke-width="${lineW}" opacity="0.85"/>`);
        }
        // Cell numbers with shadow
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const num = String(r * cols + c + 1);
                const cx = Math.round(c * cellW + cellW / 2);
                const cy = Math.round(r * cellH + cellH / 2);
                // Black shadow
                svgParts.push(`<text x="${cx + 2}" y="${cy + 2}" ` +
                    `font-family="Liberation Sans, DejaVu Sans, sans-serif" ` +
                    `font-size="${fontSize}" font-weight="bold" ` +
                    `text-anchor="middle" dominant-baseline="middle" ` +
                    `fill="black" opacity="0.55">${num}</text>`);
                // White number
                svgParts.push(`<text x="${cx}" y="${cy}" ` +
                    `font-family="Liberation Sans, DejaVu Sans, sans-serif" ` +
                    `font-size="${fontSize}" font-weight="bold" ` +
                    `text-anchor="middle" dominant-baseline="middle" ` +
                    `fill="white" opacity="1">${num}</text>`);
            }
        }
        const svg = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">` +
            svgParts.join('') +
            `</svg>`, 'utf-8');
        return (0, sharp_1.default)(inputBuffer)
            .composite([{ input: svg, top: 0, left: 0 }])
            .jpeg({ quality: 88 })
            .toBuffer();
    }
    function buildCellKeyboard(totalCells, selectedCells) {
        const kb = new grammy_1.InlineKeyboard();
        const BTNS_PER_ROW = totalCells <= 100 ? 5 : 10;
        for (let i = 1; i <= totalCells; i++) {
            const isSelected = selectedCells.includes(i);
            const label = isSelected ? `✅${i}` : String(i);
            kb.text(label, `cgz_${i}`);
            if (i % BTNS_PER_ROW === 0)
                kb.row();
        }
        // Process button
        kb.row().text(selectedCells.length > 0
            ? `🚀 عالج الصورة (${selectedCells.length} مربع)`
            : '🚀 عالج الصورة', 'cgz_process');
        // Back button
        kb.row().text('🔙 رجوع لاختيار الحجم', 'cgz_back');
        // Cancel button
        kb.row().text('❌ إلغاء', 'cancel_custom_eraser');
        return kb;
    }
    if (data === 'cgz_more') {
        await ctx.answerCallbackQuery().catch(() => { });
        const userId = ctx.from.id.toString();
        const user = await User_1.User.findOne({ telegramId: userId });
        if (!user || !user.awaitingCustomEraserZone)
            return;
        if (user.customEraserBtnMsgId) {
            await ctx.api.deleteMessage(ctx.chat.id, user.customEraserBtnMsgId).catch(() => { });
        }
        const selectedCells = user.customEraserSelectedCells || [];
        const count = selectedCells.length;
        const list = selectedCells.join(', ');
        const gridSize = user.customEraserGridSize || 30;
        const MAX_CELLS = gridSize >= 100 ? 10 : 6;
        const kb = buildCellKeyboard(gridSize, selectedCells);
        const newBtnMsg = await ctx.reply(`📍 <b>اختر مربعاً إضافياً:</b>\nالمحدد حالياً: ${list}\n(المتبقي: ${MAX_CELLS - count} مربعات)`, { parse_mode: 'HTML', reply_markup: kb });
        user.customEraserBtnMsgId = newBtnMsg.message_id;
        await user.save();
        return;
    }
    if (data === 'cgz_process') {
        await ctx.answerCallbackQuery().catch(() => { });
        const userId = ctx.from.id.toString();
        const user = await User_1.User.findOne({ telegramId: userId });
        if (!user || !user.awaitingCustomEraserZone || !user.customEraserFileId) {
            await ctx.reply("❌ انتهت صلاحية الجلسة، ابدأ من جديد.");
            return;
        }
        if (!user.customEraserSelectedCells || user.customEraserSelectedCells.length === 0) {
            await ctx.answerCallbackQuery({
                text: '⚠️ لم تحدد أي مربع بعد! اضغط على الأرقام أولاً.',
                show_alert: true,
            });
            return;
        }
        const adminIds = process.env.ADMIN_IDS?.split(',') || [];
        const isAdminUser = adminIds.includes(userId);
        if (user.dailyQuota < 3 && !isAdminUser) {
            await ctx.reply("⚠️ رصيدك الحالي غير كافٍ لهذه العملية.\nتحتاج على الأقل <b>3 محاولات</b>.", { parse_mode: 'HTML' });
            return;
        }
        user.awaitingCustomEraserZone = false;
        await user.save();
        if (user.customEraserBtnMsgId) {
            await ctx.api.deleteMessage(ctx.chat.id, user.customEraserBtnMsgId).catch(() => { });
        }
        const processingMsg = await ctx.reply("⚙️ <b>جارٍ المعالجة...</b> قد يستغرق 30-60 ثانية ⏳", { parse_mode: 'HTML' });
        try {
            const tgFile = await ctx.api.getFile(user.customEraserFileId);
            const imageUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;
            const res = await fetch(imageUrl);
            if (!res.ok)
                throw new Error('Failed to download image');
            const rawBuffer = Buffer.from(new Uint8Array(await res.arrayBuffer()));
            const gridSize = user.customEraserGridSize || 30;
            const cfg = GRID_CONFIGS[gridSize];
            const maskBuffer = await buildMaskFromCells(rawBuffer, user.customEraserSelectedCells, cfg.cols, cfg.rows);
            const { removeCustomAreaAI } = await Promise.resolve().then(() => __importStar(require('../../services/imageService')));
            const resultBuffer = await removeCustomAreaAI(rawBuffer, maskBuffer);
            if (!isAdminUser) {
                await User_1.User.updateOne({ telegramId: userId }, { $inc: { dailyQuota: -3 } });
            }
            await User_1.User.updateOne({ telegramId: userId }, { $set: { lastEraserResultBuffer: resultBuffer.toString('base64'), customEraserFileId: '' } });
            await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => { });
            const sentMsg = await ctx.replyWithDocument(new grammy_1.InputFile(resultBuffer, 'custom_erased.jpg'));
            await User_1.User.updateOne({ telegramId: userId }, { $set: { lastEraserResultMsgId: sentMsg.message_id } });
            const { InlineKeyboard } = await Promise.resolve().then(() => __importStar(require('grammy')));
            await ctx.reply("🔄 <b>تحويل الصيغة:</b>", {
                parse_mode: 'HTML',
                reply_markup: new InlineKeyboard()
                    .text('JPG', 'eraser_fmt_jpg')
                    .text('PNG', 'eraser_fmt_png')
                    .text('WEBP', 'eraser_fmt_webp')
                    .row()
                    .text('GIF', 'eraser_fmt_gif')
                    .text('TIFF', 'eraser_fmt_tiff')
            });
            const archiveChannel = process.env.ARCHIVE_GROUP_ID || process.env.CHANNEL_ID;
            if (archiveChannel) {
                const userLink = ctx.from.username ? `@${ctx.from.username}` : `<a href="tg://user?id=${ctx.from.id}">${ctx.from.first_name}</a>`;
                const date = new Date().toLocaleString('ar-SA');
                const cellsList = user.customEraserSelectedCells.join(', ');
                ctx.api.sendDocument(archiveChannel, new grammy_1.InputFile(resultBuffer, 'custom_erased.jpg'), {
                    caption: `📦 <b>نسخة أرشيفية — إزالة مخصصة</b>\n━━━━━━━━━━━━━━\n🆔 User ID: <code>${userId}</code>\n👤 Username: ${userLink}\n🔄 العملية: إزالة عنصر مخصص (شبكة)\n📍 المربعات المحددة: ${cellsList}\n💳 المخصوم: 3\n✅ الحالة: ناجحة\n📅 ${date}\n━━━━━━━━━━━━━━`,
                    parse_mode: 'HTML',
                    disable_notification: true,
                }).catch(e => console.error('[Archive Error]:', e));
            }
        }
        catch (err) {
            await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => { });
            console.error('[CustomEraserZone] Error:', err);
            await ctx.reply("❌ عذراً، لم أتمكن من معالجة الصورة هذه المرة. لم يتم خصم أي محاولات.");
        }
        return;
    }
    if (data === 'cgz_back') {
        await ctx.answerCallbackQuery().catch(() => { });
        const userId = ctx.from.id.toString();
        const user = await User_1.User.findOne({ telegramId: userId });
        if (!user || !user.customEraserFileId) {
            await ctx.reply('❌ انتهت الجلسة، ابدأ من جديد.');
            return;
        }
        await User_1.User.updateOne({ telegramId: userId }, {
            $set: {
                awaitingCustomEraserZone: false,
                customEraserSelectedCells: [],
                customEraserGridSize: 0,
            }
        });
        if (user.customEraserBtnMsgId) {
            await ctx.api.deleteMessage(ctx.chat.id, user.customEraserBtnMsgId).catch(() => { });
        }
        const sizeMsg = await ctx.reply(`🖼️ <b>اختر حجم الشبكة:</b>\nكلما زاد التقسيم، زادت دقة التحديد`, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '30 تقسيم', callback_data: 'cgz_size_30' },
                        { text: '40 تقسيم', callback_data: 'cgz_size_40' },
                    ],
                    [
                        { text: '50 تقسيم', callback_data: 'cgz_size_50' },
                        { text: '70 تقسيم', callback_data: 'cgz_size_70' },
                    ],
                    [
                        { text: '80 تقسيم', callback_data: 'cgz_size_80' },
                        { text: '🔒 100 تقسيم', callback_data: 'cgz_size_100' },
                    ],
                    [{ text: '❌ إلغاء', callback_data: 'cancel_custom_eraser' }],
                ]
            }
        });
        await User_1.User.updateOne({ telegramId: userId }, {
            $set: { customEraserBtnMsgId: sizeMsg.message_id }
        });
        return;
    }
    if (data.startsWith('cgz_size_')) {
        const newSize = parseInt(data.replace('cgz_size_', ''));
        const validSizes = [30, 40, 50, 70, 80, 100];
        if (!validSizes.includes(newSize))
            return;
        if (newSize === 100) {
            const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
            const isAdminUser = adminIds.includes(ctx.from.id.toString());
            if (!isAdminUser) {
                await ctx.answerCallbackQuery({
                    text: '🔒 هذا الخيار مقفل من قبل المطور\nللفتح تواصل معه مباشرة',
                    show_alert: true,
                });
                return;
            }
        }
        await ctx.answerCallbackQuery().catch(() => { });
        const userId = ctx.from.id.toString();
        const user = await User_1.User.findOne({ telegramId: userId });
        if (!user || !user.customEraserFileId) {
            await ctx.reply('❌ انتهت الجلسة، ابدأ من جديد.');
            return;
        }
        await User_1.User.updateOne({ telegramId: userId }, {
            $set: {
                customEraserGridSize: newSize,
                customEraserSelectedCells: [],
                awaitingCustomEraserZone: true,
            }
        });
        if (user.customEraserBtnMsgId) {
            await ctx.api.deleteMessage(ctx.chat.id, user.customEraserBtnMsgId).catch(() => { });
        }
        const tgFile = await ctx.api.getFile(user.customEraserFileId);
        const imageUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;
        const res = await fetch(imageUrl);
        const rawBuffer = Buffer.from(new Uint8Array(await res.arrayBuffer()));
        const cfg = GRID_CONFIGS[newSize];
        const gridImageBuffer = await drawGridOnImage(rawBuffer, cfg.cols, cfg.rows);
        await ctx.replyWithPhoto(new grammy_1.InputFile(gridImageBuffer), {
            caption: `📐 <b>تقسيم ${newSize} مربع</b> — اضغط على أرقام المربعات التي تحتوي العنصر:`,
            parse_mode: 'HTML',
        });
        const MAX_CELLS = newSize >= 100 ? 10 : 6;
        const kb = buildCellKeyboard(newSize, []);
        const btnMsg = await ctx.reply(`📍 <b>حدد المربعات:</b>\n(الحد الأقصى ${MAX_CELLS} مربعات)`, { parse_mode: 'HTML', reply_markup: kb });
        await User_1.User.updateOne({ telegramId: userId }, { $set: { customEraserBtnMsgId: btnMsg.message_id } });
        return;
    }
    if (data.startsWith('cgz_') && data !== 'cgz_more' && data !== 'cgz_process' && data !== 'cgz_back') {
        const N = parseInt(data.replace('cgz_', ''));
        if (isNaN(N))
            return;
        const userId = ctx.from.id.toString();
        const user = await User_1.User.findOne({ telegramId: userId });
        if (!user || !user.awaitingCustomEraserZone)
            return;
        if (user.customEraserSelectedCells?.includes(N)) {
            await ctx.answerCallbackQuery({ text: 'هذا المربع محدد مسبقاً ✅', show_alert: false }).catch(() => { });
            return;
        }
        const MAX_CELLS = (user.customEraserGridSize ?? 0) >= 100 ? 10 : 6;
        if ((user.customEraserSelectedCells?.length || 0) >= MAX_CELLS) {
            await ctx.answerCallbackQuery({
                text: `⚠️ وصلت للحد الأقصى (${MAX_CELLS} مربعات). اضغط "عالج الصورة" للمتابعة.`,
                show_alert: true
            }).catch(() => { });
            return;
        }
        const selectedCells = user.customEraserSelectedCells || [];
        selectedCells.push(N);
        user.customEraserSelectedCells = selectedCells;
        await user.save();
        await ctx.answerCallbackQuery({ text: `✅ تم إضافة المربع ${N}`, show_alert: false }).catch(() => { });
        if (user.customEraserBtnMsgId) {
            await ctx.api.deleteMessage(ctx.chat.id, user.customEraserBtnMsgId).catch(() => { });
        }
        const count = selectedCells.length;
        const list = selectedCells.join(', ');
        const gridSize = user.customEraserGridSize || 30;
        const kb = buildCellKeyboard(gridSize, selectedCells);
        const newBtnMsg = await ctx.reply(`✅ <b>تم اختيار ${count} مربع/مربعات:</b> ${list}\n\nهل تريد إضافة مربع آخر أم تبدأ المعالجة؟`, { parse_mode: 'HTML', reply_markup: kb });
        user.customEraserBtnMsgId = newBtnMsg.message_id;
        await user.save();
        return;
    }
    if (data === 'cancel_custom_eraser') {
        await ctx.answerCallbackQuery({ text: 'تم الإلغاء ❌' }).catch(() => { });
        const user = await User_1.User.findOne({ telegramId: ctx.from.id.toString() });
        if (user?.customEraserBtnMsgId) {
            await ctx.api.deleteMessage(ctx.chat.id, user.customEraserBtnMsgId).catch(() => { });
        }
        await User_1.User.updateOne({ telegramId: ctx.from.id.toString() }, { $set: { awaitingCustomEraserImage: false, awaitingCustomEraserZone: false, customEraserFileId: '', customEraserSelectedCells: [], customEraserBtnMsgId: null, customEraserGridSize: 0 } });
        await ctx.reply('تم الإلغاء ❌');
        return;
    }
    if (data === 'cancel_auto_eraser') {
        await ctx.answerCallbackQuery({ text: 'تم الإلغاء ❌' }).catch(() => { });
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { awaitingAutoEraserImage: false } });
        await ctx.deleteMessage().catch(() => { });
        return;
    }
    if (data === 'cancel_eraser') {
        await ctx.answerCallbackQuery({ text: 'تم الإلغاء ❌' }).catch(() => { });
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, {
            $set: {
                awaitingEraserImage: false,
                awaitingEraserOriginal: false,
                'eraserCoords.minX': null,
                'eraserCoords.minY': null,
                'eraserCoords.width': null,
                'eraserCoords.height': null
            }
        });
        await ctx.deleteMessage().catch(() => { });
        return;
    }
    if (data.startsWith('convert_')) {
        await ctx.answerCallbackQuery().catch(() => { });
        // Extract format from callback_data (e.g., convert_jpg_1234567890 → jpg)
        const parts = data.split('_');
        const format = parts[1];
        const validFormats = ['jpg', 'png', 'webp', 'gif', 'tiff'];
        if (!validFormats.includes(format))
            return;
        // Get user's last processed image URL
        const convertUser = await User_1.User.findOne({ telegramId: ctx.from.id.toString() });
        if (!convertUser?.lastEraserResultUrl) {
            await ctx.reply('⚠️ انتهت صلاحية الصورة. يرجى إعادة المعالجة من جديد.');
            return;
        }
        const processingMsg = await ctx.reply(`⏳ جاري تحويل الصورة إلى ${format.toUpperCase()}...`);
        try {
            // Re-process the original image to get clean result
            const { convertImageFormat } = await Promise.resolve().then(() => __importStar(require('../../services/imageService')));
            const res = await fetch(convertUser.lastEraserResultUrl);
            const erasedBuffer = Buffer.from(new Uint8Array(await res.arrayBuffer()));
            const { buffer: convertedBuffer, ext } = await convertImageFormat(erasedBuffer, format);
            const fileName = `NizoAI_Clean_${Date.now()}.${ext}`;
            await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => { });
            const { InputFile } = await Promise.resolve().then(() => __importStar(require('grammy')));
            const { incrementGlobalCounter } = await Promise.resolve().then(() => __importStar(require('../../services/statsService')));
            await incrementGlobalCounter();
            await ctx.replyWithDocument(new InputFile(convertedBuffer, fileName), { caption: `✅ تم التحويل إلى <b>${format.toUpperCase()}</b> بنجاح! 🎉`, parse_mode: 'HTML' });
            // Delete the format selection message to keep chat clean
            await ctx.deleteMessage().catch(() => { });
        }
        catch (error) {
            await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => { });
            console.error('[Convert] Error:', error?.message);
            await ctx.reply('❌ حدث خطأ أثناء التحويل. يرجى المحاولة مجدداً.');
        }
        return;
    }
    // ══════════════════════════════════════
    // ✏️ LIVE TEXT EDITOR — admin_edit_texts
    // ══════════════════════════════════════
    if (data === 'admin_edit_texts') {
        if (!adminIds.includes(ctx.from.id.toString()))
            return;
        await ctx.answerCallbackQuery();
        await ctx.reply('✏️ <b>تعديل نصوص البوت</b>\n\nاختر الفئة:', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💬 رسائل البوت', callback_data: 'txtedit_cat_message' }],
                    [{ text: '🔘 أسماء الأزرار', callback_data: 'txtedit_cat_button' }],
                    [{ text: '🔔 الإشعارات', callback_data: 'txtedit_cat_notification' }],
                    [{ text: '🔙 رجوع للوحة', callback_data: 'admin_panel' }],
                ]
            }
        });
        return;
    }
    if (data.startsWith('txtedit_cat_')) {
        if (!adminIds.includes(ctx.from.id.toString()))
            return;
        await ctx.answerCallbackQuery();
        const catMap = {
            txtedit_cat_message: 'message',
            txtedit_cat_button: 'button',
            txtedit_cat_notification: 'notification',
        };
        const category = catMap[data];
        if (!category)
            return;
        const { getByCategory } = await Promise.resolve().then(() => __importStar(require('../../services/botTextsService')));
        const items = await getByCategory(category);
        const labelMap = {
            message: '💬 رسائل البوت',
            button: '🔘 أسماء الأزرار',
            notification: '🔔 الإشعارات',
        };
        const keyboard = items.map(item => ([{
                // callback_data max 64 chars — key prefix "txtedit_item_" = 13 chars
                text: `✏️ ${item.description}`,
                callback_data: `txtedit_item_${item.key}`.slice(0, 64)
            }]));
        keyboard.push([{ text: '🔙 رجوع', callback_data: 'admin_edit_texts' }]);
        await ctx.reply(`📋 <b>${labelMap[category]}</b>\n\nاختر العنصر:`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
        return;
    }
    if (data.startsWith('txtedit_item_')) {
        if (!adminIds.includes(ctx.from.id.toString()))
            return;
        await ctx.answerCallbackQuery();
        const key = data.replace('txtedit_item_', '');
        const { getText } = await Promise.resolve().then(() => __importStar(require('../../services/botTextsService')));
        const currentValue = await getText(key);
        // Set admin awaiting state
        await User_1.User.updateOne({ telegramId: ctx.from.id.toString() }, { adminAwaitingInput: `txtedit:${key}` });
        await ctx.reply(`✏️ <b>تعديل النص</b>\n\n` +
            `🔑 <b>المفتاح:</b> <code>${key}</code>\n\n` +
            `📝 <b>النص الحالي:</b>\n` +
            `<code>${currentValue.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>\n\n` +
            `📨 <b>أرسل الآن النص الجديد</b>\n\n` +
            `📌 المتغيرات المتاحة (إن وجدت):\n` +
            `• <code>{timeLeft}</code> الوقت المتبقي\n` +
            `• <code>{required}</code> المحاولات المطلوبة\n` +
            `• <code>{current}</code> الرصيد الحالي\n` +
            `• <code>{userId}</code> معرف المستخدم\n` +
            `• <code>{username}</code> اسم المستخدم\n\n` +
            `✅ يدعم: *bold* _italic_ \`code\`\n` +
            `❌ أرسل /cancel للإلغاء`, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔄 استعادة الافتراضي', callback_data: `txtedit_reset_${key}`.slice(0, 64) }],
                    [{ text: '❌ إلغاء', callback_data: 'txtedit_cancel' }],
                ]
            }
        });
        return;
    }
    if (data.startsWith('txtedit_reset_')) {
        if (!adminIds.includes(ctx.from.id.toString()))
            return;
        await ctx.answerCallbackQuery();
        const key = data.replace('txtedit_reset_', '');
        const { resetText } = await Promise.resolve().then(() => __importStar(require('../../services/botTextsService')));
        const restored = await resetText(key);
        await User_1.User.updateOne({ telegramId: ctx.from.id.toString() }, { adminAwaitingInput: '' });
        if (restored) {
            await ctx.reply(`✅ <b>تم استعادة النص الافتراضي</b>\n\n` +
                `📝 <b>النص المُستعاد:</b>\n<code>${restored.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>`, { parse_mode: 'HTML' });
        }
        else {
            await ctx.reply('❌ لم يتم العثور على هذا المفتاح.');
        }
        return;
    }
    if (data === 'txtedit_cancel') {
        await ctx.answerCallbackQuery();
        await User_1.User.updateOne({ telegramId: ctx.from.id.toString() }, { adminAwaitingInput: '' });
        await ctx.reply('❌ تم الإلغاء.');
        return;
    }
    // ════════════════════════════════
    // 🎯 Attempts Management
    // ════════════════════════════════
    if (data === 'admin_manage_attempts' && isAdminUser) {
        await ctx.answerCallbackQuery().catch(() => { });
        await ctx.reply('🎯 <b>إدارة المحاولات</b>\n\nاختر العملية المطلوبة:', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '➕ إضافة للجميع', callback_data: 'attempts_add_all' }],
                    [{ text: '👤 إضافة لشخص محدد', callback_data: 'attempts_add_one' }],
                    [{ text: '➖ خصم من شخص محدد', callback_data: 'attempts_remove_one' }],
                    [{ text: '🔄 تصفير شخص محدد', callback_data: 'attempts_reset_one' }],
                    [{ text: '❌ إغلاق', callback_data: 'admin_close' }],
                ]
            }
        });
        return;
    }
    if (data === 'attempts_add_all' && isAdminUser) {
        await ctx.answerCallbackQuery().catch(() => { });
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { adminAwaitingInput: 'attempts_add_all', adminTargetUserId: null } });
        await ctx.reply('➕ <b>إضافة محاولات للجميع</b>\n\nأرسل عدد المحاولات التي تريد إضافتها لجميع المستخدمين:', { parse_mode: 'HTML' });
        return;
    }
    if (data === 'attempts_add_one' && isAdminUser) {
        await ctx.answerCallbackQuery().catch(() => { });
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { adminAwaitingInput: 'attempts_add_one_id', adminTargetUserId: null } });
        await ctx.reply('👤 <b>إضافة لشخص محدد</b>\n\nأرسل الـ ID الخاص بالمستخدم:', { parse_mode: 'HTML' });
        return;
    }
    if (data === 'attempts_remove_one' && isAdminUser) {
        await ctx.answerCallbackQuery().catch(() => { });
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { adminAwaitingInput: 'attempts_remove_one_id', adminTargetUserId: null } });
        await ctx.reply('➖ <b>خصم من شخص محدد</b>\n\nأرسل الـ ID الخاص بالمستخدم:', { parse_mode: 'HTML' });
        return;
    }
    if (data === 'attempts_reset_one' && isAdminUser) {
        await ctx.answerCallbackQuery().catch(() => { });
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { adminAwaitingInput: 'attempts_reset_one_id', adminTargetUserId: null } });
        await ctx.reply('🔄 <b>تصفير شخص محدد</b>\n\nأرسل الـ ID الخاص بالمستخدم:', { parse_mode: 'HTML' });
        return;
    }
    if (data === 'admin_create_magic_link' && isAdminUser) {
        await ctx.answerCallbackQuery().catch(() => { });
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { adminAwaitingInput: 'magic_link_reward', adminTargetUserId: null } });
        await ctx.reply('🔗 <b>إنشاء رابط مكافأة خاص</b>\n\nأرسل عدد المحاولات التي سيحصل عليها كل شخص يدخل من هذا الرابط:', { parse_mode: 'HTML' });
        return;
    }
    // ════════════════════════════════
    // 📢 Force Sub Admin Management
    // ════════════════════════════════
    if (data === 'admin_force_sub' && isAdminUser) {
        await ctx.answerCallbackQuery().catch(() => { });
        const channels = await ForceSubChannel_1.ForceSubChannel.find().sort({ order: 1 });
        const fsubKeyboard = channels.map((ch) => ([{
                text: `🗑 حذف: ${ch.channelName}`,
                callback_data: `del_fsub_${String(ch._id)}`,
            }]));
        if (channels.length < 10) {
            fsubKeyboard.push([{
                    text: '➕ إضافة قناة جديدة',
                    callback_data: 'add_fsub',
                }]);
        }
        fsubKeyboard.push([{ text: '🔙 رجوع', callback_data: 'admin_panel' }]);
        await ctx.reply(`📢 <b>قنوات الاشتراك الإجباري</b>\n\n` +
            `عدد القنوات: ${channels.length}/10\n\n` +
            (channels.length === 0
                ? 'لا توجد قنوات مضافة.'
                : channels.map((c, i) => `${i + 1}. ${c.channelName}`).join('\n')), {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: fsubKeyboard },
        });
        return;
    }
    if (data === 'add_fsub' && isAdminUser) {
        await ctx.answerCallbackQuery().catch(() => { });
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { adminAwaitingInput: 'add_fsub_input' } });
        await ctx.editMessageText('📢 <b>إضافة قناة اشتراك إجباري</b>\n\n' +
            '⚠️ تأكد أن البوت <b>مشرف</b> في القناة أولاً.\n\n' +
            'أرسل بيانات القناة بهذا الشكل:\n' +
            '<code>CHANNEL_ID | CHANNEL_URL | CHANNEL_NAME</code>\n\n' +
            'مثال:\n' +
            '<code>-1001234567890 | https://t.me/mychannel | قناتي</code>', { parse_mode: 'HTML' }).catch(async () => {
            await ctx.reply('📢 <b>إضافة قناة اشتراك إجباري</b>\n\n' +
                '⚠️ تأكد أن البوت <b>مشرف</b> في القناة أولاً.\n\n' +
                'أرسل بيانات القناة بهذا الشكل:\n' +
                '<code>CHANNEL_ID | CHANNEL_URL | CHANNEL_NAME</code>\n\n' +
                'مثال:\n' +
                '<code>-1001234567890 | https://t.me/mychannel | قناتي</code>', { parse_mode: 'HTML' });
        });
        return;
    }
    if (data.startsWith('del_fsub_') && isAdminUser) {
        const docId = data.replace('del_fsub_', '');
        await ForceSubChannel_1.ForceSubChannel.findByIdAndDelete(docId);
        await ctx.answerCallbackQuery({
            text: '✅ تم حذف القناة',
            show_alert: true,
        }).catch(() => { });
        // Refresh the force-sub management screen
        const updatedChannels = await ForceSubChannel_1.ForceSubChannel.find().sort({ order: 1 });
        const updatedKeyboard = updatedChannels.map((ch) => ([{
                text: `🗑 حذف: ${ch.channelName}`,
                callback_data: `del_fsub_${String(ch._id)}`,
            }]));
        if (updatedChannels.length < 10) {
            updatedKeyboard.push([{
                    text: '➕ إضافة قناة جديدة',
                    callback_data: 'add_fsub',
                }]);
        }
        updatedKeyboard.push([{ text: '🔙 رجوع', callback_data: 'admin_panel' }]);
        await ctx.editMessageText(`📢 <b>قنوات الاشتراك الإجباري</b>\n\nعدد القنوات: ${updatedChannels.length}/10`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: updatedKeyboard },
        }).catch(() => { });
        return;
    }
    // ── GIVEAWAY: Admin starts setup ─────────────────────────────────────────
    if (data === 'admin_giveaway_start' && isAdminUser) {
        await ctx.answerCallbackQuery().catch(() => { });
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { 'giveawaySetup.step': 'gw_winners' } });
        await ctx.reply('🎁 <b>إعداد عجلة الحظ والتوزيعات</b>\n\n' +
            '━━━━━━━━━━━━━━━━━\n' +
            '👥 <b>الخطوة 1/3</b>\n' +
            'أرسل <b>عدد الفائزين</b> في هذه التوزيعة\n' +
            '<i>مثال: 50</i>', { parse_mode: 'HTML' });
        return;
    }
    // ── GIVEAWAY: Roll handler (user presses button in channel) ──────────────
    if (data === 'gw_roll_init') {
        const { Giveaway } = await Promise.resolve().then(() => __importStar(require('../../database/models/Giveaway')));
        const messageId = ctx.callbackQuery?.message?.message_id;
        const giveaway = await Giveaway.findOne({ messageId });
        if (!giveaway || !giveaway.isActive) {
            await ctx.answerCallbackQuery({
                text: '⏰ انتهت هذه التوزيعة!\nترقبوا التوزيعات القادمة 🚀',
                show_alert: true,
            });
            return;
        }
        const userId = ctx.from.id.toString();
        // Already participated check
        if (giveaway.participants.includes(userId)) {
            const isWinner = giveaway.winners.includes(userId);
            await ctx.answerCallbackQuery({
                text: isWinner
                    ? '🏆 أنت من الفائزين في هذه التوزيعة! محاولاتك تم إضافتها مسبقاً ✅'
                    : '⚠️ لقد جربت حظك مسبقاً في هذه التوزيعة!\nانتظر التوزيعات القادمة 🎯',
                show_alert: true,
            });
            return;
        }
        // User must have started the bot
        const participant = await User_1.User.findOne({ telegramId: userId });
        if (!participant) {
            await ctx.answerCallbackQuery({
                text: '⚠️ يجب البدء بالبوت أولاً!\nأرسل /start للبوت وعد مرة أخرى 🤖',
                show_alert: true,
            });
            return;
        }
        // Atomic add to participants (race-condition safe)
        const updated = await Giveaway.findOneAndUpdate({ _id: giveaway._id, participants: { $ne: userId }, isActive: true }, { $push: { participants: userId } }, { new: true });
        if (!updated) {
            await ctx.answerCallbackQuery({
                text: '⚠️ لقد جربت حظك مسبقاً!\nانتظر التوزيعات القادمة 🎯',
                show_alert: true,
            });
            return;
        }
        // Smart probability: active users (totalEnhancements ≥ 5) → 70%, others → 20%
        const isActiveUser = (participant.totalEnhancements ?? 0) >= 5;
        const winChance = isActiveUser ? 0.70 : 0.20;
        const hasWon = Math.random() < winChance &&
            updated.currentWinners < updated.maxWinners;
        if (hasWon) {
            const reward = Math.floor(Math.random() * (updated.maxReward - updated.minReward + 1)) +
                updated.minReward;
            await User_1.User.updateOne({ telegramId: userId }, { $inc: { dailyQuota: reward } });
            await Giveaway.updateOne({ _id: giveaway._id }, { $inc: { currentWinners: 1 }, $push: { winners: userId } });
            await ctx.answerCallbackQuery({
                text: `🎉🎉 مبـــروووووك يا بطل! 🎉🎉\n\n` +
                    `🏆 ربحت ${reward} محاولات مجانية!\n` +
                    `✅ تمت إضافتها لرصيدك فوراً\n\n` +
                    `شكراً لتفاعلك مع البوت 💎`,
                show_alert: true,
            });
            // Close giveaway if all winners claimed
            const fresh = await Giveaway.findById(giveaway._id);
            if (fresh && fresh.currentWinners >= fresh.maxWinners) {
                await Giveaway.updateOne({ _id: giveaway._id }, { $set: { isActive: false } });
                try {
                    await ctx.api.editMessageText(updated.channelId, updated.messageId, `🎉 <b>توزيعات NizoAI Bot</b>\n\n` +
                        `✅ <b>انتهت التوزيعة بنجاح!</b>\n` +
                        `تم توزيع جميع الجوائز على ${fresh.maxWinners} فائز محظوظ 🏆\n\n` +
                        `🔔 تابعونا للتوزيعات القادمة! 🚀`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } });
                }
                catch (_) { /* channel edit may fail — silent */ }
            }
        }
        else {
            await ctx.answerCallbackQuery({
                text: `💔 عذراً صديقي، لم يحالفك الحظ هذه المرة\n\n` +
                    `💡 نصيحة: المستخدمون النشطون لديهم فرص أعلى!\n` +
                    `🎯 استخدم البوت أكثر وستزداد فرصك 🚀\n\n` +
                    `انتظر التوزيعات القادمة 🎁`,
                show_alert: true,
            });
        }
        return;
    }
}
//# sourceMappingURL=callbackHandler.js.map