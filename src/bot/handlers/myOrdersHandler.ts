// src/bot/handlers/myOrdersHandler.ts
import { BotContext } from '../../utils/validators';
import { User } from '../../database/models/User';
import { Order } from '../../database/models/Order';
import crypto from 'crypto';

const ALERT_CHANNEL_ID: number = Number(process.env.ALERT_CHANNEL_ID ?? '-1001912891669');

// Dynamic progress texts (index = progressStage 0–4)
const PROGRESS_TEXTS = [
  '⏳ جاري استلام طلبك...',
  '🔍 يتم الآن تحليل الطلب...',
  '⚙️ طلبك تحت المعالجة...',
  '🚀 جاري وضع اللمسات الأخيرة...',
  '✅ اقتربنا من الانتهاء!',
];

function buildProgressBar(stage: number): string {
  const filled = Math.min(stage, 5);
  const empty  = 5 - filled;
  const pct    = Math.round((filled / 5) * 100);
  return `${'▰'.repeat(filled)}${'▱'.repeat(empty)} ${pct}%`;
}

// ── Show "طلباتي" main menu ──────────────────────────────────────────────────
export async function handleMyOrdersMenu(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => {});
  const telegramId = ctx.from!.id.toString();
  const user = await User.findOne({ telegramId: Number(telegramId) });
  const totalEnhancements = user?.totalEnhancements ?? 0;

  const activeOrders = await Order.find({
    userId: telegramId,
    status: { $nin: ['completed', 'cancelled'] },
  }).sort({ createdAt: -1 }).limit(10);

  const welcomeText =
    `📦 <b>طلباتي</b>\n\n` +
    `شكراً على ثقتك بنا يا <b>${ctx.from?.first_name || 'صديقي'}</b> 💙\n` +
    `لقد أنجزنا معك <b>${totalEnhancements}</b> عملية حتى الآن ✨\n\n` +
    (activeOrders.length === 0
      ? `<i>لا توجد طلبات نشطة حالياً.</i>`
      : `<b>طلباتك النشطة:</b>`);

  const orderButtons = activeOrders.map((order) => ([
    {
      text: `🔵 ${order.serviceName}`,
      callback_data: `order_details_${order.orderId}`,
      // @ts-ignore
      style: 'primary' as const,
    },
  ]));

  const keyboard = {
    inline_keyboard: [
      ...orderButtons,
      [
        {
          text: '🔙 رجوع',
          callback_data: 'back_to_main',
          // @ts-ignore
          style: 'primary' as const,
        },
      ],
    ],
  };

  if (ctx.callbackQuery) {
    await ctx.editMessageText(welcomeText, {
      parse_mode: 'HTML',
      reply_markup: keyboard as any,
    }).catch(() => {});
    await ctx.answerCallbackQuery();
  } else {
    await ctx.reply(welcomeText, {
      parse_mode: 'HTML',
      reply_markup: keyboard as any,
    });
  }
}

// ── Show individual order details ────────────────────────────────────────────
export async function handleOrderDetails(ctx: BotContext, orderId: string): Promise<void> {
  const order = await Order.findOne({ orderId });
  if (!order) {
    await ctx.answerCallbackQuery({ text: '❌ الطلب غير موجود أو انتهت صلاحيته.', show_alert: true });
    return;
  }

  const stage     = Math.min(order.progressStage, 4);
  const progressBar = buildProgressBar(order.progressStage);
  const stageText   = PROGRESS_TEXTS[stage];

  const text =
    `📋 <b>تفاصيل الطلب</b>\n\n` +
    `🏷 <b>الخدمة:</b> ${order.serviceName}\n` +
    `📊 <b>الحالة:</b> ${stageText}\n\n` +
    `<b>التقدم:</b> ${progressBar}\n`;

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: '🔄 تحديث الطلب',
          callback_data: `refresh_order_${orderId}`,
          // @ts-ignore
          style: 'success' as const,
        },
        {
          text: '❌ إلغاء الطلب',
          callback_data: `request_cancel_${orderId}`,
          // @ts-ignore
          style: 'danger' as const,
        },
      ],
      [
        {
          text: '🔙 رجوع لطلباتي',
          callback_data: 'my_orders_menu',
          // @ts-ignore
          style: 'primary' as const,
        },
      ],
    ],
  };

  await ctx.editMessageText(text, {
    parse_mode: 'HTML',
    reply_markup: keyboard as any,
  }).catch(() => {});
  await ctx.answerCallbackQuery();
}

