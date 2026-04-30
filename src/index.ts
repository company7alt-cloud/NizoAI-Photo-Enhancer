// src/index.ts
import 'dotenv/config';

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is missing');
if (!process.env.ADMIN_IDS) throw new Error('ADMIN_IDS is missing');
if (!process.env.CHANNEL_ID) throw new Error('CHANNEL_ID is missing');
if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is missing');


import http from 'http';
import { Bot, session, NextFunction, InlineKeyboard } from 'grammy';

import { BotContext, isAdmin } from './utils/validators';
import { connectDatabase, closeDatabaseConnection } from './database/connection';
import { Settings } from './database/models/Settings';
import { User } from './database/models/User';
import { BotSettings } from './database/models/BotSettings';

import { startCommand, inviteCommand } from './bot/commands/start';
import { registerAdminCommands } from './bot/commands/admin';
import { imageHandler } from './bot/handlers/imageHandler';
import { callbackHandler } from './bot/handlers/callbackHandler';

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
        void ctx.answerCallbackQuery({ text: msg, show_alert: true }).catch(() => {});
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
        void ctx.answerCallbackQuery({ text: msg, show_alert: true }).catch(() => {});
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

// ─── /endchat — Admin closes the active support session ───────────────────────

bot.command('endchat', async (ctx) => {
  const telegramId = ctx.from?.id.toString();
  const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
  if (!adminIds.includes(telegramId || '')) return; // admins only

  const activeUser = await User.findOne({
    supportSessionActive: true,
    supportSessionAdminId: telegramId,
  });

  if (activeUser) {
    await User.findOneAndUpdate(
      { telegramId: activeUser.telegramId },
      { $set: { supportSessionActive: false, supportSessionAdminId: null } }
    );
    // Notify user
    await ctx.api.sendMessage(
      activeUser.telegramId,
      `✅ <b>تم إغلاق جلسة الدعم</b>\n\nشكراً لتواصلك معنا 🌹\nنتمنى لك يوماً طيباً 😊`,
      { parse_mode: 'HTML' }
    ).catch(() => {});
  }

  await ctx.reply(
    `🛑 <b>تم إنهاء المحادثة المباشرة مع العميل.</b>`,
    { parse_mode: 'HTML' }
  );
});

// ─── Live Support Interceptor ──────────────────────────────────────────────────

bot.on('message', async (ctx, next) => {
  const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
  const isAdminUser = adminIds.includes(ctx.from?.id.toString() || '');

  if (isAdminUser) {
    const text = ctx.message?.text || ctx.message?.caption || '';

    // ── End session command ─────────────────────────────────────
    if (text === '/endchat' || text === 'اغلق المحادثة') {
      const activeUser = await User.findOne({
        supportSessionActive: true,
        supportSessionAdminId: ctx.from!.id.toString()
      });

      if (activeUser) {
        await User.findOneAndUpdate(
          { telegramId: activeUser.telegramId },
          { $set: { supportSessionActive: false, supportSessionAdminId: null } }
        );
        await ctx.reply('✅ تم إغلاق المحادثة مع العميل.');
        try {
          await ctx.api.sendMessage(
            activeUser.telegramId,
            '🔔 تم إغلاق جلسة الدعم. شكراً لتواصلك معنا 💙'
          );
        } catch (e) {}
      } else {
        await ctx.reply('❌ لا توجد محادثة نشطة حالياً.');
      }
      return;
    }

    // ── Check if admin has active support session ───────────────
    const activeUser = await User.findOne({
      supportSessionActive: true,
      supportSessionAdminId: ctx.from!.id.toString()
    });

    if (activeUser) {
      // Send confirmation AS A REPLY to admin's original message
      // reply_parameters ensures we can copy the exact message later
      await ctx.reply(
        `📤 <b>هل تريد إرسال هذه الرسالة للعميل؟</b>\n\n` +
        `👤 العميل: <code>${activeUser.telegramId}</code>`,
        {
          parse_mode: 'HTML',
          reply_parameters: { message_id: ctx.message!.message_id },
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ نعم، أرسل', callback_data: `confirm_support_send_${activeUser.telegramId}` },
              { text: '❌ لا، إلغاء', callback_data: 'cancel_support_send' }
            ]]
          }
        }
      );
      return;
    }
  }
  return next();
});

