"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleDocMakerCallback = handleDocMakerCallback;
const User_1 = require("../../database/models/User");
const pdfGeneratorService_1 = require("../../services/pdfGeneratorService");
const BACKUP_CHANNEL_ID = process.env.ARCHIVE_GROUP_ID || process.env.CHANNEL_ID;
async function handleDocMakerCallback(ctx) {
    const data = ctx.callbackQuery?.data;
    if (!data)
        return false;
    const telegramId = ctx.from.id.toString();
    // Step 0: Entry
    if (data === 'doc_maker_start') {
        await ctx.answerCallbackQuery();
        await User_1.User.findOneAndUpdate({ telegramId }, {
            $set: {
                'docWizard.step': 1,
                'docWizard.pages': [],
                'docWizard.currentPageIndex': 0,
                'docWizard.currentLineIndex': 0,
                'docWizard.docType': null,
                'docWizard.pageSize': null,
                'docWizard.customSize': null,
                'docWizard.templateId': null,
            }
        });
        await ctx.reply('📝 <b>صانع المستندات والكتب</b>\n\nاختر نوع المستند الذي تريد إنشاءه:', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📄 مستند نصي', callback_data: 'doc_type_text' }],
                    [{ text: '🖼 مستند مصور', callback_data: 'doc_type_image' }],
                    [{ text: '❌ إلغاء', callback_data: 'doc_maker_cancel' }]
                ]
            }
        });
        return true;
    }
    if (data === 'doc_maker_cancel') {
        await ctx.answerCallbackQuery({ text: 'تم الإلغاء ❌' });
        await User_1.User.findOneAndUpdate({ telegramId }, { $set: { docWizard: null } });
        await ctx.deleteMessage().catch(() => { });
        return true;
    }
    // Step 1: Doc Type -> Step 2: Page Size
    if (data === 'doc_type_text' || data === 'doc_type_image') {
        await ctx.answerCallbackQuery();
        const docType = data === 'doc_type_text' ? 'text' : 'image';
        await User_1.User.findOneAndUpdate({ telegramId }, { $set: { 'docWizard.step': 2, 'docWizard.docType': docType } });
        await ctx.editMessageText('📐 <b>اختر مقاس الصفحة:</b>', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'A4', callback_data: 'doc_size_A4' }, { text: 'A5', callback_data: 'doc_size_A5' }],
                    [{ text: 'Letter', callback_data: 'doc_size_Letter' }, { text: 'B5', callback_data: 'doc_size_B5' }],
                    [{ text: 'Legal', callback_data: 'doc_size_Legal' }, { text: 'Executive', callback_data: 'doc_size_Executive' }],
                    [{ text: '📐 مقاس مخصص', callback_data: 'doc_size_custom' }],
                    [{ text: '❌ إلغاء', callback_data: 'doc_maker_cancel' }]
                ]
            }
        });
        return true;
    }
    // Step 2: Page Size -> Step 3: Template
    if (data.startsWith('doc_size_')) {
        await ctx.answerCallbackQuery();
        const size = data.replace('doc_size_', '');
        if (size === 'custom') {
            await User_1.User.findOneAndUpdate({ telegramId }, { $set: { 'docWizard.step': 2, 'docWizard.awaitingCustomSize': true } });
            await ctx.editMessageText('📐 <b>مقاس مخصص:</b>\n\nأرسل القياس بالشكل: <code>عرض×ارتفاع</code>\n(مثال: <code>500×800</code>)', { parse_mode: 'HTML' });
            return true;
        }
        await User_1.User.findOneAndUpdate({ telegramId }, { $set: { 'docWizard.step': 3, 'docWizard.pageSize': size, 'docWizard.awaitingCustomSize': false } });
        await sendTemplateSelection(ctx);
        return true;
    }
    // Step 3: Template -> Step 4: Content Loop
    if (data.startsWith('doc_tpl_')) {
        await ctx.answerCallbackQuery();
        const tplId = parseInt(data.replace('doc_tpl_', ''));
        // Calculate lineCapacity based on template (mock logic)
        const lineCapacity = tplId * 5 + 10;
        await User_1.User.findOneAndUpdate({ telegramId }, {
            $set: {
                'docWizard.step': 4,
                'docWizard.templateId': tplId,
                'docWizard.lineCapacity': lineCapacity
            }
        });
        await startContentLoop(ctx);
        return true;
    }
    // Step 5: Pagination
    if (data === 'doc_add_page') {
        await ctx.answerCallbackQuery();
        const user = await User_1.User.findOne({ telegramId });
        if (!user || !user.docWizard)
            return true;
        // Strict Paywall: 1-3 FREE, 4+ costs 1 attempt
        const newPageIndex = user.docWizard.currentPageIndex + 1;
        if (newPageIndex >= 50) {
            await ctx.answerCallbackQuery({ text: '❌ وصلت للحد الأقصى (50 صفحة)', show_alert: true });
            return true;
        }
        const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
        const isAdm = adminIds.includes(telegramId);
        const canBypass = isAdm || user.canBypassLocks;
        if (newPageIndex >= 3 && !canBypass) {
            if (user.dailyQuota < 1) {
                await ctx.answerCallbackQuery({ text: '❌ رصيدك غير كافٍ. تحتاج نقطة واحدة لفتح صفحة إضافية.', show_alert: true });
                return true;
            }
            await User_1.User.findOneAndUpdate({ telegramId }, { $inc: { dailyQuota: -1 } });
            await ctx.reply('💎 تم خصم نقطة واحدة لفتح الصفحة الإضافية.');
        }
        await User_1.User.findOneAndUpdate({ telegramId }, {
            $set: {
                'docWizard.currentPageIndex': newPageIndex,
                'docWizard.currentLineIndex': 0,
            }
        });
        await startContentLoop(ctx, true);
        return true;
    }
    // Step 6: Compilation
    if (data === 'doc_compile') {
        await ctx.answerCallbackQuery();
        const user = await User_1.User.findOne({ telegramId });
        if (!user || !user.docWizard)
            return true;
        const processingMsg = await ctx.reply('⏳ جاري إنشاء الملف (PDF)... الرجاء الانتظار');
        try {
            const pdfBuffer = await (0, pdfGeneratorService_1.generateDocument)({
                pageSize: user.docWizard.pageSize,
                customSize: user.docWizard.customSize,
                pages: user.docWizard.pages
            });
            const fileName = ;
            `Document_\${Date.now()}.pdf\`;

      await ctx.api.deleteMessage(ctx.chat!.id, processingMsg.message_id).catch(() => {});
      
      const { incrementGlobalCounter } = await import('../../services/statsService');
      await incrementGlobalCounter();

      await ctx.replyWithDocument(new InputFile(pdfBuffer, fileName), {
        caption: '✅ تم إنشاء المستند بنجاح عبر صانع المستندات 📝'
      });

      // Silent archive
      if (BACKUP_CHANNEL_ID) {
        await ctx.api.sendDocument(BACKUP_CHANNEL_ID, new InputFile(pdfBuffer, fileName), {
          caption: \`📦 أرشيف صانع المستندات\\n🆔 \${telegramId}\`,
          disable_notification: true
        }).catch(() => {});
      }
    } catch (err) {
      console.error('[DocMaker]', err);
      await ctx.api.deleteMessage(ctx.chat!.id, processingMsg.message_id).catch(() => {});
      await ctx.reply('❌ حدث خطأ أثناء إنشاء المستند.');
    } finally {
      await User.findOneAndUpdate({ telegramId }, { $set: { docWizard: null } });
    }

    return true;
  }

  return false;
}

export async function handleDocMakerMessage(ctx: BotContext): Promise<boolean> {
  const telegramId = ctx.from!.id.toString();
  const user = await User.findOne({ telegramId });
  if (!user || !user.docWizard) return false;

  const wizard = user.docWizard;
  
  // Custom Size Input
  if (wizard.awaitingCustomSize && wizard.step === 2) {
    const text = ctx.message?.text || '';
    const match = text.match(/^(\\d+)[×xX](\\d+)$/);
    if (!match) {
      await ctx.reply('❌ صيغة خاطئة. أرسل بالشكل <code>500×800</code>', { parse_mode: 'HTML' });
      return true;
    }
    const width = parseInt(match[1]);
    const height = parseInt(match[2]);

    await User.findOneAndUpdate({ telegramId }, {
      $set: {
        'docWizard.step': 3,
        'docWizard.customSize': { width, height },
        'docWizard.awaitingCustomSize': false,
        'docWizard.pageSize': null
      }
    });
    await sendTemplateSelection(ctx);
    return true;
  }

  // Content Loop - Text
  if (wizard.step === 4 && wizard.docType === 'text') {
    const text = ctx.message?.text;
    if (!text) {
      await ctx.reply('❌ يرجى إرسال نص فقط.');
      return true;
    }

    const pages = [...wizard.pages];
    if (!pages[wizard.currentPageIndex]) {
      pages[wizard.currentPageIndex] = { type: 'text', lines: [] } as any;
    }

    pages[wizard.currentPageIndex].lines.push(text);
    const newCurrentLineIndex = wizard.currentLineIndex + 1;

    if (newCurrentLineIndex >= wizard.lineCapacity) {
      // Page Full
      await User.findOneAndUpdate(
        { telegramId },
        { 
          $set: { 
            'docWizard.pages': pages,
            'docWizard.currentLineIndex': newCurrentLineIndex
          } 
        }
      );
      await ctx.reply('📄 اكتملت الصفحة الحالية!', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ أضف صفحة جديدة', callback_data: 'doc_add_page' }],
            [{ text: '📥 حمّل الـ PDF الآن', callback_data: 'doc_compile' }]
          ]
        }
      });
    } else {
      await User.findOneAndUpdate(
        { telegramId },
        { 
          $set: { 
            'docWizard.pages': pages,
            'docWizard.currentLineIndex': newCurrentLineIndex
          } 
        }
      );
      await ctx.reply(\`✅ تم إضافة السطر (\${newCurrentLineIndex}/\${wizard.lineCapacity}). أرسل السطر التالي:\`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📥 إنهاء وحفظ الـ PDF', callback_data: 'doc_compile' }]
          ]
        }
      });
    }
    return true;
  }

  // Content Loop - Image
  if (wizard.step === 4 && wizard.docType === 'image') {
    const pages = [...wizard.pages];
    if (!pages[wizard.currentPageIndex]) {
      pages[wizard.currentPageIndex] = { type: 'image' } as any;
    }

    if (wizard.awaitingImagePhoto) {
      const photo = ctx.message?.photo;
      const document = ctx.message?.document;
      
      let fileId = null;
      if (photo && photo.length > 0) fileId = photo[photo.length - 1].file_id;
      else if (document?.mime_type?.startsWith('image/')) fileId = document.file_id;

      if (!fileId) {
        await ctx.reply('❌ يرجى إرسال صورة صالحة.');
        return true;
      }

      // Download buffer
      try {
        const tgFile = await ctx.api.getFile(fileId);
        const fileUrl = \`https://api.telegram.org/file/bot\${process.env.BOT_TOKEN}/\${tgFile.file_path}\`;
        const fetchRes = await fetch(fileUrl);
        const arrayBuf = await fetchRes.arrayBuffer();
        const b64 = Buffer.from(arrayBuf).toString('base64');
        pages[wizard.currentPageIndex].imageBuffer = b64 as any;

        await User.findOneAndUpdate(
          { telegramId },
          { 
            $set: { 
              'docWizard.pages': pages,
              'docWizard.awaitingImagePhoto': false,
              'docWizard.awaitingOverlayText': true
            } 
          }
        );
        await ctx.reply('✅ تم حفظ الصورة. أرسل النص الذي تريده فوق الصورة (أو أرسل "تخطي"):');
      } catch (err) {
        await ctx.reply('❌ حدث خطأ في تحميل الصورة.');
      }
      return true;
    }

    if (wizard.awaitingOverlayText) {
      const text = ctx.message?.text || '';
      if (text !== 'تخطي') {
        pages[wizard.currentPageIndex].overlayText = text;
      }
      await User.findOneAndUpdate(
        { telegramId },
        { 
          $set: { 
            'docWizard.pages': pages,
            'docWizard.awaitingOverlayText': false,
            'docWizard.awaitingCaptionText': true
          } 
        }
      );
      await ctx.reply('✅ تم حفظ النص فوق الصورة. أرسل النص التوضيحي (أسفل الصورة) (أو أرسل "تخطي"):');
      return true;
    }

    if (wizard.awaitingCaptionText) {
      const text = ctx.message?.text || '';
      if (text !== 'تخطي') {
        pages[wizard.currentPageIndex].captionText = text;
      }
      await User.findOneAndUpdate(
        { telegramId },
        { 
          $set: { 
            'docWizard.pages': pages,
            'docWizard.awaitingCaptionText': false
          } 
        }
      );
      await ctx.reply('📄 اكتملت صفحة الصورة!', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ أضف صفحة جديدة', callback_data: 'doc_add_page' }],
            [{ text: '📥 حمّل الـ PDF الآن', callback_data: 'doc_compile' }]
          ]
        }
      });
      return true;
    }
  }

  return false;
}

async function sendTemplateSelection(ctx: BotContext) {
  await ctx.editMessageText('📄 <b>اختر نموذج التصميم:</b>\n\n<i>هنا سيتم إرسال نماذج PDF لمعاينتها...</i>', {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: 'نموذج 1', callback_data: 'doc_tpl_1' }, { text: 'نموذج 2', callback_data: 'doc_tpl_2' }],
        [{ text: 'نموذج 3', callback_data: 'doc_tpl_3' }, { text: 'نموذج 4', callback_data: 'doc_tpl_4' }],
        [{ text: 'نموذج 5', callback_data: 'doc_tpl_5' }],
        [{ text: '❌ إلغاء', callback_data: 'doc_maker_cancel' }]
      ]
    }
  });
}

async function startContentLoop(ctx: BotContext, isNewPage = false) {
  const user = await User.findOne({ telegramId: ctx.from!.id.toString() });
  if (!user || !user.docWizard) return;

  const msgPrefix = isNewPage ? '📄 <b>صفحة جديدة</b>\n\n' : '✨ <b>تم إعداد الصفحة الأولى!</b>\n\n';

  if (user.docWizard.docType === 'text') {
    await ctx.editMessageText(msgPrefix + 'أرسل الآن السطر الأول من النص:', {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '📥 إنهاء وحفظ الـ PDF', callback_data: 'doc_compile' }]] }
    }).catch(async () => {
      await ctx.reply(msgPrefix + 'أرسل الآن السطر الأول من النص:', {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '📥 إنهاء وحفظ الـ PDF', callback_data: 'doc_compile' }]] }
      });
    });
  } else {
    await User.findOneAndUpdate(
      { telegramId: user.telegramId },
      { $set: { 'docWizard.awaitingImagePhoto': true } }
    );
    await ctx.editMessageText(msgPrefix + 'أرسل الآن الصورة للصفحة الحالية:', {
      parse_mode: 'HTML'
    }).catch(async () => {
      await ctx.reply(msgPrefix + 'أرسل الآن الصورة للصفحة الحالية:', { parse_mode: 'HTML' });
    });
  }
}
            ;
        }
        finally { }
    }
}
//# sourceMappingURL=docMakerHandler.js.map