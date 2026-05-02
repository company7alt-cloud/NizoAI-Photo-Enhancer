// src/bot/handlers/callbackHandler.ts
import { InputFile } from 'grammy';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { User } from '../../database/models/User';
import { BotContext, isAdmin } from '../../utils/validators';
import * as imageService from '../../services/imageService';
import { sendAdminAlert } from '../../utils/adminAlert';
import { BotSettings } from '../../database/models/BotSettings';
import {
  startFundCampaignSetup,
  clearFundCampaignState,
  claimChannelReward,
} from '../../services/channelFundService';
import { FundCampaign } from '../../database/models/FundCampaign';
import { getSettings, toggleLock } from '../../services/settingsService';

const ARCHIVE_GROUP_ID = process.env.ARCHIVE_GROUP_ID ?? '';
const CHANNEL_ID = process.env.CHANNEL_ID ?? '';
const BACKUP_CHANNEL_ID = ARCHIVE_GROUP_ID || CHANNEL_ID;

export async function callbackHandler(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data || !ctx.from) return;

  const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
  const isAdminUser = adminIds.includes(ctx.from!.id.toString());
  const settings = await getSettings();
  const locks = settings.locks;

  const lockMap: Record<string, boolean> = {
    'enhance_2k': locks.btn_2k,
    'enhance_4k': locks.btn_4k,
    'locked_8k': locks.btn_8k,
    'process_4k_ai': locks.btn_4kai,
    'locked_8k_ai': locks.btn_8kai,
    'nano_banana_start': locks.btn_nano,
  };

  if (!isAdminUser && lockMap[data] === true) {
    await ctx.answerCallbackQuery({
      text: 'عذراً، هذا الزر مقفل حالياً للصيانة 🔒',
      show_alert: true
    }).catch(() => {});
    return;
  }

  // Admin callbacks are now handled at the bottom of this file

  // ── STEP 1: Fetch FRESH user ──────────────────────────────────────────────────
  let user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) {
    user = await User.create({
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
    }).catch(() => {});
    return;
  }

  // ── STEP 3: Auto-reset logic removed. User MUST click daily reward button. ──

  // ── STEP 4: Admin flag ────────────────────────────────────────────────────────
  const admin = isAdmin(ctx.from.id);

  // ── STEP 5: Locked 8K ─────────────────────────────────────────────────────────
  if (data === 'locked_8k') {
    void ctx.answerCallbackQuery({
      text: '🔒 هذه الميزة مقفلة حالياً 💫\nتواصل مع المطور لفتح ميزة الـ 8K ✨',
      show_alert: true,
    }).catch(() => {});
    return;
  }

  if (data === 'locked_4k') {
    void ctx.answerCallbackQuery({
      text: '🔒 هذه الميزة مقفلة حالياً 💫\nتواصل مع المطور لفتح الميزة ✨',
      show_alert: true,
    }).catch(() => {});
    return;
  }

  // ── Helper: get Telegram file URL from session ────────────────────────────────
  const pendingFile = ctx.session.pendingFile;
  const getTelegramFileUrl = async (): Promise<string | null> => {
    if (!pendingFile?.fileId) return null;
    const tgFile = await ctx.api.getFile(pendingFile.fileId);
    if (!tgFile.file_path) return null;
    return `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;
  };

  // ── Helper: forward result to public channel ──────────────────────────────────
  const forwardToChannel = async (
    buf: Buffer,
    fileName: string,
    resolution: string,
    jobId: string
  ): Promise<void> => {
    if (!BACKUP_CHANNEL_ID) return;

    const actionUser = ctx.from;
    const userLink = actionUser?.username
      ? `@${actionUser.username}`
      : `<a href="tg://user?id=${actionUser?.id}">${actionUser?.first_name || 'مجهول'}</a>`;

    const caption =
      `📦 <b>نسخة أرشيفية</b>\n` +
      `━━━━━━━━━━━━━━\n` +
      `🆔 <b>User ID:</b> <code>${actionUser?.id}</code>\n` +
      `👤 <b>Username:</b> ${userLink}\n` +
      `🏷 <b>Job ID:</b> <code>${jobId}</code>\n` +
      `💎 <b>Resolution:</b> ${resolution}\n` +
      `📅 <b>Time:</b> ${new Date().toLocaleString('ar-SA')}\n` +
      `━━━━━━━━━━━━━━`;

    try {
      await ctx.api.sendDocument(
        BACKUP_CHANNEL_ID,
        new InputFile(buf, fileName),
        {
          disable_notification: true,
          caption: caption,
          parse_mode: 'HTML',
        }
      );
    } catch (fwdErr: unknown) {
      console.error('[Archive Error]', fwdErr);
    }
  };

  // ── STEP 6: enhance_2k ───────────────────────────────────────────────────────
  if (data === 'enhance_2k') {
    const resolution = '2K';
    await ctx.answerCallbackQuery().catch(() => {});

    if (resolution !== '2K') {
      if (!admin && user.dailyQuota < 1) {
        await ctx.reply(
          '🌙 أوه! انتهت محاولاتك اليومية 🥺\nعد غداً وستجد 5 محاولات جديدة بانتظارك 🎁✨'
        );
        return;
      }
    }

    const telegramFileUrl = await getTelegramFileUrl();
    if (!telegramFileUrl) {
      await ctx.reply('❌ انتهت الجلسة. أرسل الصورة مجدداً.');
      return;
    }

    if (resolution !== '2K') {
      if (!admin) {
        user.dailyQuota -= 1;
        await user.save();
      }
    }

    const jobId = uuidv4().substring(0, 8).toUpperCase();
    await ctx.editMessageText('⏳ جاري تحسين صورتك بدقة 2K...\nالرجاء الانتظار لحظات 🌟');
    ctx.session.pendingFile = undefined;

    try {
      const resultBuffer = await imageService.enhance(telegramFileUrl, '2K');
      user.totalEnhancements += 1;
      await user.save();

      const outputFileName = `NizoAI_2K_${jobId}.jpg`;

      await ctx.replyWithDocument(new InputFile(resultBuffer, outputFileName), {
        caption: `🎉 صورتك جاهزة بدقة 2K! 🌟\n🏷 Job ID: ${jobId}\n⚡ محاولاتك المتبقية: ${user.dailyQuota}`,
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🖼 PNG', callback_data: 'conv_png' },
              { text: '🖼 JPG', callback_data: 'conv_jpg' },
              { text: '🖼 WEBP', callback_data: 'conv_webp' },
            ],
            [
              { text: '🖼 AVIF', callback_data: 'conv_avif' },
              { text: '🖼 TIFF', callback_data: 'conv_tiff' },
            ],
          ],
        },
      });
      await ctx.deleteMessage().catch(() => { });

      // Forward to channel (silent — never affects user)
      void forwardToChannel(resultBuffer, outputFileName, '2K', jobId);
    } catch {
      if (resolution !== '2K') {
        if (!admin) {
          user.dailyQuota += 1;
          await user.save();
        }
      }
      await ctx.deleteMessage().catch(() => { });
      await ctx.reply(
        '😔 عذراً حدث خطأ أثناء معالجة صورتك 🌸\nتم إعادة محاولتك تلقائياً ✨\nجرب مرة أخرى وسنكون معك 💙'
      );
    }
    return;
  }

  // ── STEP 7: enhance_4k ───────────────────────────────────────────────────────
  if (data === 'enhance_4k') {
    await ctx.answerCallbackQuery().catch(() => {});

    if (!admin && user.dailyQuota < 2) {
      await ctx.reply(
        `💫 تحتاج محاولتين لدقة 4K الفائقة 🌟\nرصيدك الحالي: ${user.dailyQuota} محاولة 🥺\nاستخدم دقة 2K أو عد غداً لـ 5 محاولات جديدة 🎁`
      );
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

    const jobId = uuidv4().substring(0, 8).toUpperCase();
    await ctx.editMessageText(
      '⚙️ جاري المعالجة بدقة 4K الفائقة ✨\nهذه العملية تستهلك محاولتين من رصيدك 💎\nالرجاء الانتظار، قد تستغرق دقيقة أو أكثر 🌸'
    );
    ctx.session.pendingFile = undefined;

    try {
      const resultBuffer = await imageService.enhance(telegramFileUrl, '4K');
      user.totalEnhancements += 1;
      await user.save();

      const outputFileName = `NizoAI_4K_${jobId}.jpg`;

      await ctx.replyWithDocument(new InputFile(resultBuffer, outputFileName), {
        caption: `💎 صورتك جاهزة بدقة 4K الفائقة! ✨\n🏷 Job ID: ${jobId}\n⚡ محاولاتك المتبقية: ${user.dailyQuota}`,
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🖼 PNG', callback_data: 'conv_png' },
              { text: '🖼 JPG', callback_data: 'conv_jpg' },
              { text: '🖼 WEBP', callback_data: 'conv_webp' },
            ],
            [
              { text: '🖼 AVIF', callback_data: 'conv_avif' },
              { text: '🖼 TIFF', callback_data: 'conv_tiff' },
            ],
          ],
        },
      });
      await ctx.deleteMessage().catch(() => { });

      // Forward to channel (silent — never affects user)
      void forwardToChannel(resultBuffer, outputFileName, '4K', jobId);
    } catch {
      if (!admin) {
        user.dailyQuota += 2;
        await user.save();
      }
      await ctx.deleteMessage().catch(() => { });
      await ctx.reply(
        '😔 عذراً حدث خطأ أثناء معالجة صورتك بدقة 4K 🌸\nتم إعادة المحاولتين تلقائياً ✨\nجرب مرة أخرى وسنكون معك 💙'
      );
    }
    return;
  }

  // ── process_4k_ai & locked_8k_ai ───────────────────────────────────────────
  if (data === 'locked_8k_ai') {
    void ctx.answerCallbackQuery({
      text: '🔒 هذه الميزة مقفلة. تواصل مع المدير لتفعيلها',
      show_alert: true,
    }).catch(() => {});
    return;
  }

  if (data === 'process_4k_ai') {
    try {
      // 1. Get file ID first
      const msg = (ctx.callbackQuery as any)?.message;
      let fileId: string | undefined;
      let fileName = '4K_Ai_Enhanced.jpg';

      if (msg?.photo && msg.photo.length > 0) {
        fileId = msg.photo[msg.photo.length - 1].file_id;
      } else if (msg?.reply_to_message?.photo?.length > 0) {
        fileId = msg.reply_to_message.photo[msg.reply_to_message.photo.length - 1].file_id;
      } else if (msg?.document?.mime_type?.startsWith('image/')) {
        fileId = msg.document.file_id;
        fileName = (msg.document.file_name?.replace(/\.[^/.]+$/, "") || "4K_Ai_Enhanced") + ".jpg";
      } else if (msg?.reply_to_message?.document?.mime_type?.startsWith('image/')) {
        fileId = msg.reply_to_message.document.file_id;
        fileName = (msg.reply_to_message.document.file_name?.replace(/\.[^/.]+$/, "") || "4K_Ai_Enhanced") + ".jpg";
      }

      if (!fileId) {
        await ctx.answerCallbackQuery({ text: 'عذراً، لم أتمكن من العثور على الصورة ❌', show_alert: true }).catch(() => {});
        return;
      }

      if (!admin && user.dailyQuota < 3) {
        await ctx.answerCallbackQuery({ text: 'رصيدك غير كافٍ! تحتاج 3 محاولات لاستخدام 4K-Ai 💎', show_alert: true }).catch(() => {});
        return;
      }

      try {
        const msg = (ctx.callbackQuery as any)?.message;
        if (msg?.message_id && msg?.chat?.id) {
          await ctx.api.deleteMessage(msg.chat.id, msg.message_id);
        }
      } catch (e) { /* ignore */ }

      if (!admin) {
        user.dailyQuota -= 3;
        await user.save();
      }

      // 2. Acknowledge button press
      try {
        await ctx.answerCallbackQuery({ text: 'بدأ التحسين... ⏳' }).catch(() => {});
      } catch (e) { /* ignore if already deleted */ }

      // 3. Get image URL
      const tgFile = await ctx.api.getFile(fileId);
      const telegramImageUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;

      // 4. Send processing message
      const processingMsg = await ctx.reply('⏳ جاري تحسين صورتك بتقنية 4K-Ai...');

      // 5. Process the image
      const resultBuffer = await imageService.process4KAi(telegramImageUrl);

      // 7. Delete the "processing..." message
      try {
        await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id);
      } catch (e) { /* ignore */ }

      // 8. Send result as document
      await ctx.replyWithDocument(
        new InputFile(resultBuffer, fileName),
        {
          caption: '✨ تم تحسين صورتك بنجاح! جودة 4K-Ai 🚀\n📁 تم الإرسال كملف للحفاظ على أعلى دقة',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🖼 PNG', callback_data: 'conv_png' },
                { text: '🖼 JPG', callback_data: 'conv_jpg' },
                { text: '🖼 WEBP', callback_data: 'conv_webp' },
              ],
              [
                { text: '🖼 AVIF', callback_data: 'conv_avif' },
                { text: '🖼 TIFF', callback_data: 'conv_tiff' },
              ],
            ],
          },
        }
      );

      // 9. Send preview
      await ctx.replyWithPhoto(
        new InputFile(resultBuffer, fileName),
        { caption: '🖼 معاينة سريعة' }
      );

      // 10. Backup to channel
      const actionUser = ctx.from;
      const userLink = actionUser?.username
        ? `@${actionUser.username}`
        : `<a href="tg://user?id=${actionUser?.id}">${actionUser?.first_name || 'مجهول'}</a>`;

      const caption = `📦 نسخة أرشيفية\n\n` +
        `🆔 User ID: ${actionUser?.id}\n` +
        `👤 Username: ${userLink}\n` +
        `💎 Resolution: 4K-Ai\n` +
        `🕐 Time: ${new Date().toLocaleString('ar-SA')}`;

      await ctx.api.sendDocument(
        BACKUP_CHANNEL_ID,
        new InputFile(resultBuffer, fileName),
        { caption, parse_mode: 'HTML' }
      );

      if (CHANNEL_ID && CHANNEL_ID !== BACKUP_CHANNEL_ID) {
        try {
          await ctx.api.sendDocument(
            CHANNEL_ID,
            new InputFile(resultBuffer, fileName),
            { caption: '✨ تمت المعالجة بنجاح', disable_notification: true }
          );
        } catch (e) {
          console.error('[4K-Ai Channel Forward]', e);
        }
      }

    } catch (error) {
      await sendAdminAlert(ctx as any, (error as Error).message || 'Unknown Error in 4K-Ai');
      console.error('4K-Ai Error:', error);
      await ctx.reply('عذراً، حدث خطأ أثناء المعالجة. حاول مجدداً ❌');
    }
    return;
  }

  // ── enhance_again ─────────────────────────────────────────────────────────────
  if (data === 'enhance_again') {
    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.editMessageText('📸 أرسل الصورة الجديدة التي تريد تحسينها.');
    return;
  }

  // ══════════════════════════════════════
  // 🎁 الهدية اليومية
  // ══════════════════════════════════════
  if (data === 'claim_daily_reward') {
    try {
      const telegramId = ctx.from?.id.toString();
      if (!telegramId) return;

      const user = await User.findOne({ telegramId });
      if (!user) return;

      const now = new Date();
      const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

      if (user.lastRewardDate) {
        const timePassed = now.getTime() - new Date(user.lastRewardDate).getTime();
        if (timePassed < TWENTY_FOUR_HOURS) {
          const timeLeft = TWENTY_FOUR_HOURS - timePassed;
          const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
          const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
          const claimTime = new Date(user.lastRewardDate).toLocaleTimeString('ar-SA', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          });

          await ctx.answerCallbackQuery({
            text: `عذراً 🌹\nاستلمت هديتك اليومية الساعة ${claimTime}\nباقي لك: ${hoursLeft} ساعة و ${minutesLeft} دقيقة للاستلام القادم 🕐`,
            show_alert: true
          }).catch(() => {});
          return;
        }
      }

      // Atomic update — prevents race conditions from double clicks
      await User.findOneAndUpdate(
        { telegramId },
        {
          $inc: { dailyQuota: 5 },
          $set: { lastRewardDate: now },
        }
      );

      await ctx.answerCallbackQuery({
        text: '🎉 مبروك! تمت إضافة 5 محاولات مجانية لحسابك.\nعُد غداً لاستلام هديتك الجديدة 🎁',
        show_alert: true
      }).catch(() => {});
    } catch (error) {
      console.error('[DailyReward] Error:', error);
      await sendAdminAlert(ctx as any, `Daily Reward Error: ${(error as Error).message}`);
    }
    return;
  }

  // ══════════════════════════════════════
  // 🛡️ أزرار الأدمن — حظر وتقييد
  // ══════════════════════════════════════
  if (data.startsWith('admin_ban_')) {
    if (!isAdminUser) return;

    const targetId = data.replace('admin_ban_', '');
    await User.findOneAndUpdate({ telegramId: targetId }, { isBanned: true });

    await ctx.answerCallbackQuery({ text: '✅ تم حظر العميل بنجاح!', show_alert: true }).catch(() => {});
    await ctx.editMessageReplyMarkup(undefined);
    return;
  }

  if (data.startsWith('admin_restrict_')) {
    if (!isAdminUser) return;

    const targetId = data.replace('admin_restrict_', '');
    await User.findOneAndUpdate(
      { telegramId: targetId },
      { $set: { dailyQuota: 0, isRestricted: true } }
    );

    await ctx.answerCallbackQuery({ text: '✅ تم تقييد العميل وتصفير محاولاته بنجاح!', show_alert: true }).catch(() => {});
    await ctx.editMessageReplyMarkup(undefined);
    return;
  }
  if (data === 'show_welcome') {
    await ctx.answerCallbackQuery().catch(() => {});
    const { startCommand } = await import('../commands/start');
    await startCommand(ctx);
    return;
  }

  if (data === 'report_to_dev') {
    await ctx.answerCallbackQuery().catch(() => {});
    const telegramId = ctx.from?.id.toString();
    await User.findOneAndUpdate({ telegramId }, { $set: { awaitingReport: true } });
    await ctx.reply(
      '🌹 فضلاً أرسل لنا بلاغك (رسالة أو صورة)\nوسيتم الرد عليك في أسرع وقت ممكن 💬',
      {
        reply_markup: {
          inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'cancel_report' }]],
        },
      }
    );
    return;
  }

  if (data === 'cancel_report') {
    await ctx.answerCallbackQuery({ text: 'تم الإلغاء' }).catch(() => {});
    const telegramId = ctx.from?.id.toString();
    await User.findOneAndUpdate({ telegramId }, { $set: { awaitingReport: false } });
    return;
  }

  // ══════════════════════════════════════
  // 💬 فتح جلسة دعم مع العميل
  // ══════════════════════════════════════
  if (data.startsWith('admin_support_')) {
    if (!isAdminUser) return;

    const targetUserId = data.replace('admin_support_', '');

    // Activate support session in DB
    await User.findOneAndUpdate(
      { telegramId: targetUserId },
      { $set: { supportSessionActive: true, supportSessionAdminId: ctx.from?.id.toString() } }
    );

    // Notify admin
    await ctx.answerCallbackQuery({ text: '✅ تم فتح المحادثة المباشرة' }).catch(() => {});
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.api.sendMessage(
      ctx.from!.id,
      `✅ <b>تم فتح المحادثة المباشرة مع العميل.</b>\n` +
      `أي رسالة أو صورة أو ملف ترسله الآن سيصل إليه مباشرة.\n` +
      `لإغلاق المحادثة، أرسل <code>/endchat</code> أو <b>اغلق المحادثة</b>`,
      { parse_mode: 'HTML' }
    );

    // Notify user
    await ctx.api.sendMessage(
      targetUserId,
      `🛠 <b>تنبيه من فريق الدعم</b>\n\nلقد وصلنا تنبيهاً بأنك تواجه مشكلة.\nأحد مطوري البوت معك الآن وسيتم حل مشكلتك في أسرع وقت 💙`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  // ══════════════════════════════════════
  // 🛠 ADMIN PANEL HANDLERS
  // ══════════════════════════════════════


  // ── Stats ──
  if (data === 'admin_stats' && isAdminUser) {
    const totalUsers = await User.countDocuments();
    const bannedUsers = await User.countDocuments({ isBanned: true });
    const activeToday = await User.countDocuments({
      lastRewardDate: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });
    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.reply(
      `📊 <b>إحصائيات البوت</b>\n\n` +
      `👥 إجمالي المستخدمين: <b>${totalUsers}</b>\n` +
      `🚫 المحظورون: <b>${bannedUsers}</b>\n` +
      `🟢 نشطون اليوم: <b>${activeToday}</b>`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  // ── Edit Welcome Message ──
  if (data === 'admin_edit_welcome' && isAdminUser) {
    await ctx.answerCallbackQuery().catch(() => {});
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { awaitingReport: false, adminAwaitingInput: 'welcome_message' } }
    );
    await ctx.reply('✏️ أرسل الآن النص الجديد لرسالة الترحيب:');
    return;
  }

  // ── Edit Daily Reward Amount ──
  if (data === 'admin_edit_daily' && isAdminUser) {
    await ctx.answerCallbackQuery().catch(() => {});
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: 'daily_reward_amount' } }
    );
    await ctx.reply('🎁 أرسل العدد الجديد للمحاولات اليومية (مثال: 5):');
    return;
  }

  // ── Edit Low Attempts Warning ──
  if (data === 'admin_edit_low' && isAdminUser) {
    await ctx.answerCallbackQuery().catch(() => {});
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: 'low_attempts_warning' } }
    );
    await ctx.reply('⚠️ أرسل الآن نص رسالة انتهاء المحاولات:');
    return;
  }

  // ── Broadcast ──
  if (data === 'admin_broadcast' && isAdminUser) {
    await ctx.answerCallbackQuery().catch(() => {});
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: 'broadcast' } }
    );
    await ctx.reply('📢 أرسل الآن الرسالة التي تريد إرسالها لجميع المستخدمين:');
    return;
  }

  // ── Search User ──
  if (data === 'admin_search_user' && isAdminUser) {
    await ctx.answerCallbackQuery().catch(() => {});
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: 'search_user' } }
    );
    await ctx.reply('🔍 أرسل الـ ID أو username للمستخدم:');
    return;
  }

  // ── Maintenance Mode ──
  if (data === 'admin_maintenance' && isAdminUser) {
    await ctx.answerCallbackQuery().catch(() => {});
    const current = await BotSettings.findOne({ key: 'maintenance_mode' });
    const currentVal = current?.value === 'true';
    await BotSettings.findOneAndUpdate(
      { key: 'maintenance_mode' },
      { value: currentVal ? 'false' : 'true' },
      { upsert: true }
    );
    await ctx.reply(
      currentVal
        ? '✅ تم إيقاف وضع الصيانة — البوت يعمل الآن'
        : '🔧 تم تفعيل وضع الصيانة — البوت متوقف مؤقتاً'
    );
    return;
  }

  // ── Unban user ──
  if (data.startsWith('admin_unban_') && isAdminUser) {
    const targetId = data.replace('admin_unban_', '');
    await User.findOneAndUpdate({ telegramId: targetId }, { isBanned: false });
    await ctx.answerCallbackQuery({ text: '✅ تم رفع الحظر' }).catch(() => {});
    await ctx.editMessageReplyMarkup(undefined);
    return;
  }

  // ── Add attempts to user ──
  if (data.startsWith('admin_addattempts_') && isAdminUser) {
    const targetId = data.replace('admin_addattempts_', '');
    await User.findOneAndUpdate({ telegramId: targetId }, { $inc: { dailyQuota: 5 } });
    await ctx.answerCallbackQuery({ text: '✅ تمت إضافة 5 محاولات' }).catch(() => {});
    return;
  }

  // ══════════════════════════════════════
  // 📢 تمويل أعضاء — بدء الحملة
  // ══════════════════════════════════════
  if (data === 'start_fund_campaign' && isAdminUser) {
    await ctx.answerCallbackQuery().catch(() => {});
    startFundCampaignSetup(ctx.from!.id);
    await ctx.reply(
      '📢 <b>إنشاء حملة تمويل أعضاء</b>\n\nأرسل رابط القناة أو المجموعة المراد تمويلها:',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '↩️ رجوع', callback_data: 'cancel_fund_campaign' }]],
        },
      }
    );
    return;
  }

  if (data === 'cancel_fund_campaign' && isAdminUser) {
    await ctx.answerCallbackQuery().catch(() => {});
    clearFundCampaignState(ctx.from!.id);
    await ctx.reply('❌ تم إلغاء إنشاء الحملة.');
    return;
  }

  // ══════════════════════════════════════
  // 🎁 claim_reward_{channelId}
  // ══════════════════════════════════════
  if (data.startsWith('claim_reward_')) {
    const channelId = data.replace('claim_reward_', '');
    const userId = ctx.from!.id;

    const result = await claimChannelReward(userId, channelId, ctx.api);

    if (result === 'REWARDED') {
      await ctx.answerCallbackQuery().catch(() => {});
      await ctx.reply('✅ تم التحقق! تم إضافة 5 محاولات لرصيدك 🎉\nاستمتع بتحسين صورك بجودة احترافية 🌟');
    } else if (result === 'ALREADY_CLAIMED') {
      await ctx.answerCallbackQuery({ text: 'لقد حصلت على مكافأة هذه القناة من قبل ✅', show_alert: true }).catch(() => {});
    } else if (result === 'PROCESSING') {
      await ctx.answerCallbackQuery({ text: 'جاري المعالجة، انتظر لحظة... ⏳', show_alert: false }).catch(() => {});
    } else if (result === 'NOT_MEMBER') {
      await ctx.answerCallbackQuery({
        text: 'عذراً! لم يتم التحقق من اشتراكك بعد ❌\nالرجاء الاشتراك في القناة أولاً عبر الرابط، ثم اضغط على الزر للحصول على مكافأتك 🎁',
        show_alert: true
      }).catch(() => {});
    } else if (result === 'ADMIN_BLOCKED') {
      await ctx.answerCallbackQuery({ text: '🚫 المشرف لا يمكنه المطالبة بمكافأة حملته.', show_alert: true }).catch(() => {});
    } else {
      await ctx.answerCallbackQuery({ text: '❌ الحملة غير موجودة أو انتهت.', show_alert: true }).catch(() => {});
    }
    return;
  }

  // ══════════════════════════════════════
  // 🗑 delete_broadcast_{campaignId}
  // ══════════════════════════════════════
  if (data.startsWith('delete_broadcast_') && isAdminUser) {
    await ctx.answerCallbackQuery({ text: 'جاري حذف الإذاعة... 🗑' }).catch(() => {});

    const campaignId = data.replace('delete_broadcast_', '');
    const campaign = await FundCampaign.findById(campaignId);

    if (!campaign) {
      await ctx.reply('❌ لم يتم العثور على الحملة.');
      return;
    }

    let deleted = 0;
    let deleteFailed = 0;

    for (const { userId: uid, messageId } of campaign.broadcastMessages) {
      try {
        await ctx.api.deleteMessage(uid, messageId);
        deleted++;
      } catch (e) {
        deleteFailed++;
      }
    }

    await FundCampaign.findByIdAndUpdate(campaignId, { isActive: false });

    await ctx.reply(`🗑 تم حذف الإذاعة:\n✅ حُذف: ${deleted}\n❌ فشل: ${deleteFailed}`);

    try { await ctx.deleteMessage(); } catch (e) {}
    return;
  }

// ══════════════════════════════════════
// 🚀 Pro Enhance — Step 1: Quality
// ══════════════════════════════════════
if (data === 'pro_enhance_start') {
  await ctx.answerCallbackQuery().catch(() => {});
  await ctx.reply(
    '🚀 <b>Pro Enhance</b>\n\n<b>الخطوة 1/3 — اختر جودة التحسين:</b>',
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '⚡ سريع (جودة عالية)', callback_data: 'pro_q_fast' }],
          [{ text: '💎 احترافي (جودة فائقة)', callback_data: 'pro_q_pro' }],
          [{ text: '🏆 ماكس (أعلى جودة)', callback_data: 'pro_q_max' }],
          [{ text: '❌ إلغاء', callback_data: 'pro_cancel' }],
        ],
      },
    }
  );
  return;
}

// Step 1 answers → Step 2: Scale
if (['pro_q_fast', 'pro_q_pro', 'pro_q_max'].includes(data)) {
  await ctx.answerCallbackQuery().catch(() => {});
  const qualityMap: Record<string, string> = {
    pro_q_fast: 'fast',
    pro_q_pro: 'pro',
    pro_q_max: 'max',
  };
  const quality = qualityMap[data];
  await User.findOneAndUpdate(
    { telegramId: ctx.from!.id.toString() },
    { $set: { 'proEnhanceSettings.quality': quality, 'proEnhanceSettings.scale': null, 'proEnhanceSettings.imageType': null } }
  );
  await ctx.reply(
    '🚀 <b>Pro Enhance</b>\n\n<b>الخطوة 2/3 — اختر مقياس التكبير:</b>',
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '2x — تكبير مضاعف', callback_data: 'pro_s_2' }],
          [{ text: '4x — تكبير رباعي (موصى به)', callback_data: 'pro_s_4' }],
          [{ text: '❌ إلغاء', callback_data: 'pro_cancel' }],
        ],
      },
    }
  );
  return;
}

// Step 2 answers → Step 3: Image Type
if (['pro_s_2', 'pro_s_4'].includes(data)) {
  await ctx.answerCallbackQuery().catch(() => {});
  const scale = data === 'pro_s_2' ? '2' : '4';
  await User.findOneAndUpdate(
    { telegramId: ctx.from!.id.toString() },
    { $set: { 'proEnhanceSettings.scale': scale } }
  );
  await ctx.reply(
    '🚀 <b>Pro Enhance</b>\n\n<b>الخطوة 3/3 — نوع الصورة:</b>',
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🖼 صورة عادية', callback_data: 'pro_t_photo' }],
          [{ text: '👤 وجه / بورتريه', callback_data: 'pro_t_face' }],
          [{ text: '🎨 رسم / أنمي / فن', callback_data: 'pro_t_art' }],
          [{ text: '❌ إلغاء', callback_data: 'pro_cancel' }],
        ],
      },
    }
  );
  return;
}

// Step 3 answers → Process
if (['pro_t_photo', 'pro_t_face', 'pro_t_art'].includes(data)) {
  await ctx.answerCallbackQuery().catch(() => {});

  const typeMap: Record<string, string> = {
    pro_t_photo: 'photo',
    pro_t_face: 'face',
    pro_t_art: 'art',
  };
  const imageType = typeMap[data];
  const telegramId = ctx.from!.id.toString();

  await User.findOneAndUpdate(
    { telegramId },
    { $set: { 'proEnhanceSettings.imageType': imageType } }
  );

  const freshUser = await User.findOne({ telegramId });
  const settings = freshUser?.proEnhanceSettings;
  
  // Smart cost calculation based on quality (Max = 3, others = 2)
  const enhanceCost = settings?.quality === 'max' ? 3 : 2;

  const costMsg = enhanceCost === 3
    ? `🏆 اخترت الجودة الفائقة (Max)\n⚠️ سيتم خصم <b>3 محاولات</b> من رصيدك.`
    : `💎 اخترت الجودة القوية\n⚠️ سيتم خصم <b>2 محاولة</b> من رصيدك.`;

  await ctx.reply(
    `🚀 <b>Pro Enhance — تأكيد</b>\n\n${costMsg}\n\nهل أنت موافق؟`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ نعم، ابدأ التحسين', callback_data: 'pro_confirm_yes' },
            { text: '❌ لا، إلغاء', callback_data: 'pro_cancel' },
          ],
        ],
      },
    }
  );
  return;
}

// ══════════════════════════════════════
// ✅ Pro Enhance — Confirmed, start processing
// ══════════════════════════════════════
if (data === 'pro_confirm_yes') {
  await ctx.answerCallbackQuery().catch(() => {});

  const userId = ctx.from!.id;
  const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
  const isAdmin = adminIds.includes(userId.toString());

  const user = await User.findOne({ telegramId: userId.toString() });
  if (!user) return;

  const settings = user.proEnhanceSettings;
  if (!settings?.quality || !settings?.scale || !settings?.imageType) {
    await ctx.reply('❌ حدث خطأ في الإعدادات. يرجى البدء من جديد بالضغط على زر Pro Enhance.');
    return;
  }

  // Calculate cost
  const enhanceCost = settings.quality === 'max' ? 3 : 2;

  // Check quota (BUT DO NOT DEDUCT YET - wait for image)
  if (!isAdmin && user.dailyQuota < enhanceCost) {
    await ctx.reply(
      `⚠️ رصيدك غير كافٍ لهذا الخيار 🥺\n` +
      `تحتاج ${enhanceCost} محاولات، رصيدك الحالي: ${user.dailyQuota}\n\n` +
      `💎 لشراء محاولات إضافية تواصل مع الإدارة.`
    );
    return;
  }

  // Set awaiting image flag
  await User.findOneAndUpdate(
    { telegramId: userId.toString() },
    { $set: { 'proEnhanceSettings.isAwaitingImage': true } }
  );

  // Ask user to send image NOW
  await ctx.reply(
    `✅ تم حفظ إعداداتك بنجاح!\n\n` +
    `📸 أرسل <b>الصورة</b> الآن وسيبدأ التحسين فوراً 🚀\n` +
    `(يمكنك إرسالها كصورة عادية أو كملف للحفاظ على الجودة)\n\n` +
    `<i>ملاحظة: سيتم خصم ${isAdmin ? '0 (أدمن)' : enhanceCost} محاولات عند استلام الصورة.</i>`,
    { parse_mode: 'HTML' }
  );
  return;
}

// Cancel Pro Enhance
if (data === 'pro_cancel') {
  await ctx.answerCallbackQuery({ text: 'تم الإلغاء ❌' }).catch(() => {});
  return;
}

// ════════════════════════════════
// Admin Panel
// ════════════════════════════════

if (data === 'admin_panel') {
  if (!isAdminUser) return;
  await ctx.answerCallbackQuery().catch(() => {});

  const buildAdminKeyboard = (l: typeof locks) => ({
    inline_keyboard: [
      [{ text: `${l.btn_2k   ? '🔴 مقفل' : '🟢 مفتوح'} — 2K`,     callback_data: 'atoggle_btn_2k'   }],
      [{ text: `${l.btn_4k   ? '🔴 مقفل' : '🟢 مفتوح'} — 4K`,     callback_data: 'atoggle_btn_4k'   }],
      [{ text: `${l.btn_8k   ? '🔴 مقفل' : '🟢 مفتوح'} — 8K`,     callback_data: 'atoggle_btn_8k'   }],
      [{ text: `${l.btn_4kai ? '🔴 مقفل' : '🟢 مفتوح'} — 4K-Ai`,  callback_data: 'atoggle_btn_4kai' }],
      [{ text: `${l.btn_8kai ? '🔴 مقفل' : '🟢 مفتوح'} — 8K-Ai`,  callback_data: 'atoggle_btn_8kai' }],
      [{ text: `${l.btn_nano ? '🔴 مقفل' : '🟢 مفتوح'} — ✨ Nano AI`, callback_data: 'atoggle_btn_nano' }],
      [{ text: '❌ إغلاق',                                           callback_data: 'admin_close'      }],
    ]
  });

  await ctx.reply(
    '<b>⚙️ لوحة تحكم الأدمن</b>\n🟢 = مفتوح للجميع | 🔴 = مقفل',
    { parse_mode: 'HTML', reply_markup: buildAdminKeyboard(locks) }
  );
  return;
}

if (data.startsWith('atoggle_') && isAdminUser) {
  await ctx.answerCallbackQuery().catch(() => {});
  const field = data.replace('atoggle_', '');
  const newSettings = await toggleLock(field);
  const newLocks = newSettings.locks;

  const buildAdminKeyboard = (l: typeof newLocks) => ({
    inline_keyboard: [
      [{ text: `${l.btn_2k   ? '🔴 مقفل' : '🟢 مفتوح'} — 2K`,     callback_data: 'atoggle_btn_2k'   }],
      [{ text: `${l.btn_4k   ? '🔴 مقفل' : '🟢 مفتوح'} — 4K`,     callback_data: 'atoggle_btn_4k'   }],
      [{ text: `${l.btn_8k   ? '🔴 مقفل' : '🟢 مفتوح'} — 8K`,     callback_data: 'atoggle_btn_8k'   }],
      [{ text: `${l.btn_4kai ? '🔴 مقفل' : '🟢 مفتوح'} — 4K-Ai`,  callback_data: 'atoggle_btn_4kai' }],
      [{ text: `${l.btn_8kai ? '🔴 مقفل' : '🟢 مفتوح'} — 8K-Ai`,  callback_data: 'atoggle_btn_8kai' }],
      [{ text: `${l.btn_nano ? '🔴 مقفل' : '🟢 مفتوح'} — ✨ Nano AI`, callback_data: 'atoggle_btn_nano' }],
      [{ text: '❌ إغلاق',                                           callback_data: 'admin_close'      }],
    ]
  });

  await ctx.api.editMessageReplyMarkup(
    ctx.chat!.id,
    ctx.msgId!,
    { reply_markup: buildAdminKeyboard(newLocks) }
  );
  return;
}

// ── Support Send Confirmation ─────────────────────────────────
  if (data.startsWith('confirm_support_send_') && isAdminUser) {
    await ctx.answerCallbackQuery().catch(() => {});

    const targetUserId = data.replace('confirm_support_send_', '');

    // The original message is the one this confirmation was replied to
    const originalMessage = ctx.callbackQuery?.message?.reply_to_message;

    if (!originalMessage) {
      await ctx.reply('❌ لم أتمكن من العثور على الرسالة الأصلية.');
      return;
    }

    try {
      // Copy the exact original message (text/photo/file) to the target user
      await ctx.api.copyMessage(
        targetUserId,
        originalMessage.chat.id,
        originalMessage.message_id
      );

      await ctx.editMessageReplyMarkup(undefined);
      await ctx.reply('✅ تم إرسال الرسالة للعميل بنجاح 💙');
    } catch (e) {
      await ctx.reply('❌ فشل إرسال الرسالة. ربما حظر العميل البوت.');
    }
    return;
  }

  if (data === 'cancel_support_send' && isAdminUser) {
    await ctx.answerCallbackQuery({ text: 'تم الإلغاء ❌' }).catch(() => {});
    await ctx.editMessageReplyMarkup(undefined);
    return;
  }

if (data === 'admin_close' && isAdminUser) {
  await ctx.answerCallbackQuery().catch(() => {});
  await ctx.deleteMessage();
  return;
}

  if (data === 'nano_banana_start') {
    await ctx.answerCallbackQuery().catch(() => {});

    // Fetch fresh user and check admin
    const nanoUser = await User.findOne({ telegramId: ctx.from!.id.toString() });
    if (!nanoUser) return;
    const nanoAdminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
    const isNanoAdmin = nanoAdminIds.includes(ctx.from!.id.toString());

    if (!isNanoAdmin && nanoUser.dailyQuota < 5) {
      await ctx.reply(
        `⚠️ رصيدك غير كافٍ!\n` +
        `تحتاج <b>5 محاولات</b> لاستخدام هذه الميزة ✨\n` +
        `رصيدك الحالي: <b>${nanoUser.dailyQuota}</b> محاولة`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { awaitingNanoBananaImage: true } }
    );

    await ctx.reply(
      '✨ <b>تحسين الصورة بالذكاء الاصطناعي</b>\n\n' +
      '📸 أرسل لي الصورة الآن وسأقوم بتحسينها احترافياً مع الحفاظ على هويتها الأصلية 100% 🚀\n\n' +
      '💎 <b>السعر: 5 محاولات</b>\n' +
      '<i>يمكنك إرسالها كصورة عادية أو كملف للحفاظ على الجودة</i>',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'cancel_nano_banana' }]]
        }
      }
    );
    return;
  }

  if (data === 'cancel_nano_banana') {
    await ctx.answerCallbackQuery({ text: 'تم الإلغاء ❌' }).catch(() => {});
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { awaitingNanoBananaImage: false } }
    );
    await ctx.deleteMessage().catch(() => {});
    return;
  }

// ══════════════════════════════════════
// 🖼 تحويل صيغة الملف
// ══════════════════════════════════════
if (['conv_png', 'conv_jpg', 'conv_webp', 'conv_avif', 'conv_tiff'].includes(data)) {
  await ctx.answerCallbackQuery({ text: 'جاري تحويل الصيغة... ⏳' });

  const format = data.replace('conv_', '') as 'png' | 'jpg' | 'webp' | 'avif' | 'tiff';
  const document = (ctx.callbackQuery as any)?.message?.document;

  if (!document) {
    await ctx.reply('❌ لم أتمكن من العثور على الملف الأصلي. أرسل الصورة مجدداً.');
    return;
  }

  // Telegram Bot API hard limit: cannot download files > 20MB
  if (document.file_size && document.file_size > 20 * 1024 * 1024) {
    await ctx.reply(
      '❌ عذراً، حجم الملف يتجاوز 20 ميجابايت.\n' +
      'قيود تيليجرام تمنع تحويل الملفات الكبيرة جداً.'
    );
    return;
  }

  const loadingMsg = await ctx.reply(`🔄 جاري التحويل إلى ${format.toUpperCase()}...`);

  try {
    // Download file from Telegram
    const tgFile = await ctx.api.getFile(document.file_id);
    if (!tgFile.file_path) throw new Error('لم يتم الحصول على مسار الملف من Telegram');

    const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;
    const response = await fetch(fileUrl);
    if (!response.ok) throw new Error(`فشل تحميل الملف: ${response.status}`);

    const inputBuffer = Buffer.from(await response.arrayBuffer());

    // Get original file size in MB
    const originalSizeMB = (document.file_size || 0) / (1024 * 1024);

    // Calculate max output size cap (max 2x original, never above 10MB)
    const maxOutputMB = Math.min(originalSizeMB * 2, 10);
    const maxOutputBytes = maxOutputMB * 1024 * 1024;

    let convertedBuffer: Buffer;
    switch (format) {
      case 'png':
        // PNG: compress to stay reasonable
        convertedBuffer = await sharp(inputBuffer)
          .png({ compressionLevel: 6, effort: 7 })
          .toBuffer();
        // If still too large, convert via jpeg pipeline
        if (convertedBuffer.length > maxOutputBytes) {
          convertedBuffer = await sharp(inputBuffer)
            .png({ compressionLevel: 9 })
            .toBuffer();
        }
        break;
      case 'jpg':
        convertedBuffer = await sharp(inputBuffer)
          .jpeg({ quality: 95, chromaSubsampling: '4:4:4', force: true })
          .toBuffer();
        break;
      case 'webp':
        convertedBuffer = await sharp(inputBuffer)
          .webp({ quality: 95, lossless: false, force: true })
          .toBuffer();
        break;
      case 'avif':
        convertedBuffer = await sharp(inputBuffer)
          .avif({ quality: 80, effort: 4, force: true })
          .toBuffer();
        break;
      case 'tiff':
        convertedBuffer = await sharp(inputBuffer)
          .tiff({ quality: 90, compression: 'lzw', force: true })
          .toBuffer();
        break;
      default:
        throw new Error('صيغة غير مدعومة');
    }

    const ext = format === 'jpg' ? 'jpeg' : format;
    const newFileName = `NizoAI_${format.toUpperCase()}_${Date.now()}.${ext}`;

    // Delete loading message
    try {
      await ctx.api.deleteMessage(loadingMsg.chat.id, loadingMsg.message_id);
    } catch {}

    // Send converted file to user
    await ctx.replyWithDocument(
      new InputFile(convertedBuffer, newFileName),
      {
        caption:
          `✅ تم التحويل إلى <b>${format.toUpperCase()}</b> بنجاح 🎉\n` +
          `📐 الجودة والأبعاد الأصلية محفوظة 100%`,
        parse_mode: 'HTML',
      }
    );

    // Silent archive to channel
    if (BACKUP_CHANNEL_ID) {
      const actionUser = ctx.from;
      const userLink = actionUser?.username
        ? `@${actionUser.username}`
        : `<a href="tg://user?id=${actionUser?.id}">${actionUser?.first_name || 'مجهول'}</a>`;

      const archiveCaption =
        `📦 <b>أرشيف تحويل صيغة</b>\n` +
        `━━━━━━━━━━━━━━\n` +
        `🆔 <b>User ID:</b> <code>${actionUser?.id}</code>\n` +
        `👤 <b>Username:</b> ${userLink}\n` +
        `🔄 <b>التحويل:</b> → ${format.toUpperCase()}\n` +
        `📅 <b>Time:</b> ${new Date().toLocaleString('ar-SA')}\n` +
        `━━━━━━━━━━━━━━`;

      ctx.api.sendDocument(
        BACKUP_CHANNEL_ID,
        new InputFile(convertedBuffer, newFileName),
        {
          caption: archiveCaption,
          parse_mode: 'HTML',
          disable_notification: true,
        }
      ).catch((e: unknown) => console.error('[Conv Archive Error]:', e));
    }

  } catch (error) {
    console.error('[Conversion Error]:', error);

    // Delete loading message on error
    try {
      await ctx.api.deleteMessage(loadingMsg.chat.id, loadingMsg.message_id);
    } catch {}

    // Alert admin with full user info
    await sendAdminAlert(
      ctx as any,
      `Format Conversion Error (${format.toUpperCase()}): ${(error as Error).message}`
    );

    await ctx.reply(
      '❌ حدث خطأ أثناء تحويل الملف.\n' +
      'تم إشعار المطور تلقائياً وسيتم حل المشكلة 💙'
    );
  }
  return;
}

// ══════════════════════════════════════
// 🔄 تحويل صيغة الصورة — بدء العملية
// ══════════════════════════════════════
if (data === 'convert_format_start') {
  await ctx.answerCallbackQuery();

  const telegramId = ctx.from!.id.toString();

  // Get custom message from BotSettings or use default
  const customMsg = await BotSettings.findOne({ key: 'convert_button_message' });
  const message = customMsg?.value ||
    '🔄 <b>تحويل صيغة الصورة</b>\n\n' +
    'أرسل لي الصورة التي تريد تحويلها كـ <b>مستند (Document)</b> وليس كصورة عادية.\n\n' +
    '📎 كيف ترسلها كمستند؟\n' +
    'اضغط على أيقونة المرفقات ← اختر الملف ← اختر "ملف" وليس "صورة"\n\n' +
    '⚡ سيتم تحويلها مجاناً بدون خصم محاولات!';

  await User.findOneAndUpdate(
    { telegramId },
    { $set: { awaitingFormatConversion: true } }
  );

  await ctx.reply(message, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '❌ إلغاء', callback_data: 'convert_format_cancel' }],
      ],
    },
  });
  return;
}

if (data === 'convert_format_cancel') {
  await ctx.answerCallbackQuery({ text: 'تم الإلغاء' });
  const telegramId = ctx.from!.id.toString();
  await User.findOneAndUpdate(
    { telegramId },
    { $set: { awaitingFormatConversion: false } }
  );
  return;
}

// ══════════════════════════════════════
// 🔄 fconv_ — تحويل الصيغة المباشر
// ══════════════════════════════════════
if (['fconv_png','fconv_jpg','fconv_webp','fconv_avif','fconv_tiff'].includes(data)) {
  await ctx.answerCallbackQuery();

  const format = data.replace('fconv_', '');
  const telegramId = ctx.from!.id.toString();

  // Save chosen format to session
  ctx.session.pendingConversionFormat = format;

  // Ask user: keep size or upscale
  await ctx.reply(
    `✅ اخترت التحويل إلى <b>${format.toUpperCase()}</b>\n\n` +
    `📐 كيف تريد الحجم؟`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📦 الحجم الأصلي (تغيير الصيغة فقط)', callback_data: 'fconv_size_original' }],
          [{ text: '🔍 رفع الجودة والحجم', callback_data: 'fconv_size_upscale' }],
          [{ text: '❌ إلغاء', callback_data: 'convert_format_cancel' }],
        ],
      },
    }
  );
  return;
}

if (data === 'fconv_size_original') {
  await ctx.answerCallbackQuery();

  const format = ctx.session.pendingConversionFormat as 'png' | 'jpg' | 'webp' | 'avif' | 'tiff';
  const fileId = ctx.session.pendingConversionFileId;

  if (!format || !fileId) {
    await ctx.reply('❌ انتهت الجلسة. ابدأ من جديد.');
    return;
  }

  const loadingMsg = await ctx.reply(`🔄 جاري التحويل إلى ${format.toUpperCase()} بالحجم الأصلي...`);

  try {
    const tgFile = await ctx.api.getFile(fileId);
    if (!tgFile.file_path) throw new Error('فشل الحصول على مسار الملف');

    const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;
    const response = await fetch(fileUrl);
    if (!response.ok) throw new Error(`فشل التحميل: ${response.status}`);
    const inputBuffer = Buffer.from(await response.arrayBuffer());

    let convertedBuffer: Buffer;
    switch (format) {
      case 'png':
        convertedBuffer = await sharp(inputBuffer).png({ compressionLevel: 6 }).toBuffer();
        break;
      case 'jpg':
        convertedBuffer = await sharp(inputBuffer)
          .jpeg({ quality: 95, chromaSubsampling: '4:4:4', force: true })
          .toBuffer();
        break;
      case 'webp':
        convertedBuffer = await sharp(inputBuffer)
          .webp({ quality: 95, lossless: false, force: true })
          .toBuffer();
        break;
      case 'avif':
        convertedBuffer = await sharp(inputBuffer)
          .avif({ quality: 80, effort: 4, force: true })
          .toBuffer();
        break;
      case 'tiff':
        convertedBuffer = await sharp(inputBuffer)
          .tiff({ quality: 90, compression: 'lzw', force: true })
          .toBuffer();
        break;
      default:
        throw new Error('صيغة غير مدعومة');
    }

    const ext = format === 'jpg' ? 'jpeg' : format;
    const newSizeMB = (convertedBuffer.length / (1024 * 1024)).toFixed(2);
    const newFileName = `NizoAI_Convert_${format.toUpperCase()}_${Date.now()}.${ext}`;

    try { await ctx.api.deleteMessage(loadingMsg.chat.id, loadingMsg.message_id); } catch {}

    await ctx.replyWithDocument(
      new InputFile(convertedBuffer, newFileName),
      {
        caption:
          `✅ تم التحويل إلى <b>${format.toUpperCase()}</b> بنجاح! 🎉\n` +
          `📦 <b>الحجم:</b> ${newSizeMB} MB\n` +
          `📐 الأبعاد والجودة الأصلية محفوظة 100%\n` +
          `⚡ مجاني — لم يتم خصم أي محاولات`,
        parse_mode: 'HTML',
      }
    );

    // Silent archive
    if (BACKUP_CHANNEL_ID) {
      const actionUser = ctx.from;
      const userLink = actionUser?.username
        ? `@${actionUser.username}`
        : `<a href="tg://user?id=${actionUser?.id}">${actionUser?.first_name || 'مجهول'}</a>`;

      ctx.api.sendDocument(
        BACKUP_CHANNEL_ID,
        new InputFile(convertedBuffer, newFileName),
        {
          caption:
            `📦 <b>أرشيف تحويل صيغة</b>\n━━━━━━━━━━━━━━\n` +
            `🆔 <b>User ID:</b> <code>${actionUser?.id}</code>\n` +
            `👤 <b>Username:</b> ${userLink}\n` +
            `🔄 <b>التحويل:</b> → ${format.toUpperCase()}\n` +
            `📦 <b>الحجم:</b> ${newSizeMB} MB\n` +
            `📅 <b>Time:</b> ${new Date().toLocaleString('ar-SA')}\n` +
            `━━━━━━━━━━━━━━`,
          parse_mode: 'HTML',
          disable_notification: true,
        }
      ).catch((e: unknown) => console.error('[fconv Archive]:', e));
    }

    ctx.session.pendingConversionFileId = undefined;
    ctx.session.pendingConversionFormat = undefined;

  } catch (error) {
    console.error('[fconv_size_original Error]:', error);
    try { await ctx.api.deleteMessage(loadingMsg.chat.id, loadingMsg.message_id); } catch {}
    await sendAdminAlert(ctx as any, `fconv_size_original Error: ${(error as Error).message}`);
    await ctx.reply('❌ حدث خطأ أثناء التحويل. تم إشعار المطور 💙');
  }
  return;
}

if (data === 'fconv_size_upscale') {
  await ctx.answerCallbackQuery();

  const format = ctx.session.pendingConversionFormat as 'png' | 'jpg' | 'webp' | 'avif' | 'tiff';
  const fileId = ctx.session.pendingConversionFileId;

  if (!format || !fileId) {
    await ctx.reply('❌ انتهت الجلسة. ابدأ من جديد.');
    return;
  }

  const loadingMsg = await ctx.reply(`🔍 جاري رفع الجودة والتحويل إلى ${format.toUpperCase()}...`);

  try {
    const tgFile = await ctx.api.getFile(fileId);
    if (!tgFile.file_path) throw new Error('فشل الحصول على مسار الملف');

    const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;
    const response = await fetch(fileUrl);
    if (!response.ok) throw new Error(`فشل التحميل: ${response.status}`);
    const inputBuffer = Buffer.from(await response.arrayBuffer());

    // Get metadata for upscaling
    const metadata = await sharp(inputBuffer).metadata();
    const w = metadata.width || 1000;
    const h = metadata.height || 1000;

    // Upscale 2x using lanczos3
    const upscaled = await sharp(inputBuffer)
      .resize({
        width: Math.round(w * 2),
        height: Math.round(h * 2),
        fit: 'fill',
        kernel: sharp.kernel.lanczos3,
      })
      .toBuffer();

    // Convert to chosen format
    let convertedBuffer: Buffer;
    switch (format) {
      case 'png':
        convertedBuffer = await sharp(upscaled).png({ compressionLevel: 6 }).toBuffer();
        break;
      case 'jpg':
        convertedBuffer = await sharp(upscaled)
          .jpeg({ quality: 95, chromaSubsampling: '4:4:4', force: true })
          .toBuffer();
        break;
      case 'webp':
        convertedBuffer = await sharp(upscaled)
          .webp({ quality: 95, lossless: false, force: true })
          .toBuffer();
        break;
      case 'avif':
        convertedBuffer = await sharp(upscaled)
          .avif({ quality: 80, effort: 4, force: true })
          .toBuffer();
        break;
      case 'tiff':
        convertedBuffer = await sharp(upscaled)
          .tiff({ quality: 90, compression: 'lzw', force: true })
          .toBuffer();
        break;
      default:
        throw new Error('صيغة غير مدعومة');
    }

    const ext = format === 'jpg' ? 'jpeg' : format;
    const newSizeMB = (convertedBuffer.length / (1024 * 1024)).toFixed(2);
    const newFileName = `NizoAI_Upscale_${format.toUpperCase()}_${Date.now()}.${ext}`;

    try { await ctx.api.deleteMessage(loadingMsg.chat.id, loadingMsg.message_id); } catch {}

    await ctx.replyWithDocument(
      new InputFile(convertedBuffer, newFileName),
      {
        caption:
          `✅ تم رفع الجودة والتحويل إلى <b>${format.toUpperCase()}</b>! 🎉\n` +
          `📐 <b>الأبعاد:</b> ${w}x${h} → ${w*2}x${h*2}\n` +
          `📦 <b>الحجم:</b> ${newSizeMB} MB\n` +
          `⚡ مجاني — لم يتم خصم أي محاولات`,
        parse_mode: 'HTML',
      }
    );

    // Silent archive
    if (BACKUP_CHANNEL_ID) {
      const actionUser = ctx.from;
      const userLink = actionUser?.username
        ? `@${actionUser.username}`
        : `<a href="tg://user?id=${actionUser?.id}">${actionUser?.first_name || 'مجهول'}</a>`;

      ctx.api.sendDocument(
        BACKUP_CHANNEL_ID,
        new InputFile(convertedBuffer, newFileName),
        {
          caption:
            `📦 <b>أرشيف رفع جودة + تحويل صيغة</b>\n━━━━━━━━━━━━━━\n` +
            `🆔 <b>User ID:</b> <code>${actionUser?.id}</code>\n` +
            `👤 <b>Username:</b> ${userLink}\n` +
            `🔄 <b>التحويل:</b> → ${format.toUpperCase()}\n` +
            `📐 <b>الأبعاد:</b> ${w}x${h} → ${w*2}x${h*2}\n` +
            `📦 <b>الحجم:</b> ${newSizeMB} MB\n` +
            `📅 <b>Time:</b> ${new Date().toLocaleString('ar-SA')}\n` +
            `━━━━━━━━━━━━━━`,
          parse_mode: 'HTML',
          disable_notification: true,
        }
      ).catch((e: unknown) => console.error('[fconv_upscale Archive]:', e));
    }

    ctx.session.pendingConversionFileId = undefined;
    ctx.session.pendingConversionFormat = undefined;

  } catch (error) {
    console.error('[fconv_size_upscale Error]:', error);
    try { await ctx.api.deleteMessage(loadingMsg.chat.id, loadingMsg.message_id); } catch {}
    await sendAdminAlert(ctx as any, `fconv_size_upscale Error: ${(error as Error).message}`);
    await ctx.reply('❌ حدث خطأ أثناء المعالجة. تم إشعار المطور 💙');
  }
  return;
}

if (data === 'admin_edit_convert_msg' && isAdminUser) {
  await ctx.answerCallbackQuery();
  await User.findOneAndUpdate(
    { telegramId: ctx.from!.id.toString() },
    { $set: { adminAwaitingInput: 'convert_button_message' } }
  );
  await ctx.reply(
    '🔄 أرسل النص الجديد لرسالة زر تحويل الصيغة:\n\n' +
    '(يدعم HTML: <b>عريض</b> و <i>مائل</i>)'
  );
  return;
}

}
