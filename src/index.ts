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


import { startCommand, inviteCommand } from './bot/commands/start';
import { registerAdminCommands } from './bot/commands/admin';
import { imageHandler } from './bot/handlers/imageHandler';
import { callbackHandler } from './bot/handlers/callbackHandler';
import { forceSubMiddleware } from './bot/middlewares/forceSubMiddleware';
import { ForceSubChannel } from './database/models/ForceSubChannel';
import { initBotTexts } from './services/botTextsService';

// ─── Bot Instance ──────────────────────────────────────────────────────────────

const bot = new Bot<BotContext>(process.env.BOT_TOKEN);

// ─── Middlewares ───────────────────────────────────────────────────────────────

bot.use(forceSubMiddleware);
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

bot.on('message:text', async (ctx, next) => {
  const telegramId = ctx.from?.id.toString();
  const user = await User.findOne({ telegramId });
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

    const targetUser = await User.findOne({ telegramId: targetId });
    if (!targetUser) {
      await ctx.reply('❌ لم يتم العثور على مستخدم بهذا الـ ID.');
      return;
    }

    await User.findOneAndUpdate({ telegramId: targetId }, { $set: { vipSizeBypass: true } });
    await ctx.reply(`✅ <b>تم تفعيل VIP!</b>\nالمستخدم (<code>${targetId}</code>) يمكنه الآن رفع صور بحجم 15 ميجابايت.`, { parse_mode: 'HTML' });
    
    try {
      await ctx.api.sendMessage(targetId, '🌟 <b>تم ترقية حسابك (VIP)</b>\n\nبناءً على طلبك، تم فتح الحد الأقصى للممحاة السحرية. يمكنك الآن إرسال صور بحجم يصل إلى <b>15 ميجابايت</b>! 😎', { parse_mode: 'HTML' });
    } catch (e) {}
    
    return;
  }

  // 1. Admin Commands (Priority 1)
  if (isAdm && (messageText === '/endchat' || messageText === 'قفل المحادثة' || messageText === 'اغلق المحادثة')) {
    const activeUser = await User.findOne({
      supportSessionActive: true,
      supportSessionAdminId: telegramId
    });

    if (activeUser) {
      await User.findOneAndUpdate(
        { telegramId: activeUser.telegramId },
        { $set: { supportSessionActive: false, supportSessionAdminId: null } }
      );
      await ctx.reply(`✅ <b>تم إنهاء المحادثة المباشرة مع العميل.</b>`, { parse_mode: 'HTML' });
      try {
        await ctx.api.sendMessage(activeUser.telegramId, '🔔 تم إغلاق جلسة الدعم. شكراً لتواصلك معنا 💙');
      } catch (e) {}
    } else {
      await ctx.reply('❌ لا توجد محادثة نشطة حالياً لإغلاقها.');
    }
    return;
  }

  const adminInputUser = await User.findOne({ telegramId: ctx.from?.id.toString() });
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
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: null } }
    );
    const result = await User.updateMany({}, { $inc: { dailyQuota: amount } });
    
    // Notify users safely
    const allUsers = await User.find({}).select('telegramId').lean();
    let notified = 0;
    for (const u of allUsers) {
      try {
        await ctx.api.sendMessage(
          u.telegramId,
          `🎁 <b>هدية من المطور!</b>\n\nتم إضافة <b>${amount}</b> محاولات مجانية لرصيدك 🚀\nنتمنى لك تجربة ممتعة ومميزة 💎✨`,
          { parse_mode: 'HTML' }
        );
        notified++;
      } catch (e) {}
      if (notified % 25 === 0) await new Promise(r => setTimeout(r, 1000));
    }
    await ctx.reply(`✅ تمت إضافة ${amount} محاولات لـ ${result.modifiedCount} مستخدم\n📢 تم إشعار ${notified} مستخدم`);
    return;
  }

  // ── attempts_add_one_id: waiting for user ID ──
  if (adminInput === 'attempts_add_one_id' && isAdminMsg) {
    const targetUser = await User.findOne({ telegramId: text });
    if (!targetUser) {
      await ctx.reply('❌ المستخدم غير موجود. تأكد من الـ ID وأعد الإرسال.');
      return;
    }
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: 'attempts_add_one_amount', adminTargetUserId: text } }
    );
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
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: null, adminTargetUserId: null } }
    );
    await User.findOneAndUpdate({ telegramId: targetId }, { $inc: { dailyQuota: amount } });
    try {
      await ctx.api.sendMessage(
        targetId!,
        `🎁 <b>مفاجأة من المطور!</b>\n\nتم إضافة <b>${amount}</b> محاولات مجانية لرصيدك الشخصي 🌟\nهذه مكافأة خاصة لك تقديراً لحسن تعاملك مع البوت 💙`,
        { parse_mode: 'HTML' }
      );
    } catch (e) {}
    await ctx.reply(`✅ تمت إضافة ${amount} محاولات للمستخدم <code>${targetId}</code> وتم إشعاره`, { parse_mode: 'HTML' });
    return;
  }

  // ── attempts_remove_one_id: waiting for user ID ──
  if (adminInput === 'attempts_remove_one_id' && isAdminMsg) {
    const targetUser = await User.findOne({ telegramId: text });
    if (!targetUser) {
      await ctx.reply('❌ المستخدم غير موجود.');
      return;
    }
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: 'attempts_remove_one_amount', adminTargetUserId: text } }
    );
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
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: null, adminTargetUserId: null } }
    );
    
    // Smart subtraction pipeline: prevents negative quota
    await User.findOneAndUpdate(
      { telegramId: targetId },
      [{ $set: { dailyQuota: { $max: [0, { $subtract: ["$dailyQuota", amount] }] } } }]
    );
    await ctx.reply(`✅ تم خصم ${amount} محاولات من المستخدم <code>${targetId}</code> (الرصيد لا ينزل تحت الصفر)`, { parse_mode: 'HTML' });
    return;
  }

  // ── attempts_reset_one_id: waiting for user ID ──
  if (adminInput === 'attempts_reset_one_id' && isAdminMsg) {
    const targetUser = await User.findOne({ telegramId: text });
    if (!targetUser) {
      await ctx.reply('❌ المستخدم غير موجود.');
      return;
    }
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: null, adminTargetUserId: null } }
    );
    await User.findOneAndUpdate({ telegramId: text }, { $set: { dailyQuota: 0 } });
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
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: 'magic_link_maxuses', adminTargetUserId: reward.toString() } }
    );
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

    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: null, adminTargetUserId: null } }
    );

    // Generate unique code & Expiration Date (24 Hours)
    const { v4: uuidv4 } = await import('uuid');
    const code = uuidv4().substring(0, 8).toUpperCase();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const { MagicLink } = await import('./database/models/MagicLink');
    await MagicLink.create({ code, reward, maxUses, currentUses: 0, usedBy: [], isActive: true, expiresAt });

    const botUsername = (await ctx.api.getMe()).username;
    const magicLinkUrl = `https://t.me/${botUsername}?start=magic_${code}`;

    await ctx.reply(
      `✅ <b>تم إنشاء رابط المكافأة بنجاح!</b>\n\n` +
      `🔗 <b>الرابط:</b>\n<code>${magicLinkUrl}</code>\n\n` +
      `🎁 <b>المكافأة:</b> ${reward} محاولات لكل شخص\n` +
      `👥 <b>الحد الأقصى:</b> ${maxUses} شخص\n` +
      `⏳ <b>الصلاحية:</b> 24 ساعة فقط\n` +
      `📊 <b>الكود:</b> <code>${code}</code>\n\n` +
      `⚠️ الرابط سيتوقف تلقائياً بعد استخدامه ${maxUses} مرة أو بعد مرور 24 ساعة.`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  // ── add_fsub_input: waiting for channel data (CHANNEL_ID | URL | NAME) ──
  if (adminInput === 'add_fsub_input' && isAdminMsg) {
    const parts = text.split('|').map((s) => s.trim());

    if (parts.length !== 3) {
      await ctx.reply(
        '❌ صيغة خاطئة. أرسل هكذا:\n' +
        '<code>CHANNEL_ID | CHANNEL_URL | CHANNEL_NAME</code>',
        { parse_mode: 'HTML' }
      );
      return;
    }

    const [channelId, channelUrl, channelName] = parts;

    // Verify bot is admin in the channel before accepting
    try {
      const botInfo   = await ctx.api.getMe();
      const botMember = await ctx.api.getChatMember(channelId, botInfo.id);

      if (!['administrator', 'creator'].includes(botMember.status)) {
        await ctx.reply(
          '❌ البوت ليس مشرفاً في هذه القناة.\n' +
          'أضفه كمشرف أولاً ثم أرسل البيانات مجدداً.'
        );
        return;
      }
    } catch {
      await ctx.reply(
        '❌ تعذر الوصول للقناة. تأكد من:\n' +
        '1. صحة الـ ID (يبدأ بـ -100...)\n' +
        '2. أن البوت مشرف فيها'
      );
      return;
    }

    const { ForceSubChannel } = await import('./database/models/ForceSubChannel');
    const count = await ForceSubChannel.countDocuments();

    if (count >= 10) {
      await ctx.reply('❌ وصلت للحد الأقصى (10 قنوات).');
      await User.findOneAndUpdate(
        { telegramId: telegramId },
        { $set: { adminAwaitingInput: null } }
      );
      return;
    }

    const existing = await ForceSubChannel.findOne({ channelId });
    if (existing) {
      await ctx.reply('❌ هذه القناة مضافة مسبقاً.');
      await User.findOneAndUpdate(
        { telegramId: telegramId },
        { $set: { adminAwaitingInput: null } }
      );
      return;
    }

    await ForceSubChannel.create({
      channelId,
      channelUrl,
      channelName,
      order: count,
    });

    await User.findOneAndUpdate(
      { telegramId: telegramId },
      { $set: { adminAwaitingInput: null } }
    );

    await ctx.reply(
      `✅ تم إضافة القناة بنجاح!\n\n` +
      `📢 ${channelName}\n` +
      `🆔 ${channelId}\n\n` +
      'ستظهر الآن للعملاء ضمن شرط الاشتراك الإجباري.'
    );
    return;
  }

  // 2. Admin Awaiting Input Logic (Priority 2 - Kept exactly as original)
  if (isAdm && user?.adminAwaitingInput) {
    const inputType = user.adminAwaitingInput;
    const inputText = messageText;

    await User.findOneAndUpdate({ telegramId: telegramId }, { $set: { adminAwaitingInput: null } });

    if (inputType.startsWith('txtedit:')) {
      const key = inputType.replace('txtedit:', '');
      const newValue = inputText.trim();

      if (!newValue || newValue === '/cancel') {
        await ctx.reply('❌ تم الإلغاء.');
        return;
      }

      const { updateText, getText } = await import('./services/botTextsService');
      const oldValue = await getText(key);
      const success = await updateText(key, newValue);

      if (success) {
        await ctx.reply(
          `✅ <b>تم التحديث بنجاح!</b>\n\n` +
          `🔑 المفتاح: <code>${key}</code>\n\n` +
          `📝 <b>النص القديم:</b>\n<code>${oldValue.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</code>\n\n` +
          `✨ <b>النص الجديد:</b>\n<code>${newValue.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</code>`,
          { parse_mode: 'HTML' }
        );
      } else {
        await ctx.reply(
          '❌ فشل التحديث.\n' +
          `المفتاح <code>${key}</code> غير موجود في قاعدة البيانات.`,
          { parse_mode: 'HTML' }
        );
      }
      return;
    }

    if (inputType === 'welcome_message') {
      const { BotSettings } = await import('./database/models/BotSettings');
      await BotSettings.findOneAndUpdate({ key: 'welcome_message' }, { value: inputText }, { upsert: true });
      await ctx.reply('✅ تم تحديث رسالة الترحيب بنجاح!');
      return;
    }

    if (inputType === 'convert_button_message') {
      const { BotSettings } = await import('./database/models/BotSettings');
      await BotSettings.findOneAndUpdate(
        { key: 'convert_button_message' },
        { value: inputText },
        { upsert: true }
      );
      await ctx.reply('✅ تم تحديث رسالة زر تحويل الصيغة!');
      return;
    }

    if (inputType === 'daily_reward_amount') {
      const { BotSettings } = await import('./database/models/BotSettings');
      const num = parseInt(inputText);
      if (isNaN(num) || num < 1) { await ctx.reply('❌ أرسل رقماً صحيحاً أكبر من صفر'); return; }
      await BotSettings.findOneAndUpdate({ key: 'daily_reward_amount' }, { value: inputText }, { upsert: true });
      await ctx.reply(`✅ تم تحديث المحاولات اليومية إلى ${num} محاولات`);
      return;
    }

    if (inputType === 'low_attempts_warning') {
      const { BotSettings } = await import('./database/models/BotSettings');
      await BotSettings.findOneAndUpdate({ key: 'low_attempts_warning' }, { value: inputText }, { upsert: true });
      await ctx.reply('✅ تم تحديث رسالة انتهاء المحاولات');
      return;
    }

    if (inputType === 'broadcast') {
      const allUsers = await User.find({ isBanned: { $ne: true } });
      let successCount = 0; let failCount = 0;
      for (const u of allUsers) {
        try { await ctx.api.sendMessage(u.telegramId, inputText); successCount++; } catch { failCount++; }
      }
      await ctx.reply(`📢 <b>تم إرسال الإشعار</b>\n✅ نجح: ${successCount}\n❌ فشل: ${failCount}`, { parse_mode: 'HTML' });
      return;
    }

    if (inputType === 'search_user') {
      const query = inputText.startsWith('@') ? { username: inputText.replace('@', '') } : { telegramId: inputText };
      const foundUser = await User.findOne(query);
      if (!foundUser) { await ctx.reply('❌ المستخدم غير موجود'); return; }
      await ctx.reply(
        `🔍 <b>معلومات المستخدم</b>\n\n🆔 ID: <code>${foundUser.telegramId}</code>\n👤 Username: @${foundUser.username || 'غير محدد'}\n⚡ المحاولات: ${foundUser.dailyQuota}\n🚫 محظور: ${foundUser.isBanned ? 'نعم' : 'لا'}`,
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
    if (inputType === 'vip_size_bypass') {
      const targetUser = await User.findOne({ telegramId: inputText.trim() });
      if (!targetUser) {
        await ctx.reply('❌ لم يتم العثور على مستخدم بهذا الـ ID.');
        return;
      }
      await User.findOneAndUpdate({ telegramId: targetUser.telegramId }, { $set: { vipSizeBypass: true } });
      await ctx.reply(`✅ <b>تم التفعيل!</b>\nالمستخدم (<code>${targetUser.telegramId}</code>) يستطيع الآن إرسال صور بحجم يصل إلى 15 ميجابايت 🌟`, { parse_mode: 'HTML' });
      try {
        await ctx.api.sendMessage(targetUser.telegramId, '🌟 <b>تم ترقية حسابك (VIP)</b>\n\nبناءً على طلبك، تم فتح الحد الأقصى للممحاة السحرية. يمكنك الآن إرسال صور بحجم يصل إلى <b>15 ميجابايت</b>! 😎', { parse_mode: 'HTML' });
      } catch (e) {}
      return;
    }
  }

  // 3. Fund Campaign Logic (Priority 3 - Kept exactly as original)
  const { isFundCampaignPending, handleFundCampaignInput, broadcastFundCampaign } = await import('./services/channelFundService');
  if (isAdm && isFundCampaignPending(ctx.from!.id)) {
    const result = await handleFundCampaignInput(ctx.from!.id, ctx.message!.text || '', ctx.api);
    if (result.status === 'ask_target') {
      await ctx.reply(`✅ تم التحقق من صلاحيات البوت.\n\nكم عدد الأعضاء المطلوب؟`, { reply_markup: { inline_keyboard: [[{ text: '↩️ رجوع', callback_data: 'cancel_fund_campaign' }]] } });
    } else if (result.status === 'not_admin_in_channel') {
      await ctx.reply('❌ البوت ليس مشرفاً في هذه القناة. أضفه كمشرف أولاً ثم أعد المحاولة.');
    } else if (result.status === 'done' && 'campaign' in result) {
      const campaign = result.campaign;
      await ctx.reply(`✅ تم إنشاء الحملة بنجاح!\n\n📢 القناة: ${campaign.channelLink}\n🎯 الهدف: ${campaign.targetMembers} عضو\n\n⏳ جاري الإذاعة...`);
      const { sent, failed } = await broadcastFundCampaign(ctx.api, campaign);
      const { InlineKeyboard } = await import('grammy');
      const deleteBroadcastKeyboard = new InlineKeyboard().text('🗑 حذف الإذاعة', `delete_broadcast_${campaign._id}`);
      await ctx.reply(`📢 اكتملت الإذاعة!\n✅ نجح: ${sent}\n❌ فشل: ${failed}`, { reply_markup: deleteBroadcastKeyboard });
    } else if (result.status === 'invalid_target') {
      await ctx.reply('❌ عدد غير صحيح.');
    }
    return;
  }

  // 4. Strict Admin -> User Support Routing (Admin is sending a message during an active session)
  if (isAdm) {
    const activeUser = await User.findOne({
      supportSessionActive: true,
      supportSessionAdminId: telegramId
    });

    if (activeUser) {
      // Admin is in a session, intercept this message and ask for confirmation.
      await ctx.reply(
        `📤 <b>هل أنت متأكد من إرسال هذا الرد للعميل؟</b>\n\n` +
        `👤 <b>معرف العميل:</b> <code>${activeUser.telegramId}</code>\n` +
        `⚠️ <i>إذا لم تقصد الرد عليه، قم بقفل المحادثة أولاً (أرسل: قفل المحادثة)</i>`,
        {
          parse_mode: 'HTML',
          reply_parameters: { message_id: ctx.message!.message_id },
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ نعم، أرسل للعميل', callback_data: `confirm_support_send_${activeUser.telegramId}` },
              { text: '❌ لا، إلغاء الإرسال', callback_data: 'cancel_support_send' }
            ]]
          }
        }
      );
      return; // Do not process further
    }
  }

  // 5. Strict User -> Admin Support Routing (User is sending a message during an active session)
  if (user?.supportSessionActive && user.supportSessionAdminId) {
    await ctx.api.sendMessage(
      user.supportSessionAdminId,
      `💬 <b>رد من العميل (${ctx.from?.first_name || 'مجهول'} | <code>${telegramId}</code>):</b>\n\n${messageText}`,
      { parse_mode: 'HTML' }
    );
    return; // Stop — don't process as standard message
  }

  // ── Report interceptor for text messages ──
  if (user?.awaitingReport) {
    await User.findOneAndUpdate({ telegramId }, { $set: { awaitingReport: false } });

    const messageId = ctx.message?.message_id;
    const chatId = ctx.chat?.id;

    if (messageId && chatId) {
      await ctx.reply(
        '📤 <b>هل تريد مشاركة هذا البلاغ مع مطور البوت؟</b>\n\n' +
        'سيتم إرسال رسالتك للمطور مباشرة وسيتم الرد عليك في أقرب وقت 💙',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ نعم، أرسل البلاغ', callback_data: `confirm_report_${chatId}_${messageId}` },
                { text: '❌ لا، إلغاء', callback_data: 'cancel_report_confirm' },
              ],
            ],
          },
        }
      );
    }
    return;
  }

  await next();
});

