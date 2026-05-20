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
exports.imageHandler = imageHandler;
// src/bot/handlers/imageHandler.ts
const grammy_1 = require("grammy");
const grammy_2 = require("grammy");
const User_1 = require("../../database/models/User");
const validators_1 = require("../../utils/validators");
const settingsService_1 = require("../../services/settingsService");
const onnxEnhanceService_1 = require("../../services/onnxEnhanceService");
async function imageHandler(ctx) {
    const telegramId = ctx.from?.id.toString();
    const reportUser = await User_1.User.findOne({ telegramId });
    // ── Format Conversion Interceptor ──
    const userRecord = reportUser;
    if (userRecord?.awaitingFormatConversion &&
        !userRecord.awaitingCustomEraserImage) {
        const doc = ctx.message?.document;
        if (!doc) {
            if (userRecord.awaitingCustomEraserImage) {
                // fall through — do NOT return, let custom eraser handlers below take over
            }
            else {
                await ctx.reply('⚠️ أرسل الصورة كـ <b>مستند (ملف)</b> وليس كصورة عادية.\n' +
                    'اضغط 📎 ← اختر "ملف" ← اختر صورتك', { parse_mode: 'HTML' });
                return;
            }
            return; // exit format conversion block entirely — custom eraser handles below
        }
        if (doc) {
            const mimeType = doc.mime_type || '';
            const isImage = mimeType.startsWith('image/') ||
                doc.file_name?.match(/\.(jpg|jpeg|png|webp|avif|tiff|tif|bmp|gif|heic|heif)$/i);
            if (!isImage) {
                await ctx.reply('❌ الملف ليس صورة. أرسل ملف صورة صحيح.');
                return; // STRICT RETURN
            }
            const mimeToFormat = {
                'image/jpeg': 'JPG', 'image/jpg': 'JPG',
                'image/png': 'PNG', 'image/webp': 'WEBP',
                'image/avif': 'AVIF', 'image/tiff': 'TIFF',
                'image/gif': 'GIF', 'image/bmp': 'BMP',
                'image/heic': 'HEIC', 'image/heif': 'HEIF',
            };
            const detectedFormat = mimeToFormat[mimeType] ||
                doc.file_name?.split('.').pop()?.toUpperCase() || 'غير معروف';
            // Save file_id and pause awaiting state
            const updatedUser = await User_1.User.findOneAndUpdate({ telegramId }, {
                $push: { pendingConversionFiles: doc.file_id },
                $set: { awaitingFormatConversion: false },
            }, { new: true });
            const count = updatedUser?.pendingConversionFiles?.length || 1;
            if (count >= 5) {
                // Max reached — force format selection
                await ctx.reply(`✅ تم استلام الصورة <b>${count}</b>\n\n` +
                    `⚠️ <b>تنبيه:</b> وصلت للحد الأقصى المسموح به (5 صور).\n\n` +
                    `🔓 للحصول على حد أعلى، تواصل مع المطور.\n\n` +
                    `اختر الآن ما تريد:`, {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            // @ts-ignore
                            [{ text: '✅ واصل لاختيار الصيغة', callback_data: 'conv_batch_finish' }],
                            [{ text: '💬 مراسلة المطور', url: `https://t.me/${process.env.ADMIN_USERNAME || 'Nizar_CEO'}` }],
                            // @ts-ignore
                            [{ text: '❌ إلغاء', callback_data: 'convert_format_cancel' }],
                        ],
                    },
                });
            }
            else {
                // Under limit — ask if more
                await ctx.reply(`✅ تم استلام الصورة <b>${count}</b>\n` +
                    `📋 <b>الصيغة الحالية:</b> ${detectedFormat}\n\n` +
                    `هل توجد صور أخرى تريد تحويلها أيضاً؟\n` +
                    `<i>المتبقي: ${5 - count} صورة</i>`, {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                // @ts-ignore
                                { text: `✅ نعم (${5 - count} متبقي)`, callback_data: 'conv_batch_add', style: 'success' },
                                { text: '❌ لا، اختر الصيغة', callback_data: 'conv_batch_finish', style: 'primary' },
                            ],
                            // @ts-ignore
                            [{ text: '🚫 إلغاء الكل', callback_data: 'convert_format_cancel' }],
                        ],
                    },
                });
            }
            return; // STRICT RETURN — stop all other processing
        }
    }
    // PRO ENHANCE INTERCEPTOR — must run before normal processing
    const userId = ctx.from?.id;
    if (!userId)
        return;
    // ── FILTERS MENU INTERCEPTOR ─────────────────────────────────────────
    if (ctx.session?.inFiltersMenu && !ctx.session?.awaitingFilterAction) {
        const isMedia = ctx.message?.photo || ctx.message?.document;
        if (isMedia) {
            await ctx.reply("⚠️ <b>الرجاء اختيار الفلتر الذي تريد تطبيقه على صورتك من الأزرار أعلاه أولاً.</b>", { parse_mode: 'HTML' });
            return;
        }
    }
    let user = await User_1.User.findOne({ telegramId: userId.toString() });
    if (!user) {
        await ctx.reply('⚠️ يرجى إرسال /start أولاً لتسجيل حسابك.');
        return;
    }
    // ── UNIFIED FILTER INTERCEPTOR ─────────────────────────────────────────
    if (ctx.session?.awaitingFilterAction && ctx.session.awaitingFilterAction.startsWith('filter_')) {
        const photo = ctx.message?.photo;
        const document = ctx.message?.document;
        const fileId = photo ? photo[photo.length - 1].file_id : document?.file_id;
        if (!fileId) {
            await ctx.reply('⚠️ يرجى إرسال الصورة كصورة أو كملف للبدء بالمعالجة.');
            return;
        }
        const pendingFilter = ctx.session.awaitingFilterAction;
        ctx.session.activeImageFileId = fileId;
        ctx.session.awaitingFilterAction = undefined; // Clear state immediately
        ctx.session.inFiltersMenu = false; // Clear menu state
        const processingMsg = await ctx.reply('⏳ جاري استلام الصورة والبدء بالمعالجة...');
        try {
            const tgFile = await ctx.api.getFile(fileId);
            const imageUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;
            const { processImageFilter } = await Promise.resolve().then(() => __importStar(require('../../services/imageService')));
            // ── UNIFIED FILTER PIPELINE (restore + all other filters) ─────────────────────
            const filterType = pendingFilter.replace('filter_', '');
            const cost = ['anime', 'ghibli'].includes(filterType) ? 3 : 2; // restore costs 2
            const filterNames = {
                face: '👤 تصفية الوجه',
                color: '🎨 تلوين الصور',
                anime: '🌸 أنمي',
                ghibli: ' جيبلي فني',
                restore: '🪄 ترميم الصورة',
            };
            // STRICT: Check quota BEFORE calling API
            if (user.dailyQuota < cost) {
                await ctx.reply(`⚠️ رصيدك غير كافٍ!\nتحتاج <b>${cost} محاولات</b> لهذا الفلتر.\nرصيدك الحالي: <b>${user.dailyQuota}</b>`, { parse_mode: 'HTML' });
                await ctx.api.deleteMessage(ctx.chat.id, processingMsg.message_id).catch(() => { });
                return;
            }
            // STRICT: Deduct BEFORE calling API
            const updatedUser = await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $inc: { dailyQuota: -cost } }, { new: true });
            try {
                const resultBuffer = await processImageFilter(imageUrl, filterType);
                await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { lastEraserResultBuffer: resultBuffer.toString('base64') } });
                const { incrementGlobalCounter } = await Promise.resolve().then(() => __importStar(require('../../services/statsService')));
                await incrementGlobalCounter();
                // Archive
                const archiveChannel = process.env.ARCHIVE_GROUP_ID || process.env.ARCHIVE_CHANNEL || process.env.CHANNEL_ID;
                if (archiveChannel) {
                    const sizeMB = (resultBuffer.length / (1024 * 1024)).toFixed(2);
                    ctx.api.sendDocument(archiveChannel, new grammy_2.InputFile(resultBuffer, `filter_${filterType}.jpg`), {
                        caption: `📦 <b>أرشيف — فلاتر الصور</b>\n━━━━━━━━━━━━━━\n🆔 <b>User ID:</b> <code>${ctx.from.id}</code>\n🎨 <b>الفلتر:</b> ${filterNames[filterType] ?? filterType}\n✅ <b>الحالة:</b> ناجحة\n📦 <b>الحجم:</b> ${sizeMB} MB\n━━━━━━━━━━━━━━`,
                        parse_mode: 'HTML',
                        disable_notification: true
                    }).catch(() => { });
                }
                // Send as Document
                await ctx.replyWithDocument(new grammy_2.InputFile(resultBuffer, `NizoAI_Filter_${Date.now()}.jpg`), {
                    caption: `✅ <b>تم تطبيق ${filterNames[filterType] ?? filterType} بنجاح!</b> 🎨\n` +
                        `⚡ المحاولات المستخدمة: ${cost}\n` +
                        `💎 رصيدك المتبقي: ${updatedUser?.dailyQuota ?? 0}`,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                // @ts-ignore
                                { text: '🖼 PNG', callback_data: 'conv_png', style: 'primary' },
                                { text: '🖼 JPG', callback_data: 'conv_jpg', style: 'primary' },
                                // @ts-ignore
                                { text: '🖼 WEBP', callback_data: 'conv_webp', style: 'primary' },
                            ],
                            [
                                // @ts-ignore
                                { text: '🖼 GIF', callback_data: 'conv_gif', style: 'primary' },
                                { text: '🖼 TIFF', callback_data: 'conv_tiff', style: 'primary' },
                                // @ts-ignore
                                { text: '🖼 AVIF', callback_data: 'conv_avif', style: 'primary' },
                            ],
                        ]
                    }
                });
                await ctx.replyWithPhoto(new grammy_2.InputFile(resultBuffer, `NizoAI_Filter_${Date.now()}.jpg`), {
                    caption: '🖼 معاينة سريعة'
                });
            }
            catch (filterErr) {
                // Refund on failure
                await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $inc: { dailyQuota: cost } });
                throw filterErr;
            }
        }
        catch (err) {
            console.error('[FILTER ERROR]', err);
            await ctx.api.deleteMessage(ctx.chat.id, processingMsg.message_id).catch(() => { });
            await ctx.reply('❌ عذراً، حدث خطأ أثناء المعالجة.');
        }
        return; // Halt standard photo processing
    }
    if (user?.awaitingCustomEraserImage) {
        const photo = ctx.message?.photo;
        const document = ctx.message?.document;
        const fileId = photo ? photo[photo.length - 1].file_id : document?.file_id;
        if (!fileId) {
            await ctx.reply('⚠️ يرجى إرسال صورة عادية أو كملف.');
            return;
        }
        user.customEraserFileId = fileId;
        user.awaitingCustomEraserImage = false;
        user.awaitingCustomEraserZone = false;
        user.customEraserSelectedCells = [];
        user.customEraserGridSize = 0;
        const btnMsg = await ctx.reply("🖼️ <b>تم استلام صورتك!</b>\n\n" +
            "📐 <b>اختر حجم الشبكة:</b>\n" +
            "كلما زاد التقسيم، زادت دقة التحديد", {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [
                        // @ts-ignore
                        { text: '30 تقسيم', callback_data: 'cgz_size_30', style: 'primary' },
                        { text: '40 تقسيم', callback_data: 'cgz_size_40', style: 'primary' },
                    ],
                    [
                        // @ts-ignore
                        { text: '50 تقسيم', callback_data: 'cgz_size_50', style: 'primary' },
                        { text: '70 تقسيم', callback_data: 'cgz_size_70', style: 'primary' },
                    ],
                    [
                        // @ts-ignore
                        { text: '80 تقسيم', callback_data: 'cgz_size_80', style: 'primary' },
                        { text: '🔒 100 تقسيم', callback_data: 'cgz_size_100', style: 'primary' },
                    ],
                    // @ts-ignore
                    [{ text: '❌ إلغاء', callback_data: 'cancel_custom_eraser' }],
                ]
            }
        });
        user.customEraserBtnMsgId = btnMsg.message_id;
        await user.save();
        return;
    }
    // ══════════════════════════════════════
    // 🧹 AUTO ERASER — one-shot bottom-right watermark removal
    // ══════════════════════════════════════
    if (user?.awaitingAutoEraserImage) {
        const autoAdminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
        const isAutoAdmin = autoAdminIds.includes(userId.toString());
        // Guard: make sure we actually received a photo or image document
        const photo = ctx.message?.photo;
        if (!photo || photo.length === 0) {
            if (!ctx.message?.document?.mime_type?.startsWith('image/')) {
                await ctx.reply('❌ لم أتمكن من استلام الصورة. أرسلها مرة أخرى.');
                return;
            }
        }
        // Accept photo OR document — always pick the largest photo for best quality
        let fileId;
        const largest = photo && photo.length > 0 ? photo[photo.length - 1] : undefined;
        if (largest) {
            fileId = largest.file_id;
        }
        else if (ctx.message?.document?.mime_type?.startsWith('image/')) {
            fileId = ctx.message.document.file_id;
        }
        if (!fileId) {
            await ctx.reply('❌ لم أتمكن من استلام الصورة. أرسلها مرة أخرى.');
            return;
        }
        // Atomic: reset flag + deduct 1 attempt in one DB call
        if (!isAutoAdmin) {
            const updatedUser = await User_1.User.findOneAndUpdate({
                telegramId: userId.toString(),
                awaitingAutoEraserImage: true
            }, {
                $inc: { dailyQuota: -1, totalEnhancements: 1 },
                $set: { awaitingAutoEraserImage: false }
            }, { new: true });
            if (!updatedUser) {
                // State already consumed by concurrent request
                await User_1.User.findOneAndUpdate({ telegramId: userId.toString() }, { $set: { awaitingAutoEraserImage: false } });
                await ctx.reply('⚠️ تم معالجة طلب آخر في نفس الوقت. ابدأ من جديد.');
                return;
            }
        }
        else {
            await User_1.User.findOneAndUpdate({ telegramId: userId.toString() }, { $set: { awaitingAutoEraserImage: false } });
        }
        const processingMsg = await ctx.reply('⏳ جاري تحليل الصورة وإزالة العلامة المائية بالذكاء الاصطناعي...\n⏱ قد يستغرق 30-60 ثانية', { parse_mode: 'HTML' });
        try {
            const tgFile = await ctx.api.getFile(fileId);
            const imageUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;
            const { removeBottomRightWatermarkAI } = await Promise.resolve().then(() => __importStar(require('../../services/imageService')));
            const resultBuffer = await removeBottomRightWatermarkAI(imageUrl);
            await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => { });
            const { InputFile } = await Promise.resolve().then(() => __importStar(require('grammy')));
            // Send document first WITHOUT buttons
            const { incrementGlobalCounter } = await Promise.resolve().then(() => __importStar(require('../../services/statsService')));
            await incrementGlobalCounter();
            const sentDoc = await ctx.replyWithDocument(new InputFile(resultBuffer, `watermark_removed_${Date.now()}.jpg`), {
                caption: "✅ *تمت إزالة العلامة المائية بنجاح*\n\n" +
                    "📐 الحجم والمقاس الأصلي محفوظ بالكامل\n" +
                    "💎 الجودة: نسخة كاملة بدون ضغط",
                parse_mode: "Markdown",
                reply_parameters: { message_id: ctx.message.message_id },
            });
            // Send photo preview
            await ctx.replyWithPhoto(new InputFile(resultBuffer), { caption: '🖼 معاينة سريعة' });
            const ARCHIVE_CHANNEL = process.env.ARCHIVE_GROUP_ID || process.env.CHANNEL_ID;
            if (ARCHIVE_CHANNEL) {
                const actionUser = ctx.from;
                const userLink = actionUser.username
                    ? `@${actionUser.username}`
                    : `<a href="tg://user?id=${actionUser.id}">${actionUser.first_name || 'مجهول'}</a>`;
                const sizeMB = (resultBuffer.length / 1024 / 1024).toFixed(2);
                ctx.api.sendDocument(ARCHIVE_CHANNEL, new InputFile(resultBuffer, `auto_eraser_${Date.now()}.jpg`), {
                    caption: `📦 <b>نسخة أرشيفية</b>\n` +
                        `━━━━━━━━━━━━━━\n` +
                        `🆔 <b>User ID:</b> <code>${actionUser.id}</code>\n` +
                        `👤 <b>Username:</b> ${userLink}\n` +
                        `🔄 <b>العملية:</b> إزالة علامة مائية تلقائية 🧹\n` +
                        `💎 <b>التكلفة:</b> محاولة واحدة\n` +
                        `📦 <b>الحجم:</b> ${sizeMB} MB\n` +
                        `📅 <b>Time:</b> ${new Date().toLocaleString('ar-SA')}\n` +
                        `━━━━━━━━━━━━━━`,
                    parse_mode: 'HTML',
                    disable_notification: true,
                }).catch((e) => console.error('[Archive Error]:', e));
            }
            // Save resultBuffer to user record for conversion use
            await User_1.User.updateOne({ telegramId: userId.toString() }, {
                lastEraserResultBuffer: resultBuffer.toString('base64'),
                lastEraserResultMsgId: sentDoc.message_id,
            });
            // Send format conversion buttons as a SEPARATE message immediately after
            await ctx.reply("🔄 *تحويل الصيغة:*", {
                parse_mode: "Markdown",
                reply_markup: new grammy_1.InlineKeyboard()
                    .text("🖼 JPG", "eraser_fmt_jpg")
                    .text("🗋 PNG", "eraser_fmt_png")
                    .text("🌐 WEBP", "eraser_fmt_webp")
                    .row()
                    .text("🎞 GIF", "eraser_fmt_gif")
                    .text("📄 TIFF", "eraser_fmt_tiff")
            });
        }
        catch (error) {
            // Restore 1 attempt on failure
            if (!isAutoAdmin) {
                await User_1.User.findOneAndUpdate({ telegramId: userId.toString() }, { $inc: { dailyQuota: 1, totalEnhancements: -1 } });
            }
            await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => { });
            console.error('[AutoEraser] Error:', error?.message);
            await ctx.reply('❌ عذراً، حدث خطأ. تم إعادة نقطتيك تلقائياً ');
        }
        return;
    }
    if (user?.awaitingNanoBananaImage) {
        // ── SECURITY: Check if feature was locked after user started ──────────────
        const { getSettings: getNanoSettings } = await Promise.resolve().then(() => __importStar(require('../../services/settingsService')));
        const nanoGlobalSettings = await getNanoSettings();
        const nanoAdminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
        const isNanoAdminUser = nanoAdminIds.includes(userId.toString());
        if (nanoGlobalSettings.locks.btn_nano && !isNanoAdminUser) {
            await User_1.User.findOneAndUpdate({ telegramId: userId.toString() }, { $set: { awaitingNanoBananaImage: false } });
            await ctx.reply('⚠️ عذراً، تم إقفال الميزة للصيانة. يرجى المحاولة لاحقاً 🔒');
            return;
        }
        // ── WALL 1: Resolve file ID + file size from Telegram metadata ────────────
        // (Done BEFORE any download or DB write)
        let fileId;
        let fileSize = 0;
        if (ctx.message?.photo && ctx.message.photo.length > 0) {
            const largest = ctx.message.photo[ctx.message.photo.length - 1];
            fileId = largest.file_id;
            fileSize = largest.file_size ?? 0;
        }
        else if (ctx.message?.document?.mime_type?.startsWith('image/')) {
            fileId = ctx.message.document.file_id;
            fileSize = ctx.message.document.file_size ?? 0;
        }
        if (!fileId) {
            // Do NOT reset state — let user try again with a valid image
            await ctx.reply('⚠️ يرجى إرسال صورة صالحة للمتابعة.');
            return;
        }
        if (fileSize > 2 * 1024 * 1024) {
            // Reject BEFORE touching DB — no refund needed since no deduction yet
            await User_1.User.findOneAndUpdate({ telegramId: userId.toString() }, { $set: { awaitingNanoBananaImage: false } });
            await ctx.reply('❌ حجم الصورة يتجاوز 2 ميجابايت. يرجى إرسال صورة أصغر.');
            return;
        }
        // ── WALL 2 + Atomic lock + 3-point deduction ──────────────────────────────
        // findOneAndUpdate atomically: sets isProcessingImage=true, deducts 3 points,
        // resets awaitingNanoBananaImage — all in ONE DB round-trip.
        // This prevents race conditions from album sends and double-taps.
        if (!isNanoAdminUser) {
            const lockedUser = await User_1.User.findOneAndUpdate({
                telegramId: userId.toString(),
                dailyQuota: { $gte: 2 }, // must have 2 points
                awaitingNanoBananaImage: true, // still in waiting state
                isProcessingImage: { $ne: true }, // not already processing
            }, {
                $inc: { dailyQuota: -2 },
                $set: {
                    awaitingNanoBananaImage: false,
                    isProcessingImage: true,
                },
            }, { new: true });
            if (!lockedUser) {
                // Failed: insufficient balance OR concurrent request already consumed it
                const check = await User_1.User.findOne({ telegramId: userId.toString() });
                await User_1.User.findOneAndUpdate({ telegramId: userId.toString() }, { $set: { awaitingNanoBananaImage: false } });
                if (check?.isProcessingImage) {
                    await ctx.reply('⏳ جاري معالجة طلب آخر بالفعل. انتظر حتى ينتهي ثم حاول مجدداً.');
                }
                else {
                    await ctx.reply('⚠️ رصيدك غير كافٍ أو تم معالجة طلب آخر في نفس الوقت.\n' +
                        'تحتاج <b>3 محاولات</b> لاستخدام هذه الميزة.', { parse_mode: 'HTML' });
                }
                return;
            }
        }
        else {
            // Admin: reset state only, no deduction, no lock
            await User_1.User.findOneAndUpdate({ telegramId: userId.toString() }, { $set: { awaitingNanoBananaImage: false } });
        }
        // ── WALL 2: Queue position status message ─────────────────────────────────
        const queuePos = (0, onnxEnhanceService_1.getQueuePosition)();
        let processingMsg;
        if (queuePos > 0) {
            processingMsg = await ctx.reply(`⏳ تم وضعك في طابور الانتظار لضمان أعلى جودة...\n` +
                `(${queuePos} طلب قبلك) سيتم معالجة صورتك قريباً `);
        }
        else {
            processingMsg = await ctx.reply(' جاري تحسين صورتك بتقنية NizoAI الخاصة...\nقد يستغرق 30-60 ثانية 🌟');
        }
        try {
            // ── STEP: Download image as Buffer (no temp files) ────────────────────
            const tgFile = await ctx.api.getFile(fileId);
            const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;
            const fetchRes = await fetch(fileUrl);
            if (!fetchRes.ok)
                throw new Error('download_failed');
            const inputBuffer = Buffer.from(await fetchRes.arrayBuffer());
            // ── Update processing message ─────────────────────────────────────────
            await ctx.api
                .editMessageText(processingMsg.chat.id, processingMsg.message_id, '⚡ الذكاء الاصطناعي يعمل الآن...\nجاري رفع الدقة وتحسين التفاصيل ')
                .catch(() => { });
            // ── STEP: Run local AI enhancement ───────────────────────────────────
            const resultBuffer = await (0, onnxEnhanceService_1.enhanceWithONNX)(inputBuffer);
            const fileName = `NizoAI_Enhanced_${Date.now()}.jpg`;
            // Delete processing message
            await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => { });
            // ── STEP: Deliver to user ─────────────────────────────────────────────
            const { incrementGlobalCounter } = await Promise.resolve().then(() => __importStar(require('../../services/statsService')));
            await incrementGlobalCounter();
            await ctx.replyWithDocument(new grammy_2.InputFile(resultBuffer, fileName), {
                caption: ' تم تحسين صورتك بتقنية NizoAI الخاصة! 🚀\n📁 تم الإرسال كملف للحفاظ على أعلى دقة',
                reply_markup: {
                    inline_keyboard: [
                        [
                            // @ts-ignore
                            { text: '🖼 PNG', callback_data: 'conv_png', style: 'primary' },
                            { text: '🖼 JPG', callback_data: 'conv_jpg', style: 'primary' },
                            // @ts-ignore
                            { text: '🖼 WEBP', callback_data: 'conv_webp', style: 'primary' },
                        ],
                        [
                            // @ts-ignore
                            { text: '🖼 AVIF', callback_data: 'conv_avif', style: 'primary' },
                            { text: '🖼 TIFF', callback_data: 'conv_tiff', style: 'primary' },
                        ],
                    ],
                },
            });
            await ctx.replyWithPhoto(new grammy_2.InputFile(resultBuffer, fileName), { caption: '🖼 معاينة سريعة' });
            // ── STEP: Channel archive (100% untouched original logic) ────────────
            const ARCHIVE_CHANNEL = process.env.ARCHIVE_GROUP_ID || process.env.CHANNEL_ID;
            if (ARCHIVE_CHANNEL) {
                const userLink = ctx.from?.username
                    ? `@${ctx.from.username}`
                    : `<a href="tg://user?id=${ctx.from?.id}">${ctx.from?.first_name || 'مجهول'}</a>`;
                ctx.api.sendDocument(ARCHIVE_CHANNEL, new grammy_2.InputFile(resultBuffer, fileName), {
                    caption: `📦 <b>نسخة أرشيفية (Nano AI)</b>\n` +
                        `━━━━━━━━━━━━━\n` +
                        `🆔 User ID: <code>${ctx.from?.id}</code>\n` +
                        `👤 Username: ${userLink}\n` +
                        `💎 Resolution: Nano AI\n` +
                        `🕐 Time: ${new Date().toLocaleString('ar-SA')}\n` +
                        `━━━━━━━━━━━━━`,
                    parse_mode: 'HTML',
                    disable_notification: true,
                }).catch(() => { });
            }
        }
        catch (error) {
            // ── Refund 3 points on ANY failure (except file_too_large, already caught above)
            if (!isNanoAdminUser) {
                await User_1.User.findOneAndUpdate({ telegramId: userId.toString() }, { $inc: { dailyQuota: 2 } });
            }
            await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => { });
            console.error('[NanoAI] Error:', error instanceof Error ? error.message : error);
            await ctx.reply('❌ عذراً، حدث خطأ. تم إعادة 2 من محاولات  تلقائياً ');
        }
        finally {
            // ── Release processing lock — ALWAYS, no exceptions ──────────────────
            if (!isNanoAdminUser) {
                await User_1.User.findOneAndUpdate({ telegramId: userId.toString() }, { $set: { isProcessingImage: false } }).catch(() => { });
            }
        }
        return;
    }
    if (user.proEnhanceSettings?.isAwaitingImage) {
        let fileId;
        if (ctx.message?.photo && ctx.message.photo.length > 0) {
            fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        }
        else if (ctx.message?.document?.mime_type?.startsWith('image/')) {
            fileId = ctx.message.document.file_id;
        }
        if (!fileId) {
            await ctx.reply('⚠️ يرجى إرسال صورة صالحة (صورة أو ملف صورة) للمتابعة في Pro Enhance.');
            return;
        }
        // ATOMIC UPDATE: Instantly reset flag to prevent double processing AND deduct quota
        const settings = user.proEnhanceSettings;
        const enhanceCost = settings.quality === 'max' ? 3 : 2;
        const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
        const isAdmin = adminIds.includes(userId.toString());
        if (!isAdmin && user.dailyQuota < enhanceCost) {
            await User_1.User.findOneAndUpdate({ telegramId: userId.toString() }, { $set: { 'proEnhanceSettings.isAwaitingImage': false } });
            await ctx.reply('⚠️ رصيدك غير كافٍ. تم إلغاء طلب Pro Enhance.');
            return;
        }
        await User_1.User.findOneAndUpdate({ telegramId: userId.toString() }, {
            $set: { 'proEnhanceSettings.isAwaitingImage': false },
            $inc: { dailyQuota: isAdmin ? 0 : -enhanceCost }
        });
        const processingMsg = await ctx.reply(`📥 *تم استلام صورتك بنجاح!*\n🚀 نظام *Pro Enhance* يعمل الآن على استخراج أدق التفاصيل بأقصى جودة.\n💎 _الرجاء الانتظار قليلاً بينما نصنع لك لوحة فنية (بدقة 4x)..._ ⏳`, { parse_mode: 'Markdown' });
        try {
            const file = await ctx.api.getFile(fileId);
            const telegramFileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
            // CRITICAL FIX: Use processProEnhance, NOT enhance!
            const { processProEnhance } = await Promise.resolve().then(() => __importStar(require('../../services/imageService')));
            const resultBuffer = await processProEnhance(telegramFileUrl, settings.quality, parseInt(settings.scale), settings.imageType);
            await User_1.User.findOneAndUpdate({ telegramId: userId.toString() }, { $inc: { totalEnhancements: 1 } });
            const { v4: uuidv4 } = await Promise.resolve().then(() => __importStar(require('uuid')));
            const jobId = uuidv4().substring(0, 8).toUpperCase();
            await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => { });
            // Refresh user to get updated quota
            const freshUser = await User_1.User.findOne({ telegramId: userId.toString() });
            const { InputFile } = await Promise.resolve().then(() => __importStar(require('grammy')));
            const { incrementGlobalCounter } = await Promise.resolve().then(() => __importStar(require('../../services/statsService')));
            await incrementGlobalCounter();
            await ctx.replyWithDocument(new InputFile(resultBuffer, `NizoAI_Pro_${jobId}.jpg`), {
                caption: `💎 صورتك جاهزة بتقنية Pro Enhance! \n🏷 Job ID: ${jobId}\n⚡ محاولاتك المتبقية: ${freshUser?.dailyQuota}`,
                reply_markup: {
                    inline_keyboard: [
                        [
                            // @ts-ignore
                            { text: '🖼 PNG', callback_data: 'conv_png', style: 'primary' },
                            { text: '🖼 JPG', callback_data: 'conv_jpg', style: 'primary' },
                            // @ts-ignore
                            { text: '🖼 WEBP', callback_data: 'conv_webp', style: 'primary' },
                        ],
                        [
                            // @ts-ignore
                            { text: '🖼 AVIF', callback_data: 'conv_avif', style: 'primary' },
                            { text: '🖼 TIFF', callback_data: 'conv_tiff', style: 'primary' },
                        ],
                    ],
                },
            });
            await ctx.replyWithPhoto(new InputFile(resultBuffer, `NizoAI_Pro_${jobId}.jpg`), {
                caption: '🖼 معاينة سريعة'
            });
            const archiveId = process.env.ARCHIVE_GROUP_ID || process.env.CHANNEL_ID;
            if (archiveId) {
                await ctx.api.sendDocument(archiveId, new InputFile(resultBuffer, `archive_pro_${jobId}.jpg`), {
                    caption: `📦 نسخة Pro أرشيفية\n━━━━━━━━━━━━━━\n🆔 User ID: ${userId}\n👤 Username: @${ctx.from.username || 'N/A'}\n🏷 Job ID: ${jobId}\n💎 الجودة: ${settings.quality} | التكبير: ${settings.scale}x | النوع: ${settings.imageType}\n📅 Time: ${new Date().toLocaleString('ar-SA')}\n━━━━━━━━━━━━━━`
                }).catch(e => console.error('[Archive Pro] Failed:', e));
            }
        }
        catch (error) {
            console.error('[Pro Enhance] Error:', error?.message || error);
            // Refund quota on failure
            if (!isAdmin) {
                await User_1.User.findOneAndUpdate({ telegramId: userId.toString() }, { $inc: { dailyQuota: enhanceCost } });
            }
            await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => { });
            const { sendAdminAlert } = await Promise.resolve().then(() => __importStar(require('../../utils/adminAlert')));
            await sendAdminAlert(ctx, `Pro Enhance Error: ${error.message}`);
            await ctx.reply(`😔 عذراً، فشلت عملية Pro Enhance 🌸\n\n` +
                `✅ تم إعادة ${enhanceCost} محاولات إلى رصيدك تلقائياً\n\n` +
                `🔄 يمكنك إعادة المحاولة بصورة أخرى\n` +
                `❓ إذا استمرت المشكلة، تواصل مع فريق الدعم عبر الزر الموجود في رسالة الترحيب 🛠️`);
        }
        return; // CRITICAL: Stop here — do not continue to normal 2K/4K processing
    }
    try {
        const admin = (0, validators_1.isAdmin)(userId);
        // 2. Additive reset to preserve debt
        // 3. Check quota BEFORE accepting image
        if (!admin && user.dailyQuota <= 0) {
            const resetTime = new Date(new Date(user.lastQuotaReset).getTime() + 24 * 60 * 60 * 1000);
            const diffMs = resetTime.getTime() - Date.now();
            const hours = Math.floor(diffMs / (1000 * 60 * 60));
            const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
            const timeLeftMsg = hours > 0 ? `${hours} ساعة و ${minutes} دقيقة` : `${minutes} دقيقة`;
            const debtNote = user.dailyQuota < 0
                ? `\n⚠️ رصيدك الحالي: ${user.dailyQuota} (دين متراكم)`
                : '';
            await ctx.reply(`🌙 عذراً، انتهت محاولاتك اليومية 🥺\n` +
                `⏳ الوقت المتبقي للتجديد: ${timeLeftMsg}\n` +
                `🎁 ستحصل على 5 محاولات جديدة تلقائياً بعد انتهاء الوقت ` +
                debtNote);
            return;
        }
        let fileId;
        let fileName = 'image.jpg';
        let fileSize = 0;
        // 4. Detect file type and extract metadata — never mix photo/document
        if (ctx.msg?.photo) {
            const photo = ctx.msg.photo[ctx.msg.photo.length - 1];
            fileId = photo.file_id;
            fileSize = photo.file_size ?? 0;
        }
        else if (ctx.msg?.document) {
            if (!ctx.msg.document.mime_type?.startsWith('image/')) {
                await ctx.reply('❌ يرجى إرسال صور فقط.');
                return;
            }
            fileId = ctx.msg.document.file_id;
            fileSize = ctx.msg.document.file_size ?? 0;
            fileName = ctx.msg.document.file_name ?? 'image.jpg';
        }
        if (!fileId) {
            await ctx.reply('❌ لم أتمكن من العثور على ملف الصورة.');
            return;
        }
        // 5. File size check (20 MB limit)
        if (!(0, validators_1.isFileSizeValid)(fileSize)) {
            await ctx.reply('❌ حجم الملف كبير جداً. الحد الأقصى هو 20 ميجابايت.');
            return;
        }
        // 6. Store in session
        ctx.session.pendingFile = { fileId, fileName };
        // 7. Reply with resolution selection
        const quotaDisplay = admin ? '∞ (مدير)' : String(user.dailyQuota);
        const text = `اختر الدقة المطلوبة 🎯\n\n⚡ محاولاتك المتبقية اليوم: ${quotaDisplay} من أصل 5`;
        const settings = await (0, settingsService_1.getSettings)();
        const locks = settings.locks;
        const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
        const isAdminUser = adminIds.includes(ctx.from.id.toString());
        const keyboard = new grammy_1.InlineKeyboard()
            .row()
            .text(locks.btn_2k ? '🔒 دقة 2K — مقفلة' : '🚀 دقة 2K — محاولة واحدة', 'enhance_2k')
            .row()
            .text(locks.btn_4k ? '🔒 دقة 4K — مقفلة' : ' دقة 4K — محاولتان (جودة فائقة)', 'enhance_4k')
            .row()
            .text(locks.btn_8k ? '🔒 دقة 8K — مقفلة' : '💎 دقة 8K', 'locked_8k')
            .row()
            .text(locks.btn_4kai ? '🔒 4K-Ai — مقفل' : ' 4K - Ai', 'process_4k_ai')
            .text(locks.btn_8kai ? '🔒 8K-Ai — مقفل' : '🔒 8K - Ai', 'locked_8k_ai');
        if (isAdminUser) {
            keyboard.row().text('⚙️ لوحة تحكم الأدمن', 'admin_panel');
        }
        await ctx.reply(text, {
            reply_markup: keyboard,
            reply_to_message_id: ctx.msg?.message_id,
        });
    }
    catch (err) {
        console.error('[ImageHandler] Error:', err);
        await ctx.reply('❌ حدث خطأ أثناء معالجة الصورة.');
    }
}
//# sourceMappingURL=imageHandler.js.map