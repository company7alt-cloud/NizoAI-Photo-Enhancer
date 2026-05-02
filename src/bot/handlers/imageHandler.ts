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

  // PRO ENHANCE INTERCEPTOR — must run before normal processing
  const userId = ctx.from?.id;
  if (!userId) return;

  let user = await User.findOne({ telegramId: userId.toString() });
  if (!user) {
    await ctx.reply('⚠️ يرجى إرسال /start أولاً لتسجيل حسابك.');
    return;
  }

  if (user?.awaitingNanoBananaImage) {

    // SECURITY LAYER 1: Check if feature locked after user started
    const { getSettings: getNanoSettings } = await import('../../services/settingsService');
    const nanoGlobalSettings = await getNanoSettings();
    const nanoAdminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
    const isNanoAdminUser = nanoAdminIds.includes(userId.toString());

    if (nanoGlobalSettings.locks.btn_nano && !isNanoAdminUser) {
      await User.findOneAndUpdate(
        { telegramId: userId.toString() },
        { $set: { awaitingNanoBananaImage: false } }
      );
      await ctx.reply('⚠️ عذراً، تم إقفال الميزة للصيانة. يرجى المحاولة لاحقاً 🔒');
      return;
    }

    // Get fileId BEFORE resetting state
    // If no image found, keep state so user can try again
    let fileId: string | undefined;
    if (ctx.message?.photo && ctx.message.photo.length > 0) {
      fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    } else if (ctx.message?.document?.mime_type?.startsWith('image/')) {
      fileId = ctx.message.document.file_id;
    }

    if (!fileId) {
      // Do NOT reset state — let user try again with a valid image
      await ctx.reply('⚠️ يرجى إرسال صورة صالحة للمتابعة.');
      return;
    }

    // SECURITY LAYER 2: Atomic deduction + state reset in ONE MongoDB operation
    // This prevents Race Condition from album sends (multiple images at once)
    if (!isNanoAdminUser) {
      const updatedUser = await User.findOneAndUpdate(
        {
          telegramId: userId.toString(),
          dailyQuota: { $gte: 5 },           // Only proceeds if balance >= 5
          awaitingNanoBananaImage: true        // Only proceeds if still in waiting state
        },
        {
          $inc: { dailyQuota: -5 },
          $set: { awaitingNanoBananaImage: false }
        },
        { new: true }
      );

      if (!updatedUser) {
        // Failed: either insufficient balance or concurrent request already consumed it
        await User.findOneAndUpdate(
          { telegramId: userId.toString() },
          { $set: { awaitingNanoBananaImage: false } }
        );
        await ctx.reply(
          '⚠️ رصيدك غير كافٍ أو تم معالجة طلب آخر في نفس الوقت.\n' +
          'تحتاج <b>5 محاولات</b> لاستخدام هذه الميزة.',
          { parse_mode: 'HTML' }
        );
        return;
      }
    } else {
      // Admin: reset state only, no deduction
      await User.findOneAndUpdate(
        { telegramId: userId.toString() },
        { $set: { awaitingNanoBananaImage: false } }
      );
    }

    const processingMsg = await ctx.reply(
      '⏳ جاري تحسين صورتك بالذكاء الاصطناعي... ✨\nالرجاء الانتظار 🌟'
    );

    try {
      const tgFile = await ctx.api.getFile(fileId);
      const imageUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;

      const { processNanoBanana } = await import('../../services/imageService');
      const resultBuffer = await processNanoBanana(imageUrl);
      const fileName = `NanoAI_${Date.now()}.jpg`;

      await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => {});

      const { InputFile } = await import('grammy');

      await ctx.replyWithDocument(
        new InputFile(resultBuffer, fileName),
        { caption: '✨ تم تحسين صورتك بنجاح! 🚀\n📁 تم الإرسال كملف للحفاظ على أعلى دقة' }
      );

      await ctx.replyWithPhoto(
        new InputFile(resultBuffer, fileName),
        { caption: '🖼 معاينة سريعة' }
      );

      const ARCHIVE_CHANNEL = process.env.ARCHIVE_GROUP_ID || process.env.CHANNEL_ID;
      if (ARCHIVE_CHANNEL) {
        const userLink = ctx.from?.username
          ? `@${ctx.from.username}`
          : `<a href="tg://user?id=${ctx.from?.id}">${ctx.from?.first_name || 'مجهول'}</a>`;

        await ctx.api.sendDocument(
          ARCHIVE_CHANNEL,
          new InputFile(resultBuffer, fileName),
          {
            caption:
              `📦 <b>نسخة أرشيفية (Nano AI)</b>\n` +
              `━━━━━━━━━━━━━\n` +
              `🆔 User ID: <code>${ctx.from?.id}</code>\n` +
              `👤 Username: ${userLink}\n` +
              `💎 Resolution: Nano AI\n` +
              `🕐 Time: ${new Date().toLocaleString('ar-SA')}\n` +
              `━━━━━━━━━━━━━`,
            parse_mode: 'HTML',
            disable_notification: true
          }
        ).catch(() => {});
      }

    } catch (error: any) {
      // Refund on failure
      if (!isNanoAdminUser) {
        await User.findOneAndUpdate(
          { telegramId: userId.toString() },
          { $inc: { dailyQuota: 5 } }
        );
      }
      await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => {});
      console.error('[NanoAI] Error:', error?.message);
      await ctx.reply('❌ عذراً، حدث خطأ. تم إعادة 5 محاولاتك تلقائياً ✨');
    }
    return;
  }

  if (user.proEnhanceSettings?.isAwaitingImage) {
    let fileId: string | undefined;
    if (ctx.message?.photo && ctx.message.photo.length > 0) {
      fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    } else if (ctx.message?.document?.mime_type?.startsWith('image/')) {
      fileId = ctx.message.document.file_id;
    }

    if (!fileId) {
      await ctx.reply('⚠️ يرجى إرسال صورة صالحة (صورة أو ملف صورة) للمتابعة في Pro Enhance.');
      return;
    }

    // ATOMIC UPDATE: Instantly reset flag to prevent double processing AND deduct quota
    const settings = user.proEnhanceSettings;
    const enhanceCost = settings.quality === 'max' ? 3 : 2;
    const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
    const isAdmin = adminIds.includes(userId.toString());

    if (!isAdmin && user.dailyQuota < enhanceCost) {
      await User.findOneAndUpdate({ telegramId: userId.toString() }, { $set: { 'proEnhanceSettings.isAwaitingImage': false } });
      await ctx.reply('⚠️ رصيدك غير كافٍ. تم إلغاء طلب Pro Enhance.');
      return;
    }

    await User.findOneAndUpdate(
      { telegramId: userId.toString() },
      { 
        $set: { 'proEnhanceSettings.isAwaitingImage': false },
        $inc: { dailyQuota: isAdmin ? 0 : -enhanceCost }
      }
    );

    const processingMsg = await ctx.reply(
      `⏳ جاري استلام صورتك...\n` +
      `🚀 بدأ التحسين بتقنية Pro Enhance\n` +
      `💎 الجودة: ${settings.quality} | التكبير: ${settings.scale}x | النوع: ${settings.imageType}\n` +
      `🌟 الرجاء الانتظار...`
    );

    try {
      const file = await ctx.api.getFile(fileId);
      const telegramFileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;

      // CRITICAL FIX: Use processProEnhance, NOT enhance!
      const { processProEnhance } = await import('../../services/imageService');
      const resultBuffer = await processProEnhance(
        telegramFileUrl,
        settings.quality!,
        parseInt(settings.scale!),
        settings.imageType!
      );

      await User.findOneAndUpdate({ telegramId: userId.toString() }, { $inc: { totalEnhancements: 1 } });

      const { v4: uuidv4 } = await import('uuid');
      const jobId = uuidv4().substring(0, 8).toUpperCase();

      await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => {});

      // Refresh user to get updated quota
      const freshUser = await User.findOne({ telegramId: userId.toString() });

      const { InputFile } = await import('grammy');
      await ctx.replyWithDocument(new InputFile(resultBuffer, `NizoAI_Pro_${jobId}.jpg`), {
        caption: `💎 صورتك جاهزة بتقنية Pro Enhance! ✨\n🏷 Job ID: ${jobId}\n⚡ محاولاتك المتبقية: ${freshUser?.dailyQuota}`
      });
      await ctx.replyWithPhoto(new InputFile(resultBuffer, `NizoAI_Pro_${jobId}.jpg`), {
        caption: '🖼 معاينة سريعة'
      });

      const archiveId = process.env.ARCHIVE_GROUP_ID || process.env.CHANNEL_ID;
      if (archiveId) {
        await ctx.api.sendDocument(archiveId, new InputFile(resultBuffer, `archive_pro_${jobId}.jpg`), {
          caption: `📦 نسخة Pro أرشيفية\n━━━━━━━━━━━━━━\n🆔 User ID: ${userId}\n👤 Username: @${ctx.from!.username || 'N/A'}\n🏷 Job ID: ${jobId}\n💎 الجودة: ${settings.quality} | التكبير: ${settings.scale}x | النوع: ${settings.imageType}\n📅 Time: ${new Date().toLocaleString('ar-SA')}\n━━━━━━━━━━━━━━`
        }).catch(e => console.error('[Archive Pro] Failed:', e));
      }

    } catch (error: any) {
      console.error('[Pro Enhance] Error:', error?.message || error);

      // Refund quota on failure
      if (!isAdmin) {
        await User.findOneAndUpdate({ telegramId: userId.toString() }, { $inc: { dailyQuota: enhanceCost } });
      }

      await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => {});
      
      const { sendAdminAlert } = await import('../../utils/adminAlert');
      await sendAdminAlert(ctx as any, `Pro Enhance Error: ${(error as Error).message}`);

      await ctx.reply(
        `😔 عذراً، فشلت عملية Pro Enhance 🌸\n\n` +
        `✅ تم إعادة ${enhanceCost} محاولات إلى رصيدك تلقائياً\n\n` +
        `🔄 يمكنك إعادة المحاولة بصورة أخرى\n` +
        `❓ إذا استمرت المشكلة، تواصل مع فريق الدعم عبر الزر الموجود في رسالة الترحيب 🛠️`
      );
    }

    return; // CRITICAL: Stop here — do not continue to normal 2K/4K processing
  }

  try {

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
