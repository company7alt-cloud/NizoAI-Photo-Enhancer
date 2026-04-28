// src/bot/commands/start.ts
import { InlineKeyboard } from 'grammy';
import { User } from '../../database/models/User';
import { Settings } from '../../database/models/Settings';
import { BotContext } from '../../utils/validators';
import { addAttemptsWithDebtCheck } from '../../services/channelFundService';

// ─── /start ───────────────────────────────────────────────────────────────────

export async function startCommand(ctx: BotContext): Promise<void> {
  const telegramId = ctx.from!.id;
  const firstName = ctx.from!.first_name ?? 'User';
  const username = ctx.from!.username;
  const language = ctx.from!.language_code ?? 'en';

  // ctx.match contains everything after /start (the payload)
  const rawPayload = (ctx.match as string | undefined)?.trim() ?? '';

  try {
    // ── 1. Referrer detection ──────────────────────────────────────────────────
    const referrerId = parseReferralPayload(rawPayload);

    // ── 2. Check if user is brand-new (not in DB) ──────────────────────────────
    const existingUser = await User.findOne({ telegramId });
    const isActuallyNew = !existingUser;

    // ── 3. Find or create user ─────────────────────────────────────────────────
    const { user, isNew } = await User.findOrCreate({
      telegramId,
      firstName,
      username,
      language,
      dailyQuota: isActuallyNew ? 5 : existingUser!.dailyQuota,
      lastQuotaReset: isActuallyNew ? new Date() : existingUser!.lastQuotaReset,
    });

    // ── 4. Referral reward (strict rules) ──────────────────────────────────────
    if (isActuallyNew && referrerId !== null && referrerId !== telegramId) {
      const referrer = await User.findOne({ telegramId: referrerId });

      if (
        referrer &&
        !referrer.isBanned &&
        !referrer.referredUsers.includes(telegramId)
      ) {
        // Add 20 points via the shared debt-aware function
        await addAttemptsWithDebtCheck(referrerId, 20);

        // Record this user so the same referrer cannot claim again
        referrer.referredUsers.push(telegramId);
        referrer.referralCount += 1;
        await referrer.save();

        // Notify referrer
        ctx.api
          .sendMessage(
            referrerId,
            '🎉 مبروك! انضم شخص عبر رابطك وحصلت على 20 نقطة!'
          )
          .catch(() => {});
      }
    }

    // ── 5. Admin notification for new joins ────────────────────────────────────
    if (isNew) {
      const notifyOnJoin = (await Settings.get('notify_on_join')) as boolean;
      if (notifyOnJoin === true) {
        const adminIds = (process.env.ADMIN_IDS ?? '')
          .split(',')
          .map((id) => parseInt(id.trim(), 10))
          .filter((id) => !isNaN(id));

        const notif = `👤 *عضو جديد!*\nالاسم: ${firstName}\nالآيدي: \`${telegramId}\``;
        for (const aid of adminIds) {
          ctx.api
            .sendMessage(aid, notif, { parse_mode: 'Markdown' })
            .catch(() => {});
        }
      }
    }

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

    const greeting =
      `- مرحباً ( ${firstName} ) 🎃\n\n` +
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

    const keyboard = new InlineKeyboard();
    if (devLink) keyboard.url('المطور', devLink);
    if (chanLink) keyboard.url('القناة', chanLink);

    await ctx.reply(greeting, {
      parse_mode: undefined,
      reply_markup: devLink || chanLink ? keyboard : undefined,
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
