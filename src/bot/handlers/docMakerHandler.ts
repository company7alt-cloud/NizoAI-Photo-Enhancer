// src/bot/handlers/docMakerHandler.ts
import { BotContext } from '../../utils/validators';
import { User } from '../../database/models/User';
import { generateDocument, getLineCapacity } from '../../services/pdfGeneratorService';
import { InputFile } from 'grammy';
import https from 'https';

const BACKUP_CHANNEL_ID = process.env.ARCHIVE_GROUP_ID || process.env.CHANNEL_ID || '';

// ─── Helper: download Telegram file to Buffer ──────────────────────────────────
function downloadFile(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ─── Helper: send template selection ──────────────────────────────────────────
async function sendTemplateSelection(ctx: BotContext, editOrReply: 'edit' | 'reply' = 'edit') {
  const text =
    '🎨 <b>اختر نموذج التصميم:</b>\n\n' +
    '1️⃣ كلاسيكي نظيف (إطار رفيع)\n' +
    '2️⃣ احترافي مع رأس وتذييل\n' +
    '3️⃣ زوايا مزخرفة — خط كبير\n' +
    '4️⃣ أشرطة جانبية — خط مضغوط\n' +
    '5️⃣ إطار مزدوج أنيق\n\n' +
    '<i>اختر النموذج المناسب لمستندك:</i>';

  const kb = {
    inline_keyboard: [
      [{ text: '1️⃣ كلاسيكي', callback_data: 'doc_tpl_1' }, { text: '2️⃣ احترافي', callback_data: 'doc_tpl_2' }],
      [{ text: '3️⃣ زوايا', callback_data: 'doc_tpl_3' }, { text: '4️⃣ أشرطة', callback_data: 'doc_tpl_4' }],
      [{ text: '5️⃣ إطار مزدوج', callback_data: 'doc_tpl_5' }],
      [{ text: '❌ إلغاء', callback_data: 'doc_maker_cancel' }],
    ],
  };

  if (editOrReply === 'edit') {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb })
      .catch(async () => ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }));
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }
}

