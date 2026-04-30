// src/index.ts
import 'dotenv/config';

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is missing');
if (!process.env.ADMIN_IDS) throw new Error('ADMIN_IDS is missing');
if (!process.env.CHANNEL_ID) throw new Error('CHANNEL_ID is missing');
if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is missing');


import http from 'http';
import { Bot, session, NextFunction } from 'grammy';

import { BotContext, isAdmin } from './utils/validators';
import { connectDatabase, closeDatabaseConnection } from './database/connection';
import { Settings } from './database/models/Settings';
import { User } from './database/models/User';
import { BotSettings } from './database/models/BotSettings';

import { startCommand, inviteCommand } from './bot/commands/start';
import { registerAdminCommands } from './bot/commands/admin';
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
registerAdminCommands(bot);
bot.command('invite', inviteCommand);

// ─── Live Support Interceptor ──────────────────────────────────────────────────

bot.on('message:text', async (ctx, next) => {
  const telegramId = ctx.from?.id.toString();
  const user = await User.findOne({ telegramId });
  const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
  const isAdm = adminIds.includes(telegramId || '');
  const messageText = ctx.message?.text || '';

  if (isAdm && user?.adminAwaitingInput) {
    const inputType = user.adminAwaitingInput;
    const inputText = messageText;

    // Clear the waiting state first
    await User.findOneAndUpdate(
      { telegramId: telegramId },
      { $set: { adminAwaitingInput: null } }
    );

    if (inputType === 'welcome_message') {
      await BotSettings.findOneAndUpdate(
        { key: 'welcome_message' },
        { value: inputText },
        { upsert: true }
      );
      await ctx.reply('✅ تم تحديث رسالة الترحيب بنجاح!');
      return;
    }

    if (inputType === 'daily_reward_amount') {
      const num = parseInt(inputText);
      if (isNaN(num) || num < 1) {
        await ctx.reply('❌ أرسل رقماً صحيحاً أكبر من صفر');
        return;
      }
      await BotSettings.findOneAndUpdate(
        { key: 'daily_reward_amount' },
        { value: inputText },
        { upsert: true }
      );
      await ctx.reply(`✅ تم تحديث المحاولات اليومية إلى ${num} محاولات`);
      return;
    }

    if (inputType === 'low_attempts_warning') {
      await BotSettings.findOneAndUpdate(
        { key: 'low_attempts_warning' },
        { value: inputText },
        { upsert: true }
      );
      await ctx.reply('✅ تم تحديث رسالة انتهاء المحاولات');
      return;
    }

    if (inputType === 'broadcast') {
      const allUsers = await User.find({ isBanned: { $ne: true } });
      let successCount = 0;
      let failCount = 0;
      for (const u of allUsers) {
        try {
          await ctx.api.sendMessage(u.telegramId, inputText);
          successCount++;
        } catch {
          failCount++;
        }
      }
      await ctx.reply(
        `📢 <b>تم إرسال الإشعار</b>\n✅ نجح: ${successCount}\n❌ فشل: ${failCount}`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    if (inputType === 'search_user') {
      const query = inputText.startsWith('@')
        ? { username: inputText.replace('@', '') }
        : { telegramId: inputText };
      const foundUser = await User.findOne(query);
      if (!foundUser) {
        await ctx.reply('❌ المستخدم غير موجود');
        return;
      }
      await ctx.reply(
        `🔍 <b>معلومات المستخدم</b>\n\n` +
        `🆔 ID: <code>${foundUser.telegramId}</code>\n` +
        `👤 Username: @${foundUser.username || 'غير محدد'}\n` +
        `⚡ المحاولات: ${foundUser.dailyQuota}\n` +
        `🚫 محظور: ${foundUser.isBanned ? 'نعم' : 'لا'}\n` +
        `📅 الانضمام: ${new Date(foundUser.joinedAt || Date.now()).toLocaleDateString('ar-SA')}`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🚫 حظر', callback_data: `admin_ban_${foundUser.telegramId}` }],
              [{ text: '🔓 رفع الحظر', callback_data: `admin_unban_${foundUser.telegramId}` }],
              [{ text: '➕ إضافة محاولات', callback_data: `admin_addattempts_${foundUser.telegramId}` }],
            ],
          },
        }
      );
      return;
    }
  }

  // ── إغلاق المحادثة (من الأدمن) ──
  if (isAdm && messageText === 'اغلق المحادثة') {
    // Find the active support session this admin has open
    const activeUser = await User.findOne({
      supportSessionActive: true,
      supportSessionAdminId: telegramId,
    });

    if (activeUser) {
      await User.findOneAndUpdate(
        { telegramId: activeUser.telegramId },
        { $set: { supportSessionActive: false, supportSessionAdminId: null } }
      );

      // Notify admin
      await ctx.reply('✅ تم إغلاق المحادثة');

      // Notify user
      await ctx.api.sendMessage(
        activeUser.telegramId,
        `✅ <b>تم إغلاق جلسة الدعم</b>\n\nشكراً لتواصلك معنا 🌹\nسوف يتم حل مشكلتك قريباً.\nنتمنى لك يوماً طيباً 😊`,
        { parse_mode: 'HTML' }
      );
    } else {
      await ctx.reply('⚠️ لا توجد جلسة دعم مفتوحة حالياً');
    }
    return;
  }

  // ── رسائل الأدمن تروح للعميل ──
  if (isAdm) {
    const activeUser = await User.findOne({
      supportSessionActive: true,
      supportSessionAdminId: telegramId,
    });
    if (activeUser) {
      await ctx.api.sendMessage(
        activeUser.telegramId,
        `💬 <b>المطور:</b> ${messageText}`,
        { parse_mode: 'HTML' }
      );
      return;
    }
  }

  // ── رسائل العميل تروح للأدمن ──
  if (user?.supportSessionActive && user.supportSessionAdminId) {
    await ctx.api.sendMessage(
      user.supportSessionAdminId,
      `💬 <b>العميل (${ctx.from?.first_name || 'مجهول'}):</b> ${messageText}`,
      { parse_mode: 'HTML' }
    );
    return; // Stop — don't process as image or command
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
      drop_pending_updates: true,
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
