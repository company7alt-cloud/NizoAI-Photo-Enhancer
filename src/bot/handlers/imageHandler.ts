// src/bot/handlers/imageHandler.ts
import { InlineKeyboard } from 'grammy';
import { User } from '../../database/models/User';
import { BotContext, isAdmin, isFileSizeValid } from '../../utils/validators';
import { getSettings } from '../../services/settingsService';

export async function imageHandler(ctx: BotContext): Promise<void> {
  const telegramId = ctx.from?.id.toString();
  const reportUser = await User.findOne({ telegramId });

  if (reportUser?.awaitingReport) {
    await User.findOneAndUpdate({ telegramId }, { $set: { awaitingReport: false } });

    const adminIdsRaw = process.env.ADMIN_IDS || '';
    const adminIds = adminIdsRaw.split(',').map((id) => id.trim());
    const userId = ctx.from?.id;
    const firstName = ctx.from?.first_name || 'مجهول';
    const username = ctx.from?.username ? `@${ctx.from.username}` : 'لا يوجد معرف';
    const userLink = `tg://user?id=${userId}`;

    const reportHeader =
      `🚨 <b>بلاغ جديد من عميل</b>\n\n` +
      `👤 <b>العميل:</b> <a href="${userLink}">${firstName}</a>\n` +
      `🔗 <b>المعرف:</b> ${username}\n` +
      `🆔 <b>الـ ID:</b> <code>${userId}</code>\n` +
      `📅 <b>التوقيت:</b> ${new Date().toLocaleString('ar-SA')}`;

    for (const adminId of adminIds) {
      try {
        await ctx.api.sendMessage(adminId, reportHeader, { parse_mode: 'HTML' });
        await ctx.forwardMessage(adminId);
      } catch (e) {
        console.error('[Report] Forward error:', e);
      }
    }

    await ctx.reply('✅ تم تحويل بلاغك إلى المطور بنجاح 💌\nسيتم الرد عليك في أسرع وقت ممكن 🌹');
    return;
  }

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

    // 2. Additive reset to preserve debt
    if (
      !admin &&
      (!user.lastQuotaReset ||
        Date.now() - new Date(user.lastQuotaReset).getTime() > 24 * 60 * 60 * 1000)
    ) {
      user.dailyQuota += 5;
      if (user.dailyQuota > 5) user.dailyQuota = 5;
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

    const settings = await getSettings();
    const locks = settings.locks;
    const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
    const isAdminUser = adminIds.includes(ctx.from!.id.toString());

    const keyboard = new InlineKeyboard()
      .row()
      .text(locks.btn_2k ? '🔒 دقة 2K — مقفلة' : '🚀 دقة 2K — محاولة واحدة', 'enhance_2k')
      .row()
      .text(locks.btn_4k ? '🔒 دقة 4K — مقفلة' : '✨ دقة 4K — محاولتان (جودة فائقة)', 'enhance_4k')
      .row()
      .text(locks.btn_8k ? '🔒 دقة 8K — مقفلة' : '💎 دقة 8K', 'locked_8k')
      .row()
      .text(locks.btn_4kai ? '🔒 4K-Ai — مقفل' : '✨ 4K - Ai', 'process_4k_ai')
      .text(locks.btn_8kai ? '🔒 8K-Ai — مقفل' : '🔒 8K - Ai', 'locked_8k_ai');

    if (isAdminUser) {
      keyboard.row().text('⚙️ لوحة تحكم الأدمن', 'admin_panel');
    }

    await ctx.reply(text, {
      reply_markup: keyboard,
      reply_to_message_id: ctx.msg?.message_id,
    });
  } catch (err: unknown) {
    console.error('[ImageHandler] Error:', err);
    await ctx.reply('❌ حدث خطأ أثناء معالجة الصورة.');
  }
}
