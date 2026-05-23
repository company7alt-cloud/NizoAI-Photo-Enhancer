const fs = require('fs');

const path = 'src/index.ts';
let content = fs.readFileSync(path, 'utf8');

const lines = content.split('\n');

let startIndex = -1;
let endIndex = -1;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('// ── PHOTO GUARD: block photos sent before selecting a service ──') || lines[i].includes('// ── PHOTO GUARD ──')) {
    startIndex = i;
  }
  if (startIndex !== -1 && (lines[i].includes('// ── END PHOTO GUARD ──') || lines[i].includes('// ── END GUARD ──'))) {
    endIndex = i;
    break;
  }
}

if (startIndex !== -1 && endIndex !== -1) {
  console.log(`Found guard from line ${startIndex + 1} to ${endIndex + 1}`);
  
  const hasCR = lines[startIndex].endsWith('\r');
  const cr = hasCR ? '\r' : '';

  const newGuard = [
    `  // \u2500\u2500 PHOTO GUARD \u2500\u2500${cr}`,
    `  if (!isAdm && !user?.supportSessionActive) {${cr}`,
    `    const dbUser = await User.findOne({ telegramId: ctx.from?.id.toString() });${cr}`,
    `    const hasActiveFlow =${cr}`,
    `      ctx.session?.awaitingFilterAction ||${cr}`,
    `      ctx.session?.pendingFile ||${cr}`,
    `      ctx.session?.pendingConversionFileId ||${cr}`,
    `      ctx.session?.awaitingCustomWidth ||${cr}`,
    `      ctx.session?.awaitingCustomHeight ||${cr}`,
    `      dbUser?.awaitingFilterImage ||${cr}`,
    `      dbUser?.awaitingNanoBananaImage ||${cr}`,
    `      dbUser?.awaitingAutoEraserImage ||${cr}`,
    `      dbUser?.awaitingCustomEraserImage ||${cr}`,
    `      dbUser?.awaitingFormatConversion ||${cr}`,
    `      (dbUser?.proEnhanceSettings as any)?.isAwaitingImage;${cr}`,
    `${cr}`,
    `    if (!hasActiveFlow) {${cr}`,
    `      await ctx.reply(${cr}`,
    `        '\u26A0\uFE0F <b>\u064A\u0631\u062C\u0649 \u0627\u062E\u062A\u064A\u0627\u0631 \u0627\u0644\u062E\u062F\u0645\u0629 \u0623\u0648\u0644\u0627\u064B!</b>\\n\\n' +${cr}`,
    `        '\u0644\u0627 \u064A\u0645\u0643\u0646 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0635\u0648\u0631 \u0645\u0628\u0627\u0634\u0631\u0629.\\n' +${cr}`,
    `        '\u0627\u062E\u062A\u0631 \u0625\u062D\u062F\u0649 \u0627\u0644\u062E\u062F\u0645\u0627\u062A \u0645\u0646 \u0627\u0644\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629 \u0623\u0648\u0644\u0627\u064B \uD83D\uDC46',${cr}`,
    `        { parse_mode: 'HTML' }${cr}`,
    `      );${cr}`,
    `      return;${cr}`,
    `    }${cr}`,
    `  }${cr}`,
    `  // \u2500\u2500 END GUARD \u2500\u2500${cr}`
  ];

  lines.splice(startIndex, endIndex - startIndex + 1, ...newGuard);
  
  fs.writeFileSync(path, lines.join('\n'), 'utf8');
  console.log('✅ Photo Guard replaced successfully!');
} else {
  console.error('❌ Could not find PHOTO GUARD block in index.ts');
  process.exit(1);
}
