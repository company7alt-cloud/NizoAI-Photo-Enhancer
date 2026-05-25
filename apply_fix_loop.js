const fs = require('fs');
const path = require('path');

function getFileContent(filePath) {
    return fs.readFileSync(path.join(__dirname, filePath), 'utf8');
}
function setFileContent(filePath, content) {
    fs.writeFileSync(path.join(__dirname, filePath), content, 'utf8');
}

let imgFile = 'src/bot/handlers/imageHandler.ts';
let imgContent = getFileContent(imgFile);

// ==========================================
// FIX 1: Animations and Disclaimer
// ==========================================
const magicMarker = "if (user?.awaitingMagicEnhanceImage) {";
let magicStart = imgContent.indexOf(magicMarker);
if (magicStart !== -1) {
    let animStartStr = "const processingMsg = await ctx.reply(";
    let animEndStr = "}, 10000);"; // Based on the previous session where we updated the interval
    
    let animStart = imgContent.indexOf(animStartStr, magicStart);
    if (animStart !== -1) {
        let animEnd = imgContent.indexOf(animEndStr, animStart);
        if (animEnd !== -1) {
            // Also account for the possibility of a trailing comment in the old string
            const fullEndStr = imgContent.substring(animEnd, imgContent.indexOf('\\n', animEnd));
            let finalEndIdx = animEnd + animEndStr.length;
            if (imgContent.substring(animEnd, animEnd + 30).includes('// 10 seconds interval')) {
                finalEndIdx = imgContent.indexOf('// 10 seconds interval', animEnd) + '// 10 seconds interval'.length;
            } else if (imgContent.substring(animEnd, animEnd + 30).includes('// 8 seconds interval')) {
                 finalEndIdx = imgContent.indexOf('// 8 seconds interval', animEnd) + '// 8 seconds interval'.length;
            }

            const newAnimBlock = `const processingMsg = await ctx.reply(
      '⏳ <b>يرجى الانتظار...</b>\\n\\n' +
      'الذكاء الاصطناعي يعمل الآن على توليد نسختك الاحترافية ✨\\n\\n' +
      '⚠️ <i>قد تستغرق عملية التحسين حتى 15 دقيقة، في حال تعدى هذا الوقت ولم تصلك الصورة، يرجى رفع بلاغ وسيتم تعويضك فوراً.</i>',
      { parse_mode: 'HTML' }
    );

    const animations = [
      '🔍 جاري تهيئة خوادم الذكاء الاصطناعي لاستقبال الصورة .',
      '🤖 يتم الآن تحليل تفاصيل الصورة بدقة عالية ..',
      '✨ جاري معالجة الإضاءة والظلال المعقدة ...',
      '🎨 يتم الآن دمج الواقعية العالية مع الملامح الأصلية .',
      '⏳ جاري تحسين جودة البكسلات وإبراز الملمس ..',
      '⚙️ الذكاء الاصطناعي يقوم باللمسات قبل النهائية ...',
      '🚀 جاري تجهيز نسختك الاحترافية للعرض .',
      '🌟 اللمسات الأخيرة... يرجى الانتظار قليلاً ..'
    ];
    let animIdx = 0;
    const animInterval = setInterval(async () => {
      // Loop through the array infinitely using modulo
      const currentAnim = animations[animIdx++ % animations.length];
      await ctx.api.editMessageText(
        processingMsg.chat.id,
        processingMsg.message_id,
        currentAnim + '\\n\\n⚠️ <i>قد تستغرق عملية التحسين حتى 15 دقيقة، في حال تعدى هذا الوقت ولم تصلك الصورة، يرجى رفع بلاغ وسيتم تعويضك.</i>',
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }, 10000); // 10 seconds interval`;
            
            imgContent = imgContent.substring(0, animStart) + newAnimBlock + imgContent.substring(finalEndIdx);
            console.log('Fixed Animations block');
        } else {
            console.error('animEndStr not found');
        }
    } else {
        console.error('animStartStr not found');
    }
} else {
    console.error('magicMarker not found');
}

// ==========================================
// FIX 2: Timeout to 600_000
// ==========================================
// Replace 300_000 or 120_000 with 600_000 inside the polling loop
imgContent = imgContent.replace(
  /if\s*\(Date\.now\(\)\s*-\s*startTime\s*>\s*(120_000|300_000)\)\s*throw\s*new\s*Error\('timeout'\);[^\n]*/g,
  "if (Date.now() - startTime > 600_000) throw new Error('timeout'); // 10 minutes timeout for cold boots"
);
console.log('Fixed Timeout');

setFileContent(imgFile, imgContent);