// ─── Helper: start content-entry loop ─────────────────────────────────────────
async function startContentLoop(ctx: BotContext, isNewPage = false) {
  const user = await User.findOne({ telegramId: ctx.from!.id.toString() });
  if (!user?.docWizard) return;

  const pageNum = user.docWizard.currentPageIndex + 1;
  const prefix = isNewPage
    ? `📄 <b>صفحة جديدة — رقم ${pageNum}</b>\n\n`
    : `✨ <b>تم الإعداد! الصفحة الأولى جاهزة</b>\n\n`;

  const compileKb = { inline_keyboard: [[{ text: '📥 إنهاء وتصدير PDF', callback_data: 'doc_compile' }]] };

  if (user.docWizard.docType === 'text') {
    const msg = prefix + `أرسل سطراً من النص (حد الصفحة: ${user.docWizard.lineCapacity} سطر):`;
    await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: compileKb })
      .catch(async () => ctx.reply(msg, { parse_mode: 'HTML', reply_markup: compileKb }));
  } else {
    await User.findOneAndUpdate(
      { telegramId: user.telegramId },
      { $set: { 'docWizard.awaitingImagePhoto': true } }
    );
    const msg = prefix + '📸 أرسل الآن <b>الصورة</b> لهذه الصفحة:';
    await ctx.editMessageText(msg, { parse_mode: 'HTML' })
      .catch(async () => ctx.reply(msg, { parse_mode: 'HTML' }));
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CALLBACK HANDLER
// ══════════════════════════════════════════════════════════════════════════════
export async function handleDocMakerCallback(ctx: BotContext): Promise<boolean> {
  if (!ctx.from) return false;
  const data = ctx.callbackQuery?.data;
  if (!data) return false;

  // Only handle doc_maker prefixed callbacks
  const docCallbacks = [
    'doc_maker_start', 'doc_maker_cancel',
    'doc_type_text', 'doc_type_image',
    'doc_add_page', 'doc_compile',
  ];
  const isDocCallback =
    docCallbacks.includes(data) ||
    data.startsWith('doc_size_') ||
    data.startsWith('doc_tpl_');

  if (!isDocCallback) return false;

  const telegramId = ctx.from!.id.toString();

  // ── Entry ─────────────────────────────────────────────────────────────────
  if (data === 'doc_maker_start') {
    await ctx.answerCallbackQuery();
    await User.findOneAndUpdate(
      { telegramId },
      {
        $set: {
          docWizard: {
            step: 1,
            pages: [],
            currentPageIndex: 0,
            currentLineIndex: 0,
            docType: null,
            pageSize: null,
            customSize: null,
            templateId: null,
            lineCapacity: 25,
            awaitingCustomSize: false,
            awaitingLineText: false,
            awaitingImagePhoto: false,
            awaitingOverlayText: false,
            awaitingCaptionText: false,
            pendingLongText: null,
          },
        },
      }
    );

    await ctx.reply(
      '📝 <b>صانع المستندات والكتب</b>\n\nاختر نوع المستند:',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📄 مستند نصي', callback_data: 'doc_type_text' }],
            [{ text: '🖼 مستند مصور', callback_data: 'doc_type_image' }],
            [{ text: '❌ إلغاء', callback_data: 'doc_maker_cancel' }],
          ],
        },
      }
    );
    return true;
  }

  // ── Cancel ────────────────────────────────────────────────────────────────
  if (data === 'doc_maker_cancel') {
    await ctx.answerCallbackQuery({ text: 'تم الإلغاء ❌' });
    await User.findOneAndUpdate({ telegramId }, { $set: { docWizard: null } });
    await ctx.deleteMessage().catch(() => {});
    return true;
  }

  // ── Step 1 → 2: Doc type ─────────────────────────────────────────────────
  if (data === 'doc_type_text' || data === 'doc_type_image') {
    await ctx.answerCallbackQuery();
    const docType = data === 'doc_type_text' ? 'text' : 'image';
    await User.findOneAndUpdate(
      { telegramId },
      { $set: { 'docWizard.step': 2, 'docWizard.docType': docType } }
    );

    await ctx.editMessageText('📐 <b>اختر مقاس الصفحة:</b>', {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'A4 (افتراضي)', callback_data: 'doc_size_A4' }, { text: 'A5', callback_data: 'doc_size_A5' }],
          [{ text: 'Letter', callback_data: 'doc_size_Letter' }, { text: 'B5', callback_data: 'doc_size_B5' }],
          [{ text: 'Legal', callback_data: 'doc_size_Legal' }, { text: 'Executive', callback_data: 'doc_size_Executive' }],
          [{ text: '📐 مقاس مخصص', callback_data: 'doc_size_custom' }],
          [{ text: '❌ إلغاء', callback_data: 'doc_maker_cancel' }],
        ],
      },
    });
    return true;
  }

  // ── Step 2 → 3: Page size ─────────────────────────────────────────────────
  if (data.startsWith('doc_size_')) {
    await ctx.answerCallbackQuery();
    const size = data.replace('doc_size_', '');

    if (size === 'custom') {
      await User.findOneAndUpdate(
        { telegramId },
        { $set: { 'docWizard.step': 2, 'docWizard.awaitingCustomSize': true } }
      );
      await ctx.editMessageText(
        '📐 <b>مقاس مخصص:</b>\n\nأرسل القياس بالشكل: <code>عرض×ارتفاع</code>\n(مثال: <code>500×800</code>)',
        { parse_mode: 'HTML' }
      );
      return true;
    }

    await User.findOneAndUpdate(
      { telegramId },
      { $set: { 'docWizard.step': 3, 'docWizard.pageSize': size, 'docWizard.awaitingCustomSize': false } }
    );
    await sendTemplateSelection(ctx, 'edit');
    return true;
  }

  // ── Step 3 → 4: Template ─────────────────────────────────────────────────
  if (data.startsWith('doc_tpl_')) {
    await ctx.answerCallbackQuery();
    const tplId = parseInt(data.replace('doc_tpl_', ''), 10);
    const lineCapacity = getLineCapacity(tplId);

    await User.findOneAndUpdate(
      { telegramId },
      {
        $set: {
          'docWizard.step': 4,
          'docWizard.templateId': tplId,
          'docWizard.lineCapacity': lineCapacity,
        },
      }
    );
    await startContentLoop(ctx, false);
    return true;
  }

  // ── Step 5: Add new page ──────────────────────────────────────────────────
  if (data === 'doc_add_page') {
    await ctx.answerCallbackQuery();
    const user = await User.findOne({ telegramId });
    if (!user?.docWizard) return true;

    const newPageIndex = user.docWizard.currentPageIndex + 1;

    if (newPageIndex >= 50) {
      await ctx.answerCallbackQuery({ text: '❌ وصلت للحد الأقصى (50 صفحة)', show_alert: true });
      return true;
    }

    // Paywall: pages 1-3 free (index 0-2), page 4+ (index 3+) costs 1 attempt
    const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
    const isAdm = adminIds.includes(telegramId);
    const canBypass = isAdm || !!user.canBypassLocks;

    if (newPageIndex >= 3 && !canBypass) {
      if (user.dailyQuota < 1) {
        await ctx.answerCallbackQuery({
          text: '❌ رصيدك غير كافٍ. تحتاج نقطة واحدة لفتح صفحة إضافية.',
          show_alert: true,
        });
        return true;
      }
      await User.findOneAndUpdate({ telegramId }, { $inc: { dailyQuota: -1 } });
      await ctx.reply('💎 تم خصم نقطة واحدة لفتح الصفحة الإضافية.');
    }

    await User.findOneAndUpdate(
      { telegramId },
      {
        $set: {
          'docWizard.currentPageIndex': newPageIndex,
          'docWizard.currentLineIndex': 0,
          'docWizard.awaitingImagePhoto': false,
          'docWizard.awaitingOverlayText': false,
          'docWizard.awaitingCaptionText': false,
        },
      }
    );
    await startContentLoop(ctx, true);
    return true;
  }

  // ── Step 6: Compile & deliver ─────────────────────────────────────────────
  if (data === 'doc_compile') {
    await ctx.answerCallbackQuery();
    const user = await User.findOne({ telegramId });
    if (!user?.docWizard) return true;

    if (!user.docWizard.pages || user.docWizard.pages.length === 0) {
      await ctx.answerCallbackQuery({ text: '⚠️ لم تضف أي محتوى بعد!', show_alert: true });
      return true;
    }

    const processingMsg = await ctx.reply('⏳ جاري إنشاء ملف PDF... الرجاء الانتظار');

    try {
      const pdfBuffer = await generateDocument({
        pageSize: user.docWizard.pageSize,
        customSize: user.docWizard.customSize,
        templateId: user.docWizard.templateId,
        pages: user.docWizard.pages as any,
      });

      const fileName = `NizoDoc_${Date.now()}.pdf`;

      await ctx.api.deleteMessage(ctx.chat!.id, processingMsg.message_id).catch(() => {});

      const { incrementGlobalCounter } = await import('../../services/statsService');
      await incrementGlobalCounter();

      await ctx.replyWithDocument(new InputFile(pdfBuffer, fileName), {
        caption:
          `✅ <b>تم إنشاء المستند بنجاح!</b>\n\n` +
          `📄 الصفحات: ${user.docWizard.pages.length}\n` +
          `📐 المقاس: ${user.docWizard.pageSize ?? 'مخصص'}\n` +
          `🎨 النموذج: ${user.docWizard.templateId ?? 1}`,
        parse_mode: 'HTML',
      });

      // Silent archive
      if (BACKUP_CHANNEL_ID) {
        await ctx.api.sendDocument(
          BACKUP_CHANNEL_ID,
          new InputFile(pdfBuffer, fileName),
          {
            caption: `📦 أرشيف صانع المستندات\n🆔 ${telegramId}`,
            disable_notification: true,
          }
        ).catch(() => {});
      }
    } catch (err) {
      console.error('[DocMaker] compile error:', err);
      await ctx.api.deleteMessage(ctx.chat!.id, processingMsg.message_id).catch(() => {});
      await ctx.reply('❌ حدث خطأ أثناء إنشاء المستند. حاول مرة أخرى.');
    } finally {
      await User.findOneAndUpdate({ telegramId }, { $set: { docWizard: null } });
    }
    return true;
  }

  return false;
}

