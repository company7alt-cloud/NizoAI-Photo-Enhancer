// src/bot/handlers/imageHandler.ts
import { InlineKeyboard } from 'grammy';
import { User } from '../../database/models/User';
import { BotContext, isAdmin, isFileSizeValid } from '../../utils/validators';

export async function imageHandler(ctx: BotContext): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    // 1. Fetch fresh user from DB
    const user = await User.findOne({ telegramId: userId });
    if (!user) {
      await ctx.reply('⚠️ يرجى إرسال /start أولاً لتسجيل حسابك.');
      return;
    }

    const admin = isAdmin(userId);

    // 2. Reset quota if 24h have passed (absolute reset — not additive)
    if (
      !admin &&
      (!user.lastQuotaReset ||
        Date.now() - new Date(user.lastQuotaReset).getTime() > 24 * 60 * 60 * 1000)
    ) {
      user.dailyQuota = 5;
      user.lastQuotaReset = new Date();
      await user.save();
    }

    // 3. Check quota BEFORE accepting image
    if (!admin && user.dailyQuota <= 0) {
      const resetTime = new Date(
        new Date(user.lastQuotaReset).getTime() + 24 * 60 * 60 * 1000
      );
      const diffMs = resetTime.getTime() - Date.now();
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      const timeLeftMsg =
        hours > 0 ? `${hours} ساعة و ${minutes} دقيقة` : `${minutes} دقيقة`;

      const debtNote =
        user.dailyQuota < 0
          ? `\n⚠️ رصيدك الحالي: ${user.dailyQuota} (دين متراكم)`
          : '';

      await ctx.reply(
        `🌙 عذراً، انتهت محاولاتك اليومية 🥺\n` +
          `⏳ الوقت المتبقي للتجديد: ${timeLeftMsg}\n` +
          `🎁 ستحصل على 5 محاولات جديدة تلقائياً بعد انتهاء الوقت ✨` +
          debtNote
      );
      return;
    }

    let fileId: string | undefined;
    let fileName = 'image.jpg';
    let fileSize = 0;

    // 4. Detect file type and extract metadata — never mix photo/document
    if (ctx.msg?.photo) {
      const photo = ctx.msg.photo[ctx.msg.photo.length - 1];
      fileId = photo.file_id;
      fileSize = photo.file_size ?? 0;
    } else if (ctx.msg?.document) {
      if (!ctx.msg.document.mime_type?.startsWith('image/')) {
        await ctx.reply('❌ يرجى إرسال صور فقط.');
        return;
      }
      fileId = ctx.msg.document.file_id;
      fileSize = ctx.msg.document.file_size ?? 0;
      fileName = ctx.msg.document.file_name ?? 'image.jpg';
    }

    if (!fileId) {
      await ctx.reply('❌ لم أتمكن من العثور على ملف الصورة.');
      return;
    }

    // 5. File size check (20 MB limit)
    if (!isFileSizeValid(fileSize)) {
      await ctx.reply('❌ حجم الملف كبير جداً. الحد الأقصى هو 20 ميجابايت.');
      return;
    }

    // 6. Store in session
    ctx.session.pendingFile = { fileId, fileName };

    // 7. Reply with resolution selection
    const quotaDisplay = admin ? '∞ (مدير)' : String(user.dailyQuota);
    const text = `اختر الدقة المطلوبة 🎯\n\n⚡ محاولاتك المتبقية اليوم: ${quotaDisplay} من أصل 5`;

    const keyboard = new InlineKeyboard()
      .row()
      .text('🚀 دقة 2K — محاولة واحدة', 'enhance_2k')
      .row()
      .text('✨ دقة 4K — محاولتان (جودة فائقة)', 'enhance_4k')
      .row()
      .text('🔒 دقة 8K — مقفلة', 'locked_8k');

    await ctx.reply(text, {
      reply_markup: keyboard,
      reply_to_message_id: ctx.msg?.message_id,
    });
  } catch (err: unknown) {
    console.error('[ImageHandler] Error:', err);
    await ctx.reply('❌ حدث خطأ أثناء معالجة الصورة.');
  }
}
