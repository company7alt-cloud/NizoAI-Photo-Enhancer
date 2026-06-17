import { Context } from 'grammy';
import { InputFile } from 'grammy';
import { FreeEnhance } from '../../database/models/FreeEnhance';
import { 
  processImageWithGhost,
  NoGhostAvailableError,
  GhostTimeoutError
} from '../../services/ghostEngine';
import { getGlobalLock, getAdminMaintenanceLock } from '../../services/ghostResetService';
import { v4 as uuidv4 } from 'uuid';

type UserState = 'waiting_image' | 'processing';
export const freeEnhanceStates = new Map<number, UserState>();

const formatTimeRemaining = (ms: number): string => {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours === 0) return `${minutes} دقيقة`;
  if (minutes === 0) return `${hours} ساعة`;
  return `${hours} ساعة و ${minutes} دقيقة`;
};

const getTimeUntilMidnight = (): string => {
  const now = new Date();
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  return formatTimeRemaining(midnight.getTime() - now.getTime());
};

const generateProgressBar = (percent: number): string => {
  const filled = Math.floor(percent / 10);
  const empty = 10 - filled;
  return '▓'.repeat(filled) + '░'.repeat(empty);
};

export const handleFreeEnhanceButton = async (ctx: Context): Promise<void> => {
  const userId = ctx.from?.id;
  if (!userId) return;

  await ctx.answerCallbackQuery();

  const ADMIN_IDS = process.env.ADMIN_IDS?.split(',').map(Number) || [];
  const userIsAdmin = ADMIN_IDS.includes(userId);

  // ─── CHECK 0: Admin Maintenance Lock ───
  // Admins bypass this check completely
  if (getAdminMaintenanceLock() && !userIsAdmin) {
    await ctx.reply(
      `🛠️ *هذا القسم تحت الصيانة الدورية حالياً*\n\n` +
      `⏰ سيعود قريباً إن شاء الله\n` +
      `نعتذر عن الإزعاج 🙏`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // ─── CHECK 1: Global system lock ───
  const { isGloballyLocked } = getGlobalLock();
  if (isGloballyLocked && !userIsAdmin) {
    await ctx.reply(
      `🛠️ *سيرفرات التحسين المجاني تحت الصيانة الدورية*\n\n` +
      `⏰ تعود تلقائياً بعد منتصف الليل\n` +
      `الوقت المتبقي: ${getTimeUntilMidnight()}\n\n` +
      `نعتذر عن الإزعاج 🙏`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '🚀 جرّب النسخة المطورة', callback_data: 'enhance_pro' }
          ]]
        }
      }
    );
    return;
  }

  // ─── CHECK 2: Daily limit (Admins bypass) ───
  if (!userIsAdmin) {
    const usageCheck = await FreeEnhance.canUse(userId);
    if (!usageCheck.allowed) {
      await ctx.reply(
        `⏳ *نعتذر، استنفدت محاولاتك المجانية لهذا اليوم!*\n\n` +
        `🔄 تتجدد محاولاتك تلقائياً بعد:\n` +
        `⏰ ${formatTimeRemaining(usageCheck.resetInMs)}\n\n` +
        `💎 للاستخدام غير المحدود، جرّب النسخة المطورة!`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '🚀 ترقية للمطور', callback_data: 'enhance_pro' }
            ]]
          }
        }
      );
      return;
    }
  }

  // ─── CHECK 3: Already processing ───
  if (freeEnhanceStates.get(userId) === 'processing') {
    await ctx.reply('⚠️ لديك طلب قيد المعالجة، انتظر حتى ينتهي.');
    return;
  }

  // ─── ALL CHECKS PASSED ───
  freeEnhanceStates.set(userId, 'waiting_image');

  const remaining = userIsAdmin ? '∞' : 
    String((await FreeEnhance.canUse(userId)).remaining);

  await ctx.reply(
    `✨ *تحسين مجاني بالذكاء الاصطناعي*\n\n` +
    `📎 أرسل صورتك كـ *مستند (Document)* للحصول على أعلى جودة\n\n` +
    `📋 *كيف ترسل كمستند؟*\n` +
    `• اضغط 📎 ← اختر الملف ← حدد صورتك\n` +
    `• أو في الكيبورد اختر "ملف" بدل "صورة"\n\n` +
    `⚡ وقت المعالجة: 60-90 ثانية\n` +
    `🎯 المحاولات المتبقية: ${remaining} من 3`,
    { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '❌ إلغاء', callback_data: 'cancel_free_enhance' }
        ]]
      }
    }
  );
};

