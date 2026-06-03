const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src/bot/handlers/docMakerHandler.ts');
let content = fs.readFileSync(file, 'utf8');

// FIX 1 — INJECT PHOTO GUARD FOR TEXT MODE
const fix1_regex = /async\s+function\s+handleDocMakerMessageInner\(ctx:\s+BotContext\):\s+Promise<boolean>\s*\{\s*if\s*\(!ctx\.session\s*\|\|\s*!ctx\.from\)\s*return\s*false;/;

if (fix1_regex.test(content)) {
  // We want to insert the guard right after this
  content = content.replace(fix1_regex, `async function handleDocMakerMessageInner(ctx: BotContext): Promise<boolean> {
  if (!ctx.session || !ctx.from) return false;

  // ── Shield to strictly block images in Automatic (Text) Mode ──
  if (ctx.message?.photo || ctx.message?.document) {
    if (ctx.session.docType === 'text') {
      await ctx.reply('⚠️ <b>عذراً، النسخة التلقائية تدعم إضافة النصوص فقط 📝.</b>\\nلإضافة صور وتنسيقها، يرجى إنهاء هذه الجلسة والبدء بمستند جديد واختيار <b>النسخة الاحترافية ✨</b>.', { parse_mode: 'HTML' });
      return true; // Halt processing
    }
    // If it's professional mode (image), let it pass smoothly to the image handler
  }`);
  console.log('Fix 1 applied successfully via regex.');
} else {
  console.error('Fix 1 text still not found via regex.');
}

// FIX 2 — REMOVE IMAGE HINT FROM INSTRUCTIONS
// Looks for:
// ✏️ <b>إضافة نص:</b> أرسل النص مباشرة
// 🖼 <b>إضافة صورة:</b> أرسل الصورة مباشرة
// 📏 <b>سطر فارغ واحد:</b> أرسل نقطة  .
const fix2_regex = /✏️\s*<b>إضافة نص:<\/b>\s*أرسل النص مباشرة\s*🖼\s*<b>إضافة صورة:<\/b>\s*أرسل الصورة مباشرة\s*📏\s*<b>سطر فارغ واحد:<\/b>\s*أرسل نقطة\s*\./;

if (fix2_regex.test(content)) {
  content = content.replace(fix2_regex, `✏️ <b>إضافة نص:</b> أرسل النص مباشرة\n📏 <b>سطر فارغ واحد:</b> أرسل نقطة  .`);
  console.log('Fix 2 applied successfully via regex.');
} else {
  console.error('Fix 2 text still not found via regex.');
  // Let's print the actual area if it fails
}

fs.writeFileSync(file, content, 'utf8');
console.log('Regex replacements finished.');