// ─── Support Session Media Tunnel ─────────────────────────────────────────────
// Intercepts photos & documents when either side is in an active support
// session — must be registered BEFORE the imageHandler so these messages
// are never fed into the enhancement pipeline.

bot.on([':photo', ':document'], async (ctx, next) => {
  const telegramId = ctx.from?.id.toString();
  const user = await User.findOne({ telegramId });
  const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
  const isAdm = adminIds.includes(telegramId || '');

  // 1. Admin -> User (Confirm media sending)
  if (isAdm) {
    const activeUser = await User.findOne({
      supportSessionActive: true,
      supportSessionAdminId: telegramId
    });

    if (activeUser) {
      await ctx.reply(
        `📤 <b>هل تريد إرسال هذا الملف/الصورة للعميل؟</b>\n\n` +
        `👤 <b>معرف العميل:</b> <code>${activeUser.telegramId}</code>`,
        {
          parse_mode: 'HTML',
          reply_parameters: { message_id: ctx.message!.message_id },
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ نعم، أرسل الملف', callback_data: `confirm_support_send_${activeUser.telegramId}` },
              { text: '❌ لا، إلغاء', callback_data: 'cancel_support_send' }
            ]]
          }
        }
      );
      return; // Stop processing, do not send to imageHandler
    }
  }

  // ── Report interceptor for photos and documents ──
  if (user?.awaitingReport) {
    await User.findOneAndUpdate({ telegramId }, { $set: { awaitingReport: false } });

    const messageId = ctx.message?.message_id;
    const chatId = ctx.chat?.id;

    if (messageId && chatId) {
      await ctx.reply(
        '📤 <b>هل تريد مشاركة هذا البلاغ مع مطور البوت؟</b>\n\n' +
        'سيتم إرسال رسالتك للمطور مباشرة وسيتم الرد عليك في أقرب وقت 💙',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ نعم، أرسل البلاغ', callback_data: `confirm_report_${chatId}_${messageId}` },
                { text: '❌ لا، إلغاء', callback_data: 'cancel_report_confirm' },
              ],
            ],
          },
        }
      );
      return; // STOP — do not pass to imageHandler
    }
  }

  // 2. User -> Admin (Direct forward)
  if (user?.supportSessionActive && user.supportSessionAdminId) {
    try {
      const firstName = ctx.from?.first_name || 'مجهول';
      await ctx.api.sendMessage(
        user.supportSessionAdminId,
        `💬 <b>ملف من العميل (${firstName} | <code>${telegramId}</code>):</b>`,
        { parse_mode: 'HTML' }
      );
      await ctx.forwardMessage(user.supportSessionAdminId);
    } catch (e) {
      console.error('[SupportTunnel] User→Admin media error:', e);
    }
    return; // Stop processing, do not send to imageHandler
  }

  // If no support session is active, pass media to the image processing AI
  return next();
});

