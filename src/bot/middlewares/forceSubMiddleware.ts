// src/bot/middlewares/forceSubMiddleware.ts
import { Context, NextFunction } from 'grammy';
import type { InlineKeyboardButton } from '@grammyjs/types';
import { ForceSubChannel } from '../../database/models/ForceSubChannel';

const WHITELIST_CALLBACKS = ['check_force_sub', 'captcha_', 'captcha_refresh'];

export async function forceSubMiddleware(
  ctx: Context,
  next: NextFunction
): Promise<void> {
  try {
    const matchStr: string = typeof ctx.match === 'string'
      ? ctx.match
      : typeof ctx.match === 'object' && ctx.match !== null
        ? String(Object.values(ctx.match)[0] ?? '')
        : '';
    Object.defineProperty(ctx, 'match', { value: matchStr, writable: true, configurable: true });

    if (!ctx.from || ctx.from.is_bot) {
      // Fall through to next()
    } else {
      const userIdStr = ctx.from.id.toString();
      const adminIds  = (process.env.ADMIN_IDS ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);

      if (!adminIds.includes(userIdStr) && ctx.chat?.type === 'private') {
        const cbData = ctx.callbackQuery?.data ?? '';
        if (!WHITELIST_CALLBACKS.some((w) => cbData.startsWith(w))) {
          const channels = await ForceSubChannel.find().sort({ order: 1 });
          if (channels.length > 0) {
            const notSubscribed: typeof channels = [];

            for (const ch of channels) {
              try {
                const member = await ctx.api.getChatMember(ch.channelId, ctx.from.id);
                if (['left', 'kicked'].includes(member.status)) {
                  notSubscribed.push(ch);
                }
              } catch (checkErr) {
                console.error(
                  `[ForceSubMiddleware] Cannot check channel ${ch.channelId}:`,
                  checkErr
                );
              }
            }

            if (notSubscribed.length > 0) {
              const keyboard: InlineKeyboardButton[][] = channels.map((ch) => ([{
                text: `📢 ${ch.channelName}`,
                url:  ch.channelUrl,
                style: 'primary' as const,
              } as InlineKeyboardButton]));

              keyboard.push([
                { text: '✅ تحققت من الاشتراك', callback_data: 'check_force_sub' , style: 'success' as const},
              ]);

              const text =
                '🔒 <b>يجب الاشتراك في قنواتنا لاستخدام البوت</b>\n\n' +
                'اشترك في جميع القنوات أدناه ثم اضغط ' +
                '<b>تحققت من الاشتراك</b>:';

              if (ctx.callbackQuery) {
                await ctx.answerCallbackQuery({
                  text: '⚠️ اشترك في القنوات أولاً!',
                  show_alert: true,
                }).catch(() => {});

                await ctx.editMessageText(text, {
                  parse_mode: 'HTML',
                  reply_markup: { inline_keyboard: keyboard },
                }).catch(async () => {
                  await ctx.reply(text, {
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: keyboard },
                  }).catch(() => {});
                });
              } else {
                try {
                  await ctx.reply(text, {
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: keyboard },
                  });
                } catch (err: any) {
                  if (err?.error_code === 403) {
                    console.warn(`[ForceSub] User ${ctx.from?.id} blocked the bot. Ignoring.`);
                    return;
                  }
                  console.error('[ForceSub] Error sending subscription prompt:', err?.message ?? err);
                  return;
                }
              }

              return; // HALT — do not call next()
            }
          }
        }
      }
    }
  } catch (err: unknown) {
    console.error('[ForceSubMiddleware] Unexpected error:', err);
  }

  return next();
}

