import { Context, Markup } from 'telegraf';

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

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🚫 حظر العميل', `admin_ban_${userId}`)],
      [Markup.button.callback('🔒 تقييد العميل', `admin_restrict_${userId}`)],
    ]);

    for (const adminId of adminIds) {
      await ctx.telegram.sendMessage(adminId, message, {
        parse_mode: 'HTML',
        ...keyboard,
      });
    }
  } catch (err) {
    console.error('[adminAlert] فشل إرسال التنبيه للمدير:', err);
  }
}
