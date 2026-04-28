// src/bot/commands/admin.ts
import { InputFile, InlineKeyboard } from 'grammy';
import type { Message } from '@grammyjs/types';
import { User } from '../../database/models/User';
import { Settings } from '../../database/models/Settings';
import {
  BotContext,
  isAdmin,
  sleep,
  buildAdminBackKeyboard,
  buildAdminSettingsKeyboard,
  buildUserActionKeyboard,
} from '../../utils/validators';
import {
  addAttemptsWithDebtCheck,
  isFundCampaignPending,
  startFundCampaignSetup,
  handleFundCampaignInput,
  clearFundCampaignState,
  broadcastFundCampaign,
} from '../../services/channelFundService';

// ─── Admin Main Keyboard (local — includes Fund Channel button) ───────────────

function buildAdminMainKeyboard(active: boolean): InlineKeyboard {
  return new InlineKeyboard()
    .text('📊 الإحصائيات', 'admin_stats')
    .text('📢 الإذاعة', 'admin_broadcast')
    .row()
    .text('✏️ المحتوى', 'admin_content')
    .text('👤 المستخدمين', 'admin_users')
    .row()
    .text('📢 تمويل قناة', 'admin_fund_channel')
    .row()
    .text('⚙️ الإعدادات', 'admin_settings')
    .text('💾 نسخة احتياطية', 'admin_backup')
    .row()
    .text(active ? '🟢 البوت: شغّال' : '🔴 البوت: متوقف', 'admin_toggle_bot');
}

// ─── /admin Command ────────────────────────────────────────────────────────────

export async function adminCommand(ctx: BotContext): Promise<void> {
  if (!isAdmin(ctx.from!.id)) return;
  const text = await buildDashboardText();
  const botActive = (await Settings.get('bot_status')) as boolean;
  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: buildAdminMainKeyboard(botActive),
  });
}

// ─── Callback Router ───────────────────────────────────────────────────────────

export async function handleAdminCallback(ctx: BotContext): Promise<void> {
  const userId = ctx.from!.id;
  if (!isAdmin(userId)) {
    void ctx.answerCallbackQuery({ text: '🚫 غير مصرح لك.', show_alert: true });
    return;
  }

  const data = ctx.callbackQuery!.data!;
  await ctx.answerCallbackQuery();

  if (data === 'admin_back_main') return renderMain(ctx);
  if (data === 'admin_stats') return renderStats(ctx);
  if (data === 'admin_broadcast') return renderBroadcastInit(ctx);
  if (data === 'admin_content') return renderContent(ctx);
  if (data === 'admin_users') return renderUsersPanel(ctx);
  if (data === 'admin_settings') return renderSettings(ctx);
  if (data === 'admin_backup') return sendBackup(ctx);
  if (data === 'admin_toggle_bot') return toggleBot(ctx);
  if (data === 'admin_add_quota') return renderAddQuota(ctx);
  if (data === 'admin_broadcast_buttons') return renderBroadcastButtons(ctx);
  if (data === 'admin_bcast_add_btn') return startAddBroadcastButton(ctx);
  if (data === 'admin_bcast_preview') return previewBroadcastButtons(ctx);
  if (data === 'admin_bcast_clear') return clearBroadcastButtons(ctx);
  if (data === 'admin_fund_channel') return renderFundChannelInit(ctx);

  if (data.startsWith('admin_toggle_')) {
    const key = data.replace('admin_toggle_', '');
    const dbKey =
      key === 'notify'
        ? 'notify_on_join'
        : key === 'autodelete'
        ? 'auto_delete'
        : 'bot_status';
    const current = (await Settings.get(dbKey)) as boolean;
    await Settings.set(dbKey, !current);
    return renderSettings(ctx);
  }

  if (data.startsWith('admin_user_ban_')) {
    const targetId = parseInt(data.replace('admin_user_ban_', ''), 10);
    const user = await User.findOne({ telegramId: targetId });
    if (user) {
      user.isBanned = !user.isBanned;
      await user.save();
      return renderUserDetail(ctx, targetId);
    }
  }

  if (data.startsWith('admin_edit_')) {
    const field = data.replace('admin_edit_', '');
    const map: Record<string, string> = {
      welcome: 'welcome_message',
      devlink: 'developerLink',
      chanlink: 'channelLink',
    };
    setContentEditPending(userId, map[field]);
    await ctx.editMessageText(
      `✏️ أرسل القيمة الجديدة لـ *${field}*:`,
      { parse_mode: 'Markdown', reply_markup: buildAdminBackKeyboard() }
    );
  }
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

async function buildDashboardText(): Promise<string> {
  const total = await User.countDocuments();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const newToday = await User.countDocuments({ joinedAt: { $gte: today } });
  const banned = await User.countDocuments({ isBanned: true });
  const agg = await User.aggregate<{ sum: number }>([
    { $group: { _id: null, sum: { $sum: '$totalEnhancements' } } },
  ]);
  const totalOps = agg[0]?.sum ?? 0;

  return (
    `📊 *لوحة التحكم*\n\n` +
    `👥 المستخدمين: *${total}*\n` +
    `🆕 اليوم: *${newToday}*\n` +
    `🖼️ العمليات: *${totalOps}*\n` +
    `🚫 المحظورين: *${banned}*`
  );
}

async function renderMain(ctx: BotContext): Promise<void> {
  const text = await buildDashboardText();
  const botActive = (await Settings.get('bot_status')) as boolean;
  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    reply_markup: buildAdminMainKeyboard(botActive),
  });
}

