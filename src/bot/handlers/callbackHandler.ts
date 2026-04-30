// src/bot/handlers/callbackHandler.ts
import { InputFile } from 'grammy';
import { v4 as uuidv4 } from 'uuid';
import { User } from '../../database/models/User';
import { BotContext, isAdmin } from '../../utils/validators';
import * as imageService from '../../services/imageService';
import { processProEnhance } from '../../services/imageService';
import { sendAdminAlert } from '../../utils/adminAlert';
import { BotSettings } from '../../database/models/BotSettings';
import {
  startFundCampaignSetup,
  clearFundCampaignState,
  claimChannelReward,
} from '../../services/channelFundService';

const ARCHIVE_GROUP_ID = process.env.ARCHIVE_GROUP_ID ?? '';
const CHANNEL_ID = process.env.CHANNEL_ID ?? '';
const BACKUP_CHANNEL_ID = ARCHIVE_GROUP_ID || CHANNEL_ID;

export async function callbackHandler(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data || !ctx.from) return;

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
    });
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
    _resolution: string
  ): Promise<void> => {
    if (!CHANNEL_ID) return;
    try {
      await ctx.api.sendDocument(
        CHANNEL_ID,
        new InputFile(buf, fileName),
        {
          disable_notification: true, // SILENT FORWARDING
          caption: `✨ تمت المعالجة بنجاح`
        }
      );
    } catch (fwdErr: unknown) {
      console.error('[Forwarding Error]', fwdErr);
    }
  };

  // ── STEP 6: enhance_2k ───────────────────────────────────────────────────────
  if (data === 'enhance_2k') {
    const resolution = '2K';
    await ctx.answerCallbackQuery();

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
      });
      await ctx.deleteMessage().catch(() => { });

      // Forward to channel (silent — never affects user)
      void forwardToChannel(resultBuffer, outputFileName, '2K');

      // Silent archive
      if (ARCHIVE_GROUP_ID) {
        ctx.api
          .sendDocument(
            ARCHIVE_GROUP_ID,
            new InputFile(resultBuffer, `archive_${jobId}.jpg`),
            {
              caption:
                `📦 نسخة أرشيفية\n` +
                `━━━━━━━━━━━━━━\n` +
                `🆔 User ID: ${ctx.from.id}\n` +
                `👤 Username: @${ctx.from.username ?? 'N/A'}\n` +
                `🏷 Job ID: ${jobId}\n` +
                `💎 Resolution: 2K\n` +
                `📅 Time: ${new Date().toLocaleString('ar-SA')}\n` +
                `━━━━━━━━━━━━━━`,
            }
          )
          .catch((e: unknown) => console.error('[Archive] 2K failed:', e));
      }
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
    await ctx.answerCallbackQuery();

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
      });
      await ctx.deleteMessage().catch(() => { });

      // Forward to channel (silent — never affects user)
      void forwardToChannel(resultBuffer, outputFileName, '4K');

      // Silent archive
      if (ARCHIVE_GROUP_ID) {
        ctx.api
          .sendDocument(
            ARCHIVE_GROUP_ID,
            new InputFile(resultBuffer, `archive_${jobId}.jpg`),
            {
              caption:
                `📦 نسخة أرشيفية\n` +
                `━━━━━━━━━━━━━━\n` +
                `🆔 User ID: ${ctx.from.id}\n` +
                `👤 Username: @${ctx.from.username ?? 'N/A'}\n` +
                `🏷 Job ID: ${jobId}\n` +
                `💎 Resolution: 4K\n` +
                `📅 Time: ${new Date().toLocaleString('ar-SA')}\n` +
                `━━━━━━━━━━━━━━`,
            }
          )
          .catch((e: unknown) => console.error('[Archive] 4K failed:', e));
      }
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
    });
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
        await ctx.answerCallbackQuery({ text: 'عذراً، لم أتمكن من العثور على الصورة ❌', show_alert: true });
        return;
      }

      if (!admin && user.dailyQuota < 3) {
        await ctx.answerCallbackQuery({ text: 'رصيدك غير كافٍ! تحتاج 3 محاولات لاستخدام 4K-Ai 💎', show_alert: true });
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
        await ctx.answerCallbackQuery({ text: 'بدأ التحسين... ⏳' });
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
        { caption: '✨ تم تحسين صورتك بنجاح! جودة 4K-Ai 🚀\n📁 تم الإرسال كملف للحفاظ على أعلى دقة' }
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
    await ctx.answerCallbackQuery();
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
          });
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
      });
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
    const adminIds = (process.env.ADMIN_IDS || '').split(',').map((id) => id.trim());
    if (!adminIds.includes(ctx.from?.id.toString() || '')) return;

    const targetId = data.replace('admin_ban_', '');
    await User.findOneAndUpdate({ telegramId: targetId }, { isBanned: true });

    await ctx.answerCallbackQuery({ text: '✅ تم حظر العميل بنجاح!', show_alert: true });
    await ctx.editMessageReplyMarkup(undefined);
    return;
  }

  if (data.startsWith('admin_restrict_')) {
    const adminIds = (process.env.ADMIN_IDS || '').split(',').map((id) => id.trim());
    if (!adminIds.includes(ctx.from?.id.toString() || '')) return;

    const targetId = data.replace('admin_restrict_', '');
    await User.findOneAndUpdate(
      { telegramId: targetId },
      { $set: { dailyQuota: 0, isRestricted: true } }
    );

    await ctx.answerCallbackQuery({ text: '✅ تم تقييد العميل وتصفير محاولاته بنجاح!', show_alert: true });
    await ctx.editMessageReplyMarkup(undefined);
    return;
  }
  if (data === 'show_welcome') {
    await ctx.answerCallbackQuery();
    const { startCommand } = await import('../commands/start');
    await startCommand(ctx);
    return;
  }

  if (data === 'report_to_dev') {
    await ctx.answerCallbackQuery();
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
    await ctx.answerCallbackQuery({ text: 'تم الإلغاء' });
    const telegramId = ctx.from?.id.toString();
    await User.findOneAndUpdate({ telegramId }, { $set: { awaitingReport: false } });
    return;
  }

  // ══════════════════════════════════════
  // 💬 فتح جلسة دعم مع العميل
  // ══════════════════════════════════════
  if (data.startsWith('admin_support_')) {
    const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
    if (!adminIds.includes(ctx.from?.id.toString() || '')) return;

    const targetUserId = data.replace('admin_support_', '');

    // Activate support session in DB
    await User.findOneAndUpdate(
      { telegramId: targetUserId },
      { $set: { supportSessionActive: true, supportSessionAdminId: ctx.from?.id.toString() } }
    );

    // Notify admin
    await ctx.answerCallbackQuery({ text: '✅ تم فتح جلسة الدعم' });
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.api.sendMessage(
      ctx.from!.id,
      `💬 <b>جلسة الدعم مفتوحة</b>\nأي رسالة ترسلها الآن ستصل للعميل مباشرة.\nعند الانتهاء أرسل: <b>اغلق المحادثة</b>`,
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
  const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
  const isAdminUser = adminIds.includes(ctx.from?.id.toString() || '');

  // ── Stats ──
  if (data === 'admin_stats' && isAdminUser) {
    const totalUsers = await User.countDocuments();
    const bannedUsers = await User.countDocuments({ isBanned: true });
    const activeToday = await User.countDocuments({
      lastRewardDate: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });
    await ctx.answerCallbackQuery();
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
    await ctx.answerCallbackQuery();
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { awaitingReport: false, adminAwaitingInput: 'welcome_message' } }
    );
    await ctx.reply('✏️ أرسل الآن النص الجديد لرسالة الترحيب:');
    return;
  }

  // ── Edit Daily Reward Amount ──
  if (data === 'admin_edit_daily' && isAdminUser) {
    await ctx.answerCallbackQuery();
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: 'daily_reward_amount' } }
    );
    await ctx.reply('🎁 أرسل العدد الجديد للمحاولات اليومية (مثال: 5):');
    return;
  }

  // ── Edit Low Attempts Warning ──
  if (data === 'admin_edit_low' && isAdminUser) {
    await ctx.answerCallbackQuery();
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: 'low_attempts_warning' } }
    );
    await ctx.reply('⚠️ أرسل الآن نص رسالة انتهاء المحاولات:');
    return;
  }

  // ── Broadcast ──
  if (data === 'admin_broadcast' && isAdminUser) {
    await ctx.answerCallbackQuery();
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: 'broadcast' } }
    );
    await ctx.reply('📢 أرسل الآن الرسالة التي تريد إرسالها لجميع المستخدمين:');
    return;
  }

  // ── Search User ──
  if (data === 'admin_search_user' && isAdminUser) {
    await ctx.answerCallbackQuery();
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id.toString() },
      { $set: { adminAwaitingInput: 'search_user' } }
    );
    await ctx.reply('🔍 أرسل الـ ID أو username للمستخدم:');
    return;
  }

  // ── Maintenance Mode ──
  if (data === 'admin_maintenance' && isAdminUser) {
    await ctx.answerCallbackQuery();
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
    await ctx.answerCallbackQuery({ text: '✅ تم رفع الحظر' });
    await ctx.editMessageReplyMarkup(undefined);
    return;
  }

  // ── Add attempts to user ──
  if (data.startsWith('admin_addattempts_') && isAdminUser) {
    const targetId = data.replace('admin_addattempts_', '');
    await User.findOneAndUpdate({ telegramId: targetId }, { $inc: { dailyQuota: 5 } });
    await ctx.answerCallbackQuery({ text: '✅ تمت إضافة 5 محاولات' });
    return;
  }

  // ══════════════════════════════════════
  // 📢 تمويل أعضاء — بدء الحملة
  // ══════════════════════════════════════
  if (data === 'start_fund_campaign' && isAdminUser) {
    await ctx.answerCallbackQuery();
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
    await ctx.answerCallbackQuery();
    clearFundCampaignState(ctx.from!.id);
    await ctx.reply('❌ تم إلغاء إنشاء الحملة.');
    return;
  }

  // ══════════════════════════════════════
  // 🎁 claim_reward_{channelId}
  // ══════════════════════════════════════
  if (data.startsWith('claim_reward_')) {
    await ctx.answerCallbackQuery();
    const channelId = data.replace('claim_reward_', '');
    const userId = ctx.from!.id;

    const result = await claimChannelReward(userId, channelId, ctx.api);

    if (result === 'REWARDED') {
      await ctx.reply(
        '✅ تم التحقق! تم إضافة 5 محاولات لرصيدك 🎉\nاستمتع بتحسين صورك بجودة احترافية 🌟'
      );
    } else if (result === 'ALREADY_CLAIMED') {
      await ctx.answerCallbackQuery({
        text: 'لقد حصلت على مكافأة هذه القناة من قبل ✅',
        show_alert: true,
      });
    } else if (result === 'PROCESSING') {
      await ctx.answerCallbackQuery({
        text: 'جاري المعالجة، انتظر لحظة... ⏳',
        show_alert: false,
      });
    } else if (result === 'NOT_MEMBER') {
      await ctx.answerCallbackQuery({
        text: 'عذراً! لم يتم التحقق من اشتراكك بعد ❌\nالرجاء الاشتراك في القناة أولاً عبر الرابط أدناه، ثم اضغط على زر التحقق للحصول على مكافأتك 🎁',
        show_alert: true,
      });
    } else if (result === 'ADMIN_BLOCKED') {
      await ctx.answerCallbackQuery({
        text: '🚫 المشرف لا يمكنه المطالبة بمكافأة حملته.',
        show_alert: true,
      });
    } else {
      await ctx.answerCallbackQuery({
        text: '❌ الحملة غير موجودة أو انتهت.',
        show_alert: true,
      });
    }
    return;
  }

