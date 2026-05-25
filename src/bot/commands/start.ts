// src/bot/commands/start.ts
import path from 'path';
import { User } from '../../database/models/User';
import { Settings } from '../../database/models/Settings';
import { BotContext } from '../../utils/validators';
import { safeReplyWithPhoto } from '../../utils/assetGuard';
import { getSettings } from '../../services/settingsService';
import { getGlobalCounter } from '../../services/statsService';


// ─── /start ───────────────────────────────────────────────────────────────────

export async function startCommand(ctx: BotContext): Promise<void> {
  const telegramId = ctx.from!.id;
  const firstName = ctx.from!.first_name ?? 'User';
  const username = ctx.from!.username;
  const language = ctx.from!.language_code ?? 'en';

  // ctx.match contains everything after /start (the payload)
  const rawPayload = (ctx.match as string | undefined)?.trim() ?? '';

  try {
    if (rawPayload.startsWith('magic_')) {
      const code = rawPayload.replace('magic_', '');
      const { MagicLink } = await import('../../database/models/MagicLink');

      const link = await MagicLink.findOne({ code, isActive: true });

      if (!link) {
        await ctx.reply('❌ هذا الرابط غير صالح أو تم إيقافه.');
        return;
      }

      if (new Date() > link.expiresAt) {
        await ctx.reply('⏳ عذراً، لقد انتهت صلاحية هذا الرابط (مرت 24 ساعة).');
        return;
      }

      if (link.usedBy.includes(ctx.from!.id.toString())) {
        await ctx.reply('⚠️ لقد استخدمت هذا الرابط من قبل وحصلت على المكافأة.');
        return;
      }

      // Atomic update: claim reward
      const updated = await MagicLink.findOneAndUpdate(
        {
          code,
          isActive: true,
          currentUses: { $lt: link.maxUses },
          usedBy: { $ne: ctx.from!.id.toString() }
        },
        {
          $inc: { currentUses: 1 },
          $push: { usedBy: ctx.from!.id.toString() }
        },
        { new: true }
      );

      if (!updated) {
        await ctx.reply('❌ انتهت صلاحية هذا الرابط أو تم الوصول للحد الأقصى للمستخدمين.');
        return;
      }

      // Add reward to user
      await User.findOneAndUpdate(
        { telegramId: ctx.from!.id.toString() },
        { $inc: { dailyQuota: link.reward } },
        { upsert: true }
      );

      // Auto-deactivate if max uses reached
      if (updated.currentUses >= updated.maxUses) {
        await MagicLink.findOneAndUpdate({ code }, { $set: { isActive: false } });
      }

      await ctx.reply(
        `🎉 <b>مبروك! رابط المكافأة صالح</b>\n\nتم إضافة <b>${link.reward}</b> محاولات مجانية لرصيدك 🚀\nاستمتع بتجربة البوت الاحترافية ✨`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    // ── 1. Referrer detection ──────────────────────────────────────────────────
    const referrerId = parseReferralPayload(rawPayload);

    // ── 2. Check if user is brand-new (not in DB) ──────────────────────────────
    const existingUser = await User.findOne({ telegramId });
    const isActuallyNew = !existingUser;

    const now = new Date();
    const userId = ctx.from?.id;
    const displayFirstName = ctx.from?.first_name || 'مجهول';
    const displayUsername = ctx.from?.username ? `@${ctx.from.username}` : 'لا يوجد معرف';
    const userLink = `tg://user?id=${userId}`;
    const timeStr = now.toLocaleString('ar-SA');

    if (!existingUser) {
      // Count total users AFTER creating the new user
      // Since this runs before user creation in the DB, we add +1 to reflect the true count
      const totalUsers = (await User.countDocuments()) + 1;

      const notifMessage =
        `🆕 <b>مستخدم جديد انضم للبوت!</b>\n\n` +
        `👤 <b>الاسم:</b> <a href="${userLink}">${displayFirstName}</a>\n` +
        `🔗 <b>المعرف:</b> ${displayUsername}\n` +
        `🆔 <b>الـ ID:</b> <code>${userId}</code>\n` +
        `📅 <b>وقت الانضمام:</b> ${timeStr}\n\n` +
        `👥 <b>إجمالي المستخدمين الآن: ${totalUsers}</b>`;

      const alertChannelRaw = process.env.ALERT_CHANNEL_ID?.trim();
      const adminIdsRaw = process.env.ADMIN_IDS || '';
      const adminIds = adminIdsRaw.split(',').map((id) => id.trim());

      const targets: (string | number)[] = [];

      if (alertChannelRaw) {
        // Correctly parse negative channel IDs for Telegram API
        const channelIdNum = Number(alertChannelRaw);
        targets.push(!isNaN(channelIdNum) ? channelIdNum : alertChannelRaw);
      } else {
        targets.push(...adminIds);
      }

      for (const target of targets) {
        try {
          await ctx.api.sendMessage(target, notifMessage, { parse_mode: 'HTML' });
        } catch (e) {
          console.error('[NewUser Notify] failed for target', target, e);
        }
      }
    }

    // Update lastSeenAt every visit
    await User.findOneAndUpdate(
      { telegramId: userId?.toString() },
      { $set: { lastSeenAt: now } }
    );

    // ── 3. Find or create user ─────────────────────────────────────────────────
    const { user } = await User.findOrCreate({
      telegramId,
      firstName,
      username,
      language,
      dailyQuota: isActuallyNew ? 5 : existingUser!.dailyQuota,
      lastQuotaReset: isActuallyNew ? new Date() : existingUser!.lastQuotaReset,
    });

    // ── 4. Referral reward (strict rules) ──────────────────────────────────────
    if (referrerId !== null && referrerId !== telegramId && !user.referralRewardClaimed) {
      const referrer = await User.findOne({ telegramId: referrerId });

      if (referrer) {
        // Add 5 points to referrer
        await User.updateOne({ telegramId: referrerId }, { $inc: { dailyQuota: 5, referralCount: 1 } });
        await User.updateOne({ telegramId: referrerId }, { $push: { referredUsers: telegramId } });

        // Track referral for potential clawback — write both fields atomically
        await User.findOneAndUpdate(
          { telegramId: telegramId },
          {
            $set: {
              referredBy:            referrerId,
              referralRewardClaimed: true,
            },
          }
        );
        // Keep in-memory user in sync
        user.referredBy = referrerId;
        user.referralRewardClaimed = true;

        // Notify referrer
        ctx.api
          .sendMessage(
            referrerId,
            '🎉 ياهووو! دخل صديق جديد عن طريق رابط دعوتك الخاص! 🚀\n' +
            'تم إضافة 5 محاولات مجانية لرصيدك بنجاح 💎✨\n' +
            'استمر في مشاركة رابطك واكسب أكثر! 🔥'
          )
          .catch(() => { });
      }
    }

    // ── 5. Admin notification for new joins ────────────────────────────────────
    // Legacy notification removed.

    // ── 6. Reload fresh user to get updated quota after any reward ─────────────
    const freshUser = (await User.findOne({ telegramId })) ?? user;

    // ── 7. Build greeting ──────────────────────────────────────────────────────
    const botUsername = ctx.me.username;

    let quotaLine: string;
    if (freshUser.dailyQuota < 0) {
      quotaLine =
        `⚠️ رصيدك: ${freshUser.dailyQuota} محاولة ` +
        `(دين متراكم — يُخصم من مكافآتك القادمة)`;
    } else {
      quotaLine = `🎁 محاولاتك اليومية: ${freshUser.dailyQuota}`;
    }

    const joinDate = freshUser.joinedAt
      ? new Date(freshUser.joinedAt).toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' })
      : 'غير محدد';

    const greeting =
      `- مرحباً ( ${firstName} ) 🎃\n\n` +
      `📅 تاريخ انضمامك: ${joinDate}\n\n` +
      `• هل ترغب في تحسين جودة الصور القديمة الى . 2k - 4k - 8k ؟\n\n` +
      `• من خلال بوت رفع جودة الصور يمكنك تحقيق ذالك بكل سهولة وتحسين جودة الصورة بذكاء الاصطناعي دون الحاجة لتطبيق او موقع 🙂🤍\n\n` +
      `👇👇👇\n\n` +
      `► فقط قم بإرسال الصورة واترك الباقي علينا 🤍 ◄\n\n` +
      `🔗 رابط الإحالة الخاص بك:\n` +
      `https://t.me/${botUsername}?start=${telegramId}\n\n` +
      quotaLine;

    // ── 8. Inline keyboard (developer / channel links) ─────────────────────────
    const devLink = (await Settings.get('developerLink')) as string | null;
    const chanLink = (await Settings.get('channelLink')) as string | null;

    const nanoSettings = await getSettings();
    const nanoLocks = nanoSettings.locks;
    const eraserSettingsData = await getSettings();
    const eraserLocks = eraserSettingsData.locks;
    const totalStats = await getGlobalCounter();

    const keyboard = {
      inline_keyboard: [
        // ROW 1 — Developer link (green) or empty if no link
        ...(devLink ? [[
          // @ts-ignore
          { text: 'المطور', url: devLink, style: 'success' }
        ]] : []),

        // ROW 2 — Filters + Pro Enhance (blue)
        [
          // @ts-ignore
          { text: nanoLocks.btn_filters ? '🔒 فلاتر الصور — مقفل' : '🎨 فلاتر الصور', callback_data: 'open_filters_menu', style: 'primary' },
          // @ts-ignore
          { text: '⚙️ تحسين الصور (Pro)', callback_data: 'pro_enhance_start', style: 'primary' },
        ],

        // ROW 3 — Nano AI + Format Conversion (blue)
        [
          // @ts-ignore
          { text: nanoLocks.btn_nano ? '🔒 تحسين الصورة بالذكاء — مقفل' : '✨ تحسين الصورة بالذكاء', callback_data: 'nano_banana_start', style: 'primary' },
          // @ts-ignore
          { text: '🔄 تحويل صيغة الصورة', callback_data: 'convert_format_start', style: 'primary' },
        ],

        // ROW 4 — Auto Eraser + Magic Enhance (blue)
        [
          // @ts-ignore
          { text: eraserLocks.btn_eraser ? '🔒 مُزيل النجمة التلقائي — مقفل' : '🧹 مُزيل النجمة التلقائي', callback_data: 'remove_watermark_auto', style: 'primary' },
          // @ts-ignore
          { text: nanoLocks.btn_magic_enhance ? '🔒 تحسين الصورة (AI) — مقفل' : '🪄 تحسين الصورة (AI)', callback_data: 'magic_enhance_start', style: 'primary' },
        ],

        // ROW 5 — Daily Gift (blue)
        [
          // @ts-ignore
          { text: '🎁 الهدية اليومية', callback_data: 'claim_daily_reward', style: 'primary' },
        ],

        // ROW 5 — Channel link (if present)
        ...(chanLink ? [[
          // @ts-ignore
          { text: 'القناة', url: chanLink, style: 'primary' }
        ]] : []),

        // ROW 6 — Statistics (green)
        [
          // @ts-ignore
          { text: `📈 إحصائيات المعالجة (${totalStats})`, callback_data: 'show_global_stats', style: 'success' },
        ],

        // ROW 7 — Report Developer (red)
        [
          // @ts-ignore
          { text: '🚨 إبلاغ المطور', callback_data: 'report_to_dev', style: 'danger' },
        ],
      ],
    };

    // ── 9. Send welcome message with image (bulletproof path) ─────────────────
    // NOTE: This file must be committed to GitHub.
    // Files only on the server will be wiped by git reset --hard.
    const welcomeImagePath = path.join(process.cwd(), 'assets', 'welcome_image.jpg');

    await safeReplyWithPhoto(ctx, welcomeImagePath, {
      caption: greeting,
      parse_mode: 'HTML',
      reply_markup: keyboard as any,
    });
  } catch (err: unknown) {
    console.error('[Start] Error:', err);
    await ctx.reply('❌ حدث خطأ أثناء بدء البوت.');
  }
}

// ─── /invite ──────────────────────────────────────────────────────────────────

export async function inviteCommand(ctx: BotContext): Promise<void> {
  const telegramId = ctx.from!.id;
  const botUsername = ctx.me.username;

  const link = `https://t.me/${botUsername}?start=${telegramId}`;

  await ctx.reply(
    `🔗 *رابط الإحالة الخاص بك:*\n\n` +
    `${link}\n\n` +
    `🎁 *كيف يعمل النظام؟*\n` +
    `• شارك رابطك مع أصدقائك\n` +
    `• عند انضمام أي شخص جديد عبر رابطك تحصل على *20 نقطة* فوراً!\n` +
    `• النقاط تُضاف لرصيدك التلقائي بعد تحقق انضمامه ✨`,
    { parse_mode: 'Markdown' }
  );
}

// ─── Internal helper ──────────────────────────────────────────────────────────

function parseReferralPayload(payload: string): number | null {
  if (!payload) return null;
  const id = parseInt(payload, 10);
  return isNaN(id) ? null : id;
}
