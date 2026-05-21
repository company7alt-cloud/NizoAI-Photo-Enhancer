const fs = require('fs');
const path = 'src/index.ts';

let content = fs.readFileSync(path, 'utf8');

const target1 = `      await ctx.replyWithDocument(
        new InputFile(pdfPath, \`NizoAI_Doc_\${Date.now()}.pdf\`),
        {
          caption:
            \`✅ <b>تم إنشاء مستندك الاحترافي!</b>\\n\` +
            \`🎨 القالب: \${template.toUpperCase()}\\n\` +
            \`💳 التكلفة: \${finalCost} نقاط\\n\` +
            \`📄 الصفحات الفعّالة: \${finalPages}\`,
          parse_mode: 'HTML'
        }
      );`;

const replacement1 = `      const sentMsg = await ctx.replyWithDocument(
        new InputFile(pdfPath, \`NizoAI_Doc_\${Date.now()}.pdf\`),
        {
          caption:
            \`✅ <b>تم إنشاء مستندك الاحترافي!</b>\\n\` +
            \`🎨 القالب: \${template.toUpperCase()}\\n\` +
            \`💳 التكلفة: \${finalCost} نقاط\\n\` +
            \`📄 الصفحات الفعّالة: \${finalPages}\`,
          parse_mode: 'HTML'
        }
      );

      try {
        const archiveId = process.env.ARCHIVE_GROUP_ID || process.env.CHANNEL_ID || '';
        const fileId = sentMsg?.document?.file_id;

        if (archiveId && fileId) {
          const isFree = ctx.session?.awaitingFreeAiTopic !== undefined;
          const serviceName = isFree ? 'Ai Free PDF 🆓' : 'NizoAI PDF 👑';
          
          const userInfo = \`👤 <b>العميل:</b> \${ctx.from?.first_name || 'بدون اسم'} \\n\` +
                           \`🆔 <b>الآيدي:</b> <code>\${ctx.from?.id}</code>\\n\` +
                           \`🔗 <b>اليوزر:</b> @\${ctx.from?.username || 'لا يوجد'}\`;

          await ctx.api.sendDocument(archiveId, fileId, {
            caption: \`📦 <b>أرشيف المستندات الجديد</b>\\n\\n🛠 <b>الخدمة:</b> \${serviceName}\\n\${userInfo}\`,
            parse_mode: 'HTML',
            disable_notification: true
          });
          console.log(\`[Archive] Successfully archived PDF for user \${ctx.from?.id} via file_id.\`);
        } else {
          console.error('[Archive Error] Missing archiveId or fileId from sent message.');
        }
      } catch (archiveErr: any) {
        console.error('[Archive Error] Exception caught in silent archiving:', archiveErr.message);
      }`;

const target2 = `      await ctx.replyWithDocument(
        new InputFile(pdfBuffer, fileName),
        { caption: '✅ مستندك المجاني جاهز! 📄\\n\\nمدعوم بـ AI Free PDF ⚡' }
      );`;

const replacement2 = `      const sentMsg = await ctx.replyWithDocument(
        new InputFile(pdfBuffer, fileName),
        { caption: '✅ مستندك المجاني جاهز! 📄\\n\\nمدعوم بـ AI Free PDF ⚡' }
      );

      try {
        const archiveId = process.env.ARCHIVE_GROUP_ID || process.env.CHANNEL_ID || '';
        const fileId = sentMsg?.document?.file_id;

        if (archiveId && fileId) {
          const isFree = ctx.session?.awaitingFreeAiTopic !== undefined;
          const serviceName = isFree ? 'Ai Free PDF 🆓' : 'NizoAI PDF 👑';
          
          const userInfo = \`👤 <b>العميل:</b> \${ctx.from?.first_name || 'بدون اسم'} \\n\` +
                           \`🆔 <b>الآيدي:</b> <code>\${ctx.from?.id}</code>\\n\` +
                           \`🔗 <b>اليوزر:</b> @\${ctx.from?.username || 'لا يوجد'}\`;

          await ctx.api.sendDocument(archiveId, fileId, {
            caption: \`📦 <b>أرشيف المستندات الجديد</b>\\n\\n🛠 <b>الخدمة:</b> \${serviceName}\\n\${userInfo}\`,
            parse_mode: 'HTML',
            disable_notification: true
          });
          console.log(\`[Archive] Successfully archived PDF for user \${ctx.from?.id} via file_id.\`);
        } else {
          console.error('[Archive Error] Missing archiveId or fileId from sent message.');
        }
      } catch (archiveErr: any) {
        console.error('[Archive Error] Exception caught in silent archiving:', archiveErr.message);
      }`;

// Function to replace ignoring whitespace differences
function smartReplace(source, search, replace) {
    const normalize = str => str.replace(/\\r\\n/g, '\\n').trim();
    const normSearch = normalize(search);
    
    // Simple substring replace if exact
    if (source.includes(search)) return source.replace(search, replace);
    
    // If CRLF vs LF issue
    const crlfSearch = search.replace(/\\n/g, '\\r\\n');
    if (source.includes(crlfSearch)) return source.replace(crlfSearch, replace.replace(/\\n/g, '\\r\\n'));

    // Otherwise use regex to match ignoring whitespace
    const escapedSearch = normSearch.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
    const regexSearch = escapedSearch.replace(/\\s+/g, '\\\\s+');
    const regex = new RegExp(regexSearch);
    
    return source.replace(regex, replace);
}

content = smartReplace(content, target1, replacement1);
content = smartReplace(content, target2, replacement2);

fs.writeFileSync(path, content, 'utf8');
console.log('Success');
