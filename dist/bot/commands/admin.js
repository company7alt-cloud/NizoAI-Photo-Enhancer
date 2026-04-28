"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isUserSearchPending = exports.clearContentEditPending = exports.setContentEditPending = exports.getContentEditPending = exports.isQuotaAddPending = exports.isAddBroadcastBtnPending = exports.isBroadcastPending = void 0;
exports.adminCommand = adminCommand;
exports.handleAdminCallback = handleAdminCallback;
exports.executeBroadcast = executeBroadcast;
exports.runBroadcast = runBroadcast;
exports.handleAddBroadcastButton = handleAddBroadcastButton;
exports.handleQuotaAdd = handleQuotaAdd;
exports.handleContentEdit = handleContentEdit;
exports.searchUser = searchUser;
// src/bot/commands/admin.ts
const User_1 = require("../../database/models/User");
const Settings_1 = require("../../database/models/Settings");
const grammy_1 = require("grammy");
const validators_1 = require("../../utils/validators");
const channelRewardService_1 = require("../../services/channelRewardService");
// ─── Command ──────────────────────────────────────────────────────────────────
async function adminCommand(ctx) {
    if (!(0, validators_1.isAdmin)(ctx.from.id))
        return;
    const text = await buildDashboardText();
    const botActive = (await Settings_1.Settings.get('bot_status'));
    await ctx.reply(text, {
        parse_mode: 'Markdown',
        reply_markup: (0, validators_1.buildAdminMainKeyboard)(botActive),
    });
}
// ─── Callback Router ───────────────────────────────────────────────────────────
async function handleAdminCallback(ctx) {
    const userId = ctx.from.id;
    if (!(0, validators_1.isAdmin)(userId)) {
        void ctx.answerCallbackQuery({ text: '🚫 غير مصرح لك.', show_alert: true });
        return;
    }
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery();
    if (data === 'admin_back_main')
        return renderMain(ctx);
    if (data === 'admin_stats')
        return renderStats(ctx);
    if (data === 'admin_broadcast')
        return renderBroadcastInit(ctx);
    if (data === 'admin_content')
        return renderContent(ctx);
    if (data === 'admin_users')
        return renderUsersPanel(ctx);
    if (data === 'admin_settings')
        return renderSettings(ctx);
    if (data === 'admin_backup')
        return sendBackup(ctx);
    if (data === 'admin_toggle_bot')
        return toggleBot(ctx);
    if (data === 'admin_add_quota')
        return renderAddQuota(ctx);
    if (data === 'admin_broadcast_buttons')
        return renderBroadcastButtons(ctx);
    if (data === 'admin_bcast_add_btn')
        return startAddBroadcastButton(ctx);
    if (data === 'admin_bcast_preview')
        return previewBroadcastButtons(ctx);
    if (data === 'admin_bcast_clear')
        return clearBroadcastButtons(ctx);
    if (data.startsWith('admin_toggle_')) {
        const key = data.replace('admin_toggle_', '');
        const dbKey = key === 'notify' ? 'notify_on_join' : (key === 'autodelete' ? 'auto_delete' : 'bot_status');
        const current = (await Settings_1.Settings.get(dbKey));
        await Settings_1.Settings.set(dbKey, !current);
        return renderSettings(ctx);
    }
    if (data.startsWith('admin_user_ban_')) {
        const targetId = parseInt(data.replace('admin_user_ban_', ''), 10);
        const user = await User_1.User.findOne({ telegramId: targetId });
        if (user) {
            user.isBanned = !user.isBanned;
            await user.save();
            return renderUserDetail(ctx, targetId);
        }
    }
    if (data.startsWith('admin_edit_')) {
        const field = data.replace('admin_edit_', '');
        const map = {
            welcome: 'welcome_message',
            devlink: 'developerLink',
            chanlink: 'channelLink'
        };
        (0, exports.setContentEditPending)(userId, map[field]);
        await ctx.editMessageText(`✏️ أرسل القيمة الجديدة لـ *${field}*:`, { parse_mode: 'Markdown', reply_markup: (0, validators_1.buildAdminBackKeyboard)() });
    }
}
// ─── Logic ────────────────────────────────────────────────────────────────────
async function buildDashboardText() {
    const total = await User_1.User.countDocuments();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const newToday = await User_1.User.countDocuments({ joinedAt: { $gte: today } });
    const banned = await User_1.User.countDocuments({ isBanned: true });
    const agg = await User_1.User.aggregate([{ $group: { _id: null, sum: { $sum: '$totalEnhancements' } } }]);
    const totalOps = agg[0]?.sum || 0;
    return `📊 *لوحة التحكم*\n\n` +
        `👥 المستخدمين: *${total}*\n` +
        `🆕 اليوم: *${newToday}*\n` +
        `🖼️ العمليات: *${totalOps}*\n` +
        `🚫 المحظورين: *${banned}*`;
}
async function renderMain(ctx) {
    const text = await buildDashboardText();
    const botActive = (await Settings_1.Settings.get('bot_status'));
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: (0, validators_1.buildAdminMainKeyboard)(botActive) });
}
async function renderStats(ctx) {
    const text = await buildDashboardText();
    await ctx.editMessageText(text + `\n\nإحصائيات إضافية قريباً...`, { parse_mode: 'Markdown', reply_markup: (0, validators_1.buildAdminBackKeyboard)() });
}
// ─── Broadcast ────────────────────────────────────────────────────────────────
const broadcastState = new Map();
const broadcastMessage = new Map();
async function renderBroadcastInit(ctx) {
    broadcastState.set(ctx.from.id, true);
    const buttons = (await Settings_1.Settings.get('broadcastButtons')) || [];
    const btnCount = buttons.length;
    await ctx.editMessageText(`📢 *وضع الإذاعة*\n\nأرسل الآن الرسالة (نص، صورة، فيديو).\n\n📎 أزرار مرفقة: *${btnCount}* زر`, {
        parse_mode: 'Markdown',
        reply_markup: new grammy_1.InlineKeyboard()
            .text('📎 إعداد أزرار الإذاعة', 'admin_broadcast_buttons').row()
            .text('↩️ رجوع', 'admin_back_main'),
    });
}
const isBroadcastPending = (id) => broadcastState.get(id) || false;
exports.isBroadcastPending = isBroadcastPending;
async function executeBroadcast(ctx) {
    broadcastState.delete(ctx.from.id);
    if (ctx.msg) {
        broadcastMessage.set(ctx.from.id, ctx.msg);
    }
    await ctx.reply('⚠️ هل أنت متأكد من الإذاعة؟\n\nأرسل /confirm_broadcast للتأكيد.', { parse_mode: 'Markdown' });
}
async function runBroadcast(ctx) {
    const msg = broadcastMessage.get(ctx.from.id);
    if (!msg)
        return;
    broadcastMessage.delete(ctx.from.id);
    // Build inline keyboard from saved broadcast buttons
    const savedButtons = (await Settings_1.Settings.get('broadcastButtons')) || [];
    let replyMarkup;
    if (savedButtons.length > 0) {
        replyMarkup = new grammy_1.InlineKeyboard();
        for (const btn of savedButtons) {
            replyMarkup.url(btn.label, btn.url).row();
        }
    }
    const users = await User_1.User.find({ isBanned: false }).select('telegramId');
    let s = 0, f = 0;
    for (const user of users) {
        try {
            await ctx.api.copyMessage(user.telegramId, ctx.from.id, msg.message_id, {
                reply_markup: replyMarkup,
            });
            s++;
        }
        catch {
            f++;
        }
        if ((s + f) % 25 === 0)
            await (0, validators_1.sleep)(1000);
    }
    await ctx.reply(`✅ اكتملت الإذاعة!\n\nنجح: ${s}\nفشل: ${f}`);
}
// ─── Broadcast Buttons Manager ────────────────────────────────────────────────
async function renderBroadcastButtons(ctx) {
    const buttons = (await Settings_1.Settings.get('broadcastButtons')) || [];
    let text = `📎 *أزرار الإذاعة الحالية:*\n\n`;
    if (buttons.length === 0) {
        text += 'لا توجد أزرار مضافة بعد.';
    }
    else {
        buttons.forEach((b, i) => { text += `${i + 1}. ${b.label} → ${b.url}\n`; });
    }
    const kb = new grammy_1.InlineKeyboard()
        .text('➕ إضافة زر جديد', 'admin_bcast_add_btn').row()
        .text('👁️ معاينة الأزرار', 'admin_bcast_preview').row()
        .text('🗑️ مسح جميع الأزرار', 'admin_bcast_clear').row()
        .text('↩️ رجوع', 'admin_broadcast');
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: kb });
}
const addBtnState = new Map();
const isAddBroadcastBtnPending = (id) => addBtnState.get(id) || false;
exports.isAddBroadcastBtnPending = isAddBroadcastBtnPending;
async function startAddBroadcastButton(ctx) {
    addBtnState.set(ctx.from.id, true);
    await ctx.editMessageText(`➕ *إضافة زر جديد*\n\nأرسل الزر بالصيغة:\n\`اسم الزر|https://رابط-الزر\`\n\nمثال:\n\`تابعنا|https://t.me/yourchannel\``, { parse_mode: 'Markdown', reply_markup: (0, validators_1.buildAdminBackKeyboard)() });
}
async function handleAddBroadcastButton(ctx, text) {
    addBtnState.delete(ctx.from.id);
    const parts = text.split('|');
    if (parts.length !== 2 || !parts[1].startsWith('http')) {
        await ctx.reply('❌ صيغة خاطئة. أرسل: اسم الزر|https://رابط');
        return;
    }
    const [label, url] = parts.map(p => p.trim());
    const buttons = (await Settings_1.Settings.get('broadcastButtons')) || [];
    buttons.push({ label, url });
    await Settings_1.Settings.set('broadcastButtons', buttons);
    await ctx.reply(`✅ تم إضافة الزر: *${label}*`, { parse_mode: 'Markdown' });
}
async function previewBroadcastButtons(ctx) {
    const buttons = (await Settings_1.Settings.get('broadcastButtons')) || [];
    if (buttons.length === 0) {
        await ctx.editMessageText('لا توجد أزرار لمعاينتها.', { reply_markup: (0, validators_1.buildAdminBackKeyboard)() });
        return;
    }
    const kb = new grammy_1.InlineKeyboard();
    for (const btn of buttons) {
        kb.url(btn.label, btn.url).row();
    }
    await ctx.editMessageText('👁️ *معاينة الأزرار:*\n\nهكذا ستظهر للمستخدمين ⬇️', {
        parse_mode: 'Markdown',
        reply_markup: kb,
    });
}
async function clearBroadcastButtons(ctx) {
    await Settings_1.Settings.set('broadcastButtons', []);
    await ctx.editMessageText('🗑️ تم مسح جميع أزرار الإذاعة.', { reply_markup: (0, validators_1.buildAdminBackKeyboard)() });
}
const adminQuotaStates = new Map();
async function renderAddQuota(ctx) {
    adminQuotaStates.set(ctx.from.id, { step: 'awaiting_id' });
    await ctx.editMessageText(`➕ *إضافة محاولات لمستخدم*\n\nأرسل الآيدي الرقمي للمستخدم:`, { parse_mode: 'Markdown', reply_markup: (0, validators_1.buildAdminBackKeyboard)() });
}
const isQuotaAddPending = (id) => adminQuotaStates.has(id);
exports.isQuotaAddPending = isQuotaAddPending;
async function handleQuotaAdd(ctx, input) {
    const adminId = ctx.from.id;
    const state = adminQuotaStates.get(adminId);
    if (!state)
        return;
    if (state.step === 'awaiting_id') {
        const targetId = parseInt(input, 10);
        if (isNaN(targetId)) {
            await ctx.reply('❌ أرسل رقماً صحيحاً فقط.');
            return;
        }
        adminQuotaStates.set(adminId, { step: 'awaiting_amount', targetId });
        await ctx.reply(`🆔 آيدي المستخدم: \`${targetId}\`\n\nكم محاولة تريد إضافتها؟ (أرسل رقماً فقط)`, { parse_mode: 'Markdown' });
        return;
    }
    if (state.step === 'awaiting_amount' && state.targetId) {
        const amount = parseInt(input, 10);
        if (isNaN(amount) || amount <= 0) {
            await ctx.reply('❌ أرسل رقماً صحيحاً أكبر من 0.');
            return;
        }
        const targetUser = await User_1.User.findOne({ telegramId: state.targetId });
        adminQuotaStates.delete(adminId);
        if (!targetUser) {
            await ctx.reply('❌ المستخدم غير موجود في قاعدة البيانات.');
            return;
        }
        const { debtPaid } = (0, channelRewardService_1.applyDebtOnQuotaAdd)(targetUser, amount);
        await targetUser.save();
        let msg = `✅ تمت إضافة ${amount} محاولات للمستخدم ${state.targetId}\n`;
        if (debtPaid > 0) {
            msg += `💳 تم خصم ${debtPaid} محاولة لسداد الدين المتبقي\n`;
        }
        msg += `⚡ رصيده الحالي: ${targetUser.dailyQuota} محاولة`;
        if (targetUser.quotaDebt > 0) {
            msg += `\n🔴 لا يزال عليه دين: ${targetUser.quotaDebt} محاولة`;
        }
        await ctx.reply(msg);
    }
}
// ─── Content ──────────────────────────────────────────────────────────────────
const editState = new Map();
async function renderContent(ctx) {
    const welcome = (await Settings_1.Settings.get('welcome_message'));
    const kb = new grammy_1.InlineKeyboard()
        .text('✏️ رسالة الترحيب', 'admin_edit_welcome').row()
        .text('✏️ تعديل رابط المطور', 'admin_edit_devlink').text('✏️ تعديل رابط القناة', 'admin_edit_chanlink').row()
        .text('↩️ رجوع', 'admin_back_main');
    await ctx.editMessageText(`📝 *إدارة المحتوى*\n\nالرسالة الحالية:\n${welcome?.substring(0, 100)}...`, {
        parse_mode: 'Markdown',
        reply_markup: kb
    });
}
const getContentEditPending = (id) => editState.get(id);
exports.getContentEditPending = getContentEditPending;
const setContentEditPending = (id, field) => editState.set(id, field);
exports.setContentEditPending = setContentEditPending;
const clearContentEditPending = (id) => editState.delete(id);
exports.clearContentEditPending = clearContentEditPending;
async function handleContentEdit(ctx, field, value) {
    await Settings_1.Settings.set(field, value);
    await ctx.reply(`✅ تم التحديث بنجاح!`);
}
// ─── User Manager ─────────────────────────────────────────────────────────────
const searchState = new Map();
async function renderUsersPanel(ctx) {
    const kb = new grammy_1.InlineKeyboard()
        .text('🔍 بحث عن مستخدم', 'admin_users').row()
        .text('➕ إضافة محاولات لمستخدم', 'admin_add_quota').row()
        .text('↩️ رجوع', 'admin_back_main');
    await ctx.editMessageText('👤 *إدارة المستخدمين*\n\nاختر الإجراء:', {
        parse_mode: 'Markdown',
        reply_markup: kb,
    });
}
const isUserSearchPending = (id) => searchState.get(id) || false;
exports.isUserSearchPending = isUserSearchPending;
async function searchUser(ctx, searchId) {
    searchState.delete(ctx.from.id);
    await renderUserDetail(ctx, searchId, true);
}
async function renderUserDetail(ctx, targetId, isNewMsg = false) {
    const user = await User_1.User.findOne({ telegramId: targetId });
    if (!user) {
        await ctx.reply('❌ لم يتم العثور على المستخدم.');
        return;
    }
    const text = `👤 *معلومات المستخدم* \n\nآيدي: ${user.telegramId}\nالمحاولات: ${user.dailyQuota}\nالديون: ${user.quotaDebt}\nالحالة: ${user.isBanned ? '🚫 محظور' : '✅ نشط'}`;
    const kb = (0, validators_1.buildUserActionKeyboard)(user.telegramId, user.isBanned);
    if (isNewMsg)
        await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb });
    else
        await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: kb });
}
// ─── Settings & Others ────────────────────────────────────────────────────────
async function renderSettings(ctx) {
    const n = (await Settings_1.Settings.get('notify_on_join'));
    const a = (await Settings_1.Settings.get('auto_delete'));
    const m = !(await Settings_1.Settings.get('bot_status'));
    await ctx.editMessageText('⚙️ *الإعدادات*', {
        reply_markup: (0, validators_1.buildAdminSettingsKeyboard)(n, a, m)
    });
}
async function toggleBot(ctx) {
    const c = (await Settings_1.Settings.get('bot_status'));
    await Settings_1.Settings.set('bot_status', !c);
    return renderMain(ctx);
}
async function sendBackup(ctx) {
    const users = await User_1.User.find().lean();
    const settings = await Settings_1.Settings.find().lean();
    const backupData = { users, settings };
    const buf = Buffer.from(JSON.stringify(backupData, null, 2));
    await ctx.replyWithDocument(new grammy_1.InputFile(buf, 'backup.json'), { caption: '💾 نسخة احتياطية كاملة (مستخدمين + إعدادات).' });
}
//# sourceMappingURL=admin.js.map