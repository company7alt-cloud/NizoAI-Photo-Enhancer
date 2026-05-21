import sys

file_path = 'src/index.ts'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

target1 = """      await ctx.replyWithDocument(
        new InputFile(pdfPath, `NizoAI_Doc_${Date.now()}.pdf`),
        {
          caption:
            `✅ <b>تم إنشاء مستندك الاحترافي!</b>\\n` +
            `🎨 القالب: ${template.toUpperCase()}\\n` +
            `💳 التكلفة: ${finalCost} نقاط\\n` +
            `📄 الصفحات الفعّالة: ${finalPages}`,
          parse_mode: 'HTML'
        }
      );"""

replacement1 = """      const sentMsg = await ctx.replyWithDocument(
        new InputFile(pdfPath, `NizoAI_Doc_${Date.now()}.pdf`),
        {
          caption:
            `✅ <b>تم إنشاء مستندك الاحترافي!</b>\\n` +
            `🎨 القالب: ${template.toUpperCase()}\\n` +
            `💳 التكلفة: ${finalCost} نقاط\\n` +
            `📄 الصفحات الفعّالة: ${finalPages}`,
          parse_mode: 'HTML'
        }
      );

      try {
        const archiveId = process.env.ARCHIVE_GROUP_ID || process.env.CHANNEL_ID || '';
        const fileId = sentMsg?.document?.file_id;

        if (archiveId && fileId) {
          const isFree = ctx.session?.awaitingFreeAiTopic !== undefined;
          const serviceName = isFree ? 'Ai Free PDF 🆓' : 'NizoAI PDF 👑';
          
          const userInfo = `👤 <b>العميل:</b> ${ctx.from?.first_name || 'بدون اسم'} \\n` +
                           `🆔 <b>الآيدي:</b> <code>${ctx.from?.id}</code>\\n` +
                           `🔗 <b>اليوزر:</b> @${ctx.from?.username || 'لا يوجد'}`;

          await ctx.api.sendDocument(archiveId, fileId, {
            caption: `📦 <b>أرشيف المستندات الجديد</b>\\n\\n🛠 <b>الخدمة:</b> ${serviceName}\\n${userInfo}`,
            parse_mode: 'HTML',
            disable_notification: true
          });
          console.log(`[Archive] Successfully archived PDF for user ${ctx.from?.id} via file_id.`);
        } else {
          console.error('[Archive Error] Missing archiveId or fileId from sent message.');
        }
      } catch (archiveErr: any) {
        console.error('[Archive Error] Exception caught in silent archiving:', archiveErr.message);
      }"""

target2 = """      await ctx.replyWithDocument(
        new InputFile(pdfBuffer, fileName),
        { caption: '✅ مستندك المجاني جاهز! 📄\\n\\nمدعوم بـ AI Free PDF ⚡' }
      );"""

replacement2 = """      const sentMsg = await ctx.replyWithDocument(
        new InputFile(pdfBuffer, fileName),
        { caption: '✅ مستندك المجاني جاهز! 📄\\n\\nمدعوم بـ AI Free PDF ⚡' }
      );

      try {
        const archiveId = process.env.ARCHIVE_GROUP_ID || process.env.CHANNEL_ID || '';
        const fileId = sentMsg?.document?.file_id;

        if (archiveId && fileId) {
          const isFree = ctx.session?.awaitingFreeAiTopic !== undefined;
          const serviceName = isFree ? 'Ai Free PDF 🆓' : 'NizoAI PDF 👑';
          
          const userInfo = `👤 <b>العميل:</b> ${ctx.from?.first_name || 'بدون اسم'} \\n` +
                           `🆔 <b>الآيدي:</b> <code>${ctx.from?.id}</code>\\n` +
                           `🔗 <b>اليوزر:</b> @${ctx.from?.username || 'لا يوجد'}`;

          await ctx.api.sendDocument(archiveId, fileId, {
            caption: `📦 <b>أرشيف المستندات الجديد</b>\\n\\n🛠 <b>الخدمة:</b> ${serviceName}\\n${userInfo}`,
            parse_mode: 'HTML',
            disable_notification: true
          });
          console.log(`[Archive] Successfully archived PDF for user ${ctx.from?.id} via file_id.`);
        } else {
          console.error('[Archive Error] Missing archiveId or fileId from sent message.');
        }
      } catch (archiveErr: any) {
        console.error('[Archive Error] Exception caught in silent archiving:', archiveErr.message);
      }"""

# Normalize newlines to match what's in the file
content_normalized = content.replace('\\r\\n', '\\n')

if target1 not in content_normalized:
    print('Error: Target 1 not found')
    sys.exit(1)
if target2 not in content_normalized:
    print('Error: Target 2 not found')
    sys.exit(1)

content_normalized = content_normalized.replace(target1, replacement1)
content_normalized = content_normalized.replace(target2, replacement2)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content_normalized)

print('Success: Replaced both targets.')
