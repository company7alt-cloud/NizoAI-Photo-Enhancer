const fs = require('fs');
const file = 'src/bot/handlers/callbackHandler.ts';
let code = fs.readFileSync(file, 'utf8');

// replace imports
code = code.replace(
  "import sharp from 'sharp';\nimport { v4 as uuidv4 } from 'uuid';",
  "import sharp from 'sharp';\nimport AdmZip from 'adm-zip';\nimport { v4 as uuidv4 } from 'uuid';"
);

// We can just find the indices of the blocks to replace.
const startIdx = code.indexOf("  if (data === 'convert_format_start') {");
const endIdx = code.indexOf("  if (data === 'admin_edit_convert_msg' && isAdminUser) {");

if (startIdx === -1 || endIdx === -1) {
  console.error("Could not find blocks");
  process.exit(1);
}

const newCode = code.substring(0, startIdx) +
`  if (data === 'convert_format_start') {
    await ctx.answerCallbackQuery();
    const telegramId = ctx.from!.id.toString();

    await User.findOneAndUpdate(
      { telegramId },
      { $set: { awaitingFormatConversion: true, pendingConversionFiles: [] } }
    );

    await ctx.reply(
      '🔄 <b>تحويل صيغة الصورة</b>\\n\\n' +
      '📎 أرسل الصورة الأولى كـ <b>مستند (ملف)</b> وليس كصورة عادية.\\n\\n' +
      '💡 <b>يمكنك إرسال أكثر من صورة!</b>\\n' +
      'البوت سيسألك بعد كل صورة إن كنت تريد إضافة المزيد.\\n\\n' +
      '⚡ التحويل مجاني بدون خصم محاولات',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '❌ إلغاء', callback_data: 'convert_format_cancel' }],
          ],
        },
      }
    );
    return;
  }

  if (data === 'convert_format_cancel') {
    await ctx.answerCallbackQuery({ text: 'تم الإلغاء ❌' });
    const telegramId = ctx.from!.id.toString();
    await User.findOneAndUpdate(
      { telegramId },
      { $set: { awaitingFormatConversion: false, pendingConversionFiles: [] } }
    );
    return;
  }

  // ── More images: YES
  if (data === 'conv_batch_add') {
    await ctx.answerCallbackQuery();
    const telegramId = ctx.from!.id.toString();
    await User.findOneAndUpdate(
      { telegramId },
      { $set: { awaitingFormatConversion: true } }
    );
    await ctx.reply(
      '📎 أرسل الصورة التالية كـ <b>مستند (ملف)</b>:',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '❌ إلغاء', callback_data: 'convert_format_cancel' }],
          ],
        },
      }
    );
    return;
  }

  // ── More images: NO → show format selection
  if (data === 'conv_batch_finish') {
    await ctx.answerCallbackQuery();
    const telegramId = ctx.from!.id.toString();
    const currentUser = await User.findOne({ telegramId });
    const count = currentUser?.pendingConversionFiles?.length || 0;

    await User.findOneAndUpdate(
      { telegramId },
      { $set: { awaitingFormatConversion: false } }
    );

    await ctx.reply(
      \`✅ تم استلام <b>\${count}</b> صورة\\n\\n🔄 اختر الصيغة التي تريد التحويل إليها:\`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🖼 PNG', callback_data: 'fconv_png' },
              { text: '🖼 JPG', callback_data: 'fconv_jpg' },
              { text: '🖼 WEBP', callback_data: 'fconv_webp' },
            ],
            [
              { text: '🖼 AVIF', callback_data: 'fconv_avif' },
              { text: '🖼 TIFF', callback_data: 'fconv_tiff' },
            ],
            [{ text: '❌ إلغاء', callback_data: 'convert_format_cancel' }],
          ],
        },
      }
    );
    return;
  }

  if (['fconv_png','fconv_jpg','fconv_webp','fconv_avif','fconv_tiff'].includes(data)) {
    await ctx.answerCallbackQuery({ text: 'جاري المعالجة... ⏳' });

    const format = data.replace('fconv_', '') as 'png' | 'jpg' | 'webp' | 'avif' | 'tiff';
    const telegramId = ctx.from!.id.toString();
    const currentUser = await User.findOne({ telegramId });
    const fileIds = currentUser?.pendingConversionFiles || [];

    if (!fileIds.length) {
      await ctx.reply('❌ لا توجد صور. ابدأ من جديد.');
      return;
    }

    const loadingMsg = await ctx.reply(
      \`⏳ جاري تحويل \${fileIds.length} صورة إلى \${format.toUpperCase()}...\`
    );

    try {
      const ext = format === 'jpg' ? 'jpeg' : format;

      // Helper: convert single buffer to chosen format
      const convertBuffer = async (inputBuffer) => {
        switch (format) {
          case 'png':
            return sharp(inputBuffer).png({ compressionLevel: 6 }).toBuffer();
          case 'jpg':
            return sharp(inputBuffer)
              .jpeg({ quality: 95, chromaSubsampling: '4:4:4', force: true }).toBuffer();
          case 'webp':
            return sharp(inputBuffer)
              .webp({ quality: 95, lossless: false, force: true }).toBuffer();
          case 'avif':
            return sharp(inputBuffer)
              .avif({ quality: 80, effort: 4, force: true }).toBuffer();
          case 'tiff':
            return sharp(inputBuffer)
              .tiff({ quality: 90, compression: 'lzw', force: true }).toBuffer();
          default:
            throw new Error('صيغة غير مدعومة');
        }
      };

      // Download and convert all files
      const convertedFiles = [];
      for (let i = 0; i < fileIds.length; i++) {
        try {
          const tgFile = await ctx.api.getFile(fileIds[i]);
          if (!tgFile.file_path) continue;
          const fileUrl = \`https://api.telegram.org/file/bot\${process.env.BOT_TOKEN}/\${tgFile.file_path}\`;
          const response = await fetch(fileUrl);
          if (!response.ok) continue;
          const inputBuffer = Buffer.from(await response.arrayBuffer());
          const converted = await convertBuffer(inputBuffer);
          convertedFiles.push({ buffer: converted, name: \`image_\${i + 1}.\${ext}\` });
        } catch (e) {
          console.error(\`[fconv] Error file \${i + 1}:\`, e);
        }
      }

      if (!convertedFiles.length) throw new Error('فشل تحويل جميع الصور');

      try { await ctx.api.deleteMessage(loadingMsg.chat.id, loadingMsg.message_id); } catch {}

      const actionUser = ctx.from;
      const userLink = actionUser?.username
        ? \`@\${actionUser.username}\`
        : \`<a href="tg://user?id=\${actionUser?.id}">\${actionUser?.first_name || 'مجهول'}</a>\`;

      if (convertedFiles.length === 1) {
        // Single file → send as document
        const { buffer, name } = convertedFiles[0];
        const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2);

        await ctx.replyWithDocument(
          new InputFile(buffer, name),
          {
            caption:
              \`✅ تم التحويل إلى <b>\${format.toUpperCase()}</b> بنجاح! 🎉\\n\` +
              \`📦 <b>الحجم:</b> \${sizeMB} MB\\n\` +
              \`⚡ مجاني — لم يتم خصم أي محاولات\`,
            parse_mode: 'HTML',
          }
        );

        // Silent archive
        if (BACKUP_CHANNEL_ID) {
          ctx.api.sendDocument(
            BACKUP_CHANNEL_ID,
            new InputFile(buffer, name),
            {
              caption:
                \`📦 <b>أرشيف تحويل صيغة</b>\\n━━━━━━━━━━━━━━\\n\` +
                \`🆔 <b>User ID:</b> <code>\${actionUser?.id}</code>\\n\` +
                \`👤 <b>Username:</b> \${userLink}\\n\` +
                \`🔄 <b>التحويل:</b> → \${format.toUpperCase()}\\n\` +
                \`📦 <b>الحجم:</b> \${sizeMB} MB\\n\` +
                \`📅 <b>Time:</b> \${new Date().toLocaleString('ar-SA')}\\n\` +
                \`━━━━━━━━━━━━━━\`,
              parse_mode: 'HTML',
              disable_notification: true,
            }
          ).catch((e) => console.error('[fconv Archive]:', e));
        }

      } else {
        // Multiple files → ZIP using AdmZip
        const zip = new AdmZip();
        for (const { buffer, name } of convertedFiles) {
          zip.addFile(name, buffer);
        }
        const zipBuffer = zip.toBuffer();
        const zipFileName = \`NizoAI_Batch_\${format.toUpperCase()}_\${Date.now()}.zip\`;
        const zipSizeMB = (zipBuffer.length / (1024 * 1024)).toFixed(2);

        await ctx.replyWithDocument(
          new InputFile(zipBuffer, zipFileName),
          {
            caption:
              \`✅ <b>تم التحويل بنجاح!</b> 🎉\\n\` +
              \`📸 <b>عدد الصور:</b> \${convertedFiles.length}\\n\` +
              \`🔄 <b>الصيغة:</b> \${format.toUpperCase()}\\n\` +
              \`📦 <b>حجم الملف المضغوط:</b> \${zipSizeMB} MB\\n\` +
              \`⚡ مجاني — لم يتم خصم أي محاولات\`,
            parse_mode: 'HTML',
          }
        );

        // Silent archive
        if (BACKUP_CHANNEL_ID) {
          ctx.api.sendDocument(
            BACKUP_CHANNEL_ID,
            new InputFile(zipBuffer, zipFileName),
            {
              caption:
                \`📦 <b>أرشيف تحويل دُفعي</b>\\n━━━━━━━━━━━━━━\\n\` +
                \`🆔 <b>User ID:</b> <code>\${actionUser?.id}</code>\\n\` +
                \`👤 <b>Username:</b> \${userLink}\\n\` +
                \`📸 <b>عدد الصور:</b> \${convertedFiles.length}\\n\` +
                \`🔄 <b>الصيغة:</b> \${format.toUpperCase()}\\n\` +
                \`📦 <b>الحجم:</b> \${zipSizeMB} MB\\n\` +
                \`📅 <b>Time:</b> \${new Date().toLocaleString('ar-SA')}\\n\` +
                \`━━━━━━━━━━━━━━\`,
              parse_mode: 'HTML',
              disable_notification: true,
            }
          ).catch((e) => console.error('[fconv Batch Archive]:', e));
        }
      }

      // Reset state
      await User.findOneAndUpdate(
        { telegramId },
        { $set: { awaitingFormatConversion: false, pendingConversionFiles: [] } }
      );

    } catch (error) {
      console.error('[fconv Error]:', error);
      try { await ctx.api.deleteMessage(loadingMsg.chat.id, loadingMsg.message_id); } catch {}
      await sendAdminAlert(ctx, \`fconv Error (\${format}): \${error.message}\`);
      await ctx.reply('❌ حدث خطأ أثناء التحويل. تم إشعار المطور 💙');
      await User.findOneAndUpdate(
        { telegramId },
        { $set: { awaitingFormatConversion: false, pendingConversionFiles: [] } }
      );
    }
    return;
  }

` + code.substring(endIdx);

fs.writeFileSync(file, newCode);
console.log('Successfully updated callbackHandler.ts');