// ── Refresh order (increment progressStage) ──────────────────────────────────
export async function handleRefreshOrder(ctx: BotContext, orderId: string): Promise<void> {
  const order = await Order.findOne({ orderId });
  if (!order) {
    await ctx.answerCallbackQuery({ text: '❌ الطلب غير موجود.', show_alert: true });
    return;
  }

  if (order.progressStage < 5) {
    await Order.updateOne({ orderId }, { $inc: { progressStage: 1 } });
    order.progressStage = Math.min(order.progressStage + 1, 5);
  }

  const stage       = Math.min(order.progressStage, 4);
  const progressBar = buildProgressBar(order.progressStage);
  const stageText   = PROGRESS_TEXTS[stage];

  const text =
    `📋 <b>تفاصيل الطلب</b>\n\n` +
    `🏷 <b>الخدمة:</b> ${order.serviceName}\n` +
    `📊 <b>الحالة:</b> ${stageText}\n\n` +
    `<b>التقدم:</b> ${progressBar}\n`;

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: '🔄 تحديث الطلب',
          callback_data: `refresh_order_${orderId}`,
          // @ts-ignore
          style: 'success' as const,
        },
        {
          text: '❌ إلغاء الطلب',
          callback_data: `request_cancel_${orderId}`,
          // @ts-ignore
          style: 'danger' as const,
        },
      ],
      [
        {
          text: '🔙 رجوع لطلباتي',
          callback_data: 'my_orders_menu',
          // @ts-ignore
          style: 'primary' as const,
        },
      ],
    ],
  };

  await ctx.editMessageText(text, {
    parse_mode: 'HTML',
    reply_markup: keyboard as any,
  }).catch(() => {});
  await ctx.answerCallbackQuery({ text: '✅ تم تحديث حالة الطلب!' });
}

// ── Request cancellation ─────────────────────────────────────────────────────
export async function handleRequestCancel(ctx: BotContext, orderId: string): Promise<void> {
  const telegramId = ctx.from!.id;
  const user = await User.findOne({ telegramId });

  if (!user) {
    await ctx.answerCallbackQuery({ text: '❌ حدث خطأ.', show_alert: true });
    return;
  }

  // Reset daily counter if it's a new day
  const today = new Date().toDateString();
  const lastDate = user.lastCancellationDate
    ? new Date(user.lastCancellationDate).toDateString()
    : null;

  if (lastDate !== today) {
    await User.updateOne({ telegramId }, { $set: { cancellationsToday: 0, lastCancellationDate: new Date() } });
    user.cancellationsToday = 0;
  }

  if ((user.cancellationsToday ?? 0) >= 2) {
    await ctx.answerCallbackQuery({
      text: '⛔ لقد استنفدت محاولات الإلغاء اليومية (2 مرات). حاول غداً.',
      show_alert: true,
    });
    return;
  }

  const order = await Order.findOne({ orderId });
  if (!order) {
    await ctx.answerCallbackQuery({ text: '❌ الطلب غير موجود.', show_alert: true });
    return;
  }

  if (order.status === 'cancel_requested') {
    await ctx.answerCallbackQuery({ text: '⏳ طلب الإلغاء مرسل بالفعل، انتظر رد الإدارة.', show_alert: true });
    return;
  }

  await Order.updateOne({ orderId }, { $set: { status: 'cancel_requested' } });

  const userName = ctx.from?.first_name ?? 'مجهول';
  const userTag  = ctx.from?.username ? `@${ctx.from.username}` : `ID: ${telegramId}`;

  const adminMsg =
    `🚨 <b>طلب إلغاء جديد</b>\n\n` +
    `👤 <b>العميل:</b> ${userName} (${userTag})\n` +
    `🆔 <b>ID:</b> <code>${telegramId}</code>\n` +
    `🏷 <b>الخدمة:</b> ${order.serviceName}\n` +
    `🔑 <b>رقم الطلب:</b> <code>${orderId}</code>\n\n` +
    `هل توافق على الإلغاء؟`;

  const adminKeyboard = {
    inline_keyboard: [[
      {
        text: '✅ قبول الإلغاء',
        callback_data: `approve_cancel_${orderId}_${telegramId}`,
        // @ts-ignore
        style: 'success' as const,
      },
      {
        text: '❌ رفض الإلغاء',
        callback_data: `reject_cancel_${orderId}_${telegramId}`,
        // @ts-ignore
        style: 'danger' as const,
      },
    ]],
  };

  try {
    await ctx.api.sendMessage(ALERT_CHANNEL_ID, adminMsg, {
      parse_mode: 'HTML',
      reply_markup: adminKeyboard as any,
    });
  } catch (e) {
    console.error('[MyOrders] Failed to notify admin channel:', e);
  }

  await ctx.answerCallbackQuery({
    text: '⏳ تم إرسال طلب الإلغاء للإدارة. انتظر ردهم.',
    show_alert: true,
  });
}

