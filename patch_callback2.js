const fs = require('fs');

const path = 'src/bot/handlers/callbackHandler.ts';
let code = fs.readFileSync(path, 'utf8');

// 1. Add PDFDocument import
if (!code.includes("import PDFDocument from 'pdfkit';")) {
  code = code.replace(
    "import AdmZip from 'adm-zip';",
    "import AdmZip from 'adm-zip';\nimport PDFDocument from 'pdfkit';"
  );
}

// 2. Add showFormatSelection helper before callbackHandler
const helperCode = `async function showFormatSelection(ctx: any, count: number, upscale: boolean): Promise<void> {
  const isSingle = count === 1;
  const keyboard: any[] = [
    [
      { text: '🖼 PNG', callback_data: 'fconv_png' },
      { text: '🖼 JPG', callback_data: 'fconv_jpg' },
      { text: '🖼 WEBP', callback_data: 'fconv_webp' },
    ],
    [
      { text: '🖼 AVIF', callback_data: 'fconv_avif' },
      { text: '🖼 TIFF', callback_data: 'fconv_tiff' },
    ],
  ];

  // Add PDF and SVG only for single image
  if (isSingle) {
    keyboard.push([
      { text: '📄 PDF', callback_data: 'fconv_pdf' },
      { text: '🎨 SVG', callback_data: 'fconv_svg' },
    ]);
  }

  keyboard.push([{ text: '❌ إلغاء', callback_data: 'convert_format_cancel' }]);

  await ctx.reply(
    \`🔄 <b>اختر الصيغة التي تريد التحويل إليها:</b>\\n\` +
    (isSingle ? '📄 PDF و SVG متاحان للصورة الواحدة فقط' : ''),
    {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    }
  );
}

export async function callbackHandler`;

code = code.replace('export async function callbackHandler', helperCode);

// 3. Replace conv_batch_finish logic
const batchFinishOld = `    await ctx.reply(
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
    );`;

const batchFinishNew = `    await ctx.reply(
      \`✅ تم استلام <b>\${count}</b> صورة\\n\\n\` +
      \`📐 <b>هل تريد رفع دقة الصور أم تحويل الصيغة فقط؟</b>\`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '✨ نعم، ارفع الدقة أيضاً', callback_data: 'conv_quality_upscale' }],
            [{ text: '🔄 لا، تحويل الصيغة فقط (كما هي)', callback_data: 'conv_quality_original' }],
            [{ text: '❌ إلغاء', callback_data: 'convert_format_cancel' }],
          ],
        },
      }
    );`;

if (!code.includes(batchFinishOld)) {
  console.log('Error: batchFinishOld not found');
} else {
  code = code.replace(batchFinishOld, batchFinishNew);
}

// 4. Add conv_quality_upscale and conv_quality_original handlers
const newHandlers = `  if (data === 'conv_quality_upscale') {
    await ctx.answerCallbackQuery();
    const telegramId = ctx.from!.id.toString();
    await User.findOneAndUpdate(
      { telegramId },
      { $set: { conversionUpscale: true } }
    );
    // Show format selection
    const currentUser = await User.findOne({ telegramId });
    const count = currentUser?.pendingConversionFiles?.length || 0;
    await showFormatSelection(ctx, count, true);
    return;
  }

  if (data === 'conv_quality_original') {
    await ctx.answerCallbackQuery();
    const telegramId = ctx.from!.id.toString();
    await User.findOneAndUpdate(
      { telegramId },
      { $set: { conversionUpscale: false } }
    );
    const currentUser = await User.findOne({ telegramId });
    const count = currentUser?.pendingConversionFiles?.length || 0;
    await showFormatSelection(ctx, count, false);
    return;
  }

  if (['fconv_png','fconv_jpg','fconv_webp','fconv_avif','fconv_tiff'`;

code = code.replace("  if (['fconv_png','fconv_jpg','fconv_webp','fconv_avif','fconv_tiff'", newHandlers);

// 5. Add pdf and svg to fconv array
code = code.replace(
  "['fconv_png','fconv_jpg','fconv_webp','fconv_avif','fconv_tiff']",
  "['fconv_png','fconv_jpg','fconv_webp','fconv_avif','fconv_tiff','fconv_pdf','fconv_svg']"
);
code = code.replace(
  "as 'png' | 'jpg' | 'webp' | 'avif' | 'tiff';",
  "as 'png' | 'jpg' | 'webp' | 'avif' | 'tiff' | 'pdf' | 'svg';"
);

