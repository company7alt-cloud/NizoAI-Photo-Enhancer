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
exports.callbackHandler = callbackHandler;
// src/bot/handlers/callbackHandler.ts
const grammy_1 = require("grammy");
const uuid_1 = require("uuid");
const User_1 = require("../../database/models/User");
const admin_1 = require("../commands/admin");
const imageService = __importStar(require("../../services/imageService"));
const ADMIN_ID = 6179646374;
const ARCHIVE_GROUP_ID = process.env.ARCHIVE_GROUP_ID;
async function callbackHandler(ctx) {
    const data = ctx.callbackQuery?.data;
    if (!data || !ctx.from)
        return;
    // Route admin callbacks immediately
    if (data.startsWith('admin_'))
        return (0, admin_1.handleAdminCallback)(ctx);
    // ── STEP 1: Fetch FRESH user from DB ────────────────────────────────────────
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
    // ── STEP 2: Ban check ────────────────────────────────────────────────────────
    if (user.isBanned) {
        void ctx.answerCallbackQuery({
            text: '🚫 عذراً، تم تقييد وصولك للبوت. للاستفسار تواصل مع المطور 💙',
            show_alert: true,
        });
        return;
    }
    // ── STEP 3: Reset quota if 24h have passed ───────────────────────────────────
    if (!user.lastQuotaReset ||
        Date.now() - new Date(user.lastQuotaReset).getTime() > 24 * 60 * 60 * 1000) {
        user.dailyQuota = 5;
        user.lastQuotaReset = new Date();
        await user.save();
    }
    // ── STEP 4: Admin flag ───────────────────────────────────────────────────────
    const isAdmin = ctx.from.id === ADMIN_ID;
    // ── STEP 5: Locked 8K ────────────────────────────────────────────────────────
    if (data === 'locked_8k') {
        void ctx.answerCallbackQuery({
            text: '🔒 هذه الميزة مقفلة حالياً 💫\nتواصل مع المطور لفتح ميزة الـ 8K ✨',
            show_alert: true,
        });
        return;
    }
    // ── STEP 5b: Locked 4K (legacy) ─────────────────────────────────────────────
    if (data === 'locked_4k') {
        void ctx.answerCallbackQuery({
            text: '🔒 هذه الميزة مقفلة حالياً 💫\nتواصل مع المطور لفتح الميزة ✨',
            show_alert: true,
        });
        return;
    }
    // ── Helper: get Telegram file URL from session ───────────────────────────────
    const pendingFile = ctx.session.pendingFile;
    const getTelegramFileUrl = async () => {
        if (!pendingFile?.fileId)
            return null;
        const tgFile = await ctx.api.getFile(pendingFile.fileId);
        if (!tgFile.file_path)
            return null;
        return `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;
    };
    // ── STEP 6: enhance_2k ──────────────────────────────────────────────────────
    if (data === 'enhance_2k') {
        // Anti-double-click: answer immediately
        await ctx.answerCallbackQuery();
        if (!isAdmin && user.dailyQuota < 1) {
            await ctx.reply('🌙 أوه! انتهت محاولاتك اليومية 🥺\nعد غداً وستجد 5 محاولات جديدة بانتظارك 🎁✨');
            return;
        }
        const telegramFileUrl = await getTelegramFileUrl();
        if (!telegramFileUrl) {
            await ctx.reply('❌ انتهت الجلسة. أرسل الصورة مجدداً.');
            return;
        }
        // Deduct IMMEDIATELY before API call
        if (!isAdmin) {
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
            await ctx.replyWithDocument(new grammy_1.InputFile(resultBuffer, `NizoAI_2K_${jobId}.jpg`), {
                caption: `🎉 صورتك جاهزة بدقة 2K! 🌟\n🏷 Job ID: ${jobId}\n⚡ محاولاتك المتبقية: ${user.dailyQuota}`,
            });
            await ctx.deleteMessage().catch(() => { });
            // Silent archive — NEVER affects user experience
            try {
                await ctx.api.sendDocument(ARCHIVE_GROUP_ID, new grammy_1.InputFile(resultBuffer, `archive_${jobId}.jpg`), {
                    caption: `📦 نسخة أرشيفية\n` +
                        `━━━━━━━━━━━━━━\n` +
                        `🆔 User ID: ${ctx.from.id}\n` +
                        `👤 Username: @${ctx.from.username || 'N/A'}\n` +
                        `🏷 Job ID: ${jobId}\n` +
                        `💎 Resolution: 2K\n` +
                        `📅 Time: ${new Date().toLocaleString('ar-SA')}\n` +
                        `━━━━━━━━━━━━━━`,
                });
            }
            catch (archiveErr) {
                console.error('[Archive] 2K archive failed:', archiveErr);
            }
        }
        catch (error) {
            if (!isAdmin) {
                user.dailyQuota += 1; // REFUND
                await user.save();
            }
            await ctx.deleteMessage().catch(() => { });
            await ctx.reply('😔 عذراً حدث خطأ أثناء معالجة صورتك 🌸\nتم إعادة محاولتك تلقائياً ✨\nجرب مرة أخرى وسنكون معك 💙');
        }
        return;
    }
    // ── STEP 7: enhance_4k ──────────────────────────────────────────────────────
    if (data === 'enhance_4k') {
        // Anti-double-click: answer immediately
        await ctx.answerCallbackQuery();
        if (!isAdmin && user.dailyQuota < 2) {
            await ctx.reply(`💫 تحتاج محاولتين لدقة 4K الفائقة 🌟\nرصيدك الحالي: ${user.dailyQuota} محاولة 🥺\nاستخدم دقة 2K أو عد غداً لـ 5 محاولات جديدة 🎁`);
            return;
        }
        const telegramFileUrl = await getTelegramFileUrl();
        if (!telegramFileUrl) {
            await ctx.reply('❌ انتهت الجلسة. أرسل الصورة مجدداً.');
            return;
        }
        // Deduct IMMEDIATELY before API call
        if (!isAdmin) {
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
            await ctx.replyWithDocument(new grammy_1.InputFile(resultBuffer, `NizoAI_4K_${jobId}.jpg`), {
                caption: `💎 صورتك جاهزة بدقة 4K الفائقة! ✨\n🏷 Job ID: ${jobId}\n⚡ محاولاتك المتبقية: ${user.dailyQuota}`,
            });
            await ctx.deleteMessage().catch(() => { });
            // Silent archive — NEVER affects user experience
            try {
                await ctx.api.sendDocument(ARCHIVE_GROUP_ID, new grammy_1.InputFile(resultBuffer, `archive_${jobId}.jpg`), {
                    caption: `📦 نسخة أرشيفية\n` +
                        `━━━━━━━━━━━━━━\n` +
                        `🆔 User ID: ${ctx.from.id}\n` +
                        `👤 Username: @${ctx.from.username || 'N/A'}\n` +
                        `🏷 Job ID: ${jobId}\n` +
                        `💎 Resolution: 4K\n` +
                        `📅 Time: ${new Date().toLocaleString('ar-SA')}\n` +
                        `━━━━━━━━━━━━━━`,
                });
            }
            catch (archiveErr) {
                console.error('[Archive] 4K archive failed:', archiveErr);
            }
        }
        catch (error) {
            if (!isAdmin) {
                user.dailyQuota += 2; // REFUND BOTH
                await user.save();
            }
            await ctx.deleteMessage().catch(() => { });
            await ctx.reply('😔 عذراً حدث خطأ أثناء معالجة صورتك بدقة 4K 🌸\nتم إعادة المحاولتين تلقائياً ✨\nجرب مرة أخرى وسنكون معك 💙');
        }
        return;
    }
    // ── enhance_again ────────────────────────────────────────────────────────────
    if (data === 'enhance_again') {
        await ctx.answerCallbackQuery();
        await ctx.editMessageText('📸 أرسل الصورة الجديدة التي تريد تحسينها.');
        return;
    }
}
//# sourceMappingURL=callbackHandler.js.map