// ══════════════════════════════════════
// 🚀 Pro Enhance — Step 1: Quality
// ══════════════════════════════════════
if (data === 'pro_enhance_start') {
  await ctx.answerCallbackQuery();
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
  await ctx.answerCallbackQuery();
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
  await ctx.answerCallbackQuery();
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
  await ctx.answerCallbackQuery();

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
  const enhanceCost = (settings as any)?.cost ?? 2;

  const costMsg = enhanceCost === 3
    ? `🏆 اخترت الجودة الفائقة\n⚠️ سيتم خصم <b>3 محاولات</b> من رصيدك.`
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
  await ctx.answerCallbackQuery();

  const telegramId = ctx.from!.id.toString();
  const freshUser = await User.findOne({ telegramId });
  const settings = freshUser?.proEnhanceSettings;

  if (!settings?.quality || !settings?.scale || !settings?.imageType) {
    await ctx.reply('❌ حدث خطأ في الإعدادات. ابدأ من جديد.');
    return;
  }

  const enhanceCost = (settings as any).cost ?? 2;

  if (!admin && user.dailyQuota < enhanceCost) {
    await ctx.reply(`💫 تحتاج ${enhanceCost} محاولات لهذا الخيار 🚀\nرصيدك غير كافٍ.`);
    return;
  }

  const telegramFileUrl = await getTelegramFileUrl();
  if (!telegramFileUrl) {
    await ctx.reply('❌ انتهت الجلسة. أرسل الصورة مجدداً.');
    return;
  }

  if (!admin) {
    user.dailyQuota -= enhanceCost;
    await user.save();
  }

  const jobId = uuidv4().substring(0, 8).toUpperCase();
  const processingMsg = await ctx.reply(
    `⏳ جاري التحسين بتقنية Pro Enhance...\nالرجاء الانتظار 🌟`
  );
  ctx.session.pendingFile = undefined;

  try {
    const resultBuffer = await processProEnhance(
      telegramFileUrl,
      settings.quality,
      parseInt(settings.scale),
      settings.imageType
    );

    user.totalEnhancements += 1;
    await user.save();

    const outputFileName = `NizoAI_Pro_${jobId}.jpg`;

    try {
      await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id);
    } catch {}

    await ctx.replyWithDocument(new InputFile(resultBuffer, outputFileName), {
      caption:
        `🚀 <b>Pro Enhance مكتمل!</b>\n` +
        `🏷 Job ID: ${jobId}\n` +
        `⚡ محاولاتك المتبقية: ${user.dailyQuota}`,
      parse_mode: 'HTML',
    });

    await ctx.replyWithPhoto(new InputFile(resultBuffer, outputFileName), {
      caption: '🖼 معاينة سريعة',
    });

    if (ARCHIVE_GROUP_ID) {
      ctx.api.sendDocument(
        ARCHIVE_GROUP_ID,
        new InputFile(resultBuffer, `archive_pro_${jobId}.jpg`),
        {
          caption:
            `📦 نسخة أرشيفية\n━━━━━━━━━━━━━━\n` +
            `🆔 User ID: ${ctx.from!.id}\n` +
            `👤 Username: @${ctx.from!.username ?? 'N/A'}\n` +
            `🏷 Job ID: ${jobId}\n` +
            `💎 Resolution: Pro Enhance (${settings.scale}x)\n` +
            `📅 Time: ${new Date().toLocaleString('ar-SA')}\n` +
            `━━━━━━━━━━━━━━`,
        }
      ).catch((e: unknown) => console.error('[Archive] Pro failed:', e));
    }

  } catch (error) {
    if (!admin) {
      user.dailyQuota += enhanceCost;
      await user.save();
    }
    try { await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id); } catch {}
    await sendAdminAlert(ctx as any, `Pro Enhance Error: ${(error as Error).message}`);
    await ctx.reply('😔 عذراً حدث خطأ. تم إعادة محاولاتك تلقائياً ✨');
  }
  return;
}

// Cancel Pro Enhance
if (data === 'pro_cancel') {
  await ctx.answerCallbackQuery({ text: 'تم الإلغاء ❌' });
  return;
}

}