async function renderStats(ctx: BotContext): Promise<void> {
  const text = await buildDashboardText();
  await ctx.editMessageText(text + `\n\nإحصائيات إضافية قريباً...`, {
    parse_mode: 'Markdown',
    reply_markup: buildAdminBackKeyboard(),
  });
}

// ─── Broadcast ────────────────────────────────────────────────────────────────

const broadcastState = new Map<number, boolean>();
const broadcastMessage = new Map<number, Message>();

async function renderBroadcastInit(ctx: BotContext): Promise<void> {
  broadcastState.set(ctx.from!.id, true);
  const buttons =
    ((await Settings.get('broadcastButtons')) as { label: string; url: string }[]) || [];
  await ctx.editMessageText(
    `📢 *وضع الإذاعة*\n\nأرسل الآن الرسالة (نص، صورة، فيديو).\n\n📎 أزرار مرفقة: *${buttons.length}* زر`,
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .text('📎 إعداد أزرار الإذاعة', 'admin_broadcast_buttons')
        .row()
        .text('↩️ رجوع', 'admin_back_main'),
    }
  );
}

export const isBroadcastPending = (id: number): boolean =>
  broadcastState.get(id) ?? false;

export async function executeBroadcast(ctx: BotContext): Promise<void> {
  broadcastState.delete(ctx.from!.id);
  if (ctx.msg) broadcastMessage.set(ctx.from!.id, ctx.msg);
  await ctx.reply('⚠️ هل أنت متأكد من الإذاعة؟\n\nأرسل /confirm_broadcast للتأكيد.', {
    parse_mode: 'Markdown',
  });
}

export async function runBroadcast(ctx: BotContext): Promise<void> {
  const msg = broadcastMessage.get(ctx.from!.id);
  if (!msg) return;
  broadcastMessage.delete(ctx.from!.id);

  const savedButtons =
    ((await Settings.get('broadcastButtons')) as { label: string; url: string }[]) || [];
  let replyMarkup: InlineKeyboard | undefined;
  if (savedButtons.length > 0) {
    replyMarkup = new InlineKeyboard();
    for (const btn of savedButtons) replyMarkup.url(btn.label, btn.url).row();
  }

  const users = await User.find({ isBanned: false }).select('telegramId');
  let s = 0, f = 0;

  for (const user of users) {
    try {
      await ctx.api.copyMessage(user.telegramId, ctx.from!.id, msg.message_id, {
        reply_markup: replyMarkup,
      });
      s++;
    } catch {
      f++;
    }
    if ((s + f) % 25 === 0) await sleep(1000);
  }

  await ctx.reply(`✅ اكتملت الإذاعة!\n\nنجح: ${s}\nفشل: ${f}`);
}