// ══════════════════════════════════════════════════════════════════════════════
// MESSAGE HANDLER
// ══════════════════════════════════════════════════════════════════════════════
export async function handleDocMakerMessage(ctx: BotContext): Promise<boolean> {
  if (!ctx.from) return false;
  const telegramId = ctx.from!.id.toString();
  const user = await User.findOne({ telegramId });
  if (!user?.docWizard) return false;

  const wizard = user.docWizard;

  // ── Custom size input ──────────────────────────────────────────────────────
  if (wizard.awaitingCustomSize && wizard.step === 2) {
    const text = ctx.message?.text?.trim() || '';
    // Accept formats: 500x800  500×800  500X800
    const match = text.match(/^(\d+)\s*[×xX]\s*(\d+)$/);
    if (!match) {
      await ctx.reply(
        '❌ صيغة خاطئة. أرسل بالشكل <code>500×800</code>',
        { parse_mode: 'HTML' }
      );
      return true;
    }
    const width = parseInt(match[1], 10);
    const height = parseInt(match[2], 10);

    if (width < 50 || height < 50 || width > 5000 || height > 5000) {
      await ctx.reply('❌ القياس خارج النطاق المسموح (50–5000 نقطة).');
      return true;
    }

    await User.findOneAndUpdate(
      { telegramId },
      {
        $set: {
          'docWizard.step': 3,
          'docWizard.customSize': { width, height },
          'docWizard.pageSize': null,
          'docWizard.awaitingCustomSize': false,
        },
      }
    );
    await sendTemplateSelection(ctx, 'reply');
    return true;
  }

  // ── Text content loop ──────────────────────────────────────────────────────
  if (wizard.step === 4 && wizard.docType === 'text') {
    const text = ctx.message?.text;
    if (!text) {
      await ctx.reply('❌ يرجى إرسال نص فقط (لا صور أو ملفات).');
      return true;
    }

    const pages = [...(wizard.pages as any[])];
    if (!pages[wizard.currentPageIndex]) {
      pages[wizard.currentPageIndex] = { type: 'text', lines: [] };
    }
    if (!pages[wizard.currentPageIndex].lines) {
      pages[wizard.currentPageIndex].lines = [];
    }
    pages[wizard.currentPageIndex].lines.push(text);

    const newLineIndex = wizard.currentLineIndex + 1;

    await User.findOneAndUpdate(
      { telegramId },
      { $set: { 'docWizard.pages': pages, 'docWizard.currentLineIndex': newLineIndex } }
    );

    if (newLineIndex >= wizard.lineCapacity) {
      await ctx.reply('📄 اكتملت الصفحة الحالية!', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ صفحة جديدة', callback_data: 'doc_add_page' }],
            [{ text: '📥 تصدير PDF الآن', callback_data: 'doc_compile' }],
          ],
        },
      });
    } else {
      await ctx.reply(
        `✅ سطر ${newLineIndex}/${wizard.lineCapacity} — أرسل السطر التالي:`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📥 إنهاء وتصدير PDF', callback_data: 'doc_compile' }],
            ],
          },
        }
      );
    }
    return true;
  }

  // ── Image content loop ─────────────────────────────────────────────────────
  if (wizard.step === 4 && wizard.docType === 'image') {
    const pages = [...(wizard.pages as any[])];
    if (!pages[wizard.currentPageIndex]) {
      pages[wizard.currentPageIndex] = { type: 'image' };
    }

    // 1. Awaiting the photo itself
    if (wizard.awaitingImagePhoto) {
      const photo = ctx.message?.photo;
      const doc = ctx.message?.document;

      let fileId: string | null = null;
      if (photo && photo.length > 0) fileId = photo[photo.length - 1].file_id;
      else if (doc?.mime_type?.startsWith('image/')) fileId = doc.file_id;

      if (!fileId) {
        await ctx.reply('❌ يرجى إرسال صورة صالحة (JPEG/PNG/WEBP).');
        return true;
      }

      try {
        const tgFile = await ctx.api.getFile(fileId);
        const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgFile.file_path}`;
        const imgBuffer = await downloadFile(fileUrl);
        pages[wizard.currentPageIndex].imageBuffer = imgBuffer.toString('base64');

        await User.findOneAndUpdate(
          { telegramId },
          {
            $set: {
              'docWizard.pages': pages,
              'docWizard.awaitingImagePhoto': false,
              'docWizard.awaitingOverlayText': true,
            },
          }
        );
        await ctx.reply(
          '✅ تم حفظ الصورة.\n\n✍️ أرسل <b>النص فوق الصورة</b> (أو اكتب <code>تخطي</code> لتخطيه):',
          { parse_mode: 'HTML' }
        );
      } catch (err) {
        console.error('[DocMaker] image download error:', err);
        await ctx.reply('❌ حدث خطأ في تحميل الصورة. حاول مرة أخرى.');
      }
      return true;
    }

    // 2. Awaiting overlay text
    if (wizard.awaitingOverlayText) {
      const text = ctx.message?.text?.trim() || '';
      if (text !== 'تخطي' && text !== '') {
        pages[wizard.currentPageIndex].overlayText = text;
      }
      await User.findOneAndUpdate(
        { telegramId },
        {
          $set: {
            'docWizard.pages': pages,
            'docWizard.awaitingOverlayText': false,
            'docWizard.awaitingCaptionText': true,
          },
        }
      );
      await ctx.reply(
        '✅ تم.\n\n✍️ أرسل <b>التسمية التوضيحية</b> أسفل الصورة (أو اكتب <code>تخطي</code>):',
        { parse_mode: 'HTML' }
      );
      return true;
    }

    // 3. Awaiting caption text
    if (wizard.awaitingCaptionText) {
      const text = ctx.message?.text?.trim() || '';
      if (text !== 'تخطي' && text !== '') {
        pages[wizard.currentPageIndex].captionText = text;
      }
      await User.findOneAndUpdate(
        { telegramId },
        {
          $set: {
            'docWizard.pages': pages,
            'docWizard.awaitingCaptionText': false,
          },
        }
      );
      await ctx.reply('✅ اكتملت صفحة الصورة!', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ صفحة جديدة', callback_data: 'doc_add_page' }],
            [{ text: '📥 تصدير PDF الآن', callback_data: 'doc_compile' }],
          ],
        },
      });
      return true;
    }
  }

  return false;
}