bot.on('message:text', async (ctx, next) => {
  const telegramId = ctx.from?.id.toString();
  const user = await User.findOne({ telegramId });
  const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
  const isAdm = adminIds.includes(telegramId || '');
  const messageText = ctx.message?.text || '';

  const { isFundCampaignPending, handleFundCampaignInput, broadcastFundCampaign } =
    await import('./services/channelFundService');

  if (isAdm && isFundCampaignPending(ctx.from!.id)) {
    const result = await handleFundCampaignInput(
      ctx.from!.id,
      ctx.message!.text || '',
      ctx.api
    );

    if (result.status === 'ask_target') {
      await ctx.reply(
        `✅ تم التحقق من صلاحيات البوت في القناة.\n\nكم عدد الأعضاء المطلوب؟ (مثال: 1000)`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: '↩️ رجوع', callback_data: 'cancel_fund_campaign' }]],
          },
        }
      );
    } else if (result.status === 'not_admin_in_channel') {
      await ctx.reply(
        '❌ البوت ليس مشرفاً في هذه القناة. أضفه كمشرف أولاً ثم أعد المحاولة.'
      );
    } else if (result.status === 'done' && 'campaign' in result) {
      const campaign = result.campaign;
      await ctx.reply(
        `✅ تم إنشاء الحملة بنجاح!\n\n` +
        `📢 القناة: ${campaign.channelLink}\n` +
        `🎯 الهدف: ${campaign.targetMembers} عضو\n\n` +
        `⏳ جاري الإذاعة لجميع المستخدمين...`
      );
      const { sent, failed } = await broadcastFundCampaign(ctx.api, campaign);
      const deleteBroadcastKeyboard = new InlineKeyboard()
        .text('🗑 حذف الإذاعة من عند الجميع', `delete_broadcast_${campaign._id}`);
      await ctx.reply(
        `📢 اكتملت إذاعة الحملة!\n✅ نجح: ${sent}\n❌ فشل: ${failed}`,
        { reply_markup: deleteBroadcastKeyboard }
      );
    } else if (result.status === 'invalid_target') {
      await ctx.reply('❌ عدد غير صحيح. أرسل رقماً صحيحاً أكبر من صفر.');
    }
    return;
  }

  // Support tunnel logic moved to global bot.on('message') middleware.

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

// ─── Support Session Media Tunnel ─────────────────────────────────────────────
// Intercepts photos & documents when either side is in an active support
// session — must be registered BEFORE the imageHandler so these messages
// are never fed into the enhancement pipeline.

bot.on([':photo', ':document'], async (ctx, next) => {
  const telegramId = ctx.from?.id.toString();

  // Admin media tunnel moved to global bot.on('message') middleware.

  // ── User → Admin: forward media to the admin who opened the session ──
  const sessionUser = await User.findOne({ telegramId, supportSessionActive: true });
  if (sessionUser?.supportSessionAdminId) {
    try {
      const firstName = ctx.from?.first_name || 'مجهول';
      await ctx.api.sendMessage(
        sessionUser.supportSessionAdminId,
        `💬 <b>رد من العميل (${firstName}):</b>`,
        { parse_mode: 'HTML' }
      );
      await ctx.forwardMessage(sessionUser.supportSessionAdminId);
    } catch (e) {
      console.error('[SupportTunnel] User→Admin media error:', e);
    }
    return; // do NOT fall through to imageHandler
  }

  // No active session — pass through to normal imageHandler
  return next();
});

// ─── Image & Callback Handlers ─────────────────────────────────────────────────

bot.on([':photo', ':document'], imageHandler);
bot.callbackQuery(/.*/, callbackHandler);

// ─── chat_member: Leave / Kick Penalty ────────────────────────────────────────

bot.on('chat_member', async (ctx) => {
  const update = ctx.update.chat_member;
  if (!update) return;

  const newStatus = update.new_chat_member.status;
  const oldStatus = update.old_chat_member.status;
  const userId = update.new_chat_member.user.id;
  const channelId = String(update.chat.id);

  const wasActive = ['member', 'administrator', 'creator'].includes(oldStatus);
  const hasLeft = ['left', 'kicked', 'restricted'].includes(newStatus);

  if (wasActive && hasLeft) {
    const { handleMemberLeft } = await import('./services/channelFundService');
    await handleMemberLeft(userId, channelId, ctx.api);
  }
});

// ─── Error Handling ────────────────────────────────────────────────────────────

bot.catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  // Silently ignore routine Telegram callback timeout — not a real bug
  if (msg.includes('query is too old')) return;
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