export const handleFreeEnhanceDocument = async (ctx: Context): Promise<boolean> => {
  const userId = ctx.from?.id;
  if (!userId) return false;

  if (freeEnhanceStates.get(userId) !== 'waiting_image') return false;

  const message = ctx.message;
  if (!message) return false;

  const document = message.document;
  const photo = message.photo;

  if (photo && !document) {
    await ctx.reply(
      `📌 *للحصول على أعلى جودة ممكنة، أرسل الصورة كمستند:*\n\n` +
      `1️⃣ اضغط على أيقونة المشاركة 📎\n` +
      `2️⃣ اختر "ملف" وليس "صورة"\n` +
      `3️⃣ حدد صورتك\n\n` +
      `_هذا يمنع تليجرام من ضغط صورتك_`,
      { parse_mode: 'Markdown' }
    );
    return true;
  }

  if (!document) return false;

  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  const mimeType = document.mime_type || 'image/jpeg';
  
  if (!allowedTypes.includes(mimeType)) {
    await ctx.reply('❌ صيغة الملف غير مدعومة. أرسل صورة بصيغة JPG أو PNG.');
    return true;
  }

  const fileSizeMB = (document.file_size || 0) / (1024 * 1024);
  if (fileSizeMB > 20) {
    await ctx.reply('❌ حجم الصورة كبير جداً (الحد الأقصى 20MB)');
    return true;
  }

  freeEnhanceStates.set(userId, 'processing');

  const progressMsg = await ctx.reply(
    `⚡ *جاري التحسين...*\n\n` +
    `🔄 [${generateProgressBar(10)}] 10%\n` +
    `⏱️ الوقت المتبقي: ~90 ثانية\n\n` +
    `_يُرجى الانتظار..._`,
    { parse_mode: 'Markdown' }
  );

  const progressStages = [
    { delay: 15000, percent: 30, text: 'تحليل الصورة وتحديد التفاصيل' },
    { delay: 35000, percent: 55, text: 'تطبيق تحسينات الذكاء الاصطناعي' },
    { delay: 60000, percent: 75, text: 'رفع الدقة إلى 4K' },
    { delay: 85000, percent: 90, text: 'اللمسات الأخيرة والتنقية' },
  ];

  const progressTimers: NodeJS.Timeout[] = [];
  
  for (const stage of progressStages) {
    const timer = setTimeout(async () => {
      try {
        await ctx.api.editMessageText(
          ctx.chat!.id,
          progressMsg.message_id,
          `⚡ *جاري التحسين...*\n\n` +
          `🔄 [${generateProgressBar(stage.percent)}] ${stage.percent}%\n` +
          `✨ ${stage.text}...\n\n` +
          `_يُرجى الانتظار..._`,
          { parse_mode: 'Markdown' }
        );
      } catch {}
    }, stage.delay);
    progressTimers.push(timer);
  }

  const clearAllTimers = () => progressTimers.forEach(t => clearTimeout(t));

  const requestId = uuidv4();
  let imageBuffer: Buffer | null = null;

  try {
    const fileInfo = await ctx.api.getFile(document.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;
    
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(fileUrl);
    
    if (!response.ok) throw new Error('Failed to download image from Telegram');
    
    const arrayBuffer = await response.arrayBuffer();
    imageBuffer = Buffer.from(arrayBuffer);

    console.log(`[FREE ENHANCE] [${requestId}] Downloaded image: ${(imageBuffer.length / 1024).toFixed(1)}KB`);

    const result = await processImageWithGhost({
      imageBuffer,
      mimeType,
      userId,
      requestId
    });

    imageBuffer = null;
    if (global.gc) global.gc();

    clearAllTimers();

    await FreeEnhance.incrementUsage(userId);
    const updatedUsage = await FreeEnhance.canUse(userId);

    try {
      await ctx.api.deleteMessage(ctx.chat!.id, progressMsg.message_id);
    } catch {}

    await ctx.replyWithDocument(
      new InputFile(result.enhancedBuffer, result.fileName),
      {
        caption:
          `✅ *تم التحسين بنجاح!*\n\n` +
          `✨ صورتك الآن بجودة 4K فائقة\n` +
          `🤖 معالجة بواسطة NizoAI\n\n` +
          `🎯 المحاولات المتبقية: ${updatedUsage.remaining} من 3`,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔄 تحويل الصيغة', callback_data: 'convert_format' },
              { text: '💾 حفظ PNG', callback_data: 'save_as_png' }
            ],
            [
              { text: '✨ تحسين صورة أخرى', callback_data: 'free_enhance' }
            ]
          ]
        }
      }
    );

    const archiveChannelId = process.env.ARCHIVE_CHANNEL_ID;
    if (archiveChannelId) {
      try {
        await ctx.api.sendDocument(
          parseInt(archiveChannelId),
          new InputFile(result.enhancedBuffer, result.fileName),
          {
            caption:
              `📸 *صورة محسنة - تحسين مجاني*\n` +
              `👤 #user_${userId}\n` +
              `⏰ ${new Date().toLocaleString('ar-SA')}`,
            parse_mode: 'Markdown'
          }
        );
      } catch (archiveError) {
        console.error('[FREE ENHANCE] Archive send failed:', archiveError);
      }
    }

    (result as any).enhancedBuffer = null;
    if (global.gc) global.gc();

    console.log(`[FREE ENHANCE] [${requestId}] SUCCESS for user ${userId}`);

  } catch (error: any) {
    clearAllTimers();
    imageBuffer = null;

    try {
      await ctx.api.deleteMessage(ctx.chat!.id, progressMsg.message_id);
    } catch {}

    console.error(`[FREE ENHANCE] [${requestId}] ERROR:`, error.message);

    if (error instanceof NoGhostAvailableError) {
      await ctx.reply(
        `🛠️ *سيرفرات التحسين المجاني ممتلئة حالياً*\n\n` +
        `⏰ تعود تلقائياً بعد منتصف الليل\n` +
        `الوقت المتبقي: ${getTimeUntilMidnight()}\n\n` +
        `نعتذر عن الإزعاج 🙏\n` +
        `_لم يتم احتساب هذه المحاولة_`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '🚀 جرّب النسخة المطورة', callback_data: 'enhance_pro' }
            ]]
          }
        }
      );
    } else if (error instanceof GhostTimeoutError) {
      await ctx.reply(
        `⚠️ *انتهت مدة الانتظار*\n\n` +
        `السيرفر مشغول حالياً، يرجى المحاولة مرة أخرى بعد دقيقة.\n\n` +
        `_لم يتم احتساب هذه المحاولة_ ✅`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '🔄 حاول مجدداً', callback_data: 'free_enhance' }
            ]]
          }
        }
      );
    } else {
      await ctx.reply(
        `❌ *حدث خطأ أثناء المعالجة*\n\n` +
        `يرجى المحاولة مرة أخرى.\n` +
        `_لم يتم احتساب هذه المحاولة_ ✅`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '🔄 حاول مجدداً', callback_data: 'free_enhance' }
            ]]
          }
        }
      );
    }
  } finally {
    freeEnhanceStates.set(userId, 'waiting_image');
  }

  return true;
};