// ─── Image & Callback Handlers ─────────────────────────────────────────────────

bot.on([':photo', ':document'], imageHandler);
bot.callbackQuery(/.*/, callbackHandler);

// ─── chat_member: Leave / Kick Penalty + Force-Sub Clawback ───────────────────

bot.on('chat_member', async (ctx) => {
  const update = ctx.update.chat_member;
  if (!update) return;

  const newStatus = update.new_chat_member.status;
  const oldStatus = update.old_chat_member.status;
  const userId    = update.new_chat_member.user.id;
  const channelId = String(update.chat.id);

  // ── Existing fund-campaign penalty ──────────────────────────────────────────
  const wasActive = ['member', 'administrator', 'creator'].includes(oldStatus);
  const hasLeft   = ['left', 'kicked', 'restricted'].includes(newStatus);

  if (wasActive && hasLeft) {
    const { handleMemberLeft } = await import('./services/channelFundService');
    await handleMemberLeft(userId, channelId, ctx.api);
  }

  // ── Referral Clawback: user leaves a force-sub channel ──────────────────────
  try {
    if (newStatus !== 'left' && newStatus !== 'kicked') return;

    const isForceSubChannel = await ForceSubChannel.findOne({ channelId });
    if (!isForceSubChannel) return;

    const fleeingUser = await User.findOne({ telegramId: userId });

    if (
      fleeingUser?.referredBy != null &&
      fleeingUser.referralRewardClaimed === true
    ) {
      const REFERRAL_REWARD = 5; // same amount given in start.ts referral block
      const POINTS_FIELD    = 'dailyQuota'; // exact field from User model

      await User.findOneAndUpdate(
        { telegramId: fleeingUser.referredBy },
        { $inc: { [POINTS_FIELD]: -REFERRAL_REWARD } }
      );

      await User.findOneAndUpdate(
        { telegramId: userId },
        { $set: { referralRewardClaimed: false } }
      );

      console.log(
        `[Clawback] ${userId} left force-sub channel. ` +
        `Clawed back ${REFERRAL_REWARD} pts from referrer ${fleeingUser.referredBy}`
      );

      try {
        await ctx.api.sendMessage(
          fleeingUser.referredBy,
          `⚠️ تم خصم ${REFERRAL_REWARD} نقطة من رصيدك لأن ` +
          'الشخص الذي دعوته غادر إحدى قنوات البوت الإجبارية.'
        );
      } catch { /* referrer may have blocked bot */ }
    }
  } catch (err) {
    console.error('[Clawback chat_member]', err);
  }
});

