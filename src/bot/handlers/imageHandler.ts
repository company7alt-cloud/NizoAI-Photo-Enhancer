// src/bot/handlers/imageHandler.ts
import { InlineKeyboard } from 'grammy';
import { InputFile } from 'grammy';

import { getFileBuffer, removeCustomAreaAI, generateMaskFromDiff } from '../../services/imageService';
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

  // ── Format Conversion Interceptor ──
  const userRecord = reportUser;

  if (userRecord?.awaitingFormatConversion) {
    const doc = ctx.message?.document;

    if (!doc) {
      await ctx.reply(
        '⚠️ أرسل الصورة كـ <b>مستند (ملف)</b> وليس كصورة عادية.\n' +
        'اضغط 📎 ← اختر "ملف" ← اختر صورتك',
        { parse_mode: 'HTML' }
      );
      return; // STRICT RETURN — prevent double menu
    }

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
              [{ text: '✅ واصل لاختيار الصيغة', callback_data: 'conv_batch_finish' }],
              [{ text: '💬 مراسلة المطور', url: `https://t.me/${process.env.ADMIN_USERNAME || 'Nizar_CEO'}` }],
              [{ text: '❌ إلغاء', callback_data: 'convert_format_cancel' }],
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
                { text: `✅ نعم (${5 - count} متبقي)`, callback_data: 'conv_batch_add' },
                { text: '❌ لا، اختر الصيغة', callback_data: 'conv_batch_finish' },
              ],
              [{ text: '🚫 إلغاء الكل', callback_data: 'convert_format_cancel' }],
            ],
          },
        }
      );
    }
    return; // STRICT RETURN — stop all other processing
  }



  // PRO ENHANCE INTERCEPTOR — must run before normal processing
  const userId = ctx.from?.id;
  if (!userId) return;

  let user = await User.findOne({ telegramId: userId.toString() });
  if (!user) {
    await ctx.reply('⚠️ يرجى إرسال /start أولاً لتسجيل حسابك.');
    return;
  }

  if (user?.awaitingMarkedImage) {
    const photo = ctx.message?.photo;
    const document = ctx.message?.document;
    const fileId = photo ? photo[photo.length - 1].file_id : document?.file_id;

    if (!fileId) return;

    user.markedImageFileId = fileId;
    user.awaitingMarkedImage = false;
    user.awaitingRawImage = true;
    await user.save();

    await ctx.reply(
      `✅ <b>تم تحديد منطقة الإزالة بنجاح!</b>\n\n📸 <b>الخطوة 2 من 2 — الصورة الأصلية</b>\n\nأرسل لي الآن <b>نفس الصورة بدون أي شخبطة أو تعديل</b>\n(الصورة الخام الأصلية). سأقوم بمقارنة الصورتين لتحديد\nموقع العنصر بدقة واستخدام الذكاء الاصطناعي لإزالته\nبشكل احترافي دون المساس بباقي الصورة.`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  if (user?.awaitingRawImage) {
    try {
      const photo = ctx.message?.photo;
      const document = ctx.message?.document;
      const rawFileId = photo ? photo[photo.length - 1].file_id : document?.file_id;

      if (!rawFileId) return;

      const userIsAdmin = isAdmin(userId);
      if (user.dailyQuota < 4 && !userIsAdmin) {
        user.awaitingMarkedImage = false;
        user.awaitingRawImage = false;
        user.markedImageFileId = '';
        await user.save();
        await ctx.reply("تحتاج على الأقل <b>4 محاولات</b> لاستخدام هذه الميزة.", { parse_mode: 'HTML' });
        return;
      }

      await ctx.replyWithChatAction('upload_photo');

      const [markedBuffer, rawBuffer] = await Promise.all([
        getFileBuffer(user.markedImageFileId ?? '', ctx),
        getFileBuffer(rawFileId, ctx)
      ]);

      const { maskBuffer } = await generateMaskFromDiff(markedBuffer, rawBuffer);

      await ctx.reply(
        "⚙️ <b>جارٍ المعالجة...</b>\nتم استلام الصورتين بنجاح. الذكاء الاصطناعي يعمل الآن على تحليل وإزالة العنصر المحدد. قد يستغرق ذلك 30-60 ثانية.",
        { parse_mode: 'HTML' }
      );

      const resultBuffer = await removeCustomAreaAI(rawBuffer, maskBuffer);

      await User.updateOne({ _id: user._id }, { $inc: { dailyQuota: -4 } });

      user.awaitingMarkedImage = false;
      user.awaitingRawImage = false;
      user.markedImageFileId = '';
      user.lastEraserResultBuffer = resultBuffer.toString('base64');
      await user.save();

      const sentMsg = await ctx.replyWithDocument(
        new InputFile(resultBuffer, 'erased_custom.png'),
        {
          reply_markup: new InlineKeyboard()
            .text('JPG', 'eraser_fmt_jpg')
            .text('PNG', 'eraser_fmt_png')
            .text('WEBP', 'eraser_fmt_webp')
            .row()
            .text('GIF', 'eraser_fmt_gif')
            .text('TIFF', 'eraser_fmt_tiff')
        }
      );

      user.lastEraserResultMsgId = sentMsg.message_id;
      await user.save();

      const archiveChannel = process.env.ARCHIVE_GROUP_ID || process.env.ARCHIVE_CHANNEL || process.env.CHANNEL_ID;
      if (archiveChannel) {
        const userId = ctx.from!.id;
        const userLink = ctx.from!.username ? `@${ctx.from!.username}` : ctx.from!.first_name.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const sizeMB = (resultBuffer.length / (1024 * 1024)).toFixed(2);
        const date = new Date().toLocaleString('en-US', { timeZone: 'Asia/Riyadh' });

        ctx.api.sendDocument(archiveChannel, new InputFile(resultBuffer, 'erased_custom.png'), {
          caption: `📦 <b>نسخة أرشيفية — إزالة مخصصة</b>\n━━━━━━━━━━━━━━\n🆔 <b>User ID:</b> <code>${userId}</code>\n👤 <b>Username:</b> ${userLink}\n🔄 <b>العملية:</b> إزالة عنصر مخصص\n💳 <b>المحاولات المخصومة:</b> 4\n✅ <b>الحالة:</b> ناجحة\n📦 <b>الحجم:</b> ${sizeMB} MB\n📅 <b>الوقت:</b> ${date}\n━━━━━━━━━━━━━━`,
          parse_mode: 'HTML',
          disable_notification: true,
        }).catch(e => console.error('[Archive Error]:', e));
      }
    } catch (err: any) {
      user.awaitingMarkedImage = false;
      user.awaitingRawImage = false;
      user.markedImageFileId = '';
      await user.save();

      await ctx.reply(
        "عذراً منك يا صديقي، لم أتمكن من معالجة الصورة هذه المرة. ⚠️\n<b>لم يتم خصم أي محاولات من رصيدك.</b>\nيرجى التأكد من جودة الصورتين ووضوح التحديد والمحاولة مجدداً.",
        { parse_mode: 'HTML' }
      );

      const archiveChannel = process.env.ARCHIVE_GROUP_ID || process.env.ARCHIVE_CHANNEL || process.env.CHANNEL_ID;
      if (archiveChannel) {
        ctx.api.sendMessage(
          archiveChannel,
          `❌ الحالة: فشل | سبب الخطأ: ${err.message?.replace(/</g, '&lt;').replace(/>/g, '&gt;')} | المخصوم: 0`,
          { parse_mode: 'HTML', disable_notification: true }
        ).catch(e => console.error('[Archive Error]:', e));
      }
    }
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



      await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => {});

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
            .text("🖼 JPG",  "eraser_fmt_jpg")
            .text("🗋 PNG",  "eraser_fmt_png")
            .text("🌐 WEBP", "eraser_fmt_webp")
            .row()
            .text("🎞 GIF",  "eraser_fmt_gif")
            .text("📄 TIFF", "eraser_fmt_tiff")
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
      await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => {});
      console.error('[AutoEraser] Error:', error?.message);
      await ctx.reply('❌ عذراً، حدث خطأ. تم إعادة نقطتيك تلقائياً ✨');
    }
    return;
  }

  // ══════════════════════════════════════
  // STEP 1: Receive reference image (marked with red)
  // ══════════════════════════════════════
  if (user?.awaitingEraserImage) {


    // Lock check
    const { getSettings: getEraserSettings } = await import('../../services/settingsService');
    const eraserGlobalSettings = await getEraserSettings();
    const eraserAdminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
    const isEraserAdminUser = eraserAdminIds.includes(userId.toString());

    if (eraserGlobalSettings.locks.btn_eraser && !isEraserAdminUser) {
      await User.findOneAndUpdate(
        { telegramId: userId.toString() },
        { $set: { awaitingEraserImage: false, awaitingEraserOriginal: false } }
      );
      await ctx.reply('⚠️ عذراً، تم إقفال الميزة للصيانة 🔒');
      return;
    }

    // Accept photo OR document
    let fileId: string | undefined;
    if (ctx.message?.photo && ctx.message.photo.length > 0) {
      fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    } else if (ctx.message?.document?.mime_type?.startsWith('image/')) {
      fileId = ctx.message.document.file_id;
    }

    if (!fileId) {
      await ctx.reply('⚠️ أرسل صورة عادية أو ملف صورة للمتابعة.');
      return;
    }

    const processingMsg = await ctx.reply('🔍 جاري تحليل الصورة وحفظ الموقع المحدد...');

    try {
      const tgFile = await ctx.api.getFile(fileId);
      const imageUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;

      const { extractMaskCoordinates } = await import('../../services/imageService');
      const coords = await extractMaskCoordinates(imageUrl);

      await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => {});

      if (!coords) {
        await ctx.reply(
          '❌ لم أتمكن من اكتشاف المنطقة المحددة!\n\n' +
          '💡 تأكد من رسم خط أو مربع <b>باللون الأحمر</b> 🔴 فوق العلامة المراد حذفها، ثم أعد الإرسال.',
          { parse_mode: 'HTML' }
        );
        return;
      }

      // Save coordinates and move to step 2
      await User.findOneAndUpdate(
        { telegramId: userId.toString() },
        {
          $set: {
            awaitingEraserImage: false,
            awaitingEraserOriginal: true,
            eraserCoords: coords
          }
        }
      );

      await ctx.reply(
        '✅ <b>تم! حفظت الموقع المحدد بنجاح</b>\n\n' +
        '📝 <b>الخطوة 2 من 2:</b>\n\n' +
        'الآن أرسل لي <b>الصورة الأصلية</b> النظيفة بدون أي تعديل أو رسم\n' +
        '(صورة عادية أو ملف) 📎\n\n' +
        '✨ سأقوم بإزالة العنصر المحدد باحترافية كاملة',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'cancel_eraser' }]]
          }
        }
      );

    } catch (error: any) {
      await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => {});
      console.error('[Eraser Step1] Error:', error?.message);
      await ctx.reply('❌ حدث خطأ أثناء تحليل الصورة. حاول مجدداً.');
    }
    return;
  }

  // ══════════════════════════════════════
  // STEP 2: Receive original clean image and process
  // ══════════════════════════════════════
  if (user?.awaitingEraserOriginal) {

    const eraserAdminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
    const isEraserAdminUser = eraserAdminIds.includes(userId.toString());

    // Accept photo OR document
    let fileId: string | undefined;
    let fileSize: number | undefined;
    if (ctx.message?.photo && ctx.message.photo.length > 0) {
      const largest = ctx.message.photo[ctx.message.photo.length - 1];
      fileId   = largest.file_id;
      fileSize = largest.file_size;
    } else if (ctx.message?.document?.mime_type?.startsWith('image/')) {
      fileId   = ctx.message.document.file_id;
      fileSize = ctx.message.document.file_size;
    }

    if (!fileId) {
      await ctx.reply('⚠️ أرسل الصورة الأصلية كصورة عادية أو كملف للمتابعة.');
      return;
    }

    // 5MB size limit
    const MAX_SIZE = 5 * 1024 * 1024;
    if (fileSize && fileSize > MAX_SIZE) {
      await User.findOneAndUpdate(
        { telegramId: userId.toString() },
        { $set: { awaitingEraserOriginal: false } }
      );
      await ctx.reply('⛔ حجم الصورة يتجاوز 5 ميجابايت. تم إنهاء الجلسة.');
      return;
    }

    // Check saved coordinates
    const freshUser = await User.findOne({ telegramId: userId.toString() });
    const coords = freshUser?.eraserCoords;
    if (!coords?.width || !coords?.height) {
      await User.findOneAndUpdate(
        { telegramId: userId.toString() },
        { $set: { awaitingEraserOriginal: false } }
      );
      await ctx.reply('⚠️ انتهت الجلسة. ابدأ من جديد بالضغط على زر المُزيل.');
      return;
    }

    // Atomic balance deduction (1 point)
    if (!isEraserAdminUser) {
      const updatedUser = await User.findOneAndUpdate(
        {
          telegramId: userId.toString(),
          dailyQuota: { $gte: 1 },
          awaitingEraserOriginal: true
        },
        {
          $inc: { dailyQuota: -1 },
          $set: {
            awaitingEraserOriginal: false,
            awaitingEraserImage: false,
            'eraserCoords.minX': null,
            'eraserCoords.minY': null,
            'eraserCoords.width': null,
            'eraserCoords.height': null
          }
        },
        { new: true }
      );

      if (!updatedUser) {
        await User.findOneAndUpdate(
          { telegramId: userId.toString() },
          { $set: { awaitingEraserOriginal: false } }
        );
        await ctx.reply('⚠️ رصيدك غير كافٍ! تحتاج <b>نقطة واحدة (1)</b> لإتمام العملية.', { parse_mode: 'HTML' });
        return;
      }
    } else {
      await User.findOneAndUpdate(
        { telegramId: userId.toString() },
        { $set: { awaitingEraserOriginal: false, awaitingEraserImage: false } }
      );
    }

    const processingMsg = await ctx.reply(
      '✨ <b>ممتاز! استلمت الصورة الأصلية</b>\n' +
      'جاري إزالة العنصر المحدد باحترافية كاملة... 🪄\n' +
      'لحظات وتكون جاهزة 🌟',
      { parse_mode: 'HTML' }
    );

    try {
      const tgFile = await ctx.api.getFile(fileId);
      const imageUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;

      const { processTwoStepInpainting } = await import('../../services/imageService');
      const resultBuffer = await processTwoStepInpainting(imageUrl, {
        minX:   coords.minX!,
        minY:   coords.minY!,
        width:  coords.width!,
        height: coords.height!
      });

      const fileName = `NizoAI_Eraser_${Date.now()}.png`;

      await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => {});

      const { InputFile } = await import('grammy');

      // Send document to user
const { incrementGlobalCounter } = await import('../../services/statsService');
await incrementGlobalCounter();
      await ctx.replyWithDocument(
        new InputFile(resultBuffer, fileName),
        {
          caption:
            '✨ <b>تم! العنصر اختفى وصورتك نظيفة احترافياً</b> 🪄\n' +
            '📁 تم الإرسال كملف للحفاظ على أعلى جودة 💎',
          parse_mode: 'HTML'
        }
      );

      // Send photo preview
      await ctx.replyWithPhoto(
        new InputFile(resultBuffer, fileName),
        { caption: '🖼 معاينة سريعة' }
      );

      // Save result URL for format conversion
      await User.findOneAndUpdate(
        { telegramId: userId.toString() },
        { $set: { lastEraserResultUrl: imageUrl } }
      );

      // Send format conversion buttons
      await ctx.reply(
        '🔄 <b>تحويل الصيغة:</b>\n\nاختر صيغة الصورة التي تريدها:',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🖼 JPG',  callback_data: `convert_jpg_${Date.now()}` },
                { text: '📄 PNG',  callback_data: `convert_png_${Date.now()}` },
                { text: '🌐 WEBP', callback_data: `convert_webp_${Date.now()}` },
              ],
              [
                { text: '🎞 GIF',  callback_data: `convert_gif_${Date.now()}` },
                { text: '📐 TIFF', callback_data: `convert_tiff_${Date.now()}` },
              ]
            ]
          }
        }
      );

      // Silent archive to channel
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
              `📦 <b>نسخة أرشيفية (مُزيل العلامات)</b>\n` +
              `━━━━━━━━━━━━━\n` +
              `🆔 User ID: <code>${ctx.from?.id}</code>\n` +
              `👤 Username: ${userLink}\n` +
              `✨ النوع: إزالة العلامات المائية\n` +
              `💎 التكلفة: محاولة واحدة\n` +
              `🕐 Time: ${new Date().toLocaleString('ar-SA')}\n` +
              `━━━━━━━━━━━━━`,
            parse_mode: 'HTML',
            disable_notification: true
          }
        ).catch(() => {});
      }

    } catch (error: any) {
      // Refund on failure
      if (!isEraserAdminUser) {
        await User.findOneAndUpdate(
          { telegramId: userId.toString() },
          { $inc: { dailyQuota: 1 } }
        );
      }
      await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => {});
      console.error('[Eraser Step2] Error:', error?.message);
      await ctx.reply('❌ عذراً، حدث خطأ. تم إعادة نقطتيك تلقائياً ✨');
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
      fileId   = largest.file_id;
      fileSize = largest.file_size ?? 0;
    } else if (ctx.message?.document?.mime_type?.startsWith('image/')) {
      fileId   = ctx.message.document.file_id;
      fileSize = ctx.message.document.file_size ?? 0;
    }

    if (!fileId) {
      // Do NOT reset state — let user try again with a valid image
      await ctx.reply('⚠️ يرجى إرسال صورة صالحة للمتابعة.');
      return;
    }

    if (fileSize > 2 * 1024 * 1024) {
      // Reject BEFORE touching DB — no refund needed since no deduction yet
      await User.findOneAndUpdate(
        { telegramId: userId.toString() },
        { $set: { awaitingNanoBananaImage: false } }
      );
      await ctx.reply('❌ حجم الصورة يتجاوز 2 ميجابايت. يرجى إرسال صورة أصغر.');
      return;
    }

    // ── WALL 2 + Atomic lock + 3-point deduction ──────────────────────────────
    // findOneAndUpdate atomically: sets isProcessingImage=true, deducts 3 points,
    // resets awaitingNanoBananaImage — all in ONE DB round-trip.
    // This prevents race conditions from album sends and double-taps.
    if (!isNanoAdminUser) {
      const lockedUser = await User.findOneAndUpdate(
        {
          telegramId:        userId.toString(),
          dailyQuota:        { $gte: 2 },          // must have 2 points
          awaitingNanoBananaImage: true,            // still in waiting state
          isProcessingImage: { $ne: true },         // not already processing
        },
        {
          $inc: { dailyQuota: -2 },
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
    let processingMsg: { chat: { id: number }; message_id: number };
    if (queuePos > 0) {
      processingMsg = await ctx.reply(
        `⏳ تم وضعك في طابور الانتظار لضمان أعلى جودة...\n` +
        `(${queuePos} طلب قبلك) سيتم معالجة صورتك قريباً ✨`
      );
    } else {
      processingMsg = await ctx.reply(
        '✨ جاري تحسين صورتك بتقنية NizoAI الخاصة...\nقد يستغرق 30-60 ثانية 🌟'
      );
    }

    try {
      // ── STEP: Download image as Buffer (no temp files) ────────────────────
      const tgFile  = await ctx.api.getFile(fileId);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;

      const fetchRes = await fetch(fileUrl);
      if (!fetchRes.ok) throw new Error('download_failed');

      const inputBuffer = Buffer.from(await fetchRes.arrayBuffer());

      // ── Update processing message ─────────────────────────────────────────
      await ctx.api
        .editMessageText(
          processingMsg.chat.id,
          processingMsg.message_id,
          '⚡ الذكاء الاصطناعي يعمل الآن...\nجاري رفع الدقة وتحسين التفاصيل ✨'
        )
        .catch(() => {});

      // ── STEP: Run local AI enhancement ───────────────────────────────────
      const resultBuffer = await enhanceWithONNX(inputBuffer);
      const fileName     = `NizoAI_Enhanced_${Date.now()}.jpg`;

      // Delete processing message
      await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => {});

      // ── STEP: Deliver to user ─────────────────────────────────────────────
const { incrementGlobalCounter } = await import('../../services/statsService');
await incrementGlobalCounter();
      await ctx.replyWithDocument(
        new InputFile(resultBuffer, fileName),
        {
          caption: '✨ تم تحسين صورتك بتقنية NizoAI الخاصة! 🚀\n📁 تم الإرسال كملف للحفاظ على أعلى دقة',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🖼 PNG',  callback_data: 'conv_png' },
                { text: '🖼 JPG',  callback_data: 'conv_jpg' },
                { text: '🖼 WEBP', callback_data: 'conv_webp' },
              ],
              [
                { text: '🖼 AVIF', callback_data: 'conv_avif' },
                { text: '🖼 TIFF', callback_data: 'conv_tiff' },
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
        ).catch(() => {});
      }

    } catch (error: unknown) {
      // ── Refund 3 points on ANY failure (except file_too_large, already caught above)
      if (!isNanoAdminUser) {
        await User.findOneAndUpdate(
          { telegramId: userId.toString() },
          { $inc: { dailyQuota: 2 } }
        );
      }
      await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => {});
      console.error('[NanoAI] Error:', error instanceof Error ? error.message : error);
      await ctx.reply('❌ عذراً، حدث خطأ. تم إعادة 2 من محاولات  تلقائياً ✨');

    } finally {
      // ── Release processing lock — ALWAYS, no exceptions ──────────────────
      if (!isNanoAdminUser) {
        await User.findOneAndUpdate(
          { telegramId: userId.toString() },
          { $set: { isProcessingImage: false } }
        ).catch(() => {});
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

      await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => {});

      // Refresh user to get updated quota
      const freshUser = await User.findOne({ telegramId: userId.toString() });

      const { InputFile } = await import('grammy');
const { incrementGlobalCounter } = await import('../../services/statsService');
await incrementGlobalCounter();
      await ctx.replyWithDocument(new InputFile(resultBuffer, `NizoAI_Pro_${jobId}.jpg`), {
        caption: `💎 صورتك جاهزة بتقنية Pro Enhance! ✨\n🏷 Job ID: ${jobId}\n⚡ محاولاتك المتبقية: ${freshUser?.dailyQuota}`,
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🖼 PNG', callback_data: 'conv_png' },
              { text: '🖼 JPG', callback_data: 'conv_jpg' },
              { text: '🖼 WEBP', callback_data: 'conv_webp' },
            ],
            [
              { text: '🖼 AVIF', callback_data: 'conv_avif' },
              { text: '🖼 TIFF', callback_data: 'conv_tiff' },
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
