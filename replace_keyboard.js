const fs = require('fs');
let content = fs.readFileSync('src/index.ts', 'utf8');

// Use a regex that replaces the block regardless of whitespace/newlines
const regex = /await\s+ctx\.replyWithPhoto\(\s*new\s+InputFile\([^)]+\)\s*,\s*\{\s*caption:.*?\s*parse_mode:\s*'HTML'\s*,\s*reply_markup:\s*new\s+InlineKeyboard\(\)\s*\.text\([^)]+\)\.row\(\)\s*\.text\([^)]+\)\s*\.text\([^)]+\)\.row\(\)\s*\.text\([^)]+\)\s*\}\s*\);/s;

const newBlock = `await ctx.replyWithPhoto(
    new InputFile(path.join(__dirname, '../assets/welcome.jpg')),
    {
      caption: \`مرحباً \${firstName}! 👋\\n\\nأنا بوت صانع المستندات الاحترافي 📝\\nيمكنك إنشاء مستندات PDF احترافية بسهولة تامة.\\n\\n💰 رصيدك الحالي: \${points} نقطة\\n\\nاضغط الزر بالأسفل للبدء:\`,
      parse_mode: 'HTML',
      reply_markup: {
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
      }
    }
  );`;

if (regex.test(content)) {
  content = content.replace(regex, newBlock);
  fs.writeFileSync('src/index.ts', content, 'utf8');
  console.log('Successfully replaced code in src/index.ts via regex!');
} else {
  console.log('Target string regex NOT MATCHED in src/index.ts');
}
