// src/index.ts
import 'dotenv/config';

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is missing');
if (!process.env.ADMIN_IDS) throw new Error('ADMIN_IDS is missing');
if (!process.env.CHANNEL_ID) throw new Error('CHANNEL_ID is missing');
if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is missing');
if (!process.env.HF_API_KEY) throw new Error('HF_API_KEY is missing');

import http from 'http';
import { Bot, session, NextFunction } from 'grammy';

import { BotContext, isAdmin } from './utils/validators';
import { connectDatabase, closeDatabaseConnection } from './database/connection';
import { Settings } from './database/models/Settings';
import { User } from './database/models/User';

import { startCommand, inviteCommand } from './bot/commands/start';
import {
  adminCommand,
  isBroadcastPending,
  executeBroadcast,
  isUserSearchPending,
  searchUser,
  getContentEditPending,
  handleContentEdit,
  clearContentEditPending,
  isAddBroadcastBtnPending,
  handleAddBroadcastButton,
  isQuotaAddPending,
  handleQuotaAdd,
  isFundCampaignPending,
  handleFundCampaignStep,
} from './bot/commands/admin';
import { imageHandler } from './bot/handlers/imageHandler';
import { callbackHandler } from './bot/handlers/callbackHandler';
import { handleMemberLeft } from './services/channelFundService';

// ─── Bot Instance ──────────────────────────────────────────────────────────────

const bot = new Bot<BotContext>(process.env.BOT_TOKEN);

// ─── Middlewares ───────────────────────────────────────────────────────────────

bot.use(session({ initial: () => ({}) }));

bot.use(async (ctx: BotContext, next: NextFunction): Promise<void> => {
  const userId = ctx.from?.id;
  if (!userId) return next();

  try {
    const user = await User.findOne({ telegramId: userId });

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
    const botStatus = (await Settings.get('bot_status')) as boolean;
    if (botStatus === false && !isAdmin(userId)) {
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
  } catch (err: unknown) {
    console.error('[Auth] Middleware error:', err);
    await next();
  }
});

// ─── Commands ──────────────────────────────────────────────────────────────────

bot.command('start', startCommand);
bot.command('admin', adminCommand);
bot.command('invite', inviteCommand);

// ─── Admin Message Interceptors ────────────────────────────────────────────────

bot.on('message', async (ctx, next) => {
  const adminId = ctx.from.id;
  if (!isAdmin(adminId)) return next();

  const text = ctx.message.text ?? '';

  // 1. Broadcast capture
  if (isBroadcastPending(adminId)) {
    return executeBroadcast(ctx);
  }

  // 2. Broadcast button add
  if (isAddBroadcastBtnPending(adminId)) {
    if (text) await handleAddBroadcastButton(ctx, text);
    return;
  }

  // 3. Quota add flow
  if (isQuotaAddPending(adminId)) {
    if (text) await handleQuotaAdd(ctx, text);
    return;
  }

  // 4. Fund campaign setup flow
  if (isFundCampaignPending(adminId)) {
    if (text) await handleFundCampaignStep(ctx, text);
    return;
  }

  // 5. User search
  if (isUserSearchPending(adminId)) {
    const searchId = parseInt(text, 10);
    if (!isNaN(searchId)) {
      return searchUser(ctx, searchId);
    }
  }

  // 6. Content edit
  const editingField = getContentEditPending(adminId);
  if (editingField) {
    if (text) {
      await handleContentEdit(ctx, editingField, text);
      clearContentEditPending(adminId);
      return;
    }
  }

  await next();
});

// ─── Image & Callback Handlers ─────────────────────────────────────────────────

bot.on([':photo', ':document'], imageHandler);
bot.callbackQuery(/.*/, callbackHandler);

// ─── chat_member: Leave / Kick Penalty ────────────────────────────────────────
// Only "left" and "kicked" statuses trigger penalties — spec rule.

bot.on('chat_member', async (ctx) => {
  try {
    const update = ctx.chatMember;
    const newStatus = update.new_chat_member.status;

    if (newStatus !== 'left' && newStatus !== 'kicked') return;

    const userId = update.new_chat_member.user.id;
    const channelId = String(ctx.chat.id);

    await handleMemberLeft(userId, channelId, ctx.api);
  } catch (err: unknown) {
    console.error('[ChatMember] Handler error:', err);
  }
});

// ─── Error Handling ────────────────────────────────────────────────────────────

bot.catch((err) => {
  console.error('[Bot Error]', err);
});

// ─── HTTP Health Check (Render requirement) ────────────────────────────────────

const PORT = process.env.PORT ?? 3000;
const server = http.createServer((_req, res) => {
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
  await closeDatabaseConnection();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  try {
    await connectDatabase();
    await Settings.initDefaults();

    console.log('--- NizoAI Bot is starting ---');
    const botInfo = await bot.api.getMe();
    console.log(`[Bot] ✅ Authenticated as @${botInfo.username}`);

    bot.start({
      allowed_updates: ['message', 'callback_query', 'chat_member'],
      onStart: (info) => {
        console.log(`[Bot] 🚀 Polling started for @${info.username}`);
      },
    });
  } catch (error: unknown) {
    console.error('[Bootstrap] ❌ Fatal error:', error);
    process.exit(1);
  }
}

bootstrap();