// 6. Update convertBuffer with pdf and svg cases
const convertBufferOld = `          case 'tiff':
            return sharp(inputBuffer)
              .tiff({ quality: 90, compression: 'lzw', force: true }).toBuffer();
          default:`;

const convertBufferNew = `          case 'tiff':
            return sharp(inputBuffer)
              .tiff({ quality: 90, compression: 'lzw', force: true }).toBuffer();
          case 'pdf': {
            // Convert image to PDF using pdfkit
            const metadata = await sharp(inputBuffer).metadata();
            const imgWidth = metadata.width || 800;
            const imgHeight = metadata.height || 600;

            const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
              const doc = new PDFDocument({
                size: [imgWidth, imgHeight],
                margin: 0,
                autoFirstPage: true,
              });
              const chunks: Buffer[] = [];
              doc.on('data', (chunk: Buffer) => chunks.push(chunk));
              doc.on('end', () => resolve(Buffer.concat(chunks)));
              doc.on('error', reject);

              // Convert image to PNG first for PDF embedding
              sharp(inputBuffer).png().toBuffer().then((pngBuffer) => {
                doc.image(pngBuffer, 0, 0, { width: imgWidth, height: imgHeight });
                doc.end();
              }).catch(reject);
            });
            return pdfBuffer;
          }
          case 'svg': {
            // Wrap image in SVG (embed as base64)
            const metadata = await sharp(inputBuffer).metadata();
            const imgWidth = metadata.width || 800;
            const imgHeight = metadata.height || 600;

            // Convert to PNG first for embedding
            const pngBuffer = await sharp(inputBuffer).png().toBuffer();
            const base64 = pngBuffer.toString('base64');

            const svgContent =
              \`<?xml version="1.0" encoding="UTF-8"?>\\n\` +
              \`<svg xmlns="http://www.w3.org/2000/svg" \` +
              \`xmlns:xlink="http://www.w3.org/1999/xlink" \` +
              \`width="\${imgWidth}" height="\${imgHeight}" \` +
              \`viewBox="0 0 \${imgWidth} \${imgHeight}">\\n\` +
              \`  <image xlink:href="data:image/png;base64,\${base64}" \` +
              \`x="0" y="0" width="\${imgWidth}" height="\${imgHeight}"/>\\n\` +
              \`</svg>\`;

            return Buffer.from(svgContent, 'utf-8');
          }
          default:`;

if (!code.includes(convertBufferOld)) {
  console.log("Error: convertBufferOld not found");
} else {
  code = code.replace(convertBufferOld, convertBufferNew);
}

// 7. Update upscale logic
const fileLoopStart = `          const inputBuffer = Buffer.from(await response.arrayBuffer());
          const converted = await convertBuffer(inputBuffer);`;

const fileLoopNew = `          const inputBuffer = Buffer.from(await response.arrayBuffer());
          
          const shouldUpscale = currentUser?.conversionUpscale === true;
          let processBuffer = inputBuffer;

          if (shouldUpscale && !['pdf', 'svg'].includes(format)) {
            const meta = await sharp(inputBuffer).metadata();
            const w = meta.width || 800;
            const h = meta.height || 600;
            processBuffer = await sharp(inputBuffer)
              .resize({
                width: Math.round(w * 2),
                height: Math.round(h * 2),
                fit: 'fill',
                kernel: sharp.kernel.lanczos3,
              })
              .toBuffer();
          }

          const converted = await convertBuffer(processBuffer);`;

if (!code.includes(fileLoopStart)) {
  console.log("Error: fileLoopStart not found");
} else {
  code = code.replace(fileLoopStart, fileLoopNew);
}

// 8. Update ext logic inside loop
code = code.replace(
  "convertedFiles.push({ buffer: converted, name: `image_${i + 1}.${ext}` });",
  "const mimeOk = !['pdf', 'svg'].includes(format);\n          convertedFiles.push({ buffer: converted, name: `image_${i + 1}.${ext}` });"
);

// 9. Reset state replacement
const resetStateOld1 = `      await User.findOneAndUpdate(
        { telegramId },
        { $set: { awaitingFormatConversion: false, pendingConversionFiles: [] } }
      );`;
const resetStateNew1 = `      await User.findOneAndUpdate(
        { telegramId },
        { $set: {
          awaitingFormatConversion: false,
          pendingConversionFiles: [],
          conversionUpscale: false,
        }}
      );`;

code = code.split(resetStateOld1).join(resetStateNew1);

fs.writeFileSync(path, code);
console.log('Patch complete.');
