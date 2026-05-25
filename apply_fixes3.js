const fs = require('fs');

function replaceStr(file, oldStr, newStr) {
    let content = fs.readFileSync(file, 'utf8');
    if (!content.includes(oldStr)) {
        console.error("NOT FOUND in " + file + ":\\n" + oldStr);
        return;
    }
    content = content.replace(oldStr, newStr);
    fs.writeFileSync(file, content, 'utf8');
    console.log("REPLACED successfully in " + file);
}

// FIX 1
const ih_file = 'src/bot/handlers/imageHandler.ts';
const oldFix1 = `    const processingMsg = await ctx.reply(
      '⏳ يرجى الانتظار...\\n\\nالذكاء الاصطناعي يعمل الآن على توليد نسختك الاحترافية ✨',
      { parse_mode: 'HTML' }
    );

    const animations = [
      '🔄 جارٍ تحليل الصورة...\\n\\nالذكاء الاصطناعي يدرس التفاصيل الدقيقة ✨',
      '🎨 جارٍ إعادة التوليد...\\n\\nيتم تحسين الإضاءة والألوان والملمس ✨',
      '✨ اللمسات الأخيرة...\\n\\nنسختك الاحترافية تكاد تكون جاهزة 🚀',
    ];
    let animIdx = 0;
    const animInterval = setInterval(async () => {
      if (animIdx < animations.length) {
        await ctx.api.editMessageText(
          processingMsg.chat.id,
          processingMsg.message_id,
          animations[animIdx++],
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }
    }, 8000);`;

const newFix1 = `    const processingMsg = await ctx.reply(
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

replaceStr(ih_file, oldFix1, newFix1);

// FIX 2
// The line might have comments or might be 120_000
let ihContent = fs.readFileSync(ih_file, 'utf8');
const regexTimeout = /if\s*\(Date\.now\(\)\s*-\s*startTime\s*>\s*(120_000|300_000)\)\s*throw\s*new\s*Error\('timeout'\);[^\n]*/;
if(regexTimeout.test(ihContent)) {
    ihContent = ihContent.replace(regexTimeout, "if (Date.now() - startTime > 300_000) throw new Error('timeout');");
    fs.writeFileSync(ih_file, ihContent, 'utf8');
    console.log("REPLACED FIX 2 successfully in " + ih_file);
} else {
    console.error("FIX 2 target not found in " + ih_file);
}

// FIX 3
const ch_file = 'src/bot/handlers/callbackHandler.ts';
const oldFix3 = "inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'cancel_magic_enhance' }]]";
const newFix3 = "inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'cancel_magic_enhance', style: 'danger' as any }]]";
replaceStr(ch_file, oldFix3, newFix3);

