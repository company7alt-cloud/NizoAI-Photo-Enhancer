"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/index.ts
require("dotenv/config");
if (!process.env.BOT_TOKEN)
    throw new Error('BOT_TOKEN is missing');
if (!process.env.ADMIN_IDS)
    throw new Error('ADMIN_IDS is missing');
if (!process.env.CHANNEL_ID)
    throw new Error('CHANNEL_ID is missing');
if (!process.env.MONGODB_URI)
    throw new Error('MONGODB_URI is missing');
const http_1 = __importDefault(require("http"));
const grammy_1 = require("grammy");
const validators_1 = require("./utils/validators");
const connection_1 = require("./database/connection");
const Settings_1 = require("./database/models/Settings");
const User_1 = require("./database/models/User");
const start_1 = require("./bot/commands/start");
const admin_1 = require("./bot/commands/admin");
const imageHandler_1 = require("./bot/handlers/imageHandler");
const callbackHandler_1 = require("./bot/handlers/callbackHandler");
const channelFundService_1 = require("./services/channelFundService");
// ─── Bot Instance ──────────────────────────────────────────────────────────────
const bot = new grammy_1.Bot(process.env.BOT_TOKEN);
// ─── Middlewares ───────────────────────────────────────────────────────────────
bot.use((0, grammy_1.session)({ initial: () => ({}) }));
bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId)
        return next();
    try {
        const user = await User_1.User.findOne({ telegramId: userId });
        // Ban check
        if (user?.isBanned) {
            const msg = '🚫 أنت محظور من استخدام البوت.';
            if (ctx.callbackQuery) {
                void ctx.answerCallbackQuery({ text: msg, show_alert: true });
                return;
            }
            await ctx.reply(msg);
            return;
        }
        // Maintenance check
        const botStatus = (await Settings_1.Settings.get('bot_status'));
        if (botStatus === false && !(0, validators_1.isAdmin)(userId)) {
            const msg = '🔧 البوت في وضع الصيانة حالياً. سنعود قريباً!';
            if (ctx.callbackQuery) {
                void ctx.answerCallbackQuery({ text: msg, show_alert: true });
                return;
            }
            await ctx.reply(msg);
            return;
        }
        // Last-seen update
        if (user) {
            user.lastSeen = new Date();
            await user.save();
        }
        await next();
    }
    catch (err) {
        console.error('[Auth] Middleware error:', err);
        await next();
    }
});
// ─── Commands ──────────────────────────────────────────────────────────────────
bot.command('start', start_1.startCommand);
bot.command('admin', admin_1.adminCommand);
bot.command('invite', start_1.inviteCommand);
// ─── Admin Message Interceptors ────────────────────────────────────────────────
bot.on('message', async (ctx, next) => {
    const adminId = ctx.from.id;
    if (!(0, validators_1.isAdmin)(adminId))
        return next();
    const text = ctx.message.text ?? '';
    // 1. Broadcast capture
    if ((0, admin_1.isBroadcastPending)(adminId)) {
        return (0, admin_1.executeBroadcast)(ctx);
    }
    // 2. Broadcast button add
    if ((0, admin_1.isAddBroadcastBtnPending)(adminId)) {
        if (text)
            await (0, admin_1.handleAddBroadcastButton)(ctx, text);
        return;
    }
    // 3. Quota add flow
    if ((0, admin_1.isQuotaAddPending)(adminId)) {
        if (text)
            await (0, admin_1.handleQuotaAdd)(ctx, text);
        return;
    }
    // 4. Fund campaign setup flow
    if ((0, admin_1.isFundCampaignPending)(adminId)) {
        if (text)
            await (0, admin_1.handleFundCampaignStep)(ctx, text);
        return;
    }
    // 5. User search
    if ((0, admin_1.isUserSearchPending)(adminId)) {
        const searchId = parseInt(text, 10);
        if (!isNaN(searchId)) {
            return (0, admin_1.searchUser)(ctx, searchId);
        }
    }
    // 6. Content edit
    const editingField = (0, admin_1.getContentEditPending)(adminId);
    if (editingField) {
        if (text) {
            await (0, admin_1.handleContentEdit)(ctx, editingField, text);
            (0, admin_1.clearContentEditPending)(adminId);
            return;
        }
    }
    await next();
});
// ─── Image & Callback Handlers ─────────────────────────────────────────────────
bot.on([':photo', ':document'], imageHandler_1.imageHandler);
bot.callbackQuery(/.*/, callbackHandler_1.callbackHandler);
// ─── chat_member: Leave / Kick Penalty ────────────────────────────────────────
// Only "left" and "kicked" statuses trigger penalties — spec rule.
bot.on('chat_member', async (ctx) => {
    try {
        const update = ctx.chatMember;
        const newStatus = update.new_chat_member.status;
        if (newStatus !== 'left' && newStatus !== 'kicked')
            return;
        const userId = update.new_chat_member.user.id;
        const channelId = String(ctx.chat.id);
        await (0, channelFundService_1.handleMemberLeft)(userId, channelId, ctx.api);
    }
    catch (err) {
        console.error('[ChatMember] Handler error:', err);
    }
});
// ─── Error Handling ────────────────────────────────────────────────────────────
bot.catch((err) => {
    console.error('[Bot Error]', err);
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
const shutdown = async () => {
    console.log('[System] Shutting down...');
    server.close();
    await (0, connection_1.closeDatabaseConnection)();
    process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
// ─── Bootstrap ────────────────────────────────────────────────────────────────
async function bootstrap() {
    try {
        await (0, connection_1.connectDatabase)();
        await Settings_1.Settings.initDefaults();
        console.log('--- NizoAI Bot is starting ---');
        const botInfo = await bot.api.getMe();
        console.log(`[Bot] ✅ Authenticated as @${botInfo.username}`);
        bot.start({
            allowed_updates: ['message', 'callback_query', 'chat_member'],
            onStart: (info) => {
                console.log(`[Bot] 🚀 Polling started for @${info.username}`);
            },
        });
    }
    catch (error) {
        console.error('[Bootstrap] ❌ Fatal error:', error);
        process.exit(1);
    }
}
bootstrap();
//# sourceMappingURL=index.js.map