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
const uuid_1 = require("uuid");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const replicate_1 = __importDefault(require("replicate"));
const User_1 = require("../../database/models/User");
const admin_1 = require("../commands/admin");
const validators_1 = require("../../utils/validators");
const channelFundService_1 = require("../../services/channelFundService");
const imageService = __importStar(require("../../services/imageService"));
const ARCHIVE_GROUP_ID = process.env.ARCHIVE_GROUP_ID ?? '';
const CHANNEL_ID = process.env.CHANNEL_ID ?? '';
async function callbackHandler(ctx) {
    const data = ctx.callbackQuery?.data;
    if (!data || !ctx.from)
        return;
    // Route admin callbacks immediately
    if (data.startsWith('admin_'))
        return (0, admin_1.handleAdminCallback)(ctx);
    // ── claim_reward_{channelId} ─────────────────────────────────────────────────
    if (data.startsWith('claim_reward_')) {
        await ctx.answerCallbackQuery();
        const channelId = data.replace('claim_reward_', '');
        const userId = ctx.from.id;
        const result = await (0, channelFundService_1.claimChannelReward)(userId, channelId, ctx.api);
        if (result === 'REWARDED') {
            await ctx.reply('✅ تم التحقق! تم إضافة 5 محاولات لرصيدك 🎉\n' +
                'استمتع بتحسين صورك بجودة احترافية 🌟');
        }
        else if (result === 'ALREADY_CLAIMED') {
            await ctx.answerCallbackQuery({
                text: 'لقد حصلت على مكافأة هذه القناة من قبل ✅',
                show_alert: true,
            });
        }
        else if (result === 'PROCESSING') {
            await ctx.answerCallbackQuery({
                text: 'جاري المعالجة، انتظر لحظة... ⏳',
                show_alert: false,
            });
        }
        else if (result === 'NOT_MEMBER') {
            await ctx.answerCallbackQuery({
                text: 'عذراً! لم يتم التحقق من اشتراكك بعد ❌\nالرجاء الاشتراك في القناة أولاً عبر الرابط أدناه، ثم اضغط على زر التحقق للحصول على مكافأتك 🎁',
                show_alert: true,
            });
        }
        else if (result === 'ADMIN_BLOCKED') {
            await ctx.answerCallbackQuery({
                text: '🚫 المشرف لا يمكنه المطالبة بمكافأة حملته.',
                show_alert: true,
            });
        }
        else {
            await ctx.answerCallbackQuery({
                text: '❌ الحملة غير موجودة أو انتهت.',
                show_alert: true,
            });
        }
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
        });
        return;
    }
    // ── STEP 3: Reset quota if 24h have passed (Additive to preserve debt) ──────
    if (!user.lastQuotaReset ||
        Date.now() - new Date(user.lastQuotaReset).getTime() > 24 * 60 * 60 * 1000) {
        user.dailyQuota += 5;
        if (user.dailyQuota > 5)
            user.dailyQuota = 5;
        user.lastQuotaReset = new Date();
        await user.save();
    }
    // ── STEP 4: Admin flag ────────────────────────────────────────────────────────
    const admin = (0, validators_1.isAdmin)(ctx.from.id);
    // ── STEP 5: Locked 8K ─────────────────────────────────────────────────────────
    if (data === 'locked_8k') {
        void ctx.answerCallbackQuery({
            text: '🔒 هذه الميزة مقفلة حالياً 💫\nتواصل مع المطور لفتح ميزة الـ 8K ✨',
            show_alert: true,
        });
        return;
    }
    if (data === 'locked_4k') {
        void ctx.answerCallbackQuery({
            text: '🔒 هذه الميزة مقفلة حالياً 💫\nتواصل مع المطور لفتح الميزة ✨',
            show_alert: true,
        });
        return;
    }
    // ── Helper: get Telegram file URL from session ────────────────────────────────
    const pendingFile = ctx.session.pendingFile;
    const getTelegramFileUrl = async () => {
        if (!pendingFile?.fileId)
            return null;
        const tgFile = await ctx.api.getFile(pendingFile.fileId);
        if (!tgFile.file_path)
            return null;
        return `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;
    };
    // ── Helper: forward result to public channel ──────────────────────────────────
    const forwardToChannel = async (buf, fileName, resolution) => {
        if (!CHANNEL_ID)
            return;
        const displayName = ctx.from.username
            ? `@${ctx.from.username}`
            : ctx.from.first_name ?? 'مستخدم';
        try {
            await ctx.api.sendDocument(CHANNEL_ID, new grammy_1.InputFile(buf, fileName), {
                caption: `✨ تم تحسين صورة جديدة بواسطة: ${displayName} | NizoAI Bot\n` +
                    `💎 الدقة: ${resolution}`,
            });
        }
        catch (err) {
            console.error('[Channel] Forward failed (silent):', err);
        }
    };
    // ── STEP 6: enhance_2k ───────────────────────────────────────────────────────
    if (data === 'enhance_2k') {
        await ctx.answerCallbackQuery();
        if (!admin && user.dailyQuota < 1) {
            await ctx.reply('🌙 أوه! انتهت محاولاتك اليومية 🥺\nعد غداً وستجد 5 محاولات جديدة بانتظارك 🎁✨');
            return;
        }
        const telegramFileUrl = await getTelegramFileUrl();
        if (!telegramFileUrl) {
            await ctx.reply('❌ انتهت الجلسة. أرسل الصورة مجدداً.');
            return;
        }
        if (!admin) {
            user.dailyQuota -= 1;
            await user.save();
        }
        const jobId = (0, uuid_1.v4)().substring(0, 8).toUpperCase();
        await ctx.editMessageText('⏳ جاري تحسين صورتك بدقة 2K...\nالرجاء الانتظار لحظات 🌟');
        ctx.session.pendingFile = undefined;
        try {
            const resultBuffer = await imageService.enhance(telegramFileUrl, '2K');
            user.totalEnhancements += 1;
            await user.save();
            const outputFileName = `NizoAI_2K_${jobId}.jpg`;
            await ctx.replyWithDocument(new grammy_1.InputFile(resultBuffer, outputFileName), {
                caption: `🎉 صورتك جاهزة بدقة 2K! 🌟\n🏷 Job ID: ${jobId}\n⚡ محاولاتك المتبقية: ${user.dailyQuota}`,
            });
            await ctx.deleteMessage().catch(() => { });
            // Forward to channel (silent — never affects user)
            void forwardToChannel(resultBuffer, outputFileName, '2K');
            // Silent archive
            if (ARCHIVE_GROUP_ID) {
                ctx.api
                    .sendDocument(ARCHIVE_GROUP_ID, new grammy_1.InputFile(resultBuffer, `archive_${jobId}.jpg`), {
                    caption: `📦 نسخة أرشيفية\n` +
                        `━━━━━━━━━━━━━━\n` +
                        `🆔 User ID: ${ctx.from.id}\n` +
                        `👤 Username: @${ctx.from.username ?? 'N/A'}\n` +
                        `🏷 Job ID: ${jobId}\n` +
                        `💎 Resolution: 2K\n` +
                        `📅 Time: ${new Date().toLocaleString('ar-SA')}\n` +
                        `━━━━━━━━━━━━━━`,
                })
                    .catch((e) => console.error('[Archive] 2K failed:', e));
            }
        }
        catch {
            if (!admin) {
                user.dailyQuota += 1;
                await user.save();
            }
            await ctx.deleteMessage().catch(() => { });
            await ctx.reply('😔 عذراً حدث خطأ أثناء معالجة صورتك 🌸\nتم إعادة محاولتك تلقائياً ✨\nجرب مرة أخرى وسنكون معك 💙');
        }
        return;
    }
    // ── STEP 7: enhance_4k ───────────────────────────────────────────────────────
    if (data === 'enhance_4k') {
        await ctx.answerCallbackQuery();
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
        ctx.session.pendingFile = undefined;
        try {
            const resultBuffer = await imageService.enhance(telegramFileUrl, '4K');
            user.totalEnhancements += 1;
            await user.save();
            const outputFileName = `NizoAI_4K_${jobId}.jpg`;
            await ctx.replyWithDocument(new grammy_1.InputFile(resultBuffer, outputFileName), {
                caption: `💎 صورتك جاهزة بدقة 4K الفائقة! ✨\n🏷 Job ID: ${jobId}\n⚡ محاولاتك المتبقية: ${user.dailyQuota}`,
            });
            await ctx.deleteMessage().catch(() => { });
            // Forward to channel (silent — never affects user)
            void forwardToChannel(resultBuffer, outputFileName, '4K');
            // Silent archive
            if (ARCHIVE_GROUP_ID) {
                ctx.api
                    .sendDocument(ARCHIVE_GROUP_ID, new grammy_1.InputFile(resultBuffer, `archive_${jobId}.jpg`), {
                    caption: `📦 نسخة أرشيفية\n` +
                        `━━━━━━━━━━━━━━\n` +
                        `🆔 User ID: ${ctx.from.id}\n` +
                        `👤 Username: @${ctx.from.username ?? 'N/A'}\n` +
                        `🏷 Job ID: ${jobId}\n` +
                        `💎 Resolution: 4K\n` +
                        `📅 Time: ${new Date().toLocaleString('ar-SA')}\n` +
                        `━━━━━━━━━━━━━━`,
                })
                    .catch((e) => console.error('[Archive] 4K failed:', e));
            }
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
        });
        return;
    }
    if (data === 'process_4k_ai') {
        const userId = ctx.from.id;
        // STEP 1 — ATOMIC LOCK + BALANCE CHECK + DEDUCTION
        const atomicUser = await User_1.User.findOneAndUpdate({
            telegramId: userId,
            isProcessingImage: { $ne: true },
            dailyQuota: { $gte: 2 }
        }, {
            $set: { isProcessingImage: true },
            $inc: { dailyQuota: -2 }
        }, { new: true });
        if (!atomicUser) {
            const check = await User_1.User.findOne({ telegramId: userId });
            if (check?.isProcessingImage === true) {
                await ctx.answerCallbackQuery({
                    text: "⏳ جاري معالجة صورة بالفعل، انتظر حتى تنتهي",
                    show_alert: true
                });
                return;
            }
            else {
                await ctx.answerCallbackQuery({
                    text: "❌ رصيدك غير كافٍ. هذا التحسين يتطلب نقطتين",
                    show_alert: true
                });
                return;
            }
        }
        await ctx.answerCallbackQuery();
        let tempPath = '';
        try {
            // STEP 2 — PROCESSING MESSAGE
            await ctx.editMessageText("⏳ جاري المعالجة بتقنية الذكاء الاصطناعي المتقدمة...");
            // STEP 3 — DOWNLOAD ORIGINAL IMAGE
            const pendingFile = ctx.session.pendingFile;
            if (!pendingFile?.fileId)
                throw new Error('download_failed');
            const tgFile = await ctx.api.getFile(pendingFile.fileId);
            if (!tgFile.file_path)
                throw new Error('download_failed');
            const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;
            tempPath = path_1.default.join(os_1.default.tmpdir(), `${userId}_${Date.now()}.jpg`);
            const fetchResponse = await fetch(fileUrl);
            if (!fetchResponse.ok)
                throw new Error('download_failed');
            const buffer = Buffer.from(await fetchResponse.arrayBuffer());
            fs_1.default.writeFileSync(tempPath, buffer);
            const base64string = buffer.toString('base64');
            const dataUrl = `data:image/jpeg;base64,${base64string}`;
            // STEP 4 — CALL REPLICATE API
            const replicate = new replicate_1.default({
                auth: process.env.REPLICATE_API_TOKEN,
            });
            const modelId = process.env.REPLICATE_AI_MODEL_ID;
            if (!modelId)
                throw new Error('api_failed');
            const input = {
                image: dataUrl,
                prompt: "Enhance product realism while preserving all original features, shape, branding, labels, and design details, maintain natural surface texture and fine material details, improve lighting balance and tone, refine color depth without over-smoothing, visible micro-textures, material grain, small natural imperfections, fine surface details, subtle light reflections and realistic highlights, natural gloss or matte finish according to the product material, tiny edge details, sharp contours, realistic shadows, stray fine fibers or dust particles where appropriate, subsurface light interaction for translucent materials, light glow through edges where natural, organic texture, ultra-realistic photo-quality finish.",
                negative_prompt: "watermark, logo, text, signature, blurry, low quality, deformed, ugly, distorted",
                prompt_strength: 0.65,
                num_inference_steps: 30,
                guidance_scale: 7.5
            };
            const output = await Promise.race([
                replicate.run(process.env.REPLICATE_AI_MODEL_ID, { input }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('api_failed')), 120000))
            ]);
            let outUrl = '';
            if (Array.isArray(output))
                outUrl = output[0];
            else if (typeof output === 'string')
                outUrl = output;
            else if (output && typeof output === 'object') {
                if (typeof output.url === 'function')
                    outUrl = output.url();
                else if (typeof output.url === 'string')
                    outUrl = output.url;
            }
            if (!outUrl || typeof outUrl !== 'string')
                throw new Error('api_failed');
            const outRes = await fetch(outUrl);
            if (!outRes.ok)
                throw new Error('api_failed');
            const outBuffer = Buffer.from(await outRes.arrayBuffer());
            // STEP 5 — DELIVER RESULT
            await ctx.replyWithDocument(new grammy_1.InputFile(outBuffer, `NizoAI_4K_Ai_${Date.now()}.jpg`), {
                caption: "✨ تم التحسين بتقنية الذكاء الاصطناعي | NizoAI Bot"
            });
            if (process.env.CHANNEL_ID) {
                const username = ctx.from?.username ? `@${ctx.from.username}` : ctx.from?.first_name;
                ctx.api.sendDocument(process.env.CHANNEL_ID, new grammy_1.InputFile(outBuffer, `NizoAI_4K_Ai_${Date.now()}.jpg`), {
                    caption: `✨ صورة محسّنة بـ 4K-Ai | ${username}`
                }).catch(err => console.error(err));
            }
        }
        catch (error) {
            // STEP 6 — ERROR HANDLER
            console.error('[4K-Ai] Replicate error details:', {
                message: error instanceof Error ? error.message : String(error),
                model: process.env.REPLICATE_AI_MODEL_ID,
                timestamp: new Date().toISOString()
            });
            await User_1.User.findOneAndUpdate({ telegramId: userId }, { $inc: { dailyQuota: 2 } });
            if (error.message === 'download_failed') {
                await ctx.editMessageText("❌ فشل تحميل الصورة. تم إرجاع نقطتيك");
            }
            else {
                await ctx.editMessageText("❌ حدث خطأ في المعالجة. تم إرجاع نقطتيك");
            }
        }
        finally {
            // STEP 7 — FINALLY BLOCK
            if (tempPath && fs_1.default.existsSync(tempPath)) {
                try {
                    fs_1.default.unlinkSync(tempPath);
                }
                catch { }
            }
            await User_1.User.findOneAndUpdate({ telegramId: userId }, { $set: { isProcessingImage: false } });
        }
        return;
    }
    // ── enhance_again ─────────────────────────────────────────────────────────────
    if (data === 'enhance_again') {
        await ctx.answerCallbackQuery();
        await ctx.editMessageText('📸 أرسل الصورة الجديدة التي تريد تحسينها.');
        return;
    }
}
//# sourceMappingURL=callbackHandler.js.map