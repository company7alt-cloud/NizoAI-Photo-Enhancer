const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src/bot/handlers/docMakerHandler.ts');
let content = fs.readFileSync(file, 'utf8');

// FIX 1 — INJECT PHOTO GUARD FOR TEXT MODE
const fix1_old = `async function handleDocMakerMessageInner(ctx: BotContext): Promise<boolean> {
  if (!ctx.session || !ctx.from) return false;`;
const fix1_new = `async function handleDocMakerMessageInner(ctx: BotContext): Promise<boolean> {
  if (!ctx.session || !ctx.from) return false;

  // ── Shield to strictly block images in Automatic (Text) Mode ──
  if (ctx.message?.photo || ctx.message?.document) {
    if (ctx.session.docType === 'text') {
      await ctx.reply('⚠️ <b>عذراً، النسخة التلقائية تدعم إضافة النصوص فقط 📝.</b>\\nلإضافة صور وتنسيقها، يرجى إنهاء هذه الجلسة والبدء بمستند جديد واختيار <b>النسخة الاحترافية ✨</b>.', { parse_mode: 'HTML' });
      return true; // Halt processing
    }
    // If it's professional mode (image), let it pass smoothly to the image handler
  }`;

if (content.includes(fix1_old)) {
    content = content.replace(fix1_old, fix1_new);
    console.log('Fix 1 applied successfully.');
} else {
    console.error('Fix 1 text not found.');
}

// FIX 2 — REMOVE IMAGE HINT FROM INSTRUCTIONS
const fix2_old = `✏️ <b>إضافة نص:</b> أرسل النص مباشرة
🖼 <b>إضافة صورة:</b> أرسل الصورة مباشرة
📏 <b>سطر فارغ واحد:</b> أرسل نقطة  .`;
const fix2_new = `✏️ <b>إضافة نص:</b> أرسل النص مباشرة
📏 <b>سطر فارغ واحد:</b> أرسل نقطة  .`;

if (content.includes(fix2_old)) {
    content = content.replace(fix2_old, fix2_new);
    console.log('Fix 2 applied successfully.');
} else {
    console.error('Fix 2 text not found.');
}

// FIX 3 — REMOVE HINT FROM EMPTY DOCUMENT
const fix3_old = `: \`📄 <b>المستند فارغ.</b>\\nأرسل نصاً أو صورة للبدء.\`;`;
const fix3_new = `: \`📄 <b>المستند فارغ.</b>\\nأرسل نصاً للبدء.\`;`;

if (content.includes(fix3_old)) {
    content = content.replace(fix3_old, fix3_new);
    console.log('Fix 3 applied successfully.');
} else {
    console.error('Fix 3 text not found.');
}

// FIX 4 — REMOVE HINT FROM APPLY FORMATTING
const fix4_old = `'أرسل نصاً أو صورة، أو اضغط تصدير.',`;
const fix4_new = `'أرسل نصاً إضافياً، أو اضغط تصدير.',`;

// Replace all occurrences just in case, but probably only one or two
if (content.includes(fix4_old)) {
    content = content.split(fix4_old).join(fix4_new);
    console.log('Fix 4 applied successfully.');
} else {
    console.error('Fix 4 text not found.');
}

// FIX 5 — REMOVE HINT FROM FORMAT BACK
const fix5_old = `'↩️ <b>تم إلغاء النص.</b>\\nأرسل نصاً جديداً أو صورة.',`;
const fix5_new = `'↩️ <b>تم إلغاء النص.</b>\\nأرسل نصاً جديداً.',`;

if (content.includes(fix5_old)) {
    content = content.replace(fix5_old, fix5_new);
    console.log('Fix 5 applied successfully.');
} else {
    console.error('Fix 5 text not found.');
}

// FIX 6 — REMOVE HINT FROM BACK TO SESSION
const fix6_old = `'↩️ <b>عدت للجلسة.</b>\\nأرسل نصاً أو صورة، أو اضغط تصدير.',`;
const fix6_new = `'↩️ <b>عدت للجلسة.</b>\\nأرسل نصاً، أو اضغط تصدير.',`;

if (content.includes(fix6_old)) {
    content = content.replace(fix6_old, fix6_new);
    console.log('Fix 6 applied successfully.');
} else {
    console.error('Fix 6 text not found.');
}

fs.writeFileSync(file, content, 'utf8');
console.log('All replacements finished.');