// ─── Broadcast Buttons ────────────────────────────────────────────────────────

async function renderBroadcastButtons(ctx: BotContext): Promise<void> {
  const buttons =
    ((await Settings.get('broadcastButtons')) as { label: string; url: string }[]) || [];
  let text = `📎 *أزرار الإذاعة الحالية:*\n\n`;
  if (buttons.length === 0) {
    text += 'لا توجد أزرار مضافة بعد.';
  } else {
    buttons.forEach((b, i) => { text += `${i + 1}. ${b.label} → ${b.url}\n`; });
  }
  const kb = new InlineKeyboard()
    .text('➕ إضافة زر جديد', 'admin_bcast_add_btn').row()
    .text('👁️ معاينة الأزرار', 'admin_bcast_preview').row()
    .text('🗑️ مسح جميع الأزرار', 'admin_bcast_clear').row()
    .text('↩️ رجوع', 'admin_broadcast');
  await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: kb });
}

const addBtnState = new Map<number, boolean>();
export const isAddBroadcastBtnPending = (id: number): boolean =>
  addBtnState.get(id) ?? false;

async function startAddBroadcastButton(ctx: BotContext): Promise<void> {
  addBtnState.set(ctx.from!.id, true);
  await ctx.editMessageText(
    `➕ *إضافة زر جديد*\n\nأرسل الزر بالصيغة:\n\`اسم الزر|https://رابط-الزر\`\n\nمثال:\n\`تابعنا|https://t.me/yourchannel\``,
    { parse_mode: 'Markdown', reply_markup: buildAdminBackKeyboard() }
  );
}

export async function handleAddBroadcastButton(
  ctx: BotContext,
  text: string
): Promise<void> {
  addBtnState.delete(ctx.from!.id);
  const parts = text.split('|');
  if (parts.length !== 2 || !parts[1].trim().startsWith('http')) {
    await ctx.reply('❌ صيغة خاطئة. أرسل: اسم الزر|https://رابط');
    return;
  }
  const [label, url] = parts.map((p) => p.trim());
  const buttons =
    ((await Settings.get('broadcastButtons')) as { label: string; url: string }[]) || [];
  buttons.push({ label, url });
  await Settings.set('broadcastButtons', buttons);
  await ctx.reply(`✅ تم إضافة الزر: *${label}*`, { parse_mode: 'Markdown' });
}

async function previewBroadcastButtons(ctx: BotContext): Promise<void> {
  const buttons =
    ((await Settings.get('broadcastButtons')) as { label: string; url: string }[]) || [];
  if (buttons.length === 0) {
    await ctx.editMessageText('لا توجد أزرار لمعاينتها.', {
      reply_markup: buildAdminBackKeyboard(),
    });
    return;
  }
  const kb = new InlineKeyboard();
  for (const btn of buttons) kb.url(btn.label, btn.url).row();
  await ctx.editMessageText('👁️ *معاينة الأزرار:*\n\nهكذا ستظهر للمستخدمين ⬇️', {
    parse_mode: 'Markdown',
    reply_markup: kb,
  });
}

async function clearBroadcastButtons(ctx: BotContext): Promise<void> {
  await Settings.set('broadcastButtons', []);
  await ctx.editMessageText('🗑️ تم مسح جميع أزرار الإذاعة.', {
    reply_markup: buildAdminBackKeyboard(),
  });
}

// ─── Channel Fund Campaign Setup ──────────────────────────────────────────────

async function renderFundChannelInit(ctx: BotContext): Promise<void> {
  startFundCampaignSetup(ctx.from!.id);
  await ctx.editMessageText(
    `📢 *تمويل قناة*\n\nأرسل رابط القناة أو المجموعة المراد تمويلها:`,
    { parse_mode: 'Markdown', reply_markup: buildAdminBackKeyboard() }
  );
}

export { isFundCampaignPending, clearFundCampaignState };

