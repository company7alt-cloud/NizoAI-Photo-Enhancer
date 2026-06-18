import { Context } from 'grammy';
import { GhostAccount } from '../../database/models/GhostAccount';
import { 
  sendPhoneCode, 
  submitPhoneCode, 
  submitPassword,
  validateSession,
  pendingSessions 
} from '../../services/gramjsSessionService';
import { getAdminMaintenanceLock } from '../../services/ghostResetService';

const ADMIN_IDS = process.env.ADMIN_IDS?.split(',').map(Number) || [];

const isAdmin = (userId: number): boolean => ADMIN_IDS.includes(userId);

// ═══════════════════════════════════════════════════
// Track admin states for multi-step conversation
// ═══════════════════════════════════════════════════
type AdminState = 
  | 'waiting_phone' 
  | 'waiting_code' 
  | 'waiting_password';

export const adminStates = new Map<number, AdminState>();

// ═══════════════════════════════════════════════════
// FORMAT: Time remaining until midnight reset
// ═══════════════════════════════════════════════════
const getTimeUntilMidnight = (): string => {
  const now = new Date();
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  const diff = midnight.getTime() - now.getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours} ساعة و ${minutes} دقيقة`;
};

// ═══════════════════════════════════════════════════
// HANDLER: Admin presses "🔗 ربط حساب شبح"
// ═══════════════════════════════════════════════════
export const handleAddGhost = async (ctx: Context): Promise<void> => {
  const userId = ctx.from?.id;
  if (!userId || !isAdmin(userId)) {
    await ctx.answerCallbackQuery({ text: '⛔ غير مصرح', show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery();
  
  adminStates.set(userId, 'waiting_phone');

  await ctx.reply(
    `🔗 *ربط حساب شبح جديد*\n\n` +
    `أرسل رقم الجوال بالصيغة الدولية:\n` +
    `مثال: \`+9665XXXXXXXX\`\n\n` +
    `⚠️ تأكد أن الحساب:\n` +
    `• نشط ومفعل\n` +
    `• لم يُستخدم للسبام سابقاً\n` +
    `• عمره أكثر من 30 يوم\n\n` +
    `أو أرسل /cancel للإلغاء`,
    { parse_mode: 'Markdown' }
  );
};

// ═══════════════════════════════════════════════════
// HANDLER: Ghost accounts statistics
// ═══════════════════════════════════════════════════
export const handleGhostStats = async (ctx: Context): Promise<void> => {
  const userId = ctx.from?.id;
  if (!userId || !isAdmin(userId)) {
    await ctx.answerCallbackQuery({ text: '⛔ غير مصرح', show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery();

  const total = await GhostAccount.countDocuments();
  const active = await GhostAccount.countDocuments({ isActive: true });
  const locked = await GhostAccount.countDocuments({ isActive: true, isLocked: true });
  const exhausted = await GhostAccount.countDocuments({ isActive: true, dailyUsed: { $gte: 10 } });
  const available = await GhostAccount.countDocuments({ 
    isActive: true, 
    isLocked: false, 
    dailyUsed: { $lt: 10 } 
  });

  // Calculate total usage today
  const usageResult = await GhostAccount.aggregate([
    { $match: { isActive: true } },
    { $group: { _id: null, totalUsed: { $sum: '$dailyUsed' }, totalCapacity: { $sum: { $literal: 10 } } } }
  ]);
  
  const todayUsed = usageResult[0]?.totalUsed || 0;
  const totalCapacity = active * 10;

  const isMaintenanceLocked = getAdminMaintenanceLock();

  await ctx.reply(
    `👻 *إحصائيات الجيش الشبح*\n\n` +
    `📊 إجمالي الحسابات: ${total}\n` +
    `✅ نشطة: ${active}\n` +
    `⚡ متاحة الآن: ${available}\n` +
    `🔒 مشغولة: ${locked}\n` +
    `😴 استنفدت حصتها: ${exhausted}\n` +
    `❌ معطلة: ${total - active}\n\n` +
    `📸 معالجة اليوم: ${todayUsed}/${totalCapacity}\n` +
    `⏰ تصفير العدادات بعد: ${getTimeUntilMidnight()}`,
    { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{
            text: isMaintenanceLocked 
              ? '🔴 فتح الزر المجاني للعملاء' 
              : '🟢 قفل الزر المجاني عن العملاء',
            callback_data: 'admin_toggle_free_enhance_lock',
            style: isMaintenanceLocked ? 'success' as const : 'danger' as const
          } as any]
        ]
      }
    }
  );
};

