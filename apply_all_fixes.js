const fs = require('fs');
const path = require('path');

function getFileContent(filePath) {
    return fs.readFileSync(path.join(__dirname, filePath), 'utf8');
}
function setFileContent(filePath, content) {
    fs.writeFileSync(path.join(__dirname, filePath), content, 'utf8');
}

// ==========================================
// FIX START COMMAND BUTTON (Prompt 1)
// ==========================================
let startFile = 'src/bot/commands/start.ts';
let startContent = getFileContent(startFile);
startContent = startContent.replace(
  "{ text: nanoLocks.btn_magic_enhance ? '🔒 تحسين احترافي بالذكاء الاصطناعي — مقفل' : '🪄 تحسين احترافي بالذكاء الاصطناعي', callback_data: 'magic_enhance_start', style: 'primary' }",
  "{ text: nanoLocks.btn_magic_enhance ? '🔒 تحسين الصورة (AI) — مقفل' : '🪄 تحسين الصورة (AI)', callback_data: 'magic_enhance_start', style: 'primary' }"
);
// In case the old text had 🪤 (trap) instead of 🪄 (wand) due to previous mistake
startContent = startContent.replace(
  "{ text: nanoLocks.btn_magic_enhance ? '🔴 مقفول' : '🟢 مفتوح'} — 🪤 تحسين احترافي",
  "{ text: nanoLocks.btn_magic_enhance ? '🔴 مقفل' : '🟢 مفتوح'} — 🪄 تحسين الصورة (AI)"
);
// Also a regex for the ternary inside start.ts if the string was slightly different
startContent = startContent.replace(
    /\{ text: nanoLocks\.btn_magic_enhance \? '🔒 تحسين احترافي بالذكاء الاصطناعي — مقفل' : '.* تحسين احترافي بالذكاء الاصطناعي', callback_data: 'magic_enhance_start', style: 'primary' \}/g,
    "{ text: nanoLocks.btn_magic_enhance ? '🔒 تحسين الصورة (AI) — مقفل' : '🪄 تحسين الصورة (AI)', callback_data: 'magic_enhance_start', style: 'primary' }"
);
setFileContent(startFile, startContent);
console.log('Fixed start.ts');

// ==========================================
// FIX CALLBACK HANDLER (Prompt 1 & Prompt 2)
// ==========================================
let cbFile = 'src/bot/handlers/callbackHandler.ts';
let cbContent = getFileContent(cbFile);
// Prompt 1: Admin toggle button
cbContent = cbContent.split("[{ text: `${l.btn_magic_enhance ? '🔴 مقفول' : '🟢 مفتوح'} — 🪤 تحسين احترافي`, callback_data: 'atoggle_btn_magic_enhance' }]").join(
  "[{ text: `${l.btn_magic_enhance ? '🔴 مقفل' : '🟢 مفتوح'} — 🪄 تحسين الصورة (AI)`, callback_data: 'atoggle_btn_magic_enhance' }]"
);
cbContent = cbContent.split("[{ text: `${l.btn_magic_enhance ? '🔴 مقفل' : '🟢 مفتوح'} — 🪄 تحسين احترافي`, callback_data: 'atoggle_btn_magic_enhance' }]").join(
  "[{ text: `${l.btn_magic_enhance ? '🔴 مقفل' : '🟢 مفتوح'} — 🪄 تحسين الصورة (AI)`, callback_data: 'atoggle_btn_magic_enhance' }]"
);
// Prompt 1: Reply text
cbContent = cbContent.split("'🪤 تحسين احترافي بالذكاء الاصطناعي\\n\\n' +").join(
  "'🪄 <b>تحسين الصورة (AI)</b>\\n\\n' +"
);
cbContent = cbContent.split("'🪄 تحسين احترافي بالذكاء الاصطناعي\\n\\n' +").join(
  "'🪄 <b>تحسين الصورة (AI)</b>\\n\\n' +"
);
// Prompt 2: Cancel button style
cbContent = cbContent.split("inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'cancel_magic_enhance' }]]").join(
  "inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'cancel_magic_enhance', style: 'danger' as any }]]"
);
setFileContent(cbFile, cbContent);
console.log('Fixed callbackHandler.ts');

// ==========================================
// FIX IMAGE HANDLER (Prompt 1 & Prompt 2)
// ==========================================
let imgFile = 'src/bot/handlers/imageHandler.ts';
let imgContent = getFileContent(imgFile);

// Prompt 2: Replace animations block ONLY INSIDE magic_enhance block
const magicMarker = "if (user?.awaitingMagicEnhanceImage) {";
let magicStart = imgContent.indexOf(magicMarker);
if (magicStart !== -1) {
    let animStartStr = "const processingMsg = await ctx.reply(";
    let animEndStr = "}, 8000);";
    
    let animStart = imgContent.indexOf(animStartStr, magicStart);
    if (animStart !== -1) {
        let animEnd = imgContent.indexOf(animEndStr, animStart);
        if (animEnd !== -1) {
            const newAnimBlock = `const processingMsg = await ctx.reply(
      '⏳ <b>يرجى الانتظار...</b>\\n\\n' +
      'الذكاء الاصطناعي يعمل الآن على توليد نسختك الاحترافية ✨\\n\\n' +
      '⚠️ <i>قد تستغرق عملية التحسين 5 دقائق، في حال تعدى هذا الوقت ولم تصلك الصورة، يرجى رفع بلاغ وسيتم تعويضك فوراً.</i>',
      { parse_mode: 'HTML' }
    );

    const animations = [
      '🔍 الصور الآن في المرحلة الأولى: جاري دراسة الملامح والتفاصيل...',
      '🤖 البوت يدرس الصورة ويحلل الإضاءة والظلال المعقدة...',
      '✨ البوت يتجهز لتصفية البكسلة ورفع الجودة إلى أقصى حد...',
      '🎨 يتم الآن دمج الواقعية العالية مع الحفاظ على روح الصورة الأصلية...',
      '🚀 اللمسات الأخيرة... نسختك الاحترافية تكاد تكون جاهزة!'
    ];
    let animIdx = 0;
    const animInterval = setInterval(async () => {
      if (animIdx < animations.length) {
        await ctx.api.editMessageText(
          processingMsg.chat.id,
          processingMsg.message_id,
          animations[animIdx++] + '\\n\\n⚠️ <i>قد تستغرق عملية التحسين 5 دقائق، في حال تعدى هذا الوقت ولم تصلك الصورة، يرجى رفع بلاغ وسيتم تعويضك.</i>',
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }
    }, 10000);`;
            
            imgContent = imgContent.substring(0, animStart) + newAnimBlock + imgContent.substring(animEnd + animEndStr.length);
        }
    }
}

// Prompt 1 & 2: Timeout to 300_000
imgContent = imgContent.replace(
  /if\s*\(Date\.now\(\)\s*-\s*startTime\s*>\s*(120_000|300_000)\)\s*throw\s*new\s*Error\('timeout'\);[^\n]*/g,
  "if (Date.now() - startTime > 300_000) throw new Error('timeout');"
);

setFileContent(imgFile, imgContent);
console.log('Fixed imageHandler.ts');

