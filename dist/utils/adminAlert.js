"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendAdminAlert = sendAdminAlert;
async function sendAdminAlert(ctx, errorDetails) {
    // ── Silently ignore routine Telegram timeouts — not real bugs ──
    if (errorDetails.includes('query is too old') ||
        errorDetails.includes('Bad Request: query is too old')) {
        return;
    }
    try {
        const adminIdsRaw = process.env.ADMIN_IDS;
        if (!adminIdsRaw)
            return;
        const adminIds = adminIdsRaw.split(',').map((id) => id.trim());
        const userId = ctx.from?.id;
        const firstName = ctx.from?.first_name || 'مجهول';
        const username = ctx.from?.username ? `@${ctx.from.username}` : 'لا يوجد معرف';
        const userLink = `tg://user?id=${userId}`;
        const message = `🚨 <b>تنبيه أمني / خطأ في البوت</b> 🚨\n\n` +
            `👤 <b>العميل:</b> <a href="${userLink}">${firstName}</a>\n` +
            `🔗 <b>المعرف:</b> ${username}\n` +
            `🆔 <b>الـ ID:</b> <code>${userId}</code>\n\n` +
            `⚠️ <b>تفاصيل الخلل:</b>\n<code>${errorDetails.slice(0, 800)}</code>`;
        const alertChannelRaw = process.env.ALERT_CHANNEL_ID?.trim() || '';
        const targets = [];
        if (alertChannelRaw) {
            const channelIdNum = Number(alertChannelRaw);
            targets.push(!isNaN(channelIdNum) ? channelIdNum : alertChannelRaw);
        }
        else {
            targets.push(...adminIds);
        }
        for (const target of targets) {
            await ctx.api.sendMessage(target, message, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🚫 حظر العميل', callback_data: `admin_ban_${userId}` }],
                        [{ text: '🔒 تقييد العميل', callback_data: `admin_restrict_${userId}` }],
                        [{ text: '💬 فتح محادثة دعم', callback_data: `admin_support_${userId}` }],
                    ],
                },
            });
        }
    }
    catch (err) {
        console.error('[adminAlert] فشل إرسال التنبيه للمدير:', err);
    }
}
//# sourceMappingURL=adminAlert.js.map