export async function handleFundCampaignStep(
  ctx: BotContext,
  text: string
): Promise<void> {
  const adminId = ctx.from!.id;
  const result = await handleFundCampaignInput(adminId, text, ctx.api);

  if (result.status === 'not_admin_in_channel') {
    await ctx.reply(
      '❌ البوت ليس مشرفاً في هذه القناة. أضفه كمشرف أولاً ثم أعد المحاولة.'
    );
    return;
  }

  if (result.status === 'ask_target') {
    await ctx.reply(
      `✅ تم التحقق من صلاحيات البوت في القناة.\n\nكم عدد الأعضاء المطلوب؟ (مثال: 1000)`
    );
    return;
  }

  if (result.status === 'invalid_target') {
    await ctx.reply('❌ أرسل رقماً صحيحاً أكبر من صفر.');
    return;
  }

  if (result.status === 'done') {
    const campaign = result.campaign;
    await ctx.reply(
      `✅ تم إنشاء الحملة بنجاح!\n\n` +
        `📢 القناة: ${campaign.channelLink}\n` +
        `🎯 الهدف: ${campaign.targetMembers} عضو\n\n` +
        `⏳ جاري الإذاعة لجميع المستخدمين...`
    );

    // Broadcast asynchronously — do not block admin response
    broadcastFundCampaign(ctx.api, campaign)
      .then(({ sent, failed }) => {
        ctx.api
          .sendMessage(
            adminId,
            `📢 اكتملت إذاعة الحملة!\n✅ نجح: ${sent}\n❌ فشل: ${failed}`
          )
          .catch(() => {});
      })
      .catch((err: unknown) => {
        console.error('[Admin] Fund broadcast error:', err);
      });
  }
}

// ─── Add Quota ────────────────────────────────────────────────────────────────

type QuotaStep = 'awaiting_id' | 'awaiting_amount';
const adminQuotaStates = new Map<number, { step: QuotaStep; targetId?: number }>();

async function renderAddQuota(ctx: BotContext): Promise<void> {
  adminQuotaStates.set(ctx.from!.id, { step: 'awaiting_id' });
  await ctx.editMessageText(
    `➕ *إضافة محاولات لمستخدم*\n\nأرسل الآيدي الرقمي للمستخدم:`,
    { parse_mode: 'Markdown', reply_markup: buildAdminBackKeyboard() }
  );
}

export const isQuotaAddPending = (id: number): boolean => adminQuotaStates.has(id);