// ─── my_chat_member: User blocks the bot — Referral Clawback ──────────────────

bot.on('my_chat_member', async (ctx) => {
  try {
    const newStatus = ctx.myChatMember.new_chat_member.status;
    if (newStatus !== 'kicked') return;

    const fleeingUserId = ctx.from.id;
    const fleeingUser   = await User.findOne({ telegramId: fleeingUserId });

    if (
      fleeingUser?.referredBy != null &&
      fleeingUser.referralRewardClaimed === true
    ) {
      const REFERRAL_REWARD = 5; // same amount given in start.ts referral block
      const POINTS_FIELD    = 'dailyQuota'; // exact field from User model

      await User.findOneAndUpdate(
        { telegramId: fleeingUser.referredBy },
        { $inc: { [POINTS_FIELD]: -REFERRAL_REWARD } }
      );

      await User.findOneAndUpdate(
        { telegramId: fleeingUserId },
        { $set: { referralRewardClaimed: false } }
      );

      console.log(
        `[Clawback] ${fleeingUserId} blocked bot. ` +
        `Clawed back ${REFERRAL_REWARD} pts from referrer ${fleeingUser.referredBy}`
      );

      try {
        await ctx.api.sendMessage(
          fleeingUser.referredBy,
          `⚠️ تم خصم ${REFERRAL_REWARD} نقطة من رصيدك لأن ` +
          'الشخص الذي دعوته قام بحظر البوت.'
        );
      } catch { /* referrer may have blocked bot */ }
    }
  } catch (err) {
    console.error('[Clawback my_chat_member]', err);
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
  try {
    await bot.stop();
    console.log('[Bot] Polling stopped gracefully.');
  } catch (err) {
    console.error('[Bot] Error stopping bot:', err);
  }
  await closeDatabaseConnection();
  process.exit(0);
};

process.removeAllListeners('SIGTERM');
process.removeAllListeners('SIGINT');
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  try {
    await connectDatabase();
    await Settings.initDefaults();
    await initBotTexts();

    console.log('--- NizoAI Bot is starting ---');
    const botInfo = await bot.api.getMe();
    console.log(`[Bot] ✅ Authenticated as @${botInfo.username}`);

    bot.start({
      allowed_updates: [
        'message',
        'callback_query',
        'chat_member',
        'my_chat_member',
      ],
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
