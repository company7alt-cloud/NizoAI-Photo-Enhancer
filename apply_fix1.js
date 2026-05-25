const fs = require('fs');

const ih_file = 'src/bot/handlers/imageHandler.ts';
let ihContent = fs.readFileSync(ih_file, 'utf8');

const startStr = "const processingMsg = await ctx.reply(";
const endStr = "}, 8000);";

// We need to find the specific block for Magic Enhance, which has "الذكاء الاصطناعي يعمل الآن"
const magicIndicator = "الذكاء الاصطناعي يعمل الآن";

let startIndex = ihContent.indexOf(startStr);
while (startIndex !== -1) {
    let endIndex = ihContent.indexOf(endStr, startIndex);
    if (endIndex !== -1) {
        const block = ihContent.substring(startIndex, endIndex + endStr.length);
        if (block.includes(magicIndicator)) {
            // Found it!
            const newFix1 = `const processingMsg = await ctx.reply(
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
    }, 10000); // 10 seconds interval`;

            ihContent = ihContent.substring(0, startIndex) + newFix1 + ihContent.substring(endIndex + endStr.length);
            fs.writeFileSync(ih_file, ihContent, 'utf8');
            console.log("REPLACED FIX 1 successfully in " + ih_file);
            break;
        }
    }
    startIndex = ihContent.indexOf(startStr, startIndex + 1);
}

