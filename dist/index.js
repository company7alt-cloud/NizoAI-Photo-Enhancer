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
const aiPdfService_1 = require("./services/aiPdfService");
const promptAnalyzerService_1 = require("./services/promptAnalyzerService");
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
async function getUserPageLimit(userId) {
    const user = await User_1.User.findOne({ telegramId: userId }).select('docPageLimit');
    return Number.isFinite(user?.docPageLimit) && Number(user?.docPageLimit) > 0
        ? Number(user?.docPageLimit)
        : 5;
}
// ─── Shared emoji strip regex (removed as it corrupts markdown tables) ────────────────────
// ─── AI Hallucination Guard ────────────────────────────────────────────────────
function sanitizeAiOutput(text, context) {
    if (!text || text.trim().length === 0) {
        throw new Error('AI returned empty content');
    }
    // 1. CJK hallucination check: >5% CJK chars in an Arabic context = corrupted output
    const cjkMatches = text.match(/[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/g) ?? [];
    const cjkRatio = cjkMatches.length / text.length;
    if (cjkRatio > 0.05) {
        console.error(`[AI Guard] CJK hallucination detected (${(cjkRatio * 100).toFixed(1)}% CJK) in ${context} flow`);
        throw new Error('AI_HALLUCINATION: unexpected language characters detected');
    }
    // 2. System noise / apology fingerprints
    const hallucPatterns = [
        /apologize/i,
        /\breroute\b/i,
        /i'm sorry/i,
        /as an ai/i,
        /\berror:\s/i,
        /\bexception\b/i,
        /\bstacktrace\b/i,
        /\bsyntaxerror\b/i,
        /\btypeerror\b/i,
    ];
    for (const pattern of hallucPatterns) {
        if (pattern.test(text)) {
            console.error(`[AI Guard] Hallucination fingerprint matched: ${pattern} in ${context} flow`);
            throw new Error('AI_HALLUCINATION: system noise detected in output');
        }
    }
    assertMarkdownTablesComplete(text, context);
    return text.trim();
}
function assertMarkdownTablesComplete(text, context) {
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
        if (!isMarkdownTableRow(lines[index]))
            continue;
        const tableRows = [];
        let cursor = index;
        while (cursor < lines.length && isMarkdownTableRow(lines[cursor])) {
            tableRows.push(lines[cursor].trim());
            cursor++;
        }
        const hasSeparator = tableRows.length >= 2 && isMarkdownSeparatorRow(tableRows[1]);
        if (!hasSeparator) {
            console.error(`[AI Guard] Broken markdown table detected in ${context} flow:`, tableRows);
            throw new Error('AI_TABLE_CORRUPTION: markdown table separator is missing');
        }
        const expectedCells = countMarkdownCells(tableRows[0]);
        for (const row of tableRows.slice(2)) {
            if (countMarkdownCells(row) !== expectedCells) {
                console.error(`[AI Guard] Markdown table cell mismatch in ${context} flow:`, tableRows);
                throw new Error('AI_TABLE_CORRUPTION: markdown table cells are inconsistent');
            }
        }
        index = cursor - 1;
    }
}
function isMarkdownTableRow(line) {
    const trimmed = line.trim();
    return trimmed.startsWith('|') && trimmed.endsWith('|') && (trimmed.match(/\|/g)?.length ?? 0) >= 3;
}
function isMarkdownSeparatorRow(line) {
    return /^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|$/.test(line.trim());
}
function countMarkdownCells(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').length;
}
// ─── docBot Maintenance Flag ───────────────────────────────────────────────────
let docBotLocked = false;
const DOC_TRANSIENT_STATE_TTL_MS = 15 * 60 * 1000;
const DOC_CALLBACK_LOCK_MS = 200;
const docAdminState = new Map();
const docCallbackLocks = new Map();
let lastDocStateCleanup = 0;
function logDocBotError(scope, error) {
    console.error(scope, error);
}
function setDocAdminState(userId, state) {
    docAdminState.set(userId, { state, updatedAt: Date.now() });
}
function getDocAdminState(userId) {
    const entry = docAdminState.get(userId);
    if (!entry)
        return undefined;
    if (Date.now() - entry.updatedAt > DOC_TRANSIENT_STATE_TTL_MS) {
        docAdminState.delete(userId);
        return undefined;
    }
    return entry.state;
}
function clearDocAdminState(userId) {
    docAdminState.delete(userId);
}
function cleanupDocTransientState() {
    const now = Date.now();
    if (now - lastDocStateCleanup < 60_000)
        return;
    lastDocStateCleanup = now;
    for (const [userId, entry] of docAdminState.entries()) {
        if (now - entry.updatedAt > DOC_TRANSIENT_STATE_TTL_MS) {
            docAdminState.delete(userId);
        }
    }
    for (const [key, timestamp] of docBotRateMap.entries()) {
        if (now - timestamp > DOC_TRANSIENT_STATE_TTL_MS) {
            docBotRateMap.delete(key);
        }
    }
    for (const [key, timestamp] of docCallbackLocks.entries()) {
        if (now - timestamp > DOC_TRANSIENT_STATE_TTL_MS) {
            docCallbackLocks.delete(key);
        }
    }
}
function isRapidDocCallback(ctx, label) {
    const userId = ctx.from?.id;
    const data = ctx.callbackQuery?.data || label;
    if (!userId)
        return false;
    const key = `${userId}:${data}`;
    const now = Date.now();
    const last = docCallbackLocks.get(key) ?? 0;
    if (now - last < DOC_CALLBACK_LOCK_MS) {
        return true;
    }
    docCallbackLocks.set(key, now);
    return false;
}
function withDocBotHandler(label, handler) {
    return async (ctx, next) => {
        try {
            await handler(ctx, next);
        }
        catch (error) {
            logDocBotError(`[DocBot:${label}] Handler failed:`, error);
            await ctx.reply('⚠️ حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.')
                .catch((replyError) => logDocBotError(`[DocBot:${label}] Failed to notify user:`, replyError));
        }
    };
}
function registerDocCallback(trigger, label, handler) {
    docBot.callbackQuery(trigger, async (ctx) => {
        const originalAnswerCallbackQuery = ctx.answerCallbackQuery.bind(ctx);
        let callbackAnswered = false;
        ctx.answerCallbackQuery = async (...args) => {
            if (callbackAnswered)
                return undefined;
            callbackAnswered = true;
            return originalAnswerCallbackQuery(...args).catch((answerError) => {
                logDocBotError(`[DocBot:${label}] answerCallbackQuery failed:`, answerError);
                return undefined;
            });
        };
        await ctx.answerCallbackQuery().catch((answerError) => {
            logDocBotError(`[DocBot:${label}] initial answerCallbackQuery failed:`, answerError);
        });
        try {
            if (!ctx.callbackQuery) {
                logDocBotError(`[DocBot:${label}] Missing callbackQuery:`, ctx.update);
                return;
            }
            if (!ctx.from) {
                logDocBotError(`[DocBot:${label}] Missing ctx.from:`, ctx.update);
                return;
            }
            if (isRapidDocCallback(ctx, label)) {
                return;
            }
            await handler(ctx);
        }
        catch (error) {
            logDocBotError(`[DocBot:${label}] Callback failed:`, error);
            await ctx.reply('⚠️ حدث خطأ أثناء تنفيذ الزر. يرجى المحاولة مرة أخرى.')
                .catch((replyError) => logDocBotError(`[DocBot:${label}] Failed to notify user:`, replyError));
        }
    });
}
// ─── docBot Admin Panel Keyboard ──────────────────────────────────────────────
const docAdminKeyboard = new grammy_1.InlineKeyboard()
    .text('👤 التحكم بالعميل', 'doc_admin_users')
    .text('🔒 قفل/فتح البوت', 'doc_admin_lock').row()
    .text('📊 الإحصائيات', 'doc_admin_stats')
    .text('💰 إدارة النقاط', 'doc_admin_points').row()
    .text('🔓 فتح صلاحية المستندات', 'doc_admin_unlock_documents').row()
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
    cleanupDocTransientState();
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
            await User_1.User.updateOne({ telegramId: userId }, { $set: { lastSeen: new Date() } });
        }
    }
    catch (err) {
        console.error('[DocBot Auth] Middleware error:', err);
    }
    await next();
});
// ─── docBot: /start command ────────────────────────────────────────────────────
docBot.command('start', withDocBotHandler('start_command', async (ctx) => {
    if (!ctx.from)
        return;
    const user = await User_1.User.findOne({ telegramId: ctx.from.id.toString() });
    const points = user?.dailyQuota ?? 0;
    const firstName = ctx.from?.first_name ?? 'مستخدم';
    await ctx.replyWithPhoto(new grammy_1.InputFile(path_1.default.join(__dirname, '../assets/welcome.jpg')), {
        caption: `مرحباً ${firstName}! 👋\n\nأنا بوت صانع المستندات الاحترافي 📝\nيمكنك إنشاء مستندات PDF احترافية بسهولة تامة.\n\n💰 رصيدك الحالي: ${points} نقطة\n\nاضغط الزر بالأسفل للبدء:`,
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: '📝 الدخول لصانع المستندات',
                        callback_data: 'start_doc_maker',
                        // @ts-ignore
                        style: 'primary'
                    }
                ],
                [
                    {
                        text: '🤖 NizoAI PDF',
                        callback_data: 'start_premium_ai',
                        // @ts-ignore
                        style: 'primary'
                    },
                    {
                        text: '🆓 Ai Free PDF',
                        callback_data: 'start_free_ai',
                        // @ts-ignore
                        style: 'primary'
                    }
                ],
                [
                    {
                        text: '🚨 إبلاغ المطور',
                        callback_data: 'doc_report_dev',
                        // @ts-ignore
                        style: 'danger'
                    }
                ]
            ]
        }
    });
}));
const handleDocReportDev = async (ctx) => {
    if (ctx.session)
        ctx.session.docAwaitingReport = true;
    await ctx.reply("🚨 <b>إبلاغ المطور:</b>\n\nأرسل رسالتك، مشكلتك، أو اقتراحك الآن في رسالة واحدة، وسيتم إيصالها للمطور مباشرة.", { parse_mode: 'HTML' });
};
registerDocCallback('doc_report_dev', 'doc_report_dev', handleDocReportDev);
registerDocCallback('report_to_dev', 'report_to_dev', handleDocReportDev);
docBot.command('admin', withDocBotHandler('admin_command', async (ctx) => {
    if (!ctx.from)
        return;
    const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
    if (!adminIds.includes(ctx.from.id.toString()))
        return;
    await ctx.reply(`🔧 <b>لوحة تحكم المشرف</b>\n\nحالة البوت: ${docBotLocked ? '🔒 مقفول' : '🔓 مفتوح'}`, {
        parse_mode: 'HTML',
        reply_markup: docAdminKeyboard
    });
}));
// ─── docBot: Admin panel callbacks ────────────────────────────────────────────
registerDocCallback('doc_admin_lock', 'doc_admin_lock', async (ctx) => {
    if (!ctx.from || !(0, validators_1.isAdmin)(ctx.from.id))
        return;
    docBotLocked = !docBotLocked;
    await ctx.editMessageText(`🔧 <b>لوحة تحكم المشرف</b>\n\nحالة البوت: ${docBotLocked ? '🔒 مقفول' : '🔓 مفتوح'}`, { parse_mode: 'HTML', reply_markup: docAdminKeyboard }).catch((error) => logDocBotError('[DocBot:doc_admin_lock] editMessageText failed:', error));
});
registerDocCallback('doc_admin_stats', 'doc_admin_stats', async (ctx) => {
    if (!ctx.from || !(0, validators_1.isAdmin)(ctx.from.id))
        return;
    const totalUsers = await User_1.User.countDocuments();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const activeToday = await User_1.User.countDocuments({ lastSeen: { $gte: today } });
    await ctx.reply(`📊 <b>إحصائيات بوت صانع المستندات</b>\n\n` +
        `👥 إجمالي المستخدمين: <b>${totalUsers}</b>\n` +
        `⚡ نشطون اليوم: <b>${activeToday}</b>\n` +
        `🔒 حالة البوت: ${docBotLocked ? 'مقفول' : 'مفتوح'}`, { parse_mode: 'HTML' });
});
registerDocCallback('doc_admin_users', 'doc_admin_users', async (ctx) => {
    if (!ctx.from || !(0, validators_1.isAdmin)(ctx.from.id))
        return;
    setDocAdminState(ctx.from.id, 'awaiting_user_id');
    await ctx.reply('👤 أرسل معرف العميل (Telegram ID):');
});
registerDocCallback('doc_admin_points', 'doc_admin_points', async (ctx) => {
    if (!ctx.from || !(0, validators_1.isAdmin)(ctx.from.id))
        return;
    setDocAdminState(ctx.from.id, 'awaiting_points');
    await ctx.reply('💰 أرسل [معرف العميل] [عدد النقاط] (مثال: 123456789 10):');
});
registerDocCallback('doc_admin_unlock_documents', 'doc_admin_unlock_documents', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => { });
    if (!ctx.from || !(0, validators_1.isAdmin)(ctx.from.id))
        return;
    setDocAdminState(ctx.from.id, 'awaiting_doc_page_unlock');
    await ctx.reply('أرسل userId الخاص بالمستخدم');
});
registerDocCallback('doc_admin_broadcast', 'doc_admin_broadcast', async (ctx) => {
    if (!ctx.from || !(0, validators_1.isAdmin)(ctx.from.id))
        return;
    setDocAdminState(ctx.from.id, 'awaiting_broadcast');
    await ctx.reply('📢 أرسل نص الإشعار الجماعي:');
});
// ─── docBot: Free AI Flow ──────────────────────────────────────────────────────
registerDocCallback('start_free_ai', 'start_free_ai', async (ctx) => {
    ctx.session.awaitingFreeAiTopic = true;
    await ctx.reply('🆓 أرسل لي الموضوع الذي تريد كتابته وسأنشئ لك مستنداً مجاناً:');
});
// ─── docBot: Premium AI Flow — Stage 1 (entry) ──────────────────────────────
registerDocCallback('start_premium_ai', 'start_premium_ai', async (ctx) => {
    ctx.session.awaitingPremiumImage = true;
    ctx.session.awaitingMoreText = false;
    ctx.session.awaitingPremiumText = false;
    ctx.session.pendingPremiumImage = undefined;
    ctx.session.pendingPremiumPrompt = undefined;
    ctx.session.pendingPremiumPages = undefined;
    ctx.session.pendingPremiumCost = undefined;
    ctx.session.referenceImageBuffer = undefined;
    ctx.session.collectedText = '';
    ctx.session.totalWords = 0;
    ctx.session.estimatedPages = 0;
    await ctx.reply(`🤖 <b>NizoAI PDF</b>\n\n` +
        `🔍 <b>ابحث عن نموذج يعجبك:</b>\n` +
        `- <code>professional PDF template</code>\n` +
        `- <code>academic document design</code>\n` +
        `- <code>business letter template</code>\n\n` +
        `🖼 أرسل صورة النموذج المرجعي\n` +
        `أو اضغط للنموذج الافتراضي:`, {
        parse_mode: 'HTML',
        reply_markup: new grammy_1.InlineKeyboard().text('📄 النموذج الافتراضي', 'premium_use_default')
    });
});
registerDocCallback('premium_use_default', 'premium_use_default', async (ctx) => {
    if (ctx.session.awaitingPremiumImage) {
        ctx.session.referenceImageBuffer = undefined;
        ctx.session.awaitingPremiumImage = false;
        ctx.session.awaitingPremiumText = false;
        ctx.session.awaitingMoreText = true;
        ctx.session.collectedText = '';
        ctx.session.totalWords = 0;
        ctx.session.estimatedPages = 0;
        await ctx.editMessageText(`✅ تم حفظ النموذج. الآن أرسل المحتوى النصي رسالة رسالة.\n` +
            `في كل رسالة سأحسب لك عدد الكلمات والصفحات المتوقعة.\n` +
            `عندما تنتهي أرسل كلمة: تم`, { parse_mode: 'HTML' });
    }
});
registerDocCallback(/^pages_(.*)$/, 'pages', async (ctx) => {
    const data = ctx.callbackQuery?.data || '';
    if (data.startsWith('pages_')) {
        const pageChoice = data.replace('pages_', '');
        const totalWords = ctx.session.totalWords || 0;
        const estimatedPages = Math.ceil(totalWords / 250);
        const selectedPages = pageChoice === 'auto' ? estimatedPages || 2 : parseInt(pageChoice, 10);
        const pages = Number.isFinite(selectedPages) ? Math.max(1, selectedPages) : 2;
        const pageLimit = await getUserPageLimit(ctx.from.id);
        if (pages > pageLimit) {
            await ctx.reply((0, promptAnalyzerService_1.buildPageLimitGuardMessage)(pageLimit), { parse_mode: 'Markdown' });
            return;
        }
        const waitMsg = await ctx.reply('⏳ جاري إنشاء المستند الاحترافي...');
        try {
            const rawPremiumPrompt = `اكتب وثيقة من ${pages} صفحات.\n\n` +
                'حافظ على روح النموذج المرجعي إذا كان مرفقاً، واستخدم المحتوى التالي فقط دون اختراع معلومات:\n\n' +
                `${ctx.session.collectedText || ''}`;
            const promptAnalysis = (0, promptAnalyzerService_1.analyzeAndEnhancePrompt)(rawPremiumPrompt);
            const imageBase64 = ctx.session.referenceImageBuffer;
            const userContent = imageBase64 ? [
                { type: 'text', text: promptAnalysis.enhancedPrompt },
                {
                    type: 'image_url',
                    image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
                },
            ] : promptAnalysis.enhancedPrompt;
            const response = await aiClient.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: 'user', content: userContent },
                ],
                max_tokens: 4000,
                temperature: 0.4,
            });
            const aiText = response.choices[0]?.message?.content ?? '';
            if (!aiText)
                throw new Error('AI returned empty content');
            const rawPremiumResponse = aiText.trim();
            // Guard: reject hallucinated / corrupt AI output before PDF rendering.
            sanitizeAiOutput(rawPremiumResponse, 'premium');
            // Generate PDF from the pure AI Markdown response.
            const pdfBuffer = await (0, aiPdfService_1.generateAiPDF)(rawPremiumResponse);
            await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id)
                .catch((error) => logDocBotError('[DocBot:pages] delete wait message failed:', error));
            await ctx.replyWithDocument(new grammy_1.InputFile(pdfBuffer, `NizoAI_Doc_${Date.now()}.pdf`), {
                caption: `✅ <b>تم إنشاء مستندك الاحترافي!</b>\n` +
                    `📝 الكلمات: ${totalWords}`,
                parse_mode: 'HTML'
            });
            // Reset session
            ctx.session.collectedText = '';
            ctx.session.referenceImageBuffer = '';
            ctx.session.totalWords = 0;
            ctx.session.awaitingMoreText = false;
        }
        catch (err) {
            await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id)
                .catch((error) => logDocBotError('[DocBot:pages] delete wait message after failure failed:', error));
            console.error('[Paid PDF] Error:', err);
            await ctx.reply(`❌ <b>فشل إنشاء المستند.</b>\n<code>${err?.message}</code>`, { parse_mode: 'HTML' });
        }
        return;
    }
});
registerDocCallback('cancel_premium_ai', 'cancel_premium_ai', async (ctx) => {
    await ctx.editMessageText('❌ تم إلغاء الطلب.')
        .catch((error) => logDocBotError('[DocBot:cancel_premium_ai] editMessageText failed:', error));
    ctx.session.awaitingPremiumImage = false;
    ctx.session.awaitingMoreText = false;
    ctx.session.awaitingPremiumText = false;
    ctx.session.awaitingCustomPages = false;
    ctx.session.pendingPremiumImage = undefined;
    ctx.session.pendingPremiumPrompt = undefined;
    ctx.session.pendingPremiumPages = undefined;
    ctx.session.pendingPremiumCost = undefined;
    ctx.session.referenceImageBuffer = undefined;
    ctx.session.collectedText = '';
    ctx.session.totalWords = 0;
    ctx.session.estimatedPages = 0;
});
// ─── docBot: Premium Image Upload Handler ───────────────────────────────────────
docBot.on(['message:photo', 'message:document'], withDocBotHandler('premium_image_upload', async (ctx, next) => {
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
            ctx.session.referenceImageBuffer = buffer.toString('base64');
            ctx.session.pendingPremiumImage = undefined;
            ctx.session.awaitingPremiumImage = false;
            ctx.session.awaitingPremiumText = false;
            ctx.session.awaitingMoreText = true;
            ctx.session.collectedText = '';
            ctx.session.totalWords = 0;
            ctx.session.estimatedPages = 0;
            await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id)
                .catch((error) => logDocBotError('[DocBot:premium_image_upload] delete wait message failed:', error));
            await ctx.reply('✅ <b>تم حفظ النموذج المرجعي!</b>\n\n' +
                '📝 أرسل الآن المحتوى رسالة رسالة، وعند الانتهاء أرسل كلمة: تم', { parse_mode: 'HTML' });
        }
        catch (error) {
            console.error('Error fetching image for premium AI:', error);
            await ctx.reply('❌ حدث خطأ أثناء معالجة الصورة، يرجى المحاولة بصورة أخرى.');
        }
        return;
    }
    return next();
}));
// ─── docBot: Admin + AI text input handler ────────────────────────────────────
docBot.on('message:text', withDocBotHandler('text_input', async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId)
        return next();
    const text = ctx.message?.text?.trim();
    if (!text)
        return next();
    // ── Paid PDF Text Loop ──────────────────────────────
    if (ctx.session.awaitingMoreText && ctx.message?.text) {
        const incoming = ctx.message.text.trim();
        if (incoming === 'تم' || incoming === 'تم.' || incoming === 'انتهيت') {
            // Move to page selection
            ctx.session.awaitingMoreText = false;
            const totalWords = (ctx.session.collectedText || '').split(/\s+/).filter(Boolean).length;
            const estimatedPages = Math.ceil(totalWords / 250);
            await ctx.reply(`📊 <b>ملخص المحتوى:</b>\n` +
                `─────────────────\n` +
                `📝 إجمالي الكلمات: ${totalWords}\n` +
                `📄 الصفحات المقترحة: ~${estimatedPages}\n\n` +
                `<b>اختر عدد الصفحات:</b>`, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '1 صفحة', callback_data: 'pages_1' },
                            { text: '2 صفحة', callback_data: 'pages_2' },
                            { text: '3 صفحات', callback_data: 'pages_3' },
                            { text: '5 صفحات', callback_data: 'pages_5' },
                        ],
                        [
                            { text: '10 صفحات', callback_data: 'pages_10' },
                            { text: '15 صفحة', callback_data: 'pages_15' },
                            { text: '20 صفحة', callback_data: 'pages_20' },
                        ],
                        [{ text: '🤖 تلقائي (يحدده البوت)', callback_data: 'pages_auto' }],
                    ]
                }
            });
            return;
        }
        // Accumulate text
        ctx.session.collectedText = (ctx.session.collectedText || '') + '\n' + incoming;
        const totalWords = ctx.session.collectedText.split(/\s+/).filter(Boolean).length;
        const estimatedPages = Math.ceil(totalWords / 250);
        ctx.session.totalWords = totalWords;
        await ctx.reply(`📝 <b>الكلمات حتى الآن:</b> ${totalWords}\n` +
            `📄 <b>الصفحات المتوقعة:</b> ~${estimatedPages}\n\n` +
            `هل لديك محتوى إضافي؟ أرسله أو أرسل <b>تم</b> للمتابعة`, { parse_mode: 'HTML' });
        return; // CRITICAL: must return to prevent other handlers
    }
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
        const state = getDocAdminState(userId);
        if (state) {
            clearDocAdminState(userId);
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
            if (state === 'awaiting_doc_page_unlock') {
                const targetId = text.trim();
                if (!/^\d+$/.test(targetId)) {
                    await ctx.reply('❌ أرسل userId صحيحاً بالأرقام فقط.');
                    return;
                }
                const updated = await User_1.User.findOneAndUpdate({ telegramId: targetId }, { $set: { docPageLimit: 999 } }, { new: true });
                if (!updated) {
                    await ctx.reply('❌ المستخدم غير موجود.');
                    return;
                }
                const username = updated.username
                    ? `@${updated.username}`
                    : (updated.firstName || String(updated.telegramId));
                await ctx.reply(`✅ تم فتح الصلاحية لـ ${username}. يمكنه الآن إنشاء\n` +
                    'وثائق غير محدودة الصفحات.');
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
                    catch (error) {
                        fail++;
                        logDocBotError('[DocBot:broadcast] Failed to send broadcast message:', error);
                    }
                    if ((ok + fail) % 25 === 0)
                        await new Promise(r => setTimeout(r, 1000));
                }
                await ctx.reply(`📢 <b>تم إرسال الإشعار</b>\n✅ نجح: ${ok}\n❌ فشل: ${fail}`, { parse_mode: 'HTML' });
                return;
            }
        }
    }
    // Paid PDF Text Loop moved to the top of the message interceptor.
    // ── Free AI Topic Interceptor ───────────────────────────────────────────────
    if (ctx.session.awaitingFreeAiTopic) {
        ctx.session.awaitingFreeAiTopic = false;
        const adminIds = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim());
        const isAdminUser = adminIds.includes(ctx.from.id.toString());
        const promptAnalysis = (0, promptAnalyzerService_1.analyzeAndEnhancePrompt)(text);
        const detectedPages = promptAnalysis.detectedPages;
        const pageLimit = await getUserPageLimit(userId);
        if (detectedPages > pageLimit) {
            await ctx.reply((0, promptAnalyzerService_1.buildPageLimitGuardMessage)(pageLimit), { parse_mode: 'Markdown' });
            return;
        }
        if (!isAdminUser) {
            const today = new Date().toISOString().slice(0, 10);
            if (ctx.session.freeAiUsageDate !== today) {
                ctx.session.freeAiUsageCount = 0;
                ctx.session.freeAiUsageDate = today;
            }
            const usageCount = ctx.session.freeAiUsageCount ?? 0;
            if (usageCount >= 7) {
                ctx.session.awaitingFreeAiTopic = false;
                await ctx.reply('⚠️ <b>لقد استنفدت حد الاستخدام اليومي المجاني</b>\n\n' +
                    '🆓 الحد اليومي: 7 مرات\n' +
                    '🔄 يتجدد الحد كل يوم عند منتصف الليل\n\n' +
                    '💡 للاستخدام غير المحدود جرب <b>NizoAI PDF</b> 🤖', { parse_mode: 'HTML' });
                return;
            }
            ctx.session.freeAiUsageCount = usageCount + 1;
        }
        const waitMsg = await ctx.reply('⏳ جاري الكتابة بالذكاء الاصطناعي...');
        try {
            const response = await aiClient.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: 'user', content: promptAnalysis.enhancedPrompt },
                ],
                max_tokens: 4000,
                temperature: 0.4,
            });
            const rawText = response.choices[0]?.message?.content ?? '';
            if (!rawText)
                throw new Error('AI returned empty content');
            // rawAiResponse: pure, untouched markdown from the API — used for PDF rendering
            // emoji stripping was causing table corruption, so we use the raw response
            const rawAiResponse = rawText.trim();
            // Guard: run hallucination check on the raw response before any rendering
            sanitizeAiOutput(rawAiResponse, 'free'); // throws on hallucination — does NOT strip
            // Generate PDF using wkhtmltopdf + Markdown pipeline (pure markdown — tables intact)
            const pdfBuffer = await (0, aiPdfService_1.generateAiPDF)(rawAiResponse);
            const fileName = `nizoai_free_${Date.now()}.pdf`;
            await ctx.replyWithDocument(new grammy_1.InputFile(pdfBuffer, fileName), { caption: '✅ مستندك المجاني جاهز! 📄\n\nمدعوم بـ AI Free PDF ⚡' });
        }
        catch (err) {
            console.error('[DocBot Free AI] Error:', err);
            await ctx.reply(`❌ <b>فشل إنشاء المستند.</b>\n<code>${err?.message ?? 'unknown error'}</code>`, { parse_mode: 'HTML' });
        }
        await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id)
            .catch((error) => logDocBotError('[DocBot:free_ai] delete wait message failed:', error));
        return;
    }
    return next();
}));
// ─── docBot: DocMaker handler (all remaining messages & callbacks) ─────────────
docBot.on(['message', 'callback_query'], withDocBotHandler('docmaker_router', async (ctx, next) => {
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
}));
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