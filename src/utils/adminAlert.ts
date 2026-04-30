import { Context } from 'grammy';

export async function sendAdminAlert(ctx: Context, errorDetails: string): Promise<void> {
  try {
    const adminIdsRaw = process.env.ADMIN_IDS;
    if (!adminIdsRaw) return;
    const adminIds = adminIdsRaw.split(',').map((id) => id.trim());

    const userId = ctx.from?.id;
    const firstName = ctx.from?.first_name || 'مجهول';
    const username = ctx.from?.username ? `@${ctx.from.username}` : 'لا يوجد معرف';
    const userLink = `tg://user?id=${userId}`;

    const message =
      `🚨 <b>تنبيه أمني / خطأ في البوت</b> 🚨\n\n` +
      `👤 <b>العميل:</b> <a href="${userLink}">${firstName}</a>\n` +
      `🔗 <b>المعرف:</b> ${username}\n` +
      `🆔 <b>الـ ID:</b> <code>${userId}</code>\n\n` +
      `⚠️ <b>تفاصيل الخلل:</b>\n<code>${errorDetails.slice(0, 800)}</code>`;

    const ALERT_CHANNEL = process.env.ALERT_CHANNEL_ID || '';
    const targets = ALERT_CHANNEL ? [ALERT_CHANNEL] : adminIds;

    for (const target of targets) {
      await ctx.api.sendMessage(target, message, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚫 حظر العميل', callback_data: `admin_ban_${userId}` }],
            [{ text: '🔒 تقييد العميل', callback_data: `admin_restrict_${userId}` }],
            [{ text: '💬 فتح محادثة دعم مع العميل', callback_data: `admin_support_${userId}` }],
          ],
        },
      });
    }
  } catch (err) {
    console.error('[adminAlert] فشل إرسال التنبيه للمدير:', err);
  }
}