// ═══════════════════════════════════════════════════
// HANDLER: Process admin text messages for ghost linking
// Call this from your main message handler
// Returns true if the message was consumed by this flow
// ═══════════════════════════════════════════════════
export const handleAdminGhostText = async (ctx: Context): Promise<boolean> => {
  const userId = ctx.from?.id;
  const text = (ctx.message as any)?.text?.trim();
  
  if (!userId || !text || !isAdmin(userId)) return false;
  
  const state = adminStates.get(userId);
  if (!state) return false;

  // Cancel command
  if (text === '/cancel') {
    adminStates.delete(userId);
    const pending = pendingSessions.get(userId);
    if (pending) {
      try { await pending.client.disconnect(); } catch {}
      pendingSessions.delete(userId);
    }
    await ctx.reply('❌ تم الإلغاء');
    return true;
  }

  // ─────────────────────────────────────────────
  // STATE: Waiting for phone number
  // ─────────────────────────────────────────────
  if (state === 'waiting_phone') {
    const phoneRegex = /^\+[1-9]\d{7,14}$/;
    if (!phoneRegex.test(text)) {
      await ctx.reply(
        `❌ صيغة الرقم غير صحيحة\n` +
        `أرسل بهذا الشكل: \`+9665XXXXXXXX\``,
        { parse_mode: 'Markdown' }
      );
      return true;
    }

    // Check if already registered
    const existing = await GhostAccount.findOne({ phoneNumber: text });
    if (existing) {
      await ctx.reply(
        `⚠️ هذا الرقم مسجل بالفعل!\n` +
        `الحالة: ${existing.isActive ? '✅ نشط' : '❌ معطل'}\n` +
        `الاستخدام اليومي: ${existing.dailyUsed}/10`
      );
      adminStates.delete(userId);
      return true;
    }

    const statusMsg = await ctx.reply('⏳ جاري إرسال كود التحقق...');

    try {
      await sendPhoneCode(userId, text);
      adminStates.set(userId, 'waiting_code');
      
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        `📱 *تم إرسال كود التحقق*\n\n` +
        `الرقم: \`${text}\`\n\n` +
        `أرسل الكود الذي وصلك:\n` +
        `_(يمكن كتابته بدون الشرطة: 12345)_\n\n` +
        `⏰ الكود يصلح لـ 5 دقائق\n` +
        `أو /cancel للإلغاء`,
        { parse_mode: 'Markdown' }
      );
    } catch (error: any) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        `❌ فشل إرسال الكود!\n\`${error.message}\``
      );
      adminStates.delete(userId);
    }
    return true;
  }

  // ─────────────────────────────────────────────
  // STATE: Waiting for verification code
  // ─────────────────────────────────────────────
  if (state === 'waiting_code') {
    const statusMsg = await ctx.reply('⏳ جاري التحقق من الكود...');

    try {
      const result = await submitPhoneCode(userId, text);

      if (result.needPassword) {
        adminStates.set(userId, 'waiting_password');
        await ctx.api.editMessageText(
          ctx.chat!.id,
          statusMsg.message_id,
          `🔐 *هذا الحساب محمي بكلمة مرور*\n\nأرسل كلمة المرور:\n_(تُحذف فوراً بعد الاستخدام)_`,
          { parse_mode: 'Markdown' }
        );
        return true;
      }

      if (result.success && result.sessionString) {
        const phoneForSave = pendingSessions.get(userId)?.phone || 'Unknown';
        await ctx.api.deleteMessage(ctx.chat!.id, statusMsg.message_id).catch(() => {});
        await saveGhostAccount(ctx, userId, result.sessionString, phoneForSave);
      }
    } catch (error: any) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        `❌ كود خاطئ أو منتهي الصلاحية!\nحاول مجدداً: /addghost`
      );
      adminStates.delete(userId);
    }
    return true;
  }

  // ─────────────────────────────────────────────
  // STATE: Waiting for 2FA password
  // ─────────────────────────────────────────────
  if (state === 'waiting_password') {
    const statusMsg = await ctx.reply('⏳ جاري التحقق من كلمة المرور...');

    try {
      const phoneBeforeDelete = pendingSessions.get(userId)?.phone || 'Unknown';
      const sessionString = await submitPassword(userId, text);
      
      // Delete the password message immediately for security
      try { await ctx.deleteMessage(); } catch {}
      
      await ctx.api.deleteMessage(ctx.chat!.id, statusMsg.message_id).catch(() => {});
      await saveGhostAccount(ctx, userId, sessionString, phoneBeforeDelete);
    } catch (error: any) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        `❌ كلمة المرور خاطئة!\nحاول مجدداً: /addghost`
      );
      adminStates.delete(userId);
    }
    return true;
  }

  return false;
};

// ═══════════════════════════════════════════════════
// INTERNAL: Save ghost account after successful login
// ═══════════════════════════════════════════════════
const saveGhostAccount = async (
  ctx: Context,
  adminId: number,
  sessionString: string,
  phoneNumber: string
): Promise<void> => {
  
  try {
    await GhostAccount.create({
      phoneNumber,
      sessionString,
      isActive: true,
      isLocked: false,
      dailyUsed: 0,
      lastResetDate: new Date(),
      addedBy: adminId,
      addedAt: new Date(),
      totalProcessed: 0,
      failureCount: 0,
      lastError: null
    });

    adminStates.delete(adminId);
    
    const totalAccounts = await GhostAccount.countDocuments({ isActive: true });

    await ctx.reply(
      `✅ *تم ربط الحساب بنجاح!*\n\n` +
      `📱 الرقم: \`${phoneNumber}\`\n` +
      `👻 إجمالي الحسابات النشطة: ${totalAccounts}\n` +
      `📊 الطاقة اليومية الكلية: ${totalAccounts * 10} صورة\n\n` +
      `🚀 الحساب جاهز للعمل فوراً!`,
      { parse_mode: 'Markdown' }
    );
  } catch (error: any) {
    adminStates.delete(adminId);
    await ctx.reply(`❌ خطأ في الحفظ: ${error.message}`);
  }
};
