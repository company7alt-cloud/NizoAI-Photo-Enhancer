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
// src/index.ts
require("dotenv/config");
// ─── Environment Guards ────────────────────────────────────────────────────────
if (!process.env.BOT_TOKEN)
    throw new Error('❌ BOT_TOKEN is missing');
if (!process.env.DOC_BOT_TOKEN)
    throw new Error('❌ DOC_BOT_TOKEN is missing — create a second bot via @BotFather and add it to .env');
if (!process.env.ADMIN_IDS)
    throw new Error('❌ ADMIN_IDS is missing');
if (!process.env.CHANNEL_ID)
    throw new Error('❌ CHANNEL_ID is missing');
if (!process.env.MONGODB_URI)
    throw new Error('❌ MONGODB_URI is missing');
const http_1 = __importDefault(require("http"));
const openai_1 = __importDefault(require("openai"));
const grammy_1 = require("grammy");
const runner_1 = require("@grammyjs/runner");
const path_1 = __importDefault(require("path"));
const validators_1 = require("./utils/validators");
const connection_1 = require("./database/connection");
const Settings_1 = require("./database/models/Settings");
const User_1 = require("./database/models/User");
const ForceSubChannel_1 = require("./database/models/ForceSubChannel");
const start_1 = require("./bot/commands/start");
const admin_1 = require("./bot/commands/admin");
const imageHandler_1 = require("./bot/handlers/imageHandler");
const callbackHandler_1 = require("./bot/handlers/callbackHandler");
const forceSubMiddleware_1 = require("./bot/middlewares/forceSubMiddleware");
const botTextsService_1 = require("./services/botTextsService");
const settingsService_1 = require("./services/settingsService");
// ─── Bot Instances ─────────────────────────────────────────────────────────────
const imageBot = new grammy_1.Bot(process.env.BOT_TOKEN);
const docBot = new grammy_1.Bot(process.env.DOC_BOT_TOKEN);
// ─── Rate Limiting ─────────────────────────────────────────────────────────────
const imageBotRateMap = new Map();
const docBotRateMap = new Map();
function rateLimitMiddleware(limitMs, map) {
    return async (ctx, next) => {
        const userId = ctx.from?.id;
        if (!userId)
            return next();
        if ((0, validators_1.isAdmin)(userId))
            return next(); // Admin always exempt
        const now = Date.now();
        if (now - (map.get(userId) ?? 0) < limitMs) {
            await ctx.reply('⚠️ أرسل ببطء قليل، لا تضغط بسرعة!').catch(() => { });
            if (ctx.callbackQuery)
                await ctx.answerCallbackQuery().catch(() => { });
            return;
        }
        map.set(userId, now);
        return next();
    };
}
// ─── OpenRouter AI Client ─────────────────────────────────────────────────────
const aiClient = new openai_1.default({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY ?? '',
});
// ─── Shared emoji strip regex (used by AI output cleaning) ────────────────────
const AI_EMOJI_REGEX = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}\u{2300}-\u{23FF}\u{FE00}-\u{FEFF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FAFF}]/gu;
// ─── docBot Maintenance Flag ───────────────────────────────────────────────────
let docBotLocked = false;
const docAdminState = new Map();
// ─── docBot Admin Panel Keyboard ──────────────────────────────────────────────
const docAdminKeyboard = new grammy_1.InlineKeyboard()
    .text('👤 التحكم بالعميل', 'doc_admin_users')
    .text('🔒 قفل/فتح البوت', 'doc_admin_lock').row()
    .text('📊 الإحصائيات', 'doc_admin_stats')
    .text('💰 إدارة النقاط', 'doc_admin_points').row()
    .text('📢 إشعار جماعي', 'doc_admin_broadcast');
