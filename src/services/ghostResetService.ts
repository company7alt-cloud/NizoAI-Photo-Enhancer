import cron from 'node-cron';
import { GhostAccount } from '../database/models/GhostAccount';
import { Bot } from 'grammy';

const ADMIN_IDS = process.env.ADMIN_IDS?.split(',').map(Number) || [];

// ═══════════════════════════════════════════════════
// Global lock state - stored in memory
// ═══════════════════════════════════════════════════
let isGloballyLocked = false;
let globalLockReason = '';

export const setGlobalLock = (locked: boolean, reason = '') => {
  isGloballyLocked = locked;
  globalLockReason = reason;
};

export const getGlobalLock = () => ({ isGloballyLocked, globalLockReason });

// ═══════════════════════════════════════════════════
// Check if ALL ghost accounts are exhausted
// ═══════════════════════════════════════════════════
export const checkAndSetGlobalLock = async (): Promise<boolean> => {
  const availableCount = await GhostAccount.countDocuments({
    isActive: true,
    isLocked: false,
    dailyUsed: { $lt: 10 }
  });
  
  if (availableCount === 0) {
    setGlobalLock(true, 'exhausted');
    return true;
  }
  
  return false;
};

// ═══════════════════════════════════════════════════
// CRON: Run at midnight every day
// Accepts the bot instance to avoid circular imports
// ═══════════════════════════════════════════════════
export const initGhostResetService = (bot: Bot<any>) => {
  cron.schedule('0 0 * * *', async () => {
    try {
      console.log('[GHOST RESET] Starting daily reset...');
      
      await GhostAccount.resetDailyCounters();
      
      // Unlock global lock
      setGlobalLock(false);
      
      // Get stats
      const totalAccounts = await GhostAccount.countDocuments({ isActive: true });
      
      // Notify all admins
      for (const adminId of ADMIN_IDS) {
        try {
          await bot.api.sendMessage(
            adminId,
            `✅ *تم تصفير عدادات الجيش الشبح*\n\n` +
            `👻 الحسابات النشطة: ${totalAccounts}\n` +
            `📸 الطاقة اليومية: ${totalAccounts * 10} صورة\n` +
            `🕛 وقت التصفير: ${new Date().toLocaleTimeString('ar')}\n\n` +
            `🚀 الجيش جاهز للعمل من جديد!`,
            { parse_mode: 'Markdown' }
          );
        } catch (e) {
          console.error(`[GHOST RESET] Failed to notify admin ${adminId}:`, e);
        }
      }
      
      console.log('[GHOST RESET] Daily reset completed successfully');
    } catch (error) {
      console.error('[GHOST RESET] CRITICAL ERROR during reset:', error);
    }
  }, {
    timezone: 'Asia/Riyadh'
  });

  // Also check every 5 minutes for stale locked accounts
  cron.schedule('*/5 * * * *', async () => {
    try {
      const unlocked = await GhostAccount.forceUnlockStaleAccounts();
      if (unlocked > 0) {
        console.log(`[GHOST CLEANUP] Force unlocked ${unlocked} stale accounts`);
      }
    } catch (error) {
      console.error('[GHOST CLEANUP] Error:', error);
    }
  });

  console.log('[GHOST RESET] Cron jobs initialized');
};
