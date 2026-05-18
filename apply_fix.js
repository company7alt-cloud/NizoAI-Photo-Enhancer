const fs = require('fs');

let content = fs.readFileSync('src/index.ts', 'utf8');

const target = `      reply_markup: new InlineKeyboard()
        .text('📝 الدخول لصانع المستندات', 'start_doc_maker').row()
        .text('🤖 NizoAI PDF', 'start_premium_ai')
        .text('🆓 Ai Free PDF', 'start_free_ai').row()
        .text('🚨 إبلاغ المطور', 'doc_report_dev')`;

const replacement = `      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '📝 الدخول لصانع المستندات',
              callback_data: 'start_doc_maker',
              // @ts-ignore
              style: 'primary'
            }
          ],
          [
            {
              text: '🤖 NizoAI PDF',
              callback_data: 'start_premium_ai',
              // @ts-ignore
              style: 'primary'
            },
            {
              text: '🆓 Ai Free PDF',
              callback_data: 'start_free_ai',
              // @ts-ignore
              style: 'primary'
            }
          ],
          [
            {
              text: '🚨 إبلاغ المطور',
              callback_data: 'report_to_dev',
              // @ts-ignore
              style: 'danger'
            }
          ]
        ]
      }`;

if (content.indexOf(target) !== -1) {
  console.log("Found using literal match!");
  content = content.replace(target, replacement);
  fs.writeFileSync('src/index.ts', content, 'utf8');
} else {
  // Normalize Windows newlines
  const targetNormalized = target.replace(/\r\n/g, '\n');
  const contentNormalized = content.replace(/\r\n/g, '\n');
  if (contentNormalized.indexOf(targetNormalized) !== -1) {
    console.log("Found using normalized match!");
    content = contentNormalized.replace(targetNormalized, replacement);
    fs.writeFileSync('src/index.ts', content, 'utf8');
  } else {
    console.log("Could not find the target text!");
  }
}
