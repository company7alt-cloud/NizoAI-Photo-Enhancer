const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'bot', 'handlers', 'callbackHandler.ts');
let content = fs.readFileSync(filePath, 'utf8');

// The anchor: the line that starts the admin_support_ section
// We insert our handler BEFORE this anchor
const anchor = `  // ══════════════════════════════════════\r\n  // 💬 فتح جلسة دعم مع العميل\r\n  // ══════════════════════════════════════\r\n  if (data.startsWith('admin_support_')) {`;

if (!content.includes(anchor)) {
  console.error('❌ Anchor not found. Aborting.');
  process.exit(1);
}

if (content.includes("if (data.startsWith('confirm_report_'))")) {
  console.log('⚠️  confirm_report_ handler already exists. Skipping.');
  process.exit(0);
}

const newHandler = `  if (data.startsWith('confirm_report_')) {\r\n    await ctx.answerCallbackQuery();\r\n\r\n    // Parse chatId and messageId from callback data\r\n    const withoutPrefix = data.replace('confirm_report_', '');\r\n    const underscoreIdx = withoutPrefix.indexOf('_');\r\n    const sourceChatId = Number(withoutPrefix.substring(0, underscoreIdx));\r\n    const sourceMessageId = Number(withoutPrefix.substring(underscoreIdx + 1));\r\n\r\n    if (!sourceChatId || !sourceMessageId || isNaN(sourceChatId) || isNaN(sourceMessageId)) {\r\n      await ctx.editMessageText('❌ انتهت صلاحية البلاغ. يرجى إرسال بلاغ جديد.').catch(() => {});\r\n      return;\r\n    }\r\n\r\n    const adminIdsRaw = process.env.ADMIN_IDS || '';\r\n    const adminIds = adminIdsRaw.split(',').map((id) => id.trim());\r\n\r\n    const userId = ctx.from?.id;\r\n    const firstName = ctx.from?.first_name || 'مجهول';\r\n    const username = ctx.from?.username ? \`@\${ctx.from.username}\` : 'لا يوجد معرف';\r\n    const userLink = \`tg://user?id=\${userId}\`;\r\n\r\n    const reportHeader =\r\n      \`🚨 <b>بلاغ جديد من عميل</b>\\n\\n\` +\r\n      \`👤 <b>العميل:</b> <a href="\${userLink}">\${firstName}</a>\\n\` +\r\n      \`🔗 <b>المعرف:</b> \${username}\\n\` +\r\n      \`🆔 <b>الـ ID:</b> <code>\${userId}</code>\\n\` +\r\n      \`📅 <b>التوقيت:</b> \${new Date().toLocaleString('ar-SA')}\`;\r\n\r\n    let forwarded = false;\r\n\r\n    for (const adminId of adminIds) {\r\n      try {\r\n        // Send header with user info and action buttons\r\n        await ctx.api.sendMessage(Number(adminId), reportHeader, {\r\n          parse_mode: 'HTML',\r\n          reply_markup: {\r\n            inline_keyboard: [\r\n              [{ text: '🚫 حظر العميل', callback_data: \`admin_ban_\${userId}\` }],\r\n              [{ text: '🔒 تقييد العميل', callback_data: \`admin_restrict_\${userId}\` }],\r\n              [{ text: '💬 فتح محادثة دعم', callback_data: \`admin_support_\${userId}\` }],\r\n            ],\r\n          },\r\n        });\r\n\r\n        // Forward the original message (works for ALL types)\r\n        await ctx.api.forwardMessage(Number(adminId), sourceChatId, sourceMessageId);\r\n        forwarded = true;\r\n      } catch (e) {\r\n        console.error('[Report Forward] Error for admin', adminId, e);\r\n      }\r\n    }\r\n\r\n    // Update confirmation message\r\n    try {\r\n      await ctx.editMessageText(\r\n        forwarded\r\n          ? '✅ <b>تم إرسال بلاغك للمطور بنجاح!</b>\\n\\nسيتم الرد عليك في أقرب وقت ممكن 🌹'\r\n          : '❌ حدث خطأ أثناء إرسال البلاغ. حاول مجدداً.',\r\n        { parse_mode: 'HTML' }\r\n      );\r\n    } catch {}\r\n    return;\r\n  }\r\n\r\n  `;

content = content.replace(anchor, newHandler + anchor);

fs.writeFileSync(filePath, content, 'utf8');
console.log('✅ confirm_report_ handler inserted successfully.');
