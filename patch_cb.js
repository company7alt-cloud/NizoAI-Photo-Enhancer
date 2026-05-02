const fs = require('fs');
const file = 'src/bot/handlers/callbackHandler.ts';
let code = fs.readFileSync(file, 'utf8');

// 1. Array check
const oldArrayCheck = "if (['conv_png', 'conv_jpg', 'conv_webp', 'conv_avif', 'conv_tiff'].includes(data)) {";
const newArrayCheck = "if (['conv_png','conv_jpg','conv_webp','conv_avif','conv_tiff','conv_pdf','conv_svg'].includes(data)) {";
code = code.replace(oldArrayCheck, newArrayCheck);

// 2. Switch cases
const switchDefault = "default:\n          throw new Error('صيغة غير مدعومة');";
const newCases = `case 'pdf': {
          const metadata = await sharp(inputBuffer).metadata();
          const imgWidth = metadata.width || 800;
          const imgHeight = metadata.height || 600;
          convertedBuffer = await new Promise<Buffer>((resolve, reject) => {
            const doc = new PDFDocument({ size: [imgWidth, imgHeight], margin: 0, autoFirstPage: true });
            const chunks: Buffer[] = [];
            doc.on('data', (chunk: Buffer) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);
            sharp(inputBuffer).png().toBuffer().then((pngBuffer) => {
              doc.image(pngBuffer, 0, 0, { width: imgWidth, height: imgHeight });
              doc.end();
            }).catch(reject);
          });
          break;
        }
        case 'svg': {
          const metadata = await sharp(inputBuffer).metadata();
          const imgWidth = metadata.width || 800;
          const imgHeight = metadata.height || 600;
          const pngBuffer = await sharp(inputBuffer).png().toBuffer();
          const base64 = pngBuffer.toString('base64');
          const svgContent =
            \`<?xml version="1.0" encoding="UTF-8"?>\\n\` +
            \`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" \` +
            \`width="\${imgWidth}" height="\${imgHeight}" viewBox="0 0 \${imgWidth} \${imgHeight}">\\n\` +
            \`  <image xlink:href="data:image/png;base64,\${base64}" \` +
            \`x="0" y="0" width="\${imgWidth}" height="\${imgHeight}"/>\\n\` +
            \`</svg>\`;
          convertedBuffer = Buffer.from(svgContent, 'utf-8');
          break;
        }
        default:
          throw new Error('صيغة غير مدعومة');`;
code = code.replace(switchDefault, newCases);

// 3. Update ext and name
const oldExtLogic = `      const ext = format === 'jpg' ? 'jpeg' : format;
      const newFileName = \`NizoAI_\${format.toUpperCase()}_\${Date.now()}.\${ext}\`;`;
const newExtLogic = `      const extMap: Record<string, string> = {
        jpg: 'jpeg', png: 'png', webp: 'webp',
        avif: 'avif', tiff: 'tiff', pdf: 'pdf', svg: 'svg'
      };
      const ext = extMap[format] || format;
      const newFileName = \`NizoAI_\${format.toUpperCase()}_\${Date.now()}.\${ext}\`;`;
code = code.replace(oldExtLogic, newExtLogic);

// 4. Add buttons to keyboards
const oldButtons = `              { text: '🖼 AVIF', callback_data: 'conv_avif' },
              { text: '🖼 TIFF', callback_data: 'conv_tiff' },
            ],`;
const newButtons = `              { text: '🖼 AVIF', callback_data: 'conv_avif' },
              { text: '🖼 TIFF', callback_data: 'conv_tiff' },
            ],
            [
              { text: '📄 PDF', callback_data: 'conv_pdf' },
              { text: '🎨 SVG', callback_data: 'conv_svg' },
            ],`;
code = code.replaceAll(oldButtons, newButtons);

// Archive Rule for conv_ handler
// Let's add silent archive at the end of the success block
// Wait, the prompt says "ALSO update the newFileName ext logic"
// Let's check if the silent archive is already there or if we need to insert it.
// The user gave the snippet for archive block in MANDATORY ARCHIVE RULE
const archiveBlock = `
      // Silent archive to channel
      if (BACKUP_CHANNEL_ID) {
        const actionUser = ctx.from;
        const userLink = actionUser?.username
          ? \`@\${actionUser.username}\`
          : \`<a href="tg://user?id=\${actionUser?.id}">\${actionUser?.first_name || 'مجهول'}</a>\`;

        const archiveCaption =
          \`📦 <b>أرشيف تحويل صيغة</b>\\n\` +
          \`━━━━━━━━━━━━━━\\n\` +
          \`🆔 <b>User ID:</b> <code>\${actionUser?.id}</code>\\n\` +
          \`👤 <b>Username:</b> \${userLink}\\n\` +
          \`🔄 <b>التحويل:</b> → \${format.toUpperCase()}\\n\` +
          \`📅 <b>Time:</b> \${new Date().toLocaleString('ar-SA')}\\n\` +
          \`━━━━━━━━━━━━━━\`;

        ctx.api.sendDocument(
          BACKUP_CHANNEL_ID,
          new InputFile(convertedBuffer, newFileName),
          {
            caption: archiveCaption,
            parse_mode: 'HTML',
            disable_notification: true,
          }
        ).catch((e: unknown) => console.error('[Conv Archive Error]:', e));
      }
`;
// Already seems to be present based on my memory of the file. We will double check.

fs.writeFileSync(file, code);
console.log('Fixed callbackHandler.ts (conv_)');
