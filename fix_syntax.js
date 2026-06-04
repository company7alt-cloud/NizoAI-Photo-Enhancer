const fs = require('fs');
const path = 'c:/NizoAI-Bot/src/index.ts';
let content = fs.readFileSync(path, 'utf8');

const brokenLines = [
  "    if (!link.startsWith('http')) {",
  "      await ctx.reply('❌ يرجى إرسال رابط صحيح يبدأ بـ http');",
  "        { parse_mode: 'Markdown' },",
  "      );",
  "      return;",
  "    }"
];

const targetStr = brokenLines.join('\n');
const targetStrWindows = brokenLines.join('\r\n');

const replacement = `    if (!link.startsWith('http')) {
      await ctx.reply('❌ يرجى إرسال رابط صحيح يبدأ بـ http');
      return;
    }

    // ── Guard B: Kill-Switch ──
    const { isInternetFetcherEnabled: _ifeB } = await import('./utils/internetFetcherSettings');
    const fetcherAdminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
    const isFetcherAdmin = fetcherAdminIds.includes(ctx.from?.id?.toString() || '');

    // Allow passing if the feature is enabled OR if the user is an Admin
    if (!_ifeB() && !isFetcherAdmin) {
      await ctx.reply(
        \`🔧 *تحميل الصور من الإنترنت*\\n\\n\` +
        \`✨ هذه الميزة تحت الصيانة حالياً لتقديم تجربة أفضل لك!\\n\\n\` +
        \`🚀 سيتم إعادة تفعيلها قريباً إن شاء الله 🌟\\n\` +
        \`💙 نعتذر عن الإزعاج ونقدّر صبرك الجميل\`,
        { parse_mode: 'Markdown' },
      );
      return;
    }`;

if (content.includes(targetStr)) {
  content = content.replace(targetStr, replacement);
  console.log('Replaced using \\n');
} else if (content.includes(targetStrWindows)) {
  content = content.replace(targetStrWindows, replacement);
  console.log('Replaced using \\r\\n');
} else {
  console.log('Could not find the target block');
}

fs.writeFileSync(path, content, 'utf8');