// ── Admin: Approve cancellation ──────────────────────────────────────────────
export async function handleApproveCancel(
  ctx: BotContext,
  orderId: string,
  userId: string
): Promise<void> {
  const order = await Order.findOneAndUpdate(
    { orderId },
    { $set: { status: 'cancelled' } },
    { new: true }
  );

  await User.updateOne(
    { telegramId: Number(userId) },
    { $inc: { cancellationsToday: 1 }, $set: { lastCancellationDate: new Date() } }
  );

  try {
    await ctx.api.sendMessage(
      Number(userId),
      `✅ <b>تمت الموافقة على إلغاء طلبك</b>\n\n🏷 الخدمة: ${order?.serviceName ?? orderId}\n\nشكراً لتواصلك معنا 🙏`,
      { parse_mode: 'HTML' }
    );
  } catch (e) { /* user may have blocked bot */ }

  await ctx.editMessageText(
    (ctx.callbackQuery?.message as any)?.text + '\n\n✅ <b>تمت الموافقة على الإلغاء</b>',
    { parse_mode: 'HTML' }
  ).catch(() => {});
  await ctx.answerCallbackQuery({ text: '✅ تم قبول الإلغاء وإشعار العميل.' });
}

// ── Admin: Reject cancellation ───────────────────────────────────────────────
export async function handleRejectCancel(
  ctx: BotContext,
  orderId: string,
  userId: string
): Promise<void> {
  await Order.updateOne({ orderId }, { $set: { status: 'processing' } });

  try {
    await ctx.api.sendMessage(
      Number(userId),
      `❌ <b>تم رفض طلب الإلغاء</b>\n\n🏷 رقم الطلب: <code>${orderId}</code>\n\nيرجى التواصل مع مطور البوت أو فتح بلاغ.`,
      { parse_mode: 'HTML' }
    );
  } catch (e) { /* user may have blocked bot */ }

  await ctx.editMessageText(
    (ctx.callbackQuery?.message as any)?.text + '\n\n❌ <b>تم رفض الإلغاء</b>',
    { parse_mode: 'HTML' }
  ).catch(() => {});
  await ctx.answerCallbackQuery({ text: '❌ تم رفض الإلغاء وإشعار العميل.' });
}

// ── Helper: Create a new order (call this from any handler when a service starts) ──
export async function createOrder(userId: string, serviceName: string): Promise<string> {
  const orderId = crypto.randomBytes(6).toString('hex');
  await Order.create({ userId, orderId, serviceName, status: 'pending', progressStage: 0 });
  return orderId;
}