export async function handleQuotaAdd(ctx: BotContext, input: string): Promise<void> {
  const adminId = ctx.from!.id;
  const state = adminQuotaStates.get(adminId);
  if (!state) return;

  if (state.step === 'awaiting_id') {
    const targetId = parseInt(input, 10);
    if (isNaN(targetId)) {
      await ctx.reply('❌ أرسل رقماً صحيحاً فقط.');
      return;
    }
    adminQuotaStates.set(adminId, { step: 'awaiting_amount', targetId });
    await ctx.reply(
      `🆔 آيدي المستخدم: \`${targetId}\`\n\nكم محاولة تريد إضافتها؟ (أرسل رقماً فقط)`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (state.step === 'awaiting_amount' && state.targetId) {
    const amount = parseInt(input, 10);
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply('❌ أرسل رقماً صحيحاً أكبر من 0.');
      return;
    }

    const targetUser = await User.findOne({ telegramId: state.targetId });
    adminQuotaStates.delete(adminId);

    if (!targetUser) {
      await ctx.reply('❌ المستخدم غير موجود في قاعدة البيانات.');
      return;
    }

    // Use the shared debt-aware function for the addition
    const newBalance = await addAttemptsWithDebtCheck(state.targetId, amount);

    let msg = `✅ تمت إضافة ${amount} محاولات للمستخدم ${state.targetId}\n`;
    msg += `⚡ رصيده الحالي: ${newBalance} محاولة`;
    if (newBalance < 0) {
      msg += `\n🔴 لا يزال عليه دين متراكم`;
    }
    await ctx.reply(msg);
  }
}

// ─── Content ──────────────────────────────────────────────────────────────────

const editState = new Map<number, string>();

async function renderContent(ctx: BotContext): Promise<void> {
  const welcome = (await Settings.get('welcome_message')) as string;
  const kb = new InlineKeyboard()
    .text('✏️ رسالة الترحيب', 'admin_edit_welcome').row()
    .text('✏️ تعديل رابط المطور', 'admin_edit_devlink')
    .text('✏️ تعديل رابط القناة', 'admin_edit_chanlink').row()
    .text('↩️ رجوع', 'admin_back_main');

  await ctx.editMessageText(
    `📝 *إدارة المحتوى*\n\nالرسالة الحالية:\n${welcome?.substring(0, 100)}...`,
    { parse_mode: 'Markdown', reply_markup: kb }
  );
}

export const getContentEditPending = (id: number): string | undefined =>
  editState.get(id);
export const setContentEditPending = (id: number, field: string): Map<number, string> =>
  editState.set(id, field);
export const clearContentEditPending = (id: number): boolean => editState.delete(id);

export async function handleContentEdit(
  ctx: BotContext,
  field: string,
  value: string
): Promise<void> {
  await Settings.set(field, value);
  await ctx.reply(`✅ تم التحديث بنجاح!`);
}

// ─── User Manager ─────────────────────────────────────────────────────────────

const searchState = new Map<number, boolean>();

async function renderUsersPanel(ctx: BotContext): Promise<void> {
  const kb = new InlineKeyboard()
    .text('🔍 بحث عن مستخدم', 'admin_users').row()
    .text('➕ إضافة محاولات لمستخدم', 'admin_add_quota').row()
    .text('↩️ رجوع', 'admin_back_main');
  await ctx.editMessageText('👤 *إدارة المستخدمين*\n\nاختر الإجراء:', {
    parse_mode: 'Markdown',
    reply_markup: kb,
  });
}

export const isUserSearchPending = (id: number): boolean =>
  searchState.get(id) ?? false;

export async function searchUser(ctx: BotContext, searchId: number): Promise<void> {
  searchState.delete(ctx.from!.id);
  await renderUserDetail(ctx, searchId, true);
}

async function renderUserDetail(
  ctx: BotContext,
  targetId: number,
  isNewMsg = false
): Promise<void> {
  const user = await User.findOne({ telegramId: targetId });
  if (!user) {
    await ctx.reply('❌ لم يتم العثور على المستخدم.');
    return;
  }

  const debtNote = user.dailyQuota < 0 ? ` (دين)` : '';
  const text =
    `👤 *معلومات المستخدم*\n\n` +
    `آيدي: ${user.telegramId}\n` +
    `المحاولات: ${user.dailyQuota}${debtNote}\n` +
    `الإحالات: ${user.referralCount}\n` +
    `الحالة: ${user.isBanned ? '🚫 محظور' : '✅ نشط'}`;

  const kb = buildUserActionKeyboard(user.telegramId, user.isBanned);
  if (isNewMsg) await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb });
  else await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: kb });
}

// ─── Settings ─────────────────────────────────────────────────────────────────

async function renderSettings(ctx: BotContext): Promise<void> {
  const n = (await Settings.get('notify_on_join')) as boolean;
  const a = (await Settings.get('auto_delete')) as boolean;
  const m = !((await Settings.get('bot_status')) as boolean);
  await ctx.editMessageText('⚙️ *الإعدادات*', {
    parse_mode: 'Markdown',
    reply_markup: buildAdminSettingsKeyboard(n, a, m),
  });
}

async function toggleBot(ctx: BotContext): Promise<void> {
  const c = (await Settings.get('bot_status')) as boolean;
  await Settings.set('bot_status', !c);
  return renderMain(ctx);
}

async function sendBackup(ctx: BotContext): Promise<void> {
  const users = await User.find().lean();
  const settings = await Settings.find().lean();
  const buf = Buffer.from(JSON.stringify({ users, settings }, null, 2));
  await ctx.replyWithDocument(new InputFile(buf, 'backup.json'), {
    caption: '💾 نسخة احتياطية كاملة (مستخدمين + إعدادات).',
  });
}
