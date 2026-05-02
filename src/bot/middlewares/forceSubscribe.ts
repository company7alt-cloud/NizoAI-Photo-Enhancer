import { NextFunction, InlineKeyboard } from 'grammy';
import { BotContext } from '../../utils/validators';
import { User } from '../../database/models/User';

const EXEMPT_CALLBACKS = ['check_force_sub'];
const EXEMPT_COMMANDS = ['/start'];

export async function forceSubscribeMiddleware(
  ctx: BotContext,
  next: NextFunction
): Promise<void> {
  if (!ctx.from?.id) return next();

  // Admins always bypass
  const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
  if (adminIds.includes(ctx.from.id.toString())) return next();

  const channelId = process.env.FORCE_SUB_CHANNEL_ID?.trim();
  const channelLink = process.env.FORCE_SUB_CHANNEL_LINK?.trim() || 'https://t.me/';

  if (!channelId) return next();

  // Exempt the check callback and /start command from being blocked
  const callbackData = ctx.callbackQuery?.data;
  if (callbackData && EXEMPT_CALLBACKS.includes(callbackData)) return next();

  const messageText = ctx.message?.text;
  if (messageText && EXEMPT_COMMANDS.some(cmd => messageText.startsWith(cmd))) return next();

  try {
    const member = await ctx.api.getChatMember(channelId, ctx.from.id);
    const validStatuses = ['creator', 'administrator', 'member', 'restricted'];
    if (validStatuses.includes(member.status)) return next();
  } catch (error: any) {
    // If bot is not admin or channel not found, log and allow to prevent bot breakage
    console.error('[ForceSub] Channel check failed:', error?.message);
    return next();
  }

  // User is NOT subscribed — block and prompt
  const keyboard = new InlineKeyboard()
    .url('📢 اشترك في القناة الآن', channelLink)
    .row()
    .text('✅ تحققت من اشتراكي', 'check_force_sub');

  const text =
    `⛔ <b>وصول مقيّد</b>\n\n` +
    `عزيزي المستخدم، يجب الاشتراك في قناتنا الرسمية لاستخدام البوت 🎁\n\n` +
    `1️⃣ اضغط زر الاشتراك أدناه\n` +
    `2️⃣ بعد الاشتراك اضغط <b>تحققت من اشتراكي</b> ✅`;

  const userId = ctx.from.id.toString();

  // Delete previous force sub message if exists
  const existingUser = await User.findOne({ telegramId: userId });
  if (existingUser?.forceSubMessageId && existingUser?.forceSubChatId) {
    try {
      await ctx.api.deleteMessage(existingUser.forceSubChatId, existingUser.forceSubMessageId);
    } catch (e) { /* Message may already be deleted */ }
  }

  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery({
      text: '⛔ يجب الاشتراك في القناة أولاً!',
      show_alert: true
    }).catch(() => {});
  }

  const sentMsg = await ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: keyboard
  });

  // Save new message_id to DB
  await User.findOneAndUpdate(
    { telegramId: userId },
    {
      $set: {
        forceSubMessageId: sentMsg.message_id,
        forceSubChatId: sentMsg.chat.id
      }
    },
    { upsert: true }
  );
}
