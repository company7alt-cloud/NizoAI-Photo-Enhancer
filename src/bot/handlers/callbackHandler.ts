// src/bot/handlers/callbackHandler.ts
import { InputFile } from 'grammy';
import { v4 as uuidv4 } from 'uuid';
import { User } from '../../database/models/User';
import { handleAdminCallback } from '../commands/admin';
import { BotContext, isAdmin } from '../../utils/validators';
import { claimChannelReward } from '../../services/channelFundService';
import * as imageService from '../../services/imageService';

const ARCHIVE_GROUP_ID = process.env.ARCHIVE_GROUP_ID ?? '';
const CHANNEL_ID = process.env.CHANNEL_ID ?? '';

export async function callbackHandler(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data || !ctx.from) return;

  // Route admin callbacks immediately
  if (data.startsWith('admin_')) return handleAdminCallback(ctx);

  // ── claim_reward_{channelId} ─────────────────────────────────────────────────
  if (data.startsWith('claim_reward_')) {
    await ctx.answerCallbackQuery();
    const channelId = data.replace('claim_reward_', '');
    const userId = ctx.from.id;

    const result = await claimChannelReward(userId, channelId, ctx.api);

    if (result === 'REWARDED') {
      await ctx.reply(
        '✅ تم التحقق! تم إضافة 5 محاولات لرصيدك 🎉\n' +
          'استمتع بتحسين صورك بجودة احترافية 🌟'
      );
    } else if (result === 'ALREADY_CLAIMED') {
      await ctx.answerCallbackQuery({
        text: 'لقد حصلت على مكافأة هذه القناة من قبل ✅',
        show_alert: true,
      });
    } else if (result === 'NOT_MEMBER') {
      await ctx.answerCallbackQuery({
        text: '❌ لم تشترك بعد. اشترك ثم حاول مجدداً 🔄',
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

  // ── STEP 3: Reset quota if 24h have passed ────────────────────────────────────
  if (
    !user.lastQuotaReset ||
    Date.now() - new Date(user.lastQuotaReset).getTime() > 24 * 60 * 60 * 1000
  ) {
    user.dailyQuota = 5;
    user.lastQuotaReset = new Date();
    await user.save();
  }

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
    resolution: string
  ): Promise<void> => {
    if (!CHANNEL_ID) return;
    const displayName = ctx.from!.username
      ? `@${ctx.from!.username}`
      : ctx.from!.first_name ?? 'مستخدم';
    try {
      await ctx.api.sendDocument(
        CHANNEL_ID,
        new InputFile(buf, fileName),
        {
          caption:
            `✨ تم تحسين صورة جديدة بواسطة: ${displayName} | NizoAI Bot\n` +
            `💎 الدقة: ${resolution}`,
        }
      );
    } catch (err: unknown) {
      console.error('[Channel] Forward failed (silent):', err);
    }
  };

  // ── STEP 6: enhance_2k ───────────────────────────────────────────────────────
  if (data === 'enhance_2k') {
    await ctx.answerCallbackQuery();

    if (!admin && user.dailyQuota < 1) {
      await ctx.reply(
        '🌙 أوه! انتهت محاولاتك اليومية 🥺\nعد غداً وستجد 5 محاولات جديدة بانتظارك 🎁✨'
      );
      return;
    }

    const telegramFileUrl = await getTelegramFileUrl();
    if (!telegramFileUrl) {
      await ctx.reply('❌ انتهت الجلسة. أرسل الصورة مجدداً.');
      return;
    }

    if (!admin) {
      user.dailyQuota -= 1;
      await user.save();
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
      await ctx.deleteMessage().catch(() => {});

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
      if (!admin) {
        user.dailyQuota += 1;
        await user.save();
      }
      await ctx.deleteMessage().catch(() => {});
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
      await ctx.deleteMessage().catch(() => {});

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
      await ctx.deleteMessage().catch(() => {});
      await ctx.reply(
        '😔 عذراً حدث خطأ أثناء معالجة صورتك بدقة 4K 🌸\nتم إعادة المحاولتين تلقائياً ✨\nجرب مرة أخرى وسنكون معك 💙'
      );
    }
    return;
  }

  // ── enhance_again ─────────────────────────────────────────────────────────────
  if (data === 'enhance_again') {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('📸 أرسل الصورة الجديدة التي تريد تحسينها.');
    return;
  }
}
