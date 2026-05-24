const fs = require('fs');
let lines = fs.readFileSync('src/index.ts', 'utf8').split('\n');
let idx = -1;
for(let i=0; i<lines.length; i++) {
  if (lines[i].includes("registerDocCallback('cancel', 'cancel'")) {
    idx = i;
    break;
  }
}
if (idx !== -1) {
  const insertContent = `// ── pages_locked: locked page button handler ──
registerDocCallback('pages_locked', 'pages_locked', async (ctx) => {
  await ctx.answerCallbackQuery({
    text: '🔒 هذا الزر مقفل من قبل الادمن — اختر زر تلقائي',
    show_alert: true
  }).catch(() => {});
});
`;
  lines.splice(idx, 0, insertContent);
  fs.writeFileSync('src/index.ts', lines.join('\n'));
  console.log('Successfully injected pages_locked before cancel');
} else {
  console.log('Could not find cancel callback');
}
