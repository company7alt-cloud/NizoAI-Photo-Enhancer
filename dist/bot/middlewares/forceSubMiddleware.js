"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.forceSubMiddleware = forceSubMiddleware;
const ForceSubChannel_1 = require("../../database/models/ForceSubChannel");
const WHITELIST_CALLBACKS = ['check_force_sub'];
async function forceSubMiddleware(ctx, next) {
    if (!ctx.from || ctx.from.is_bot)
        return await next();
    // Use string comparison — Telegram IDs are too large for safe parseInt
    const userIdStr = ctx.from.id.toString();
    const adminIds = (process.env.ADMIN_IDS ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
    if (adminIds.includes(userIdStr))
        return await next();
    // Only enforce in private chats — never block group/channel updates
    if (ctx.chat?.type !== 'private')
        return await next();
    const cbData = ctx.callbackQuery?.data ?? '';
    if (WHITELIST_CALLBACKS.some((w) => cbData.startsWith(w))) {
        return await next();
    }
    try {
        const channels = await ForceSubChannel_1.ForceSubChannel.find().sort({ order: 1 });
        if (channels.length === 0)
            return await next();
        const notSubscribed = [];
        for (const ch of channels) {
            try {
                const member = await ctx.api.getChatMember(ch.channelId, ctx.from.id);
                if (['left', 'kicked'].includes(member.status)) {
                    notSubscribed.push(ch);
                }
            }
            catch (checkErr) {
                // Bot lost admin in this channel — log but do NOT block the user.
                // This prevents an infinite block loop when the bot is removed.
                console.error(`[ForceSubMiddleware] Cannot check channel ${ch.channelId}:`, checkErr);
                // Skip this channel — do not penalise user for unverifiable channels
            }
        }
        if (notSubscribed.length === 0)
            return await next();
        // One button per channel (URL) + verify button last
        const keyboard = channels.map((ch) => ([{
                text: `📢 ${ch.channelName}`,
                url: ch.channelUrl,
                style: 'primary',
            }]));
        keyboard.push([
            { text: '✅ تحققت من الاشتراك', callback_data: 'check_force_sub', style: 'success' },
        ]);
        const text = '🔒 <b>يجب الاشتراك في قنواتنا لاستخدام البوت</b>\n\n' +
            'اشترك في جميع القنوات أدناه ثم اضغط ' +
            '<b>تحققت من الاشتراك</b>:';
        if (ctx.callbackQuery) {
            await ctx.answerCallbackQuery({
                text: '⚠️ اشترك في القنوات أولاً!',
                show_alert: true,
            }).catch(() => { });
            await ctx.editMessageText(text, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: keyboard },
            }).catch(async () => {
                await ctx.reply(text, {
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: keyboard },
                }).catch(() => { });
            });
        }
        else {
            try {
                await ctx.reply(text, {
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: keyboard },
                });
            }
            catch (err) {
                if (err?.error_code === 403) {
                    console.warn(`[ForceSub] User ${ctx.from?.id} blocked the bot. Ignoring.`);
                    return; // Exit middleware gracefully — do not crash
                }
                console.error('[ForceSub] Error sending subscription prompt:', err?.message ?? err);
            }
        }
        return; // HALT — do not call next()
    }
    catch (err) {
        console.error('[ForceSubMiddleware] Unexpected error:', err);
        return;
    }
}
//# sourceMappingURL=forceSubMiddleware.js.map