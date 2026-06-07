// src/bot/handlers/imageHandler.ts
import { InlineKeyboard } from 'grammy';
import { InputFile } from 'grammy';

import { User } from '../../database/models/User';
import { BotContext, isAdmin, isFileSizeValid } from '../../utils/validators';
import { getSettings } from '../../services/settingsService';
import {
  enhanceWithONNX,
  getQueuePosition,
} from '../../services/onnxEnhanceService';


export async function imageHandler(ctx: BotContext): Promise<void> {
  const telegramId = ctx.from?.id.toString();
  const reportUser = await User.findOne({ telegramId });

    // ── Strict Image Upload Guard ──
  const isAwaitingImage = (
    ctx.session?.workflowState === 'awaiting_image' ||
    ctx.session?.isAwaitingImage === true ||
    ctx.session?.currentService != null ||
    ctx.session?.awaitingFilterAction != null ||
    reportUser?.awaitingFilterImage === true ||
    reportUser?.awaitingFormatConversion === true ||
    reportUser?.awaitingCustomEraserImage === true ||
    reportUser?.awaitingAutoEraserImage === true ||
    reportUser?.awaitingNanoBananaImage === true ||
    reportUser?.awaitingMagicEnhanceImage === true ||
    reportUser?.proEnhanceSettings?.isAwaitingImage === true
  );

  if (!isAwaitingImage) {
    await ctx.reply(
      '⚠️ صديقي، لم تقم باختيار الخدمة أولاً!\n' +
      'يرجى الضغط على الزر المناسب لتحسين صورتك من القائمة الرئيسية 👆'
    );
    return;
  }
  // ───────────────────────────────

  // ── Format Conversion Interceptor ──
  const userRecord = reportUser;

  if (userRecord?.awaitingFormatConversion &&
    !userRecord.awaitingCustomEraserImage) {
    const doc = ctx.message?.document;
    if (doc) {
      const mimeType = doc.mime_type || '';
      const isImage = mimeType.startsWith('image/') ||
        doc.file_name?.match(/\.(jpg|jpeg|png|webp|avif|tiff|tif|bmp|gif|heic|heif)$/i);

      if (!isImage) {
        await ctx.reply('❌ الملف ليس صورة. أرسل ملف صورة صحيح.');
        return; // STRICT RETURN
      }

      const mimeToFormat: Record<string, string> = {
        'image/jpeg': 'JPG', 'image/jpg': 'JPG',
        'image/png': 'PNG', 'image/webp': 'WEBP',
        'image/avif': 'AVIF', 'image/tiff': 'TIFF',
        'image/gif': 'GIF', 'image/bmp': 'BMP',
        'image/heic': 'HEIC', 'image/heif': 'HEIF',
      };
      const detectedFormat = mimeToFormat[mimeType] ||
        doc.file_name?.split('.').pop()?.toUpperCase() || 'غير معروف';

      // Save file_id and pause awaiting state
      const updatedUser = await User.findOneAndUpdate(
        { telegramId },
        {
          $push: { pendingConversionFiles: doc.file_id },
          $set: { awaitingFormatConversion: false },
        },
        { new: true }
      );

      const count = updatedUser?.pendingConversionFiles?.length || 1;

      if (count >= 5) {
        // Max reached — force format selection
        await ctx.reply(
          `✅ تم استلام الصورة <b>${count}</b>\n\n` +
          `⚠️ <b>تنبيه:</b> وصلت للحد الأقصى المسموح به (5 صور).\n\n` +
          `🔓 للحصول على حد أعلى، تواصل مع المطور.\n\n` +
          `اختر الآن ما تريد:`,
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                // @ts-ignore
                [{ text: '✅ واصل لاختيار الصيغة', callback_data: 'conv_batch_finish' , style: 'success' as const}],
                [{ text: '💬 مراسلة المطور', url: `https://t.me/${process.env.ADMIN_USERNAME || 'Nizar_CEO'}` , style: 'success' as const}],
                // @ts-ignore
                [{ text: '❌ إلغاء', callback_data: 'convert_format_cancel' , style: 'danger' as const}],
              ],
            },
          }
        );
      } else {
        // Under limit — ask if more
        await ctx.reply(
          `✅ تم استلام الصورة <b>${count}</b>\n` +
          `📋 <b>الصيغة الحالية:</b> ${detectedFormat}\n\n` +
          `هل توجد صور أخرى تريد تحويلها أيضاً؟\n` +
          `<i>المتبقي: ${5 - count} صورة</i>`,
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  // @ts-ignore
                  { text: `✅ نعم (${5 - count} متبقي)`, callback_data: 'conv_batch_add', style: 'success' as const },
                  { text: '❌ لا، اختر الصيغة', callback_data: 'conv_batch_finish', style: 'primary' as const },
                ],
                // @ts-ignore
                [{ text: '🚫 إلغاء الكل', callback_data: 'convert_format_cancel' , style: 'danger' as const}],
              ],
            },
          }
        );
      }
      return; // STRICT RETURN — stop all other processing
    }
  }



  // PRO ENHANCE INTERCEPTOR — must run before normal processing
  const userId = ctx.from?.id;
  if (!userId) return;

  // ── FILTERS MENU INTERCEPTOR ─────────────────────────────────────────
  if (ctx.session?.inFiltersMenu && !ctx.session?.awaitingFilterAction) {
    const isMedia = ctx.message?.photo || ctx.message?.document;
    if (isMedia) {
      await ctx.reply("⚠️ <b>الرجاء اختيار الفلتر الذي تريد تطبيقه على صورتك من الأزرار أعلاه أولاً.</b>", { parse_mode: 'HTML' });
      return;
    }
  }

  let user = await User.findOne({ telegramId: userId.toString() });
  if (!user) {
    await ctx.reply('⚠️ يرجى إرسال /start أولاً لتسجيل حسابك.');
    return;
  }

  // ── UNIFIED FILTER INTERCEPTOR ─────────────────────────────────────────
  if (ctx.session?.awaitingFilterAction && ctx.session.awaitingFilterAction.startsWith('filter_')) {
    const photo = ctx.message?.photo;
    const document = ctx.message?.document;
    const fileId = photo ? photo[photo.length - 1].file_id : document?.file_id;

    if (!fileId) {
      await ctx.reply('⚠️ يرجى إرسال الصورة كصورة أو كملف للبدء بالمعالجة.');
      return;
    }

    const pendingFilter = ctx.session.awaitingFilterAction;
    ctx.session.activeImageFileId = fileId;
    ctx.session.awaitingFilterAction = undefined; // Clear state immediately
    ctx.session.inFiltersMenu = false; // Clear menu state

    const processingMsg = await ctx.reply('⏳ جاري استلام الصورة والبدء بالمعالجة...');

    try {
      const tgFile = await ctx.api.getFile(fileId);
      const imageUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;

      const { processImageFilter } = await import('../../services/imageService');

      // ── UNIFIED FILTER PIPELINE (restore + all other filters) ─────────────────────
      const filterType = pendingFilter.replace('filter_', '');
      const cost = ['anime', 'ghibli'].includes(filterType) ? 3 : 2; // restore costs 2

      const filterNames: Record<string, string> = {
        face: '👤 تصفية الوجه',
        color: '🎨 تلوين الصور',
        anime: '🌸 أنمي',
        ghibli: ' جيبلي فني',
        restore: '🪄 ترميم الصورة',
      };

      // STRICT: Check quota BEFORE calling API
      if (user.dailyQuota < cost) {
        await ctx.reply(`⚠️ رصيدك غير كافٍ!\nتحتاج <b>${cost} محاولات</b> لهذا الفلتر.\nرصيدك الحالي: <b>${user.dailyQuota}</b>`, { parse_mode: 'HTML' });
        await ctx.api.deleteMessage(ctx.chat!.id, processingMsg.message_id).catch(() => {});
        return;
      }

      // STRICT: Deduct BEFORE calling API
      const updatedUser = await User.findOneAndUpdate(
        { telegramId: ctx.from!.id.toString() },
        { $inc: { dailyQuota: -cost } },
        { new: true }
      );

      try {
        const resultBuffer = await processImageFilter(imageUrl, filterType);

        await User.findOneAndUpdate(
          { telegramId: ctx.from!.id.toString() },
          { $set: { lastEraserResultBuffer: resultBuffer.toString('base64') } }
        );

        const { incrementGlobalCounter } = await import('../../services/statsService');
        await incrementGlobalCounter();

        // Archive
        const archiveChannel = process.env.ARCHIVE_GROUP_ID || process.env.ARCHIVE_CHANNEL || process.env.CHANNEL_ID;
        if (archiveChannel) {
          const sizeMB = (resultBuffer.length / (1024 * 1024)).toFixed(2);
          ctx.api.sendDocument(archiveChannel, new InputFile(resultBuffer, `filter_${filterType}.jpg`), {
            caption: `📦 <b>أرشيف — فلاتر الصور</b>\n━━━━━━━━━━━━━━\n🆔 <b>User ID:</b> <code>${ctx.from!.id}</code>\n🎨 <b>الفلتر:</b> ${filterNames[filterType] ?? filterType}\n✅ <b>الحالة:</b> ناجحة\n📦 <b>الحجم:</b> ${sizeMB} MB\n━━━━━━━━━━━━━━`,
            parse_mode: 'HTML',
            disable_notification: true
          }).catch(() => {});
        }

        // Send as Document
        await ctx.replyWithDocument(new InputFile(resultBuffer, `NizoAI_Filter_${Date.now()}.jpg`), {
          caption: `✅ <b>تم تطبيق ${filterNames[filterType] ?? filterType} بنجاح!</b> 🎨\n` +
                   `⚡ المحاولات المستخدمة: ${cost}\n` +
                   `💎 رصيدك المتبقي: ${updatedUser?.dailyQuota ?? 0}`,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                // @ts-ignore
                { text: '🖼 PNG', callback_data: 'conv_png', style: 'primary' as const },
                { text: '🖼 JPG', callback_data: 'conv_jpg', style: 'primary' as const },
                // @ts-ignore
                { text: '🖼 WEBP', callback_data: 'conv_webp', style: 'primary' as const },
              ],
              [
                // @ts-ignore
                { text: '🖼 GIF', callback_data: 'conv_gif', style: 'primary' as const },
                { text: '🖼 TIFF', callback_data: 'conv_tiff', style: 'primary' as const },
                // @ts-ignore
                { text: '🖼 AVIF', callback_data: 'conv_avif', style: 'primary' as const },
              ],
            ]
          }
        });
        await ctx.replyWithPhoto(new InputFile(resultBuffer, `NizoAI_Filter_${Date.now()}.jpg`), {
          caption: '🖼 معاينة سريعة'
        });
      } catch (filterErr: any) {
        // Refund on failure
        await User.findOneAndUpdate(
          { telegramId: ctx.from!.id.toString() },
          { $inc: { dailyQuota: cost } }
        );
        throw filterErr;
      }
    } catch (err: any) {
      console.error('[FILTER ERROR]', err);
      await ctx.api.deleteMessage(ctx.chat!.id, processingMsg.message_id).catch(() => {});
      await ctx.reply('❌ عذراً، حدث خطأ أثناء المعالجة.');
    }

    return; // Halt standard photo processing
  }

  if (user?.awaitingCustomEraserImage) {
    const photo = ctx.message?.photo;
    const document = ctx.message?.document;
    const fileId = photo ? photo[photo.length - 1].file_id : document?.file_id;

    if (!fileId) {
      await ctx.reply('⚠️ يرجى إرسال صورة عادية أو كملف.');
      return;
    }

    user.customEraserFileId = fileId;
    user.awaitingCustomEraserImage = false;
    user.awaitingCustomEraserZone = false;
    user.customEraserSelectedCells = [];
    user.customEraserGridSize = 0;
    
    const btnMsg = await ctx.reply(
      "🖼️ <b>تم استلام صورتك!</b>\n\n" +
      "📐 <b>اختر حجم الشبكة:</b>\n" +
      "كلما زاد التقسيم، زادت دقة التحديد",
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              // @ts-ignore
              { text: '30 تقسيم', callback_data: 'cgz_size_30', style: 'primary' as const },
              { text: '40 تقسيم', callback_data: 'cgz_size_40', style: 'primary' as const },
            ],
            [
              // @ts-ignore
              { text: '50 تقسيم', callback_data: 'cgz_size_50', style: 'primary' as const },
              { text: '70 تقسيم', callback_data: 'cgz_size_70', style: 'primary' as const },
            ],
            [
              // @ts-ignore
              { text: '80 تقسيم', callback_data: 'cgz_size_80', style: 'primary' as const },
              { text: '🔒 100 تقسيم', callback_data: 'cgz_size_100', style: 'primary' as const },
            ],
            // @ts-ignore
            [{ text: '❌ إلغاء', callback_data: 'cancel_custom_eraser' , style: 'danger' as const}],
          ]
        }
      }
    );
    
    user.customEraserBtnMsgId = btnMsg.message_id;
    await user.save();
    return;
  }

  // ══════════════════════════════════════
  // 🧹 AUTO ERASER — one-shot bottom-right watermark removal
  // ══════════════════════════════════════
  if (user?.awaitingAutoEraserImage) {
    const autoAdminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
    const isAutoAdmin = autoAdminIds.includes(userId.toString());

    // Guard: make sure we actually received a photo or image document
    const photo = ctx.message?.photo;
    if (!photo || photo.length === 0) {
      if (!ctx.message?.document?.mime_type?.startsWith('image/')) {
        await ctx.reply('❌ لم أتمكن من استلام الصورة. أرسلها مرة أخرى.');
        return;
      }
    }

    // Accept photo OR document — always pick the largest photo for best quality
    let fileId: string | undefined;
    const largest = photo && photo.length > 0 ? photo[photo.length - 1] : undefined;
    if (largest) {
      fileId = largest.file_id;
    } else if (ctx.message?.document?.mime_type?.startsWith('image/')) {
      fileId = ctx.message.document.file_id;
    }

    if (!fileId) {
      await ctx.reply('❌ لم أتمكن من استلام الصورة. أرسلها مرة أخرى.');
      return;
    }

    // Atomic: reset flag + deduct 1 attempt in one DB call
    if (!isAutoAdmin) {
      const updatedUser = await User.findOneAndUpdate(
        {
          telegramId: userId.toString(),
          awaitingAutoEraserImage: true
        },
        {
          $inc: { dailyQuota: -1, totalEnhancements: 1 },
          $set: { awaitingAutoEraserImage: false }
        },
        { new: true }
      );

      if (!updatedUser) {
        // State already consumed by concurrent request
        await User.findOneAndUpdate(
          { telegramId: userId.toString() },
          { $set: { awaitingAutoEraserImage: false } }
        );
        await ctx.reply('⚠️ تم معالجة طلب آخر في نفس الوقت. ابدأ من جديد.');
        return;
      }
    } else {
      await User.findOneAndUpdate(
        { telegramId: userId.toString() },
        { $set: { awaitingAutoEraserImage: false } }
      );
    }

    const processingMsg = await ctx.reply(
      '⏳ جاري تحليل الصورة وإزالة العلامة المائية بالذكاء الاصطناعي...\n⏱ قد يستغرق 30-60 ثانية',
      { parse_mode: 'HTML' }
    );

    try {
      const tgFile = await ctx.api.getFile(fileId);
      const imageUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;

      const { removeBottomRightWatermarkAI } = await import('../../services/imageService');
      const resultBuffer = await removeBottomRightWatermarkAI(imageUrl);



      await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => { });

      const { InputFile } = await import('grammy');

      // Send document first WITHOUT buttons
      const { incrementGlobalCounter } = await import('../../services/statsService');
      await incrementGlobalCounter();
      const sentDoc = await ctx.replyWithDocument(
        new InputFile(resultBuffer, `watermark_removed_${Date.now()}.jpg`),
        {
          caption:
            "✅ *تمت إزالة العلامة المائية بنجاح*\n\n" +
            "📐 الحجم والمقاس الأصلي محفوظ بالكامل\n" +
            "💎 الجودة: نسخة كاملة بدون ضغط",
          parse_mode: "Markdown",
          reply_parameters: { message_id: ctx.message!.message_id },
        }
      );

      // Send photo preview
      await ctx.replyWithPhoto(
        new InputFile(resultBuffer),
        { caption: '🖼 معاينة سريعة' }
      );

      const ARCHIVE_CHANNEL = process.env.ARCHIVE_GROUP_ID || process.env.CHANNEL_ID
      if (ARCHIVE_CHANNEL) {
        const actionUser = ctx.from!
        const userLink = actionUser.username
          ? `@${actionUser.username}`
          : `<a href="tg://user?id=${actionUser.id}">${actionUser.first_name || 'مجهول'}</a>`
        const sizeMB = (resultBuffer.length / 1024 / 1024).toFixed(2)
        ctx.api.sendDocument(
          ARCHIVE_CHANNEL,
          new InputFile(resultBuffer, `auto_eraser_${Date.now()}.jpg`),
          {
            caption:
              `📦 <b>نسخة أرشيفية</b>\n` +
              `━━━━━━━━━━━━━━\n` +
              `🆔 <b>User ID:</b> <code>${actionUser.id}</code>\n` +
              `👤 <b>Username:</b> ${userLink}\n` +
              `🔄 <b>العملية:</b> إزالة علامة مائية تلقائية 🧹\n` +
              `💎 <b>التكلفة:</b> محاولة واحدة\n` +
              `📦 <b>الحجم:</b> ${sizeMB} MB\n` +
              `📅 <b>Time:</b> ${new Date().toLocaleString('ar-SA')}\n` +
              `━━━━━━━━━━━━━━`,
            parse_mode: 'HTML',
            disable_notification: true,
          }
        ).catch((e: unknown) => console.error('[Archive Error]:', e))
      }

      // Save resultBuffer to user record for conversion use
      await User.updateOne(
        { telegramId: userId.toString() },
        {
          lastEraserResultBuffer: resultBuffer.toString('base64'),
          lastEraserResultMsgId: sentDoc.message_id,
        }
      );

      // Send format conversion buttons as a SEPARATE message immediately after
      await ctx.reply(
        "🔄 *تحويل الصيغة:*",
        {
          parse_mode: "Markdown",
          reply_markup: new InlineKeyboard()
            .text({ text: "🖼 JPG 🖼️", style: 'primary' as const }, "eraser_fmt_jpg")
            .text({ text: "🗋 PNG 🖼️", style: 'primary' as const }, "eraser_fmt_png")
            .text({ text: "🌐 WEBP 🖼️", style: 'primary' as const }, "eraser_fmt_webp")
            .row()
            .text({ text: "🎞 GIF 🖼️", style: 'primary' as const }, "eraser_fmt_gif")
            .text({ text: "📄 TIFF 🖼️", style: 'primary' as const }, "eraser_fmt_tiff")
        }
      );



    } catch (error: any) {
      // Restore 1 attempt on failure
      if (!isAutoAdmin) {
        await User.findOneAndUpdate(
          { telegramId: userId.toString() },
          { $inc: { dailyQuota: 1, totalEnhancements: -1 } }
        );
      }
      await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => { });
      console.error('[AutoEraser] Error:', error?.message);
      await ctx.reply('❌ عذراً، حدث خطأ. تم إعادة نقطتيك تلقائياً ');
    }
    return;
  }




  // ── MAGIC ENHANCE IMAGE HANDLER ──────────────────────────────────────────
  if (user?.awaitingMagicEnhanceImage) {
    const magicAdminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
    const isMagicAdmin = magicAdminIds.includes(userId.toString());

    let fileId: string | undefined;
    if (ctx.message?.photo && ctx.message.photo.length > 0) {
      fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    } else if (ctx.message?.document?.mime_type?.startsWith('image/')) {
      fileId = ctx.message.document.file_id;
    }

    if (!fileId) {
      await ctx.reply('⚠️ يرجى إرسال صورة صالحة للمتابعة.');
      return;
    }

    if (!isMagicAdmin) {
      const lockedUser = await User.findOneAndUpdate(
        {
          telegramId: userId.toString(),
          dailyQuota: { $gte: 5 },
          awaitingMagicEnhanceImage: true,
          isProcessingImage: { $ne: true },
        },
        {
          $inc: { dailyQuota: -5 },
          $set: { awaitingMagicEnhanceImage: false, isProcessingImage: true },
        },
        { new: true }
      );

      if (!lockedUser) {
        const check = await User.findOne({ telegramId: userId.toString() });
        await User.findOneAndUpdate(
          { telegramId: userId.toString() },
          { $set: { awaitingMagicEnhanceImage: false } }
        );
        if (check?.isProcessingImage) {
          await ctx.reply('⏳ جاري معالجة طلب آخر. انتظر حتى ينتهي.');
        } else {
          await ctx.reply(
            '⚠️ رصيدك غير كافٍ!\nتحتاج 5 محاولات لاستخدام هذه الميزة.',
            { parse_mode: 'HTML' }
          );
        }
        return;
      }
    } else {
      await User.findOneAndUpdate(
        { telegramId: userId.toString() },
        { $set: { awaitingMagicEnhanceImage: false } }
      );
    }

    const processingMsg = await ctx.reply(
      '⏳ <b>يرجى الانتظار...</b>\n\n' +
      'الذكاء الاصطناعي يعمل الآن على توليد نسختك الاحترافية ✨\n\n' +
      '⚠️ <i>قد تستغرق عملية التحسين حتى 15 دقيقة، في حال تعدى هذا الوقت ولم تصلك الصورة، يرجى رفع بلاغ وسيتم تعويضك فوراً.</i>',
      { parse_mode: 'HTML' }
    );

    const animations = [
      '🔍 جاري تهيئة خوادم الذكاء الاصطناعي لاستقبال الصورة .',
      '🤖 يتم الآن تحليل تفاصيل الصورة بدقة عالية ..',
      '✨ جاري معالجة الإضاءة والظلال المعقدة ...',
      '🎨 يتم الآن دمج الواقعية العالية مع الملامح الأصلية .',
      '⏳ جاري تحسين جودة البكسلات وإبراز الملمس ..',
      '⚙️ الذكاء الاصطناعي يقوم باللمسات قبل النهائية ...',
      '🚀 جاري تجهيز نسختك الاحترافية للعرض .',
      '🌟 اللمسات الأخيرة... يرجى الانتظار قليلاً ..'
    ];
    let animIdx = 0;
    const animInterval = setInterval(async () => {
      // Loop through the array infinitely using modulo
      const currentAnim = animations[animIdx++ % animations.length];
      await ctx.api.editMessageText(
        processingMsg.chat.id,
        processingMsg.message_id,
        currentAnim + '\n\n⚠️ <i>قد تستغرق عملية التحسين حتى 15 دقيقة، في حال تعدى هذا الوقت ولم تصلك الصورة، يرجى رفع بلاغ وسيتم تعويضك.</i>',
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }, 10000); // 10 seconds interval

    try {
      const tgFile = await ctx.api.getFile(fileId);
      const imageUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;

      const replicateKey = process.env.REPLICATE_API_TOKEN || '';
      if (!replicateKey) throw new Error('REPLICATE_API_TOKEN is missing');

      // Step 1: Create prediction
      const createRes = await fetch('https://api.replicate.com/v1/models/philz1337x/crystal-upscaler/predictions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${replicateKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'wait=60',
        },
        body: JSON.stringify({
          input: {
            image:         imageUrl,
            scale_factor:  2,
            resemblance:   0.9,
            creativity:    0.2,
            dynamic:       8,
            sharpen:       3,
            tiling_width:  112,
            tiling_height: 144,
            output_format: 'jpg',
          }
        })
      });

      if (!createRes.ok) {
        const errText = await createRes.text();
        console.error('[MagicEnhance] Replicate create error:', errText);
        throw new Error(`replicate_create_failed: ${createRes.status}`);
      }

      let predictionData = await createRes.json() as any;
      const predictionId: string = predictionData.id;

      // Step 2: Poll until done (max 10 minutes)
      const pollStart = Date.now();
      while (
        predictionData.status !== 'succeeded' &&
        predictionData.status !== 'failed' &&
        predictionData.status !== 'canceled'
      ) {
        if (Date.now() - pollStart > 10 * 60 * 1000) {
          throw new Error('replicate_timeout');
        }
        await new Promise(r => setTimeout(r, 4000));
        const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
          headers: { 'Authorization': `Bearer ${replicateKey}` }
        });
        predictionData = await pollRes.json() as any;
      }

      if (predictionData.status !== 'succeeded') {
        console.error('[MagicEnhance] Replicate failed:', JSON.stringify(predictionData.error));
        throw new Error('replicate_prediction_failed');
      }

      const outputUrl: string = Array.isArray(predictionData.output)
        ? predictionData.output[0]
        : predictionData.output;

      if (!outputUrl) throw new Error('empty_output');

      const resultRes = await fetch(outputUrl);
      if (!resultRes.ok) throw new Error('result_download_failed');
      const resultBuffer = Buffer.from(await resultRes.arrayBuffer());

      clearInterval(animInterval);
      await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => {});

      await User.findOneAndUpdate(
        { telegramId: userId.toString() },
        {
          $inc: { totalEnhancements: 1 },
          $set: { lastMagicEnhanceBuffer: resultBuffer.toString('base64') }
        }
      );

      const { InputFile } = await import('grammy');
      const { InlineKeyboard } = await import('grammy');
      const fileName = `NizoAI_Magic_${Date.now()}.jpg`;

      await ctx.replyWithDocument(
        new InputFile(resultBuffer, fileName),
        {
          caption:
            '🪤 تمت العملية بنجاح!\n\n' +
            '✨ تم تحسين الصورة باحترافية كاملة مع الحفاظ على كل تفاصيلها الأصلية\n' +
            '💸 الجودة: نسخة كاملة بدون ضغط',
          parse_mode: 'HTML',
        }
      );

      await ctx.replyWithPhoto(new InputFile(resultBuffer), { caption: '🖼 معاينة سريعة' });

      await ctx.reply(
        '🔄 تحويل الصيغة:',
        {
          reply_markup: new InlineKeyboard()
            .text('🖼 JPG',  'magic_fmt_jpg')
            .text('🖼 PNG',  'magic_fmt_png')
            .text('🖼 WEBP', 'magic_fmt_webp')
            .row()
            .text('🖼 AVIF', 'magic_fmt_avif')
            .text('🖼 TIFF', 'magic_fmt_tiff')
        }
      );

      const BACKUP = process.env.ARCHIVE_GROUP_ID || process.env.CHANNEL_ID;
      if (BACKUP) {
        const actionUser = ctx.from!;
        const userLink = actionUser.username
          ? `@${actionUser.username}`
          : `${actionUser.first_name || 'مجهول'}`;
        ctx.api.sendDocument(
          BACKUP,
          new InputFile(resultBuffer, fileName),
          {
            caption:
              `📦 نسخة أرشيفية — تحسين احترافي\n` +
              `━━━━━━━━━━━━━━\n` +
              `🆔 User ID: ${actionUser.id}\n` +
              `👤 Username: ${userLink}\n` +
              `🔄 العملية: تحسين احترافي بالذكاء الاصطناعي\n` +
              `💳 المحاولات المخصومة: 5\n` +
              `✅ الحالة: ناجحة\n` +
              `📅 الوقت: ${new Date().toLocaleString('ar-SA')}\n` +
              `━━━━━━━━━━━━━━`,
            parse_mode: 'HTML',
            disable_notification: true,
          }
        ).catch((e: any) => console.error('[MagicEnhance Archive]:', e));
      }

    } catch (err: any) {
      clearInterval(animInterval);
      if (!isMagicAdmin) {
        await User.findOneAndUpdate(
          { telegramId: userId.toString() },
          { $inc: { dailyQuota: 5 } }
        );
      }
      await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => {});
      console.error('[MagicEnhance] Error:', err?.message);
      await ctx.reply(
        '❌ عذراً، حدث خطأ أثناء المعالجة.\n' +
        'تم إعادة 5 محاولات لرصيدك تلقائياً ✨',
        { parse_mode: 'HTML' }
      );
    } finally {
      if (!isMagicAdmin) {
        await User.findOneAndUpdate(
          { telegramId: userId.toString() },
          { $set: { isProcessingImage: false } }
        ).catch(() => {});
      }
    }
    return;
  }

  if (user?.awaitingNanoBananaImage) {

    // ── SECURITY: Check if feature was locked after user started ──────────────
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

    // ── WALL 1: Resolve file ID + file size from Telegram metadata ────────────
    // (Done BEFORE any download or DB write)
    let fileId: string | undefined;
    let fileSize: number = 0;

    if (ctx.message?.photo && ctx.message.photo.length > 0) {
      const largest = ctx.message.photo[ctx.message.photo.length - 1];
      fileId = largest.file_id;
      fileSize = largest.file_size ?? 0;
    } else if (ctx.message?.document?.mime_type?.startsWith('image/')) {
      fileId = ctx.message.document.file_id;
      fileSize = ctx.message.document.file_size ?? 0;
    }

    // STRICT SINGLE IMAGE GUARD
    const isAlbum = ctx.message?.media_group_id != null;

    if (isAlbum) {
      await User.findOneAndUpdate(
        { telegramId: userId.toString() },
        { $set: { awaitingNanoBananaImage: false } }
      );
      await ctx.reply(
        '❌ <b>يُسمح بصورة واحدة فقط!</b>\n\n' +
        'أرسلت أكثر من صورة في نفس الوقت.\n' +
        '📌 يرجى العودة واختيار الخدمة مجدداً وإرسال صورة واحدة فقط.',
        { parse_mode: 'HTML' }
      );
      return;
    }

    if (!fileId) {
      // Do NOT reset state — let user try again with a valid image
      await ctx.reply('⚠️ يرجى إرسال صورة صالحة للمتابعة.');
      return;
    }

    if (fileSize > 10 * 1024 * 1024) {
      await User.findOneAndUpdate(
        { telegramId: userId.toString() },
        { $set: { awaitingNanoBananaImage: false } }
      );
      await ctx.reply(
        '❌ <b>حجم الصورة يتجاوز 10MB!</b>\n\n' +
        'يرجى إرسال صورة أصغر حجماً للحصول على أفضل النتائج.',
        { parse_mode: 'HTML' }
      );
      return;
    }

    // ── WALL 2 + Atomic lock + 3-point deduction ──────────────────────────────
    // findOneAndUpdate atomically: sets isProcessingImage=true, deducts 3 points,
    // resets awaitingNanoBananaImage — all in ONE DB round-trip.
    // This prevents race conditions from album sends and double-taps.
    if (!isNanoAdminUser) {
      const lockedUser = await User.findOneAndUpdate(
        {
          telegramId: userId.toString(),
          dailyQuota: { $gte: 3 },          // must have 3 points
          awaitingNanoBananaImage: true,            // still in waiting state
          isProcessingImage: { $ne: true },         // not already processing
        },
        {
          $inc: { dailyQuota: -3 },
          $set: {
            awaitingNanoBananaImage: false,
            isProcessingImage: true,
          },
        },
        { new: true }
      );

      if (!lockedUser) {
        // Failed: insufficient balance OR concurrent request already consumed it
        const check = await User.findOne({ telegramId: userId.toString() });
        await User.findOneAndUpdate(
          { telegramId: userId.toString() },
          { $set: { awaitingNanoBananaImage: false } }
        );
        if (check?.isProcessingImage) {
          await ctx.reply('⏳ جاري معالجة طلب آخر بالفعل. انتظر حتى ينتهي ثم حاول مجدداً.');
        } else {
          await ctx.reply(
            '⚠️ رصيدك غير كافٍ أو تم معالجة طلب آخر في نفس الوقت.\n' +
            'تحتاج <b>3 محاولات</b> لاستخدام هذه الميزة.',
            { parse_mode: 'HTML' }
          );
        }
        return;
      }
    } else {
      // Admin: reset state only, no deduction, no lock
      await User.findOneAndUpdate(
        { telegramId: userId.toString() },
        { $set: { awaitingNanoBananaImage: false } }
      );
    }

    // ── WALL 2: Queue position status message ─────────────────────────────────
    const queuePos = getQueuePosition();

    const waveFrames: string[] = [
      '⏳ جاري تحسين صورتك بتقنية NizoAI ●○○',
      '⏳ جاري تحسين صورتك بتقنية NizoAI ○●○',
      '⏳ جاري تحسين صورتك بتقنية NizoAI ○○●',
      '🔍 يتم الآن تحليل تفاصيل الصورة ●○○',
      '🔍 يتم الآن تحليل تفاصيل الصورة ○●○',
      '🔍 يتم الآن تحليل تفاصيل الصورة ○○●',
      '🎨 يتم تحسين الألوان والإضاءة ●○○',
      '🎨 يتم تحسين الألوان والإضاءة ○●○',
      '🎨 يتم تحسين الألوان والإضاءة ○○●',
      '✨ يتم رفع الدقة وإبراز التفاصيل ●○○',
      '✨ يتم رفع الدقة وإبراز التفاصيل ○●○',
      '✨ يتم رفع الدقة وإبراز التفاصيل ○○●',
      '⚡ الذكاء الاصطناعي يعمل بأقصى طاقته ●○○',
      '⚡ الذكاء الاصطناعي يعمل بأقصى طاقته ○●○',
      '⚡ الذكاء الاصطناعي يعمل بأقصى طاقته ○○●',
      '🖼 جاري معالجة البكسلات بدقة فائقة ●○○',
      '🖼 جاري معالجة البكسلات بدقة فائقة ○●○',
      '🖼 جاري معالجة البكسلات بدقة فائقة ○○●',
      '🚀 اللمسات الأخيرة على صورتك ●○○',
      '🚀 اللمسات الأخيرة على صورتك ○●○',
      '🚀 اللمسات الأخيرة على صورتك ○○●',
      '🌟 تقنية NizoAI تصنع الفارق ●○○',
      '🌟 تقنية NizoAI تصنع الفارق ○●○',
      '🌟 تقنية NizoAI تصنع الفارق ○○●',
      '💎 جودة احترافية في طريقها إليك ●○○',
      '💎 جودة احترافية في طريقها إليك ○●○',
      '💎 جودة احترافية في طريقها إليك ○○●',
      '🔬 تحليل دقيق لكل تفصيل في صورتك ●○○',
      '🔬 تحليل دقيق لكل تفصيل في صورتك ○●○',
      '🔬 تحليل دقيق لكل تفصيل في صورتك ○○●',
      '⏰ صبرك جميل، النتيجة ستبهرك ●○○',
      '⏰ صبرك جميل، النتيجة ستبهرك ○●○',
      '⏰ صبرك جميل، النتيجة ستبهرك ○○●',
    ];

    const initMsg = queuePos > 0
      ? `⏳ تم وضعك في طابور الانتظار...\n(${queuePos} طلب قبلك) ●○○`
      : '⏳ جاري تحسين صورتك بتقنية NizoAI الخاصة ●○○';

    let processingMsg: { chat: { id: number }; message_id: number };
    processingMsg = await ctx.reply(initMsg);

    // Typing indicator (النقاط المموجة في شريط تليجرام)
    await ctx.api.sendChatAction(ctx.chat!.id, 'upload_document').catch(() => {});
    const typingInterval = setInterval(async () => {
      await ctx.api.sendChatAction(ctx.chat!.id, 'upload_document').catch(() => {});
    }, 4000);

    // Wave messages
    let waveIdx = 0;
    const waveInterval = setInterval(async () => {
      await ctx.api.editMessageText(
        processingMsg.chat.id,
        processingMsg.message_id,
        waveFrames[waveIdx++ % waveFrames.length]
      ).catch(() => {});
    }, 2000);

    try {
      // ── STEP: Download image as Buffer (no temp files) ────────────────────
      const tgFile = await ctx.api.getFile(fileId);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;

      const fetchRes = await fetch(fileUrl);
      if (!fetchRes.ok) throw new Error('download_failed');

      const inputBuffer = Buffer.from(await fetchRes.arrayBuffer());

      // waveInterval handles all message updates — no manual edit needed

      // ── STEP: Run local AI enhancement ───────────────────────────────────
      const resultBuffer = await enhanceWithONNX(inputBuffer);
      const fileName = `NizoAI_Enhanced_${Date.now()}.jpg`;

      // Delete processing message
      clearInterval(waveInterval);
      clearInterval(typingInterval);
      await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => { });

      // ── STEP: Deliver to user ─────────────────────────────────────────────
      const { incrementGlobalCounter } = await import('../../services/statsService');
      await incrementGlobalCounter();
      await ctx.replyWithDocument(
        new InputFile(resultBuffer, fileName),
        {
          caption: ' تم تحسين صورتك بتقنية NizoAI الخاصة! 🚀\n📁 تم الإرسال كملف للحفاظ على أعلى دقة',
          reply_markup: {
            inline_keyboard: [
              [
                // @ts-ignore
                { text: '🖼 PNG', callback_data: 'conv_png', style: 'primary' as const },
                { text: '🖼 JPG', callback_data: 'conv_jpg', style: 'primary' as const },
                // @ts-ignore
                { text: '🖼 WEBP', callback_data: 'conv_webp', style: 'primary' as const },
              ],
              [
                // @ts-ignore
                { text: '🖼 AVIF', callback_data: 'conv_avif', style: 'primary' as const },
                { text: '🖼 TIFF', callback_data: 'conv_tiff', style: 'primary' as const },
              ],
            ],
          },
        }
      );

      await ctx.replyWithPhoto(
        new InputFile(resultBuffer, fileName),
        { caption: '🖼 معاينة سريعة' }
      );

      // ── STEP: Channel archive (100% untouched original logic) ────────────
      const ARCHIVE_CHANNEL = process.env.ARCHIVE_GROUP_ID || process.env.CHANNEL_ID;
      if (ARCHIVE_CHANNEL) {
        const userLink = ctx.from?.username
          ? `@${ctx.from.username}`
          : `<a href="tg://user?id=${ctx.from?.id}">${ctx.from?.first_name || 'مجهول'}</a>`;

        ctx.api.sendDocument(
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
            disable_notification: true,
          }
        ).catch(() => { });
      }

    } catch (error: unknown) {
      clearInterval(waveInterval);
      clearInterval(typingInterval);
      // ── Refund 3 points on ANY failure (except file_too_large, already caught above)
      if (!isNanoAdminUser) {
        await User.findOneAndUpdate(
          { telegramId: userId.toString() },
          { $inc: { dailyQuota: 3 } }
        );
      }
      await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => { });
      console.error('[NanoAI] Error:', error instanceof Error ? error.message : error);
      await ctx.reply('❌ عذراً، حدث خطأ. تم إعادة 3 محاولات لرصيدك تلقائياً ✅');

    } finally {
      clearInterval(waveInterval);
      clearInterval(typingInterval);
      // ── Release processing lock — ALWAYS, no exceptions ──────────────────
      if (!isNanoAdminUser) {
        await User.findOneAndUpdate(
          { telegramId: userId.toString() },
          { $set: { isProcessingImage: false } }
        ).catch(() => { });
      }
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
      `📥 *تم استلام صورتك بنجاح!*\n🚀 نظام *Pro Enhance* يعمل الآن على استخراج أدق التفاصيل بأقصى جودة.\n💎 _الرجاء الانتظار قليلاً بينما نصنع لك لوحة فنية (بدقة 4x)..._ ⏳`,
      { parse_mode: 'Markdown' }
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

      await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => { });

      // Refresh user to get updated quota
      const freshUser = await User.findOne({ telegramId: userId.toString() });

      const { InputFile } = await import('grammy');
      const { incrementGlobalCounter } = await import('../../services/statsService');
      await incrementGlobalCounter();
      await ctx.replyWithDocument(new InputFile(resultBuffer, `NizoAI_Pro_${jobId}.jpg`), {
        caption: `💎 صورتك جاهزة بتقنية Pro Enhance! \n🏷 Job ID: ${jobId}\n⚡ محاولاتك المتبقية: ${freshUser?.dailyQuota}`,
        reply_markup: {
          inline_keyboard: [
            [
              // @ts-ignore
              { text: '🖼 PNG', callback_data: 'conv_png', style: 'primary' as const },
              { text: '🖼 JPG', callback_data: 'conv_jpg', style: 'primary' as const },
              // @ts-ignore
              { text: '🖼 WEBP', callback_data: 'conv_webp', style: 'primary' as const },
            ],
            [
              // @ts-ignore
              { text: '🖼 AVIF', callback_data: 'conv_avif', style: 'primary' as const },
              { text: '🖼 TIFF', callback_data: 'conv_tiff', style: 'primary' as const },
            ],
          ],
        },
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

      await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => { });

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
        `🎁 ستحصل على 5 محاولات جديدة تلقائياً بعد انتهاء الوقت ` +
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

    const keyboard: any = {
      inline_keyboard: [
        [
          // @ts-ignore
          { text: locks.btn_2k ? '🔒 دقة 2K — مقفلة' : '🚀 دقة 2K — محاولة واحدة', callback_data: 'enhance_2k', style: 'primary' }
        ],
        [
          // @ts-ignore
          { text: locks.btn_4k ? '🔒 دقة 4K — مقفلة' : ' دقة 4K — محاولتان (جودة فائقة)', callback_data: 'enhance_4k', style: 'primary' }
        ],
        [
          // @ts-ignore
          { text: locks.btn_8k ? '🔒 دقة 8K — مقفلة' : '💎 دقة 8K', callback_data: 'locked_8k', style: 'primary' }
        ],
        [
          // @ts-ignore
          { text: locks.btn_4kai ? '🔒 4K-Ai — مقفل' : ' 4K - Ai', callback_data: 'process_4k_ai', style: 'primary' },
          // @ts-ignore
          { text: locks.btn_8kai ? '🔒 8K-Ai — مقفل' : '🔒 8K - Ai', callback_data: 'locked_8k_ai', style: 'primary' }
        ]
      ]
    };

    if (isAdminUser) {
      keyboard.inline_keyboard.push([{ text: '⚙️ لوحة تحكم الأدمن', callback_data: 'admin_panel' , style: 'primary' as const}]);
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