// ══════════════════════════════════════════════════════════════════════════════
// IMAGE BOT — MIDDLEWARE STACK
// ══════════════════════════════════════════════════════════════════════════════
// 1. Rate limiting — FIRST, admin exempt
imageBot.use(rateLimitMiddleware(1500, imageBotRateMap));
// 2. Force subscription
imageBot.use(forceSubMiddleware_1.forceSubMiddleware);
// 3. Session — isolated key: img_<userId>
imageBot.use((0, grammy_1.session)({
    initial: () => ({ documentLines: [] }),
    getSessionKey: (ctx) => ctx.from ? `img_${ctx.from.id}` : undefined,
}));
// 4. User-init / ban / global maintenance
imageBot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId)
        return next();
    try {
        const user = await User_1.User.findOne({ telegramId: userId });
        if (user?.isBanned) {
            const msg = '🚫 أنت محظور من استخدام البوت.';
            if (ctx.callbackQuery) {
                void ctx.answerCallbackQuery({ text: msg, show_alert: true }).catch(() => { });
                return;
            }
            await ctx.reply(msg);
            return;
        }
        const botStatus = (await Settings_1.Settings.get('bot_status'));
        if (botStatus === false && !(0, validators_1.isAdmin)(userId)) {
            const msg = '🔧 البوت في وضع الصيانة حالياً. سنعود قريباً!';
            if (ctx.callbackQuery) {
                void ctx.answerCallbackQuery({ text: msg, show_alert: true }).catch(() => { });
                return;
            }
            await ctx.reply(msg);
            return;
        }
        if (user) {
            user.lastSeen = new Date();
            await user.save();
        }
    }
    catch (err) {
        console.error('[ImageBot Auth] Middleware error:', err);
    }
    await next();
});
// ── imageBot does NOT handle DocMaker — that belongs exclusively to docBot ──
// ─── Commands ──────────────────────────────────────────────────────────────────
imageBot.command('start', start_1.startCommand);
// ── /reset command ────────────────────────────────────────────────────────
imageBot.command('reset', async (ctx) => {
    await ctx.reply('⚠️ تأكيد إعادة التشغيل\n\n' +
        'سيتم إلغاء أي عملية جارية (مستند، صورة، إعدادات) والعودة للقائمة الرئيسية.\n\n' +
        '✅ رصيدك ومعلوماتك محفوظة تماماً — لن يُمس شيء منها.', {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: '✅ نعم، أعد التشغيل', callback_data: 'action_confirm_reset' }],
                [{ text: '❌ تراجع', callback_data: 'action_cancel_reset' }],
            ],
        },
    });
});
// ── action_confirm_reset callback ─────────────────────────────────────────
imageBot.callbackQuery('action_confirm_reset', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => { });
    // SURGICAL WIPE — session operational state only
    // PRESERVE: pendingFile and all fields NOT listed here
    ctx.session.isInDocMaker = false;
    ctx.session.docState = null;
    ctx.session.documentLines = [];
    ctx.session.tempLine = null;
    ctx.session.tempFormatting = null;
    ctx.session.tempImage = undefined;
    ctx.session.rowImages = undefined;
    ctx.session.awaitingNextRowImage = false;
    ctx.session.awaitingRowCaption = undefined;
    ctx.session.tempCaptionTarget = undefined;
    ctx.session.editingLineIndex = undefined;
    ctx.session.awaitingLineEditIndex = false;
    ctx.session.awaitingLineEditText = false;
    ctx.session.previewMessageId = undefined;
    ctx.session.pendingExportCost = undefined;
    ctx.session.pendingExportPages = undefined;
    ctx.session.selectedFont = undefined;
    ctx.session.docBgColor = undefined;
    ctx.session.docTextColor = undefined;
    ctx.session.pageSize = undefined;
    ctx.session.templateId = undefined;
    ctx.session.docType = undefined;
    ctx.session.pendingFile = undefined;
    ctx.session.pendingConversionFileId = undefined;
    ctx.session.pendingConversionFormat = undefined;
    ctx.session.pendingBatchFiles = [];
    ctx.session.awaitingCustomWidth = false;
    ctx.session.awaitingCustomHeight = false;
    ctx.session.customSizeWidth = undefined;
    ctx.session.customSizeDims = undefined;
    // Re-run startCommand to show welcome screen with all buttons
    await (0, start_1.startCommand)(ctx);
});
// ── action_cancel_reset callback ──────────────────────────────────────────
imageBot.callbackQuery('action_cancel_reset', async (ctx) => {
    await ctx.answerCallbackQuery({ text: '✅ تم التراجع' });
    await ctx.deleteMessage().catch(() => { });
});
(0, admin_1.registerAdminCommands)(imageBot);
imageBot.command('invite', start_1.inviteCommand);
// ─── 🎨 فلاتر الصور ──────────────────────────────────────────────────────────
imageBot.hears('🎨 فلاتر الصور', async (ctx) => {
    const settings = await (0, settingsService_1.getSettings)();
    const adminIds = (process.env.ADMIN_IDS || '').split(',');
    const isAdmin = adminIds.includes(ctx.from.id.toString());
    if (settings.locks.btn_filters && !isAdmin) {
        await ctx.reply('🔒 قسم الفلاتر مغلق مؤقتاً. تابعنا للتحديثات ✨');
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
            .text('❌ إلغاء', 'cancel_filter')
    });
});
// ─── /endchat — Admin closes the active support session ───────────────────────
imageBot.command('endchat', async (ctx) => {
    const telegramId = ctx.from?.id.toString();
    const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
    if (!adminIds.includes(telegramId || ''))
        return; // admins only
    const activeUser = await User_1.User.findOne({
        supportSessionActive: true,
        supportSessionAdminId: telegramId,
    });
    if (activeUser) {
        await User_1.User.findOneAndUpdate({ telegramId: activeUser.telegramId }, { $set: { supportSessionActive: false, supportSessionAdminId: null } });
        // Notify user
        await ctx.api.sendMessage(activeUser.telegramId, `✅ <b>تم إغلاق جلسة الدعم</b>\n\nشكراً لتواصلك معنا 🌹\nنتمنى لك يوماً طيباً 😊`, { parse_mode: 'HTML' }).catch(() => { });
    }
    await ctx.reply(`🛑 <b>تم إنهاء المحادثة المباشرة مع العميل.</b>`, { parse_mode: 'HTML' });
});
// ─── imageBot: message handlers (admin input, support, etc.) ──────────────────
imageBot.on('message', async (_ctx, next) => {
    await next();
});
imageBot.on('message:text', async (ctx, next) => {
    const telegramId = ctx.from?.id.toString();
    const user = await User_1.User.findOne({ telegramId });
    const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
    const isAdm = adminIds.includes(telegramId || '');
    const messageText = ctx.message?.text || '';
    // 0. VIP Size Bypass Command (Admin Only)
    if (isAdm && messageText.startsWith('/vip')) {
        const parts = messageText.split(' ');
        const targetId = parts[1];
        if (!targetId) {
            await ctx.reply('❌ <b>خطأ في الصيغة</b>\nالاستخدام الصحيح: <code>/vip 123456789</code>', { parse_mode: 'HTML' });
            return;
        }
        const targetUser = await User_1.User.findOne({ telegramId: targetId });
        if (!targetUser) {
            await ctx.reply('❌ لم يتم العثور على مستخدم بهذا الـ ID.');
            return;
        }
        await User_1.User.findOneAndUpdate({ telegramId: targetId }, { $set: { vipSizeBypass: true } });
        await ctx.reply(`✅ <b>تم تفعيل VIP!</b>\nالمستخدم (<code>${targetId}</code>) يمكنه الآن رفع صور بحجم 15 ميجابايت.`, { parse_mode: 'HTML' });
        try {
            await ctx.api.sendMessage(targetId, '🌟 <b>تم ترقية حسابك (VIP)</b>\n\nبناءً على طلبك، تم فتح الحد الأقصى للممحاة السحرية. يمكنك الآن إرسال صور بحجم يصل إلى <b>15 ميجابايت</b>! 😎', { parse_mode: 'HTML' });
        }
        catch (e) { }
        return;
    }
    // 1. Admin Commands (Priority 1)
    if (isAdm && (messageText === '/endchat' || messageText === 'قفل المحادثة' || messageText === 'اغلق المحادثة')) {
        const activeUser = await User_1.User.findOne({
            supportSessionActive: true,
            supportSessionAdminId: telegramId
        });
        if (activeUser) {
            await User_1.User.findOneAndUpdate({ telegramId: activeUser.telegramId }, { $set: { supportSessionActive: false, supportSessionAdminId: null } });
            await ctx.reply(`✅ <b>تم إنهاء المحادثة المباشرة مع العميل.</b>`, { parse_mode: 'HTML' });
            try {
                await ctx.api.sendMessage(activeUser.telegramId, '🔔 تم إغلاق جلسة الدعم. شكراً لتواصلك معنا 💙');
            }
            catch (e) { }
        }
        else {
            await ctx.reply('❌ لا توجد محادثة نشطة حالياً لإغلاقها.');
        }
        return;
    }
    const adminInputUser = await User_1.User.findOne({ telegramId: ctx.from?.id.toString() });
    const adminInput = adminInputUser?.adminAwaitingInput;
    const text = ctx.message?.text?.trim() || '';
    const isAdminMsg = isAdm;
    // ── attempts_add_all: waiting for number ──
    if (adminInput === 'attempts_add_all' && isAdminMsg) {
        const amount = parseInt(text);
        if (isNaN(amount) || amount <= 0) {
            await ctx.reply('❌ أرسل رقماً صحيحاً أكبر من صفر.');
            return;
        }
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { adminAwaitingInput: null } });
        const result = await User_1.User.updateMany({}, { $inc: { dailyQuota: amount } });
        // Notify users safely
        const allUsers = await User_1.User.find({}).select('telegramId').lean();
        let notified = 0;
        for (const u of allUsers) {
            try {
                await ctx.api.sendMessage(u.telegramId, `🎁 <b>هدية من المطور!</b>\n\nتم إضافة <b>${amount}</b> محاولات مجانية لرصيدك 🚀\nنتمنى لك تجربة ممتعة ومميزة 💎✨`, { parse_mode: 'HTML' });
                notified++;
            }
            catch (e) { }
            if (notified % 25 === 0)
                await new Promise(r => setTimeout(r, 1000));
        }
        await ctx.reply(`✅ تمت إضافة ${amount} محاولات لـ ${result.modifiedCount} مستخدم\n📢 تم إشعار ${notified} مستخدم`);
        return;
    }
    // ── attempts_add_one_id: waiting for user ID ──
    if (adminInput === 'attempts_add_one_id' && isAdminMsg) {
        const targetUser = await User_1.User.findOne({ telegramId: text });
        if (!targetUser) {
            await ctx.reply('❌ المستخدم غير موجود. تأكد من الـ ID وأعد الإرسال.');
            return;
        }
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { adminAwaitingInput: 'attempts_add_one_amount', adminTargetUserId: text } });
        await ctx.reply(`✅ تم العثور على المستخدم: <code>${text}</code>\n\nأرسل عدد المحاولات التي تريد إضافتها:`, { parse_mode: 'HTML' });
        return;
    }
    // ── attempts_add_one_amount: waiting for amount ──
    if (adminInput === 'attempts_add_one_amount' && isAdminMsg) {
        const amount = parseInt(text);
        if (isNaN(amount) || amount <= 0) {
            await ctx.reply('❌ أرسل رقماً صحيحاً أكبر من صفر.');
            return;
        }
        const targetId = adminInputUser?.adminTargetUserId;
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { adminAwaitingInput: null, adminTargetUserId: null } });
        await User_1.User.findOneAndUpdate({ telegramId: targetId }, { $inc: { dailyQuota: amount } });
        try {
            await ctx.api.sendMessage(targetId, `🎁 <b>مفاجأة من المطور!</b>\n\nتم إضافة <b>${amount}</b> محاولات مجانية لرصيدك الشخصي 🌟\nهذه مكافأة خاصة لك تقديراً لحسن تعاملك مع البوت 💙`, { parse_mode: 'HTML' });
        }
        catch (e) { }
        await ctx.reply(`✅ تمت إضافة ${amount} محاولات للمستخدم <code>${targetId}</code> وتم إشعاره`, { parse_mode: 'HTML' });
        return;
    }
    // ── attempts_remove_one_id: waiting for user ID ──
    if (adminInput === 'attempts_remove_one_id' && isAdminMsg) {
        const targetUser = await User_1.User.findOne({ telegramId: text });
        if (!targetUser) {
            await ctx.reply('❌ المستخدم غير موجود.');
            return;
        }
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { adminAwaitingInput: 'attempts_remove_one_amount', adminTargetUserId: text } });
        await ctx.reply(`✅ تم العثور على المستخدم: <code>${text}</code>\n\nأرسل عدد المحاولات التي تريد خصمها:`, { parse_mode: 'HTML' });
        return;
    }
    // ── attempts_remove_one_amount: waiting for amount ──
    if (adminInput === 'attempts_remove_one_amount' && isAdminMsg) {
        const amount = parseInt(text);
        if (isNaN(amount) || amount <= 0) {
            await ctx.reply('❌ أرسل رقماً صحيحاً أكبر من صفر.');
            return;
        }
        const targetId = adminInputUser?.adminTargetUserId;
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { adminAwaitingInput: null, adminTargetUserId: null } });
        // Smart subtraction pipeline: prevents negative quota
        await User_1.User.findOneAndUpdate({ telegramId: targetId }, [{ $set: { dailyQuota: { $max: [0, { $subtract: ["$dailyQuota", amount] }] } } }]);
        await ctx.reply(`✅ تم خصم ${amount} محاولات من المستخدم <code>${targetId}</code> (الرصيد لا ينزل تحت الصفر)`, { parse_mode: 'HTML' });
        return;
    }
    // ── attempts_reset_one_id: waiting for user ID ──
    if (adminInput === 'attempts_reset_one_id' && isAdminMsg) {
        const targetUser = await User_1.User.findOne({ telegramId: text });
        if (!targetUser) {
            await ctx.reply('❌ المستخدم غير موجود.');
            return;
        }
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { adminAwaitingInput: null, adminTargetUserId: null } });
        await User_1.User.findOneAndUpdate({ telegramId: text }, { $set: { dailyQuota: 0 } });
        await ctx.reply(`✅ تم تصفير محاولات المستخدم <code>${text}</code>`, { parse_mode: 'HTML' });
        return;
    }
    // ── magic_link_reward: waiting for reward amount ──
    if (adminInput === 'magic_link_reward' && isAdminMsg) {
        const reward = parseInt(text);
        if (isNaN(reward) || reward <= 0) {
            await ctx.reply('❌ أرسل رقماً صحيحاً أكبر من صفر.');
            return;
        }
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { adminAwaitingInput: 'magic_link_maxuses', adminTargetUserId: reward.toString() } });
        await ctx.reply(`✅ المكافأة: <b>${reward}</b> محاولات\n\nالآن أرسل الحد الأقصى لعدد الأشخاص المسموح لهم باستخدام الرابط:`, { parse_mode: 'HTML' });
        return;
    }
    // ── magic_link_maxuses: waiting for max uses ──
    if (adminInput === 'magic_link_maxuses' && isAdminMsg) {
        const maxUses = parseInt(text);
        if (isNaN(maxUses) || maxUses <= 0) {
            await ctx.reply('❌ أرسل رقماً صحيحاً أكبر من صفر.');
            return;
        }
        const reward = parseInt(adminInputUser?.adminTargetUserId || '0');
        await User_1.User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { $set: { adminAwaitingInput: null, adminTargetUserId: null } });
        // Generate unique code & Expiration Date (24 Hours)
        const { v4: uuidv4 } = await Promise.resolve().then(() => __importStar(require('uuid')));
        const code = uuidv4().substring(0, 8).toUpperCase();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const { MagicLink } = await Promise.resolve().then(() => __importStar(require('./database/models/MagicLink')));
        await MagicLink.create({ code, reward, maxUses, currentUses: 0, usedBy: [], isActive: true, expiresAt });
        const botUsername = (await ctx.api.getMe()).username;
        const magicLinkUrl = `https://t.me/${botUsername}?start=magic_${code}`;
        await ctx.reply(`✅ <b>تم إنشاء رابط المكافأة بنجاح!</b>\n\n` +
            `🔗 <b>الرابط:</b>\n<code>${magicLinkUrl}</code>\n\n` +
            `🎁 <b>المكافأة:</b> ${reward} محاولات لكل شخص\n` +
            `👥 <b>الحد الأقصى:</b> ${maxUses} شخص\n` +
            `⏳ <b>الصلاحية:</b> 24 ساعة فقط\n` +
            `📊 <b>الكود:</b> <code>${code}</code>\n\n` +
            `⚠️ الرابط سيتوقف تلقائياً بعد استخدامه ${maxUses} مرة أو بعد مرور 24 ساعة.`, { parse_mode: 'HTML' });
        return;
    }
    // ── add_fsub_input: waiting for channel data (CHANNEL_ID | URL | NAME) ──
    if (adminInput === 'add_fsub_input' && isAdminMsg) {
        const parts = text.split('|').map((s) => s.trim());
        if (parts.length !== 3) {
            await ctx.reply('❌ صيغة خاطئة. أرسل هكذا:\n' +
                '<code>CHANNEL_ID | CHANNEL_URL | CHANNEL_NAME</code>', { parse_mode: 'HTML' });
            return;
        }
        const [channelId, channelUrl, channelName] = parts;
        // Verify bot is admin in the channel before accepting
        try {
            const botInfo = await ctx.api.getMe();
            const botMember = await ctx.api.getChatMember(channelId, botInfo.id);
            if (!['administrator', 'creator'].includes(botMember.status)) {
                await ctx.reply('❌ البوت ليس مشرفاً في هذه القناة.\n' +
                    'أضفه كمشرف أولاً ثم أرسل البيانات مجدداً.');
                return;
            }
        }
        catch {
            await ctx.reply('❌ تعذر الوصول للقناة. تأكد من:\n' +
                '1. صحة الـ ID (يبدأ بـ -100...)\n' +
                '2. أن البوت مشرف فيها');
            return;
        }
        const { ForceSubChannel } = await Promise.resolve().then(() => __importStar(require('./database/models/ForceSubChannel')));
        const count = await ForceSubChannel.countDocuments();
        if (count >= 10) {
            await ctx.reply('❌ وصلت للحد الأقصى (10 قنوات).');
            await User_1.User.findOneAndUpdate({ telegramId: telegramId }, { $set: { adminAwaitingInput: null } });
            return;
        }
        const existing = await ForceSubChannel.findOne({ channelId });
        if (existing) {
            await ctx.reply('❌ هذه القناة مضافة مسبقاً.');
            await User_1.User.findOneAndUpdate({ telegramId: telegramId }, { $set: { adminAwaitingInput: null } });
            return;
        }
        await ForceSubChannel.create({
            channelId,
            channelUrl,
            channelName,
            order: count,
        });
        await User_1.User.findOneAndUpdate({ telegramId: telegramId }, { $set: { adminAwaitingInput: null } });
        await ctx.reply(`✅ تم إضافة القناة بنجاح!\n\n` +
            `📢 ${channelName}\n` +
            `🆔 ${channelId}\n\n` +
            'ستظهر الآن للعملاء ضمن شرط الاشتراك الإجباري.');
        return;
    }
    // 2. Admin Awaiting Input Logic (Priority 2 - Kept exactly as original)
    if (isAdm && user?.adminAwaitingInput) {
        const inputType = user.adminAwaitingInput;
        const inputText = messageText;
        await User_1.User.findOneAndUpdate({ telegramId: telegramId }, { $set: { adminAwaitingInput: null } });
        if (inputType.startsWith('txtedit:')) {
            const key = inputType.replace('txtedit:', '');
            const newValue = inputText.trim();
            if (!newValue || newValue === '/cancel') {
                await ctx.reply('❌ تم الإلغاء.');
                return;
            }
            const { updateText, getText } = await Promise.resolve().then(() => __importStar(require('./services/botTextsService')));
            const oldValue = await getText(key);
            const success = await updateText(key, newValue);
            if (success) {
                await ctx.reply(`✅ <b>تم التحديث بنجاح!</b>\n\n` +
                    `🔑 المفتاح: <code>${key}</code>\n\n` +
                    `📝 <b>النص القديم:</b>\n<code>${oldValue.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>\n\n` +
                    `✨ <b>النص الجديد:</b>\n<code>${newValue.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>`, { parse_mode: 'HTML' });
            }
            else {
                await ctx.reply('❌ فشل التحديث.\n' +
                    `المفتاح <code>${key}</code> غير موجود في قاعدة البيانات.`, { parse_mode: 'HTML' });
            }
            return;
        }
        if (inputType === 'welcome_message') {
            const { BotSettings } = await Promise.resolve().then(() => __importStar(require('./database/models/BotSettings')));
            await BotSettings.findOneAndUpdate({ key: 'welcome_message' }, { value: inputText }, { upsert: true });
            await ctx.reply('✅ تم تحديث رسالة الترحيب بنجاح!');
            return;
        }
        if (inputType === 'convert_button_message') {
            const { BotSettings } = await Promise.resolve().then(() => __importStar(require('./database/models/BotSettings')));
            await BotSettings.findOneAndUpdate({ key: 'convert_button_message' }, { value: inputText }, { upsert: true });
            await ctx.reply('✅ تم تحديث رسالة زر تحويل الصيغة!');
            return;
        }
        if (inputType === 'daily_reward_amount') {
            const { BotSettings } = await Promise.resolve().then(() => __importStar(require('./database/models/BotSettings')));
            const num = parseInt(inputText);
            if (isNaN(num) || num < 1) {
                await ctx.reply('❌ أرسل رقماً صحيحاً أكبر من صفر');
                return;
            }
            await BotSettings.findOneAndUpdate({ key: 'daily_reward_amount' }, { value: inputText }, { upsert: true });
            await ctx.reply(`✅ تم تحديث المحاولات اليومية إلى ${num} محاولات`);
            return;
        }
        if (inputType === 'low_attempts_warning') {
            const { BotSettings } = await Promise.resolve().then(() => __importStar(require('./database/models/BotSettings')));
            await BotSettings.findOneAndUpdate({ key: 'low_attempts_warning' }, { value: inputText }, { upsert: true });
            await ctx.reply('✅ تم تحديث رسالة انتهاء المحاولات');
            return;
        }
        if (inputType === 'broadcast') {
            const allUsers = await User_1.User.find({ isBanned: { $ne: true } });
            let successCount = 0;
            let failCount = 0;
            for (const u of allUsers) {
                try {
                    await ctx.api.sendMessage(u.telegramId, inputText);
                    successCount++;
                }
                catch {
                    failCount++;
                }
            }
            await ctx.reply(`📢 <b>تم إرسال الإشعار</b>\n✅ نجح: ${successCount}\n❌ فشل: ${failCount}`, { parse_mode: 'HTML' });
            return;
        }
        if (inputType === 'search_user') {
            const query = inputText.startsWith('@') ? { username: inputText.replace('@', '') } : { telegramId: inputText };
            const foundUser = await User_1.User.findOne(query);
            if (!foundUser) {
                await ctx.reply('❌ المستخدم غير موجود');
                return;
            }
            await ctx.reply(`🔍 <b>معلومات المستخدم</b>\n\n🆔 ID: <code>${foundUser.telegramId}</code>\n👤 Username: @${foundUser.username || 'غير محدد'}\n⚡ المحاولات: ${foundUser.dailyQuota}\n🚫 محظور: ${foundUser.isBanned ? 'نعم' : 'لا'}`, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🚫 حظر', callback_data: `admin_ban_${foundUser.telegramId}` }],
                        [{ text: '🔓 رفع الحظر', callback_data: `admin_unban_${foundUser.telegramId}` }],
                        [{ text: '➕ إضافة محاولات', callback_data: `admin_addattempts_${foundUser.telegramId}` }],
                    ],
                },
            });
            return;
        }
        if (inputType === 'grant_vip_id') {
            const targetUser = await User_1.User.findOne({ telegramId: inputText.trim() });
            if (!targetUser) {
                await ctx.reply('❌ لم يتم العثور على مستخدم بهذا الـ ID.');
                return;
            }
            await User_1.User.findOneAndUpdate({ telegramId: targetUser.telegramId }, { $set: { canBypassLocks: true } });
            await ctx.reply(`✅ <b>تم التفعيل!</b>\nالمستخدم (<code>${targetUser.telegramId}</code>) يستطيع الآن استخدام جميع الميزات المقفلة 🌟`, { parse_mode: 'HTML' });
            try {
                await ctx.api.sendMessage(targetUser.telegramId, '🌟 <b>تم ترقية حسابك (VIP)</b>\n\nتم فتح جميع الميزات المقفلة لك! 😎', { parse_mode: 'HTML' });
            }
            catch (e) { }
            return;
        }
        if (inputType === 'vip_size_bypass') {
            const targetUser = await User_1.User.findOne({ telegramId: inputText.trim() });
            if (!targetUser) {
                await ctx.reply('❌ لم يتم العثور على مستخدم بهذا الـ ID.');
                return;
            }
            await User_1.User.findOneAndUpdate({ telegramId: targetUser.telegramId }, { $set: { vipSizeBypass: true } });
            await ctx.reply(`✅ <b>تم التفعيل!</b>\nالمستخدم (<code>${targetUser.telegramId}</code>) يستطيع الآن إرسال صور بحجم يصل إلى 15 ميجابايت 🌟`, { parse_mode: 'HTML' });
            try {
                await ctx.api.sendMessage(targetUser.telegramId, '🌟 <b>تم ترقية حسابك (VIP)</b>\n\nبناءً على طلبك، تم فتح الحد الأقصى للممحاة السحرية. يمكنك الآن إرسال صور بحجم يصل إلى <b>15 ميجابايت</b>! 😎', { parse_mode: 'HTML' });
            }
            catch (e) { }
            return;
        }
    }
    // ── GIVEAWAY SETUP FLOW (admin only) ─────────────────────────────────────
    if (isAdm) {
        const adminUser2 = await User_1.User.findOne({ telegramId: telegramId });
        const gwSetup = adminUser2?.giveawaySetup;
        const gwStep = gwSetup?.step ?? null;
        if (gwStep === 'gw_winners') {
            const count = parseInt(messageText.trim());
            if (isNaN(count) || count < 1) {
                await ctx.reply('⚠️ يرجى إرسال رقم صحيح أكبر من صفر.');
                return;
            }
            await User_1.User.updateOne({ telegramId }, { $set: { 'giveawaySetup.maxWinners': count, 'giveawaySetup.step': 'gw_min_reward' } });
            await ctx.reply(`✅ عدد الفائزين: <b>${count}</b>\n\n` +
                `━━━━━━━━━━━━━━━━━\n` +
                `🎁 <b>الخطوة 2/3</b>\n` +
                `أرسل <b>الحد الأدنى للجائزة</b> (بالمحاولات)\n` +
                `<i>مثال: 1</i>`, { parse_mode: 'HTML' });
            return;
        }
        if (gwStep === 'gw_min_reward') {
            const min = parseInt(messageText.trim());
            if (isNaN(min) || min < 1) {
                await ctx.reply('⚠️ يرجى إرسال رقم صحيح أكبر من صفر.');
                return;
            }
            await User_1.User.updateOne({ telegramId }, { $set: { 'giveawaySetup.minReward': min, 'giveawaySetup.step': 'gw_max_reward' } });
            await ctx.reply(`✅ الحد الأدنى للجائزة: <b>${min} محاولات</b>\n\n` +
                `━━━━━━━━━━━━━━━━━\n` +
                `💰 أرسل <b>الحد الأقصى للجائزة</b>\n` +
                `<i>مثال: 10 (سيوزع عشوائياً من ${min} إلى 10)</i>`, { parse_mode: 'HTML' });
            return;
        }
        if (gwStep === 'gw_max_reward') {
            const max = parseInt(messageText.trim());
            const min = gwSetup?.minReward ?? 1;
            if (isNaN(max) || max < min) {
                await ctx.reply(`⚠️ يجب أن يكون الحد الأقصى أكبر من أو يساوي ${min}.`);
                return;
            }
            await User_1.User.updateOne({ telegramId }, { $set: { 'giveawaySetup.maxReward': max, 'giveawaySetup.step': 'gw_channel' } });
            await ctx.reply(`✅ نطاق الجائزة: <b>${min} — ${max} محاولات</b>\n\n` +
                `━━━━━━━━━━━━━━━━━\n` +
                `📢 <b>الخطوة 3/3</b>\n` +
                `أرسل <b>معرف القناة</b> أو ID القناة لنشر التوزيعة\n` +
                `<i>مثال: @MyChannel أو -1001234567890</i>\n\n` +
                `⚠️ تأكد أن البوت مشرف في القناة`, { parse_mode: 'HTML' });
            return;
        }
        if (gwStep === 'gw_channel') {
            const channelId = messageText.trim();
            if (!gwSetup?.maxWinners) {
                await ctx.reply('❌ حدث خطأ في الإعداد. ابدأ من جديد.');
                await User_1.User.updateOne({ telegramId }, { $set: { 'giveawaySetup.step': null } });
                return;
            }
            const { Giveaway } = await Promise.resolve().then(() => __importStar(require('./database/models/Giveaway')));
            try {
                const giveawayText = `🎉 <b>توزيعات NizoAI Bot</b> 🎁\n\n` +
                    `━━━━━━━━━━━━━━━━━━━\n` +
                    `🏆 <b>فرصة ذهبية لربح محاولات مجانية!</b>\n` +
                    `━━━━━━━━━━━━━━━━━━━\n\n` +
                    `💎 <b>الجائزة:</b> من ${gwSetup.minReward} إلى ${gwSetup.maxReward} محاولات عشوائياً\n` +
                    `👥 <b>عدد الفائزين:</b> ${gwSetup.maxWinners} شخص محظوظ\n\n` +
                    `⚡ المستخدمون النشطون لديهم فرص أعلى للفوز!\n\n` +
                    `👇 <b>اضغط الزر واكتشف حظك الآن!</b>`;
                const msg = await ctx.api.sendMessage(channelId, giveawayText, {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[
                                { text: '🍀 جرب حظك الآن 🟢', callback_data: 'gw_roll_init' }
                            ]]
                    }
                });
                await Giveaway.create({
                    channelId,
                    messageId: msg.message_id,
                    maxWinners: gwSetup.maxWinners,
                    minReward: gwSetup.minReward,
                    maxReward: gwSetup.maxReward,
                });
                await User_1.User.updateOne({ telegramId }, { $set: { 'giveawaySetup.step': null } });
                const safeChannel = channelId.replace('@', '');
                await ctx.reply(`✅ <b>تم نشر التوزيعة بنجاح!</b> 🎉\n\n` +
                    `📢 القناة: <code>${channelId}</code>\n` +
                    `👥 الفائزون: ${gwSetup.maxWinners}\n` +
                    `🎁 الجوائز: ${gwSetup.minReward}–${gwSetup.maxReward} محاولات\n\n` +
                    `💡 يمكنك إعادة نشر رسالة التوزيعة في أي وقت`, {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[
                                { text: '📤 عرض رسالة التوزيعة', url: `https://t.me/${safeChannel}/${msg.message_id}` }
                            ]]
                    }
                });
            }
            catch (err) {
                await ctx.reply(`❌ <b>فشل النشر!</b>\n\n` +
                    `تأكد أن البوت مشرف في القناة وأن المعرف صحيح.\n` +
                    `<code>${err.message}</code>`, { parse_mode: 'HTML' });
                await User_1.User.updateOne({ telegramId }, { $set: { 'giveawaySetup.step': null } });
            }
            return;
        }
    }
    // 3. Fund Campaign Logic (Priority 3 - Kept exactly as original)
    const { isFundCampaignPending, handleFundCampaignInput, broadcastFundCampaign } = await Promise.resolve().then(() => __importStar(require('./services/channelFundService')));
    if (isAdm && isFundCampaignPending(ctx.from.id)) {
        const result = await handleFundCampaignInput(ctx.from.id, ctx.message.text || '', ctx.api);
        if (result.status === 'ask_target') {
            await ctx.reply(`✅ تم التحقق من صلاحيات البوت.\n\nكم عدد الأعضاء المطلوب؟`, { reply_markup: { inline_keyboard: [[{ text: '↩️ رجوع', callback_data: 'cancel_fund_campaign' }]] } });
        }
        else if (result.status === 'not_admin_in_channel') {
            await ctx.reply('❌ البوت ليس مشرفاً في هذه القناة. أضفه كمشرف أولاً ثم أعد المحاولة.');
        }
        else if (result.status === 'done' && 'campaign' in result) {
            const campaign = result.campaign;
            await ctx.reply(`✅ تم إنشاء الحملة بنجاح!\n\n📢 القناة: ${campaign.channelLink}\n🎯 الهدف: ${campaign.targetMembers} عضو\n\n⏳ جاري الإذاعة...`);
            const { sent, failed } = await broadcastFundCampaign(ctx.api, campaign);
            const { InlineKeyboard } = await Promise.resolve().then(() => __importStar(require('grammy')));
            const deleteBroadcastKeyboard = new InlineKeyboard().text('🗑 حذف الإذاعة', `delete_broadcast_${campaign._id}`);
            await ctx.reply(`📢 اكتملت الإذاعة!\n✅ نجح: ${sent}\n❌ فشل: ${failed}`, { reply_markup: deleteBroadcastKeyboard });
        }
        else if (result.status === 'invalid_target') {
            await ctx.reply('❌ عدد غير صحيح.');
        }
        return;
    }
    // 3b. Admin User Control — waiting for target User ID (adminActionState)
    const adminUser = await User_1.User.findOne({ telegramId: telegramId });
    if (adminUser && adminUser.adminActionState && adminUser.adminActionState.startsWith('auc_')) {
        const targetId = ctx.message?.text?.trim();
        if (!targetId) {
            await ctx.reply('❌ أرسل ID المستخدم كرقم فقط.');
            return;
        }
        const actionState = adminUser.adminActionState; // e.g. "auc_ban"
        const action = actionState.replace('auc_', ''); // "ban" | "restrict" | "unban" | "unrestrict" | "info"
        const actionLabelMap = {
            ban: 'حظر', restrict: 'تقييد',
            unban: 'فك حظر', unrestrict: 'فك تقييد', info: 'استعلام عن'
        };
        if (action === 'info') {
            const targetUser = await User_1.User.findOne({ telegramId: targetId });
            if (!targetUser) {
                await ctx.reply('❌ لم يتم العثور على مستخدم بهذا الـ ID.');
            }
            else {
                await ctx.reply(`ℹ️ <b>معلومات العميل</b>\n\n` +
                    `🆔 ID: <code>${targetUser.telegramId}</code>\n` +
                    `👤 Username: @${targetUser.username || 'غير محدد'}\n` +
                    `⚡ المحاولات: ${targetUser.dailyQuota}\n` +
                    `🚫 محظور: ${targetUser.isBanned ? 'نعم' : 'لا'}\n` +
                    `⚠️ مقيد: ${targetUser.isRestricted ? 'نعم' : 'لا'}`, { parse_mode: 'HTML' });
            }
            await User_1.User.updateOne({ telegramId: telegramId }, { $set: { adminActionState: '' } });
            return;
        }
        const labelMap = actionLabelMap[action] || action;
        await ctx.reply(`⚠️ <b>تأكيد الإجراء</b>\n\n` +
            `الإجراء: <b>${labelMap}</b>\n` +
            `العميل: <code>${targetId}</code>\n\n` +
            `هل أنت متأكد؟`, {
            parse_mode: 'HTML',
            reply_markup: new grammy_1.InlineKeyboard()
                .text(`✅ نعم، ${labelMap}`, `auc_confirm_${action}_${targetId}`)
                .text('❌ إلغاء', 'admin_cancel_action')
        });
        await User_1.User.updateOne({ telegramId: telegramId }, { $set: { adminActionState: '' } });
        return;
    }
    // 4. Strict Admin -> User Support Routing (Admin is sending a message during an active session)
    if (isAdm) {
        const activeUser = await User_1.User.findOne({
            supportSessionActive: true,
            supportSessionAdminId: telegramId
        });
        if (activeUser) {
            // Admin is in a session, intercept this message and ask for confirmation.
            await ctx.reply(`📤 <b>هل أنت متأكد من إرسال هذا الرد للعميل؟</b>\n\n` +
                `👤 <b>معرف العميل:</b> <code>${activeUser.telegramId}</code>\n` +
                `⚠️ <i>إذا لم تقصد الرد عليه، قم بقفل المحادثة أولاً (أرسل: قفل المحادثة)</i>`, {
                parse_mode: 'HTML',
                reply_parameters: { message_id: ctx.message.message_id },
                reply_markup: {
                    inline_keyboard: [[
                            { text: '✅ نعم، أرسل للعميل', callback_data: `confirm_support_send_${activeUser.telegramId}` },
                            { text: '❌ لا، إلغاء الإرسال', callback_data: 'cancel_support_send' }
                        ]]
                }
            });
            return; // Do not process further
        }
    }
    // 5. Strict User -> Admin Support Routing (User is sending a message during an active session)
    if (user?.supportSessionActive && user.supportSessionAdminId) {
        await ctx.api.sendMessage(user.supportSessionAdminId, `💬 <b>رد من العميل (${ctx.from?.first_name || 'مجهول'} | <code>${telegramId}</code>):</b>\n\n${messageText}`, { parse_mode: 'HTML' });
        return; // Stop — don't process as standard message
    }
    // ── Report interceptor for text messages ──
    if (user?.awaitingReport) {
        await User_1.User.findOneAndUpdate({ telegramId }, { $set: { awaitingReport: false } });
        const messageId = ctx.message?.message_id;
        const chatId = ctx.chat?.id;
        if (messageId && chatId) {
            await ctx.reply('📤 <b>هل تريد مشاركة هذا البلاغ مع مطور البوت؟</b>\n\n' +
                'سيتم إرسال رسالتك للمطور مباشرة وسيتم الرد عليك في أقرب وقت 💙', {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ نعم، أرسل البلاغ', callback_data: `confirm_report_${chatId}_${messageId}` },
                            { text: '❌ لا، إلغاء', callback_data: 'cancel_report_confirm' },
                        ],
                    ],
                },
            });
        }
        return;
    }
    await next();
});
// ─── Support Session Media Tunnel ─────────────────────────────────────────────
// Intercepts photos & documents when either side is in an active support
// session — must be registered BEFORE the imageHandler so these messages
// are never fed into the enhancement pipeline.
imageBot.on([':photo', ':document'], async (ctx, next) => {
    const telegramId = ctx.from?.id.toString();
    const user = await User_1.User.findOne({ telegramId });
    const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
    const isAdm = adminIds.includes(telegramId || '');
    // 1. Admin -> User (Confirm media sending)
    if (isAdm) {
        const activeUser = await User_1.User.findOne({
            supportSessionActive: true,
            supportSessionAdminId: telegramId
        });
        if (activeUser) {
            await ctx.reply(`📤 <b>هل تريد إرسال هذا الملف/الصورة للعميل؟</b>\n\n` +
                `👤 <b>معرف العميل:</b> <code>${activeUser.telegramId}</code>`, {
                parse_mode: 'HTML',
                reply_parameters: { message_id: ctx.message.message_id },
                reply_markup: {
                    inline_keyboard: [[
                            { text: '✅ نعم، أرسل الملف', callback_data: `confirm_support_send_${activeUser.telegramId}` },
                            { text: '❌ لا، إلغاء', callback_data: 'cancel_support_send' }
                        ]]
                }
            });
            return; // Stop processing, do not send to imageHandler
        }
    }
    // ── Report interceptor for photos and documents ──
    if (user?.awaitingReport) {
        await User_1.User.findOneAndUpdate({ telegramId }, { $set: { awaitingReport: false } });
        const messageId = ctx.message?.message_id;
        const chatId = ctx.chat?.id;
        if (messageId && chatId) {
            await ctx.reply('📤 <b>هل تريد مشاركة هذا البلاغ مع مطور البوت؟</b>\n\n' +
                'سيتم إرسال رسالتك للمطور مباشرة وسيتم الرد عليك في أقرب وقت 💙', {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ نعم، أرسل البلاغ', callback_data: `confirm_report_${chatId}_${messageId}` },
                            { text: '❌ لا، إلغاء', callback_data: 'cancel_report_confirm' },
                        ],
                    ],
                },
            });
            return; // STOP — do not pass to imageHandler
        }
    }
    // 2. User -> Admin (Direct forward)
    if (user?.supportSessionActive && user.supportSessionAdminId) {
        try {
            const firstName = ctx.from?.first_name || 'مجهول';
            await ctx.api.sendMessage(user.supportSessionAdminId, `💬 <b>ملف من العميل (${firstName} | <code>${telegramId}</code>):</b>`, { parse_mode: 'HTML' });
            await ctx.forwardMessage(user.supportSessionAdminId);
        }
        catch (e) {
            console.error('[SupportTunnel] User→Admin media error:', e);
        }
        return; // Stop processing, do not send to imageHandler
    }
    // If no support session is active, pass media to the image processing AI
    return next();
});
// ─── Image & Callback Handlers ─────────────────────────────────────────────────
imageBot.on([':photo', ':document'], imageHandler_1.imageHandler);
imageBot.callbackQuery(/.*/, callbackHandler_1.callbackHandler);
// ─── chat_member: Leave / Kick Penalty + Force-Sub Clawback ───────────────────
imageBot.on('chat_member', async (ctx) => {
    const update = ctx.update.chat_member;
    if (!update)
        return;
    const newStatus = update.new_chat_member.status;
    const oldStatus = update.old_chat_member.status;
    const userId = update.new_chat_member.user.id;
    const channelId = String(update.chat.id);
    // ── Existing fund-campaign penalty ──────────────────────────────────────────
    const wasActive = ['member', 'administrator', 'creator'].includes(oldStatus);
    const hasLeft = ['left', 'kicked', 'restricted'].includes(newStatus);
    if (wasActive && hasLeft) {
        const { handleMemberLeft } = await Promise.resolve().then(() => __importStar(require('./services/channelFundService')));
        await handleMemberLeft(userId, channelId, ctx.api);
    }
    // ── Referral Clawback: user leaves a force-sub channel ──────────────────────
    try {
        if (newStatus !== 'left' && newStatus !== 'kicked')
            return;
        const isForceSubChannel = await ForceSubChannel_1.ForceSubChannel.findOne({ channelId });
        if (!isForceSubChannel)
            return;
        const fleeingUser = await User_1.User.findOne({ telegramId: userId });
        if (fleeingUser?.referredBy != null &&
            fleeingUser.referralRewardClaimed === true) {
            const REFERRAL_REWARD = 5; // same amount given in start.ts referral block
            const POINTS_FIELD = 'dailyQuota'; // exact field from User model
            await User_1.User.findOneAndUpdate({ telegramId: fleeingUser.referredBy }, { $inc: { [POINTS_FIELD]: -REFERRAL_REWARD } });
            await User_1.User.findOneAndUpdate({ telegramId: userId }, { $set: { referralRewardClaimed: false } });
            console.log(`[Clawback] ${userId} left force-sub channel. ` +
                `Clawed back ${REFERRAL_REWARD} pts from referrer ${fleeingUser.referredBy}`);
            try {
                await ctx.api.sendMessage(fleeingUser.referredBy, `⚠️ تم خصم ${REFERRAL_REWARD} نقطة من رصيدك لأن ` +
                    'الشخص الذي دعوته غادر إحدى قنوات البوت الإجبارية.');
            }
            catch { /* referrer may have blocked bot */ }
        }
    }
    catch (err) {
        console.error('[Clawback chat_member]', err);
    }
});
// ─── my_chat_member: User blocks the bot — Referral Clawback ──────────────────
imageBot.on('my_chat_member', async (ctx) => {
    try {
        const newStatus = ctx.myChatMember.new_chat_member.status;
        if (newStatus !== 'kicked')
            return;
        const fleeingUserId = ctx.from.id;
        const fleeingUser = await User_1.User.findOne({ telegramId: fleeingUserId });
        if (fleeingUser?.referredBy != null &&
            fleeingUser.referralRewardClaimed === true) {
            const REFERRAL_REWARD = 5; // same amount given in start.ts referral block
            const POINTS_FIELD = 'dailyQuota'; // exact field from User model
            await User_1.User.findOneAndUpdate({ telegramId: fleeingUser.referredBy }, { $inc: { [POINTS_FIELD]: -REFERRAL_REWARD } });
            await User_1.User.findOneAndUpdate({ telegramId: fleeingUserId }, { $set: { referralRewardClaimed: false } });
            console.log(`[Clawback] ${fleeingUserId} blocked imageBot. ` +
                `Clawed back ${REFERRAL_REWARD} pts from referrer ${fleeingUser.referredBy}`);
            try {
                await ctx.api.sendMessage(fleeingUser.referredBy, `⚠️ تم خصم ${REFERRAL_REWARD} نقطة من رصيدك لأن ` +
                    'الشخص الذي دعوته قام بحظر البوت.');
            }
            catch { /* referrer may have blocked bot */ }
        }
    }
    catch (err) {
        console.error('[Clawback my_chat_member]', err);
    }
});
// ─── imageBot Error Handler ────────────────────────────────────────────────────
imageBot.catch((err) => {
    const ctx = err.ctx;
    console.error(`[ImageBot Error] Update ${ctx.update.update_id}:`, err.error);
});
// ══════════════════════════════════════════════════════════════════════════════
// DOC BOT — MIDDLEWARE STACK
// ══════════════════════════════════════════════════════════════════════════════
// 1. Rate limiting
docBot.use(rateLimitMiddleware(2000, docBotRateMap));
// 2. Session — isolated key: doc_<userId>
docBot.use((0, grammy_1.session)({
    initial: () => ({ documentLines: [] }),
    getSessionKey: (ctx) => ctx.from ? `doc_${ctx.from.id}` : undefined,
}));
// 3. Maintenance / ban middleware
docBot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId)
        return next();
    try {
        const user = await User_1.User.findOne({ telegramId: userId });
        if (user?.isBanned) {
            const msg = '🚫 أنت محظور من استخدام البوت.';
            if (ctx.callbackQuery) {
                void ctx.answerCallbackQuery({ text: msg, show_alert: true }).catch(() => { });
                return;
            }
            await ctx.reply(msg);
            return;
        }
        if (docBotLocked && !(0, validators_1.isAdmin)(userId)) {
            const msg = '🔧 بوت صانع المستندات تحت الصيانة حالياً. سنعود قريباً!';
            if (ctx.callbackQuery) {
                void ctx.answerCallbackQuery({ text: msg, show_alert: true }).catch(() => { });
                return;
            }
            await ctx.reply(msg);
            return;
        }
        if (user) {
            user.lastSeen = new Date();
            await user.save();
        }
    }
    catch (err) {
        console.error('[DocBot Auth] Middleware error:', err);
    }
    await next();
});
// ─── docBot: /start command ────────────────────────────────────────────────────
docBot.command('start', async (ctx) => {
    const user = await User_1.User.findOne({ telegramId: ctx.from.id.toString() });
    const points = user?.dailyQuota ?? 0;
    const firstName = ctx.from?.first_name ?? 'مستخدم';
    await ctx.replyWithPhoto(new grammy_1.InputFile(path_1.default.join(__dirname, '../assets/welcome.jpg')), {
        caption: `مرحباً ${firstName}! 👋\n\nأنا بوت صانع المستندات الاحترافي 📝\nيمكنك إنشاء مستندات PDF احترافية بسهولة تامة.\n\n💰 رصيدك الحالي: ${points} نقطة\n\nاضغط الزر بالأسفل للبدء:`,
        parse_mode: 'HTML',
        reply_markup: new grammy_1.InlineKeyboard()
            .text('📝 الدخول لصانع المستندات', 'start_doc_maker').row()
            .text('🤖 NizoAI PDF', 'start_premium_ai')
            .text('🆓 Ai Free PDF', 'start_free_ai').row()
            .text('🚨 إبلاغ المطور', 'doc_report_dev')
    });
});
docBot.callbackQuery('doc_report_dev', async (ctx) => {
    if (ctx.session)
        ctx.session.docAwaitingReport = true;
    await ctx.answerCallbackQuery();
    await ctx.reply("🚨 <b>إبلاغ المطور:</b>\n\nأرسل رسالتك، مشكلتك، أو اقتراحك الآن في رسالة واحدة، وسيتم إيصالها للمطور مباشرة.", { parse_mode: 'HTML' });
});
docBot.command('admin', async (ctx) => {
    if (!ctx.from)
        return;
    const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
    if (!adminIds.includes(ctx.from.id.toString()))
        return;
    await ctx.reply(`🔧 <b>لوحة تحكم المشرف</b>\n\nحالة البوت: ${docBotLocked ? '🔒 مقفول' : '🔓 مفتوح'}`, {
        parse_mode: 'HTML',
        reply_markup: docAdminKeyboard
    });
});
// ─── docBot: Admin panel callbacks ────────────────────────────────────────────
docBot.callbackQuery('doc_admin_lock', async (ctx) => {
    if (!(0, validators_1.isAdmin)(ctx.from.id)) {
        await ctx.answerCallbackQuery();
        return;
    }
    docBotLocked = !docBotLocked;
    await ctx.answerCallbackQuery(docBotLocked ? '🔒 تم قفل البوت' : '🔓 تم فتح البوت');
    await ctx.editMessageText(`🔧 <b>لوحة تحكم المشرف</b>\n\nحالة البوت: ${docBotLocked ? '🔒 مقفول' : '🔓 مفتوح'}`, { parse_mode: 'HTML', reply_markup: docAdminKeyboard }).catch(() => { });
});
docBot.callbackQuery('doc_admin_stats', async (ctx) => {
    if (!(0, validators_1.isAdmin)(ctx.from.id)) {
        await ctx.answerCallbackQuery();
        return;
    }
    await ctx.answerCallbackQuery();
    const totalUsers = await User_1.User.countDocuments();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const activeToday = await User_1.User.countDocuments({ lastSeen: { $gte: today } });
    await ctx.reply(`📊 <b>إحصائيات بوت صانع المستندات</b>\n\n` +
        `👥 إجمالي المستخدمين: <b>${totalUsers}</b>\n` +
        `⚡ نشطون اليوم: <b>${activeToday}</b>\n` +
        `🔒 حالة البوت: ${docBotLocked ? 'مقفول' : 'مفتوح'}`, { parse_mode: 'HTML' });
});
docBot.callbackQuery('doc_admin_users', async (ctx) => {
    if (!(0, validators_1.isAdmin)(ctx.from.id)) {
        await ctx.answerCallbackQuery();
        return;
    }
    await ctx.answerCallbackQuery();
    docAdminState.set(ctx.from.id, 'awaiting_user_id');
    await ctx.reply('👤 أرسل معرف العميل (Telegram ID):');
});
docBot.callbackQuery('doc_admin_points', async (ctx) => {
    if (!(0, validators_1.isAdmin)(ctx.from.id)) {
        await ctx.answerCallbackQuery();
        return;
    }
    await ctx.answerCallbackQuery();
    docAdminState.set(ctx.from.id, 'awaiting_points');
    await ctx.reply('💰 أرسل [معرف العميل] [عدد النقاط] (مثال: 123456789 10):');
});
docBot.callbackQuery('doc_admin_broadcast', async (ctx) => {
    if (!(0, validators_1.isAdmin)(ctx.from.id)) {
        await ctx.answerCallbackQuery();
        return;
    }
    await ctx.answerCallbackQuery();
    docAdminState.set(ctx.from.id, 'awaiting_broadcast');
    await ctx.reply('📢 أرسل نص الإشعار الجماعي:');
});
// ─── docBot: Free AI Flow ──────────────────────────────────────────────────────
docBot.callbackQuery('start_free_ai', async (ctx) => {
    ctx.session.awaitingFreeAiTopic = true;
    await ctx.answerCallbackQuery();
    await ctx.reply('🆓 أرسل لي الموضوع الذي تريد كتابته وسأنشئ لك مستنداً مجاناً:');
});
// ─── docBot: Premium AI Flow — Stage 1 (entry) ──────────────────────────────
function calculatePremiumCost(pages) {
    if (pages <= 0)
        return 2;
    if (pages === 1)
        return 2;
    const extra = pages - 1;
    const extraCost = Math.floor(extra / 3) + (extra % 3 > 0 ? 1 : 0);
    return 2 + extraCost;
}
function buildPageSelectorKeyboard() {
    const kb = new grammy_1.InlineKeyboard();
    const rows = [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10]];
    for (const row of rows) {
        for (const p of row) {
            kb.text(`${p} — ${calculatePremiumCost(p)}💰`, `premium_pages_${p}`);
        }
        kb.row();
    }
    kb.text('⚡ تحليل تلقائي وخصم النقاط', 'premium_auto_analyze').row();
    kb.text('✏️ عدد مخصص', 'premium_custom_pages');
    return kb;
}
docBot.callbackQuery('start_premium_ai', async (ctx) => {
    // Clear any leftover premium state
    ctx.session.premiumAutoMode = false;
    ctx.session.awaitingPremiumImage = true;
    ctx.session.awaitingPremiumText = false;
    ctx.session.awaitingCustomPages = false;
    ctx.session.pendingPremiumImage = undefined;
    ctx.session.pendingPremiumPrompt = undefined;
    ctx.session.pendingPremiumPages = undefined;
    ctx.session.pendingPremiumCost = undefined;
    await ctx.answerCallbackQuery();
    await ctx.reply(`🤖 <b>NizoAI PDF</b>\n\n` +
        `🔍 <b>ابحث عن نموذج يعجبك:</b>\n` +
        `- <code>professional PDF template</code>\n` +
        `- <code>academic document design</code>\n` +
        `- <code>business letter template</code>\n\n` +
        `🖼 أرسل صورة النموذج المرجعي\n` +
        `أو اضغط للنموذج الافتراضي:`, {
        parse_mode: 'HTML',
        reply_markup: new grammy_1.InlineKeyboard()
            .text('📄 النموذج الافتراضي', 'premium_use_default')
    });
});
docBot.callbackQuery('premium_use_default', async (ctx) => {
    if (ctx.session.awaitingPremiumImage) {
        ctx.session.pendingPremiumImage = null;
        ctx.session.awaitingPremiumImage = false;
        ctx.session.awaitingPremiumText = true;
        await ctx.answerCallbackQuery('النموذج الافتراضي');
        await ctx.editMessageText('✅ سيستخدم NizoAI النموذج الافتراضي\n📝 أرسل المحتوى الذي تريده:', { parse_mode: 'HTML' });
    }
    else {
        await ctx.answerCallbackQuery('هذا الخيار غير متاح الآن');
    }
});
// ─── Premium pages selection callbacks ──────────────────────────────────────
for (let p = 1; p <= 10; p++) {
    const pages = p;
    docBot.callbackQuery(`premium_pages_${pages}`, async (ctx) => {
        const cost = calculatePremiumCost(pages);
        const telegramId = ctx.from.id.toString();
        ctx.session.pendingPremiumPages = pages;
        ctx.session.pendingPremiumCost = cost;
        const user = await User_1.User.findOne({ telegramId });
        const pts = user?.dailyQuota ?? 0;
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(`✅ <b>تأكيد الطلب:</b>\n` +
            `📄 عدد الصفحات: <b>${pages}</b>\n` +
            `💰 التكلفة: <b>${cost} نقطة</b>\n` +
            `💳 رصيدك: <b>${pts} نقطة</b>`, {
            parse_mode: 'HTML',
            reply_markup: new grammy_1.InlineKeyboard()
                .text('✅ تأكيد وإنشاء', 'confirm_premium_ai')
                .text('❌ إلغاء', 'cancel_premium_ai'),
        });
    });
}
docBot.callbackQuery('premium_custom_pages', async (ctx) => {
    ctx.session.awaitingCustomPages = true;
    await ctx.answerCallbackQuery();
    await ctx.reply('✏️ أرسل عدد الصفحات المطلوبة (رقم فقط):');
});
docBot.callbackQuery('premium_auto_analyze', async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.session.premiumAutoMode = true;
    const base64 = ctx.session.pendingPremiumImage;
    const prompt = ctx.session.pendingPremiumPrompt || '';
    const waitMsg = await ctx.reply('⏳ NizoAI يحلل المحتوى لتحديد عدد الصفحات...');
    try {
        let messages = [];
        if (base64) {
            messages = [{
                    role: 'user',
                    content: [
                        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
                        { type: 'text', text: `How many pages does this document template have? Reply with a single number only.` }
                    ]
                }];
        }
        else {
            messages = [{
                    role: 'user',
                    content: `How many pages (350 words per page) are needed for the following text? Reply with ONLY a number.\nText: ${prompt}`
                }];
        }
        const analysisResponse = await aiClient.chat.completions.create({
            model: 'anthropic/claude-3-haiku',
            messages
        });
        const detectedPages = parseInt(analysisResponse.choices[0]?.message?.content ?? '1') || 1;
        const autoCost = calculatePremiumCost(detectedPages);
        ctx.session.pendingPremiumPages = detectedPages;
        ctx.session.pendingPremiumCost = autoCost;
        const telegramId = ctx.from.id.toString();
        const user = await User_1.User.findOne({ telegramId });
        const pts = user?.dailyQuota ?? 0;
        await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => { });
        await ctx.reply(`🔍 <b>نتيجة التحليل التلقائي:</b>\n` +
            `📄 الصفحات المكتشفة: ${detectedPages} صفحة\n` +
            `💰 التكلفة: ${autoCost} نقطة\n` +
            `💳 رصيدك: ${pts} نقطة`, {
            parse_mode: 'HTML',
            reply_markup: new grammy_1.InlineKeyboard()
                .text(`✅ تأكيد وخصم ${autoCost} نقطة`, 'confirm_premium_ai')
                .text('❌ إلغاء', 'cancel_premium_ai')
        });
    }
    catch (error) {
        console.error('Error auto analyzing pages:', error);
        await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => { });
        await ctx.reply('❌ فشل التحليل التلقائي. يرجى اختيار عدد الصفحات يدوياً.');
    }
});
// ─── Premium confirm / cancel ────────────────────────────────────────────────
docBot.callbackQuery('confirm_premium_ai', async (ctx) => {
    const cost = ctx.session.pendingPremiumCost ?? 2;
    const pages = ctx.session.pendingPremiumPages ?? 1;
    const prompt = ctx.session.pendingPremiumPrompt ?? '';
    const imageB64 = ctx.session.pendingPremiumImage;
    const telegramId = ctx.from.id.toString();
    const user = await User_1.User.findOne({ telegramId });
    if (!user || user.dailyQuota < cost) {
        await ctx.answerCallbackQuery('❌ رصيدك غير كافٍ!');
        await ctx.reply(`❌ رصيدك الحالي ${user?.dailyQuota ?? 0} نقطة، وتحتاج ${cost} نقطة.`);
        return;
    }
    await User_1.User.updateOne({ telegramId }, { $inc: { dailyQuota: -cost } });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('⏳ NizoAI يحلل ويصمم مستندك...').catch(() => { });
    try {
        let systemPrompt = '';
        let messages = [];
        if (imageB64) {
            systemPrompt = `أنت مصمم مستندات PDF احترافي.
مهمتك:
1. تحليل صورة النموذج المرجعية بدقة عالية
2. استخراج: الألوان، التخطيط، موضع العناوين، الهوامش، التذييل
3. إنشاء مستند يطابق النموذج تماماً في التصميم
4. استبدال النص فقط بالمحتوى الجديد
5. الالتزام بـ ${pages} صفحة فقط — كل صفحة 350-400 كلمة
6. إذا المحتوى أطول: اختصر — لا تتجاوز ${pages} صفحات
7. إذا أقصر: وسّع بتفاصيل مناسبة
8. لا رموز تعبيرية أبداً
9. لا تكتب === أو markers في الإخراج النهائي
10. احتفظ بلغة المستخدم كما هي — لا تترجم`;
            messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: [
                        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageB64}` } },
                        { type: 'text', text: `المحتوى: ${prompt}\nعدد الصفحات: ${pages} فقط` }
                    ] }
            ];
        }
        else {
            systemPrompt = `أنت مصمم مستندات PDF احترافي.
أنشئ مستنداً بتصميم احترافي راقٍ:
- ترويسة أنيقة مع عنوان واضح
- عناوين رئيسية وفرعية منظمة
- فقرات متوازنة
- تذييل بسيط مع رقم الصفحة
- ${pages} صفحة فقط، كل صفحة 350-400 كلمة
- لا رموز تعبيرية
- لا تكتب === أو markers
- احتفظ بلغة المستخدم كما هي`;
            messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `${prompt}\n\nعدد الصفحات: ${pages}` }
            ];
        }
        const response = await aiClient.chat.completions.create({
            model: 'anthropic/claude-3-haiku',
            max_tokens: 4000,
            messages,
        });
        const rawText = response.choices[0]?.message?.content ?? '';
        // CLEAN output — remove ALL markers:
        const cleaned = rawText
            .replace(/===\s*(HEADER|BODY|FOOTER|PAGE BREAK|صفحة \d+)\s*===/gi, '')
            .replace(/===.*?===/gs, '')
            .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}\u{2300}-\u{23FF}\u{FE00}-\u{FEFF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FAFF}]/gu, '')
            .trim();
        if (!cleaned)
            throw new Error('AI returned empty content');
        // Split into pages by word count (350 words per page)
        const words = cleaned.split(/\s+/);
        const pageChunks = [];
        for (let i = 0; i < words.length; i += 350) {
            pageChunks.push(words.slice(i, i + 350).join(' '));
        }
        // Take ONLY first ${pages} chunks
        if (pageChunks.length > pages) {
            pageChunks.length = pages;
        }
        while (pageChunks.length < pages) {
            pageChunks.push(pageChunks[pageChunks.length - 1] || '');
        }
        const docLines = [];
        for (let i = 0; i < pageChunks.length; i++) {
            const pgLines = pageChunks[i].split('\n').map(l => ({ text: l, align: 'right' }));
            docLines.push(...pgLines);
            if (i < pageChunks.length - 1)
                docLines.push({ text: '---PAGE_BREAK---', align: 'right' });
        }
        const { generateDocumentFromLines } = await Promise.resolve().then(() => __importStar(require('./services/pdfGeneratorService')));
        const { buffer: pdfBuffer } = await generateDocumentFromLines(docLines, 'A4');
        const remaining = (user.dailyQuota - cost);
        const fileName = `nizoai_premium_${Date.now()}.pdf`;
        await ctx.replyWithDocument(new grammy_1.InputFile(pdfBuffer, fileName), {
            caption: `✅ مستندك جاهز! 🎉\n📄 ${pages} صفحة احترافية\n💰 تم خصم ${cost} نقطة\n💳 رصيدك الحالي: ${remaining} نقطة`,
            parse_mode: 'HTML'
        });
    }
    catch (err) {
        await User_1.User.updateOne({ telegramId }, { $inc: { dailyQuota: cost } });
        console.error('[DocBot Premium AI] Error:', err?.message);
        await ctx.reply(`❌ <b>فشل إنشاء المستند.</b>\nتم استرداد نقاطك.\n<code>${err?.message ?? 'unknown error'}</code>`, { parse_mode: 'HTML' });
    }
    ctx.session.premiumAutoMode = false;
    ctx.session.awaitingPremiumImage = false;
    ctx.session.awaitingPremiumText = false;
    ctx.session.awaitingCustomPages = false;
    ctx.session.pendingPremiumImage = undefined;
    ctx.session.pendingPremiumPrompt = undefined;
    ctx.session.pendingPremiumPages = undefined;
    ctx.session.pendingPremiumCost = undefined;
});
docBot.callbackQuery('cancel_premium_ai', async (ctx) => {
    await ctx.answerCallbackQuery('تم الإلغاء');
    await ctx.editMessageText('❌ تم إلغاء الطلب.').catch(() => { });
    ctx.session.awaitingPremiumImage = false;
    ctx.session.awaitingPremiumText = false;
    ctx.session.awaitingCustomPages = false;
    ctx.session.pendingPremiumImage = undefined;
    ctx.session.pendingPremiumPrompt = undefined;
    ctx.session.pendingPremiumPages = undefined;
    ctx.session.pendingPremiumCost = undefined;
});
// ─── docBot: Premium Image Upload Handler ───────────────────────────────────────
docBot.on(['message:photo', 'message:document'], async (ctx, next) => {
    if (ctx.session.awaitingPremiumImage) {
        let fileId;
        if (ctx.message?.photo) {
            fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        }
        else if (ctx.message?.document && ctx.message.document.mime_type?.startsWith('image/')) {
            fileId = ctx.message.document.file_id;
        }
        if (!fileId)
            return next();
        try {
            const waitMsg = await ctx.reply('⏳ جاري حفظ النموذج المرجعي...');
            const file = await ctx.api.getFile(fileId);
            const filePath = file.file_path;
            if (!filePath)
                throw new Error('File path not found');
            const res = await fetch(`https://api.telegram.org/file/bot${process.env.DOC_BOT_TOKEN}/${filePath}`);
            const arrayBuffer = await res.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            ctx.session.pendingPremiumImage = buffer.toString('base64');
            ctx.session.awaitingPremiumImage = false;
            ctx.session.awaitingPremiumText = true;
            await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => { });
            await ctx.reply('✅ <b>تم حفظ النموذج المرجعي!</b>\n\n' +
                '📝 أرسل الآن المحتوى الذي تريده في المستند:', { parse_mode: 'HTML' });
        }
        catch (error) {
            console.error('Error fetching image for premium AI:', error);
            await ctx.reply('❌ حدث خطأ أثناء معالجة الصورة، يرجى المحاولة بصورة أخرى.');
        }
        return;
    }
    return next();
});
// ─── docBot: Admin + AI text input handler ────────────────────────────────────
docBot.on('message:text', async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId)
        return next();
    const text = ctx.message.text.trim();
    // ── Report to Dev state ─────────────────────────────────────────────────────
    if (ctx.session?.docAwaitingReport) {
        const adminId = process.env.ADMIN_IDS?.split(',')[0]?.trim() || process.env.ADMIN_ID;
        const username = ctx.from.username ? `@${ctx.from.username}` : 'بدون يوزر';
        const name = ctx.from.first_name || 'عميل';
        const reportMsg = `📝 <b>بلاغ من بوت المستندات</b> 📝\n\n👤 <b>العميل:</b> <a href="tg://user?id=${userId}">${name}</a> (${username})\n🆔 <b>الأيدي:</b> <code>${userId}</code>\n\n📩 <b>الرسالة:</b>\n${text}`;
        try {
            if (adminId) {
                await docBot.api.sendMessage(adminId, reportMsg, { parse_mode: 'HTML' });
            }
            if (ctx.session)
                ctx.session.docAwaitingReport = false;
            await ctx.reply("✅ <b>تم إرسال رسالتك للمطور بنجاح.</b> شكراً لتواصلك!", { parse_mode: 'HTML' });
        }
        catch (error) {
            console.error('Failed to send docBot report to admin:', error);
            if (ctx.session)
                ctx.session.docAwaitingReport = false;
            await ctx.reply("❌ حدث خطأ أثناء إرسال البلاغ. يرجى المحاولة لاحقاً.");
        }
        return;
    }
    // ── Admin state machine ─────────────────────────────────────────────────────
    if ((0, validators_1.isAdmin)(userId)) {
        const state = docAdminState.get(userId);
        if (state) {
            docAdminState.delete(userId);
            if (state === 'awaiting_user_id') {
                const targetUser = await User_1.User.findOne({ telegramId: text });
                if (!targetUser) {
                    await ctx.reply('❌ المستخدم غير موجود.');
                    return;
                }
                await ctx.reply(`ℹ️ <b>معلومات العميل</b>\n\n` +
                    `🆔 ID: <code>${targetUser.telegramId}</code>\n` +
                    `👤 Username: @${targetUser.username || 'غير محدد'}\n` +
                    `🚫 محظور: ${targetUser.isBanned ? 'نعم' : 'لا'}`, { parse_mode: 'HTML' });
                return;
            }
            if (state === 'awaiting_points') {
                const parts = text.split(/\s+/);
                if (parts.length !== 2 || isNaN(parseInt(parts[1]))) {
                    await ctx.reply('❌ الصيغة غير صحيحة. مثال: 123456789 10');
                    return;
                }
                const [targetId, amountStr] = parts;
                const amount = parseInt(amountStr);
                const updated = await User_1.User.findOneAndUpdate({ telegramId: targetId }, { $inc: { dailyQuota: amount } }, { new: true });
                if (!updated) {
                    await ctx.reply('❌ المستخدم غير موجود.');
                    return;
                }
                await ctx.reply(`✅ تمت إضافة <b>${amount}</b> نقطة للمستخدم <code>${targetId}</code>. الرصيد: ${updated.dailyQuota}`, { parse_mode: 'HTML' });
                return;
            }
            if (state === 'awaiting_broadcast') {
                const allUsers = await User_1.User.find({ isBanned: { $ne: true } }).select('telegramId').lean();
                let ok = 0;
                let fail = 0;
                for (const u of allUsers) {
                    try {
                        await docBot.api.sendMessage(u.telegramId, text);
                        ok++;
                    }
                    catch {
                        fail++;
                    }
                    if ((ok + fail) % 25 === 0)
                        await new Promise(r => setTimeout(r, 1000));
                }
                await ctx.reply(`📢 <b>تم إرسال الإشعار</b>\n✅ نجح: ${ok}\n❌ فشل: ${fail}`, { parse_mode: 'HTML' });
                return;
            }
        }
    }
    // ── Custom pages number interceptor ─────────────────────────────────────────
    if (ctx.session.awaitingCustomPages) {
        const n = parseInt(text);
        if (isNaN(n) || n < 1 || n > 50) {
            await ctx.reply('❌ أرسل رقماً صحيحاً بين 1 و50.');
            return;
        }
        ctx.session.awaitingCustomPages = false;
        const cost = calculatePremiumCost(n);
        ctx.session.pendingPremiumPages = n;
        ctx.session.pendingPremiumCost = cost;
        const user = await User_1.User.findOne({ telegramId: userId.toString() });
        const pts = user?.dailyQuota ?? 0;
        await ctx.reply(`✅ <b>تأكيد الطلب:</b>\n📄 عدد الصفحات: <b>${n}</b>\n💰 التكلفة: <b>${cost} نقطة</b>\n💳 رصيدك: <b>${pts} نقطة</b>`, {
            parse_mode: 'HTML',
            reply_markup: new grammy_1.InlineKeyboard()
                .text('✅ تأكيد وإنشاء', 'confirm_premium_ai')
                .text('❌ إلغاء', 'cancel_premium_ai'),
        });
        return;
    }
    // ── Premium AI — Stage 3: awaiting text/prompt ──────────────────────────────
    if (ctx.session.awaitingPremiumText) {
        ctx.session.awaitingPremiumText = false;
        ctx.session.pendingPremiumPrompt = text;
        await ctx.reply(`📄 <b>كم صفحة تريد للمستند؟</b>\n\n` +
            `💰 <b>نظام التسعير:</b>\n` +
            `- الصفحة الأولى = 2 نقطة\n` +
            `- كل 3 صفحات إضافية = نقطة واحدة إضافية`, { parse_mode: 'HTML', reply_markup: buildPageSelectorKeyboard() });
        return;
    }
    // ── Free AI Topic Interceptor ───────────────────────────────────────────────
    if (ctx.session.awaitingFreeAiTopic) {
        ctx.session.awaitingFreeAiTopic = false;
        const waitMsg = await ctx.reply('⏳ جاري الكتابة بالذكاء الاصطناعي...');
        try {
            const FREE_AI_SYSTEM_PROMPT = 'أنت كاتب محتوى عربي محترف. اكتب المحتوى المطلوب بشكل منظم واضح. استخدم العناوين والفقرات. لا تستخدم رموز تعبيرية. اكتب باللغة العربية فقط.';
            let rawText = '';
            // Model 1: Llama 3.1 8B (primary)
            try {
                const response = await aiClient.chat.completions.create({
                    model: 'meta-llama/llama-3.1-8b-instruct:free',
                    messages: [
                        { role: 'system', content: FREE_AI_SYSTEM_PROMPT },
                        { role: 'user', content: text },
                    ],
                });
                rawText = response.choices[0]?.message?.content ?? '';
            }
            catch (primaryErr) {
                console.warn('[DocBot Free AI] Primary model failed, trying fallback:', primaryErr?.message);
                // Model 2: Gemma 3 4B (fallback)
                try {
                    const fallbackResponse = await aiClient.chat.completions.create({
                        model: 'google/gemma-3-4b-it:free',
                        messages: [
                            { role: 'system', content: FREE_AI_SYSTEM_PROMPT },
                            { role: 'user', content: text },
                        ],
                    });
                    rawText = fallbackResponse.choices[0]?.message?.content ?? '';
                }
                catch (fallbackErr) {
                    console.error('[DocBot Free AI] Fallback model also failed:', fallbackErr?.message);
                    throw new Error(`كلا النموذجين فشلا. الأول: ${primaryErr?.message} — الثاني: ${fallbackErr?.message}`);
                }
            }
            const cleanedText = rawText.replace(new RegExp(AI_EMOJI_REGEX.source, 'gu'), '').trim();
            if (!cleanedText)
                throw new Error('AI returned empty content');
            const { generateDocumentFromLines } = await Promise.resolve().then(() => __importStar(require('./services/pdfGeneratorService')));
            const lines = cleanedText.split('\n').map(l => ({ text: l, align: 'right' }));
            const { buffer: pdfBuffer, pageCount } = await generateDocumentFromLines(lines, 'A4');
            const fileName = `nizoai_free_${Date.now()}.pdf`;
            await ctx.replyWithDocument(new grammy_1.InputFile(pdfBuffer, fileName), { caption: `✅ <b>تم إنشاء مستندك المجاني!</b>\n📄 الصفحات: ${pageCount}`, parse_mode: 'HTML' });
        }
        catch (err) {
            console.error('[DocBot Free AI] Error:', err?.message);
            await ctx.reply(`❌ <b>فشل إنشاء المستند.</b>\n<code>${err?.message ?? 'unknown error'}</code>`, { parse_mode: 'HTML' });
        }
        await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => { });
        return;
    }
    return next();
});
// ─── docBot: DocMaker handler (all remaining messages & callbacks) ─────────────
docBot.on(['message', 'callback_query'], async (ctx, next) => {
    const { handleDocMakerCallback, handleDocMakerMessage, showImageFormatMenu } = await Promise.resolve().then(() => __importStar(require('./bot/handlers/docMakerHandler')));
    if (ctx.callbackQuery) {
        const handled = await handleDocMakerCallback(ctx);
        if (!handled)
            return next();
        return;
    }
    if (ctx.message) {
        const docState = ctx.session?.docState;
        // ── Session Closed Notification ──
        // Skip if user is actively in any AI or DocMaker flow
        if (!ctx.session?.isInDocMaker &&
            !ctx.session?.awaitingFreeAiTopic &&
            !ctx.session?.awaitingPremiumImage &&
            !ctx.session?.awaitingPremiumText &&
            !ctx.session?.awaitingCustomPages) {
            const txt = ctx.message.text || ctx.message.caption || '';
            if (txt.startsWith('/'))
                return next();
            await ctx.reply('⚠️ الجلسة السابقة مغلقة.\n\nإذا أردت إنشاء مستند جديد اضغط الزر أدناه:', {
                reply_markup: new grammy_1.InlineKeyboard().text('🆕 بدء مستند جديد', 'start_doc_maker')
            });
            return;
        }
        // ── CASE 1: Custom line number input ──
        if (docState === 'awaiting_custom_img_lines') {
            if (!ctx.message?.text) {
                await ctx.reply('⚠️ أرسل رقماً فقط (مثال: 10)', { parse_mode: 'HTML' });
                return;
            }
            const num = parseInt(ctx.message.text.trim());
            if (isNaN(num) || num < 1 || num > 50) {
                await ctx.reply('⚠️ أرسل رقماً صحيحاً بين 1 و50 فقط.');
                return;
            }
            if (!ctx.session.tempImage) {
                await ctx.reply('⚠️ انتهت صلاحية الصورة، أرسلها مجدداً.');
                ctx.session.docState = 'active';
                return;
            }
            ctx.session.tempImage.lines = num;
            ctx.session.docState = 'active';
            await showImageFormatMenu(ctx);
            return;
        }
        // ── CASE 2: Image sent ──
        const isPhoto = !!ctx.message?.photo;
        const isImageDoc = !!ctx.message?.document && ((ctx.message.document.mime_type?.startsWith('image/')) ?? false);
        if (isPhoto || isImageDoc) {
            if (ctx.session.awaitingNextRowImage) {
                const fileId = isPhoto
                    ? ctx.message.photo[ctx.message.photo.length - 1].file_id
                    : ctx.message.document.file_id;
                const rowImages = ctx.session.rowImages || [];
                const baseLines = rowImages[0]?.lines || 5;
                ctx.session.tempImage = { fileId, lines: baseLines, align: undefined, mask: undefined };
                ctx.session.awaitingNextRowImage = false;
                await showImageFormatMenu(ctx);
                return;
            }
            if (ctx.session.tempImage?.fileId) {
                await ctx.reply('⚠️ <b>أكمل إعدادات الصورة الحالية أولاً</b>\nأو اضغط إلغاء الصورة.', {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔙 إلغاء الصورة والعودة', callback_data: 'doc_back_to_session' }]
                        ]
                    }
                });
                return;
            }
            const fileId = isPhoto
                ? ctx.message.photo[ctx.message.photo.length - 1].file_id
                : ctx.message.document.file_id;
            ctx.session.tempImage = { fileId };
            await ctx.reply('🖼 <b>تم استلام الصورة!</b>\n\n📏 كم سطراً تريد تخصيصها للصورة في المستند؟\nأو اجعلها غلافاً يملأ الصفحة بالكامل:', {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📄 ملء الصفحة كاملة (غلاف)', callback_data: 'doc_img_full_cover' }],
                        [{ text: '📏 افتراضي — 5 أسطر', callback_data: 'doc_img_space_5' }],
                        [{ text: '📐 كبير — 10 أسطر', callback_data: 'doc_img_space_10' }],
                        [{ text: '✍️ تخصيص العدد...', callback_data: 'doc_img_space_custom' }],
                        [{ text: '🔙 إلغاء', callback_data: 'doc_back_to_session' }]
                    ]
                }
            });
            return;
        }
        // ── Row caption text intercept ──
        if (docState === 'awaiting_row_caption' && ctx.session.tempCaptionTarget !== undefined) {
            const text = ctx.message?.text?.trim();
            if (!text)
                return;
            if (ctx.session.tempCaptionTarget === 'temp' && ctx.session.tempImage) {
                ctx.session.tempImage.caption = text;
            }
            else if (typeof ctx.session.tempCaptionTarget === 'number') {
                const rowImgs = ctx.session.rowImages || [];
                if (rowImgs[ctx.session.tempCaptionTarget]) {
                    rowImgs[ctx.session.tempCaptionTarget].caption = text;
                }
            }
            ctx.session.tempCaptionTarget = undefined;
            ctx.session.docState = 'active';
            await ctx.reply(`✅ تم حفظ النص بنجاح!`);
            await showImageFormatMenu(ctx);
            return;
        }
        if (ctx.session.tempImage?.fileId) {
            await ctx.reply('⚠️ <b>أكمل إعدادات الصورة أولاً</b>\nاختر المحاذاة والإطار، أو اضغط إلغاء.', {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔙 إلغاء الصورة والعودة', callback_data: 'doc_back_to_session' }]
                    ]
                }
            });
            return;
        }
        const handled = await handleDocMakerMessage(ctx);
        if (!handled)
            return next();
    }
});
// ─── docBot Error Handler ──────────────────────────────────────────────────────
docBot.catch((err) => {
    const ctx = err.ctx;
    console.error(`[DocBot Error] Update ${ctx.update.update_id}:`, err.error);
});
process.on('unhandledRejection', (reason) => {
    console.error('[Unhandled Rejection]', reason);
});
process.on('uncaughtException', (err) => {
    console.error('[Uncaught Exception]', err);
});
// ─── HTTP Health Check (Render requirement) ────────────────────────────────────
const PORT = process.env.PORT ?? 3000;
const server = http_1.default.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('NizoAI Bot is running\n');
});
server.listen(PORT, () => {
    console.log(`[Server] Health check listening on port ${PORT}`);
});
// ─── Graceful Shutdown ─────────────────────────────────────────────────────────
// ─── Bootstrap ────────────────────────────────────────────────────────────────
async function bootstrap() {
    try {
        await (0, connection_1.connectDatabase)();
        await Settings_1.Settings.initDefaults();
        await (0, botTextsService_1.initBotTexts)();
        console.log('--- NizoAI Bot is starting ---');
        const [imageBotInfo, docBotInfo] = await Promise.all([
            imageBot.api.getMe(),
            docBot.api.getMe(),
        ]);
        console.log(`[ImageBot] ✅ Authenticated as @${imageBotInfo.username}`);
        console.log(`[DocBot]   ✅ Authenticated as @${docBotInfo.username}`);
        // Preload ONNX model in background (non-blocking)
        Promise.resolve().then(() => __importStar(require('./services/onnxEnhanceService'))).then(({ warmupONNX }) => warmupONNX?.())
            .catch(() => { });
        // Start fake counter engine
        Promise.resolve().then(() => __importStar(require('./services/fakeCounterService'))).then(({ startFakeCounterEngine }) => startFakeCounterEngine())
            .catch(err => console.error('[ImageBot] Failed to start fake counter engine', err));
        const imageRunner = (0, runner_1.run)(imageBot);
        const docRunner = (0, runner_1.run)(docBot);
        console.log('✅ Image Bot and Document Bot are now running via grammy/runner for maximum concurrency and speed.');
        // Graceful shutdown for runners
        const shutdown = async () => {
            console.log('[System] Shutting down...');
            server.close();
            if (imageRunner.isRunning())
                await imageRunner.stop();
            if (docRunner.isRunning())
                await docRunner.stop();
            await (0, connection_1.closeDatabaseConnection)();
            process.exit(0);
        };
        process.removeAllListeners('SIGTERM');
        process.removeAllListeners('SIGINT');
        process.once('SIGINT', shutdown);
        process.once('SIGTERM', shutdown);
    }
    catch (error) {
        console.error('[Bootstrap] ❌ Fatal error:', error);
        process.exit(1);
    }
}
bootstrap();
//# sourceMappingURL=index.js.map