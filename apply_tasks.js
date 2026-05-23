const fs = require('fs');

// ── TASK 3: validators.ts — append activeFilter to SessionData ────────────────
{
  const path = 'src/utils/validators.ts';
  const lines = fs.readFileSync(path, 'utf8').split('\n');

  // Find line with currentService (line 151, 0-indexed: 150)
  let insertIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('currentService') && lines[i].includes('string | null')) {
      insertIdx = i + 1; // Insert AFTER this line
      break;
    }
  }

  if (insertIdx === -1) {
    console.error('TASK3: Could not find currentService line in validators.ts!');
    process.exit(1);
  }

  console.log(`TASK3: Inserting activeFilter after line ${insertIdx} (0-indexed)`);
  const insertion = ['  activeFilter?: string;'];
  lines.splice(insertIdx, 0, ...insertion);

  fs.writeFileSync(path, lines.join('\n'), 'utf8');
  console.log('TASK3: ✅ activeFilter added to validators.ts');
}

// ── TASK 1: index.ts — inject PHOTO GUARD after isAdm line ───────────────────
{
  const path = 'src/index.ts';
  const lines = fs.readFileSync(path, 'utf8').split('\n');

  // Find the specific isAdm line inside imageBot.on([':photo', ':document']
  // It's the one at original line 1185 — we identify it by checking context:
  // The line before it must contain "adminIds = ...split(',').map(id => id.trim())"
  // and two lines AFTER it must be blank (lines 1186-1188 are \r or empty)
  let insertIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (
      lines[i].includes("const isAdm = adminIds.includes(telegramId || '')") &&
      lines[i-1] && lines[i-1].includes("split(',').map(id => id.trim())") &&
      lines[i+1] && (lines[i+1].trim() === '' || lines[i+1].trim() === '\r')
    ) {
      insertIdx = i + 1; // Insert AFTER the isAdm line
      break;
    }
  }

  if (insertIdx === -1) {
    console.error('TASK1: Could not find the correct isAdm injection point!');
    // Show all matching lines for debug
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("const isAdm = adminIds.includes")) {
        console.log(`  Line ${i+1}: ${lines[i]}`);
        console.log(`  Line ${i}: ${lines[i-1]}`);
        console.log(`  Line ${i+2}: ${lines[i+1]}`);
      }
    }
    process.exit(1);
  }

  console.log(`TASK1: Injecting PHOTO GUARD after line ${insertIdx} (0-indexed)`);

  const hasCR = lines[insertIdx] && lines[insertIdx].endsWith('\r');
  const cr = hasCR ? '\r' : '';

  const guardLines = [
    `  // \u2500\u2500 PHOTO GUARD: block photos sent before selecting a service \u2500\u2500${cr}`,
    `  if (!isAdm && !user?.supportSessionActive) {${cr}`,
    `    const hasActiveFlow =${cr}`,
    `      ctx.session?.activeFilter ||${cr}`,
    `      ctx.session?.awaitingImage ||${cr}`,
    `      ctx.session?.pendingConversionFileId ||${cr}`,
    `      ctx.session?.awaitingCustomWidth ||${cr}`,
    `      ctx.session?.awaitingCustomHeight;${cr}`,
    `${cr}`,
    `    if (!hasActiveFlow) {${cr}`,
    `      await ctx.reply(${cr}`,
    `        '\u26a0\ufe0f <b>\u064a\u0631\u062c\u0649 \u0627\u062e\u062a\u064a\u0627\u0631 \u0627\u0644\u062e\u062f\u0645\u0629 \u0623\u0648\u0644\u0627\u064b!</b>\\n\\n' +${cr}`,
    `        '\u0644\u0627 \u064a\u0645\u0643\u0646 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0635\u0648\u0631 \u0645\u0628\u0627\u0634\u0631\u0629.\\n' +${cr}`,
    `        '\u0627\u062e\u062a\u0631 \u0625\u062d\u062f\u0649 \u0627\u0644\u062e\u062f\u0645\u0627\u062a \u0645\u0646 \u0627\u0644\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0631\u0626\u064a\u0633\u064a\u0629 \u0623\u0648\u0644\u0627\u064b \ud83d\udc46',${cr}`,
    `        { parse_mode: 'HTML' }${cr}`,
    `      );${cr}`,
    `      return;${cr}`,
    `    }${cr}`,
    `  }${cr}`,
    `  // \u2500\u2500 END PHOTO GUARD \u2500\u2500${cr}`,
  ];

  lines.splice(insertIdx, 0, ...guardLines);
  fs.writeFileSync(path, lines.join('\n'), 'utf8');
  console.log('TASK1: ✅ PHOTO GUARD injected into index.ts');
}

// ── TASK 2: index.ts — insert filter callbacks BEFORE callbackHandler line ────
{
  const path = 'src/index.ts';
  const lines = fs.readFileSync(path, 'utf8').split('\n');

  // Find: imageBot.callbackQuery(/.*/, callbackHandler);
  let insertIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('imageBot.callbackQuery') && lines[i].includes('callbackHandler')) {
      insertIdx = i; // Insert BEFORE this line
      break;
    }
  }

  if (insertIdx === -1) {
    console.error('TASK2: Could not find imageBot.callbackQuery(/.*/,callbackHandler) line!');
    process.exit(1);
  }

  console.log(`TASK2: Inserting filter callbacks before line ${insertIdx + 1} (1-indexed)`);

  const hasCR = lines[insertIdx] && lines[insertIdx].endsWith('\r');
  const cr = hasCR ? '\r' : '';

  const filterCallbacks = [
    `// \u2500\u2500\u2500 Filter button callbacks (TASK 2) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${cr}`,
    `${cr}`,
    `imageBot.callbackQuery('filter_face', async (ctx) => {${cr}`,
    `  await ctx.answerCallbackQuery();${cr}`,
    `  ctx.session.activeFilter = 'face';${cr}`,
    `  await ctx.reply(${cr}`,
    `    '\ud83d\udc64 <b>\u0641\u0644\u062a\u0631 \u062a\u0635\u0641\u064a\u0629 \u0627\u0644\u0648\u062c\u0647</b>\\n\\n\u0623\u0631\u0633\u0644 \u0627\u0644\u0635\u0648\u0631\u0629 \u0627\u0644\u0622\u0646 \u0648\u0633\u064a\u062a\u0645 \u062a\u062d\u0633\u064a\u0646 \u0627\u0644\u0645\u0644\u0627\u0645\u062d \u062a\u0644\u0642\u0627\u0626\u064a\u0627\u064b:',${cr}`,
    `    { parse_mode: 'HTML' }${cr}`,
    `  );${cr}`,
    `});${cr}`,
    `${cr}`,
    `imageBot.callbackQuery('filter_color', async (ctx) => {${cr}`,
    `  await ctx.answerCallbackQuery();${cr}`,
    `  ctx.session.activeFilter = 'color';${cr}`,
    `  await ctx.reply(${cr}`,
    `    '\ud83c\udfa8 <b>\u0641\u0644\u062a\u0631 \u062a\u0644\u0648\u064a\u0646 \u0627\u0644\u0635\u0648\u0631 \u0627\u0644\u0642\u062f\u064a\u0645\u0629</b>\\n\\n\u0623\u0631\u0633\u0644 \u0635\u0648\u0631\u062a\u0643 \u0627\u0644\u0623\u0628\u064a\u0636 \u0648\u0627\u0644\u0623\u0633\u0648\u062f \u0648\u0633\u064a\u062a\u0645 \u062a\u0644\u0648\u064a\u0646\u0647\u0627:',${cr}`,
    `    { parse_mode: 'HTML' }${cr}`,
    `  );${cr}`,
    `});${cr}`,
    `${cr}`,
    `imageBot.callbackQuery('filter_anime', async (ctx) => {${cr}`,
    `  await ctx.answerCallbackQuery();${cr}`,
    `  ctx.session.activeFilter = 'anime';${cr}`,
    `  await ctx.reply(${cr}`,
    `    '\ud83c\udf38 <b>\u0641\u0644\u062a\u0631 \u062a\u062d\u0648\u064a\u0644 \u0623\u0646\u0645\u064a</b>\\n\\n\u0623\u0631\u0633\u0644 \u0635\u0648\u0631\u062a\u0643 \u0648\u0633\u064a\u062a\u0645 \u062a\u062d\u0648\u064a\u0644\u0647\u0627 \u0644\u0623\u0646\u0645\u064a \u0627\u062d\u062a\u0631\u0627\u0641\u064a:',${cr}`,
    `    { parse_mode: 'HTML' }${cr}`,
    `  );${cr}`,
    `});${cr}`,
    `${cr}`,
    `imageBot.callbackQuery('filter_ghibli', async (ctx) => {${cr}`,
    `  await ctx.answerCallbackQuery();${cr}`,
    `  ctx.session.activeFilter = 'ghibli';${cr}`,
    `  await ctx.reply(${cr}`,
    `    '\ud83c\udfad <b>\u0641\u0644\u062a\u0631 \u062a\u0623\u062b\u064a\u0631 \u062c\u064a\u0628\u0644\u064a</b>\\n\\n\u0623\u0631\u0633\u0644 \u0635\u0648\u0631\u062a\u0643 \u0648\u0633\u064a\u062a\u0645 \u062a\u0637\u0628\u064a\u0642 \u062a\u0623\u062b\u064a\u0631 \u062c\u064a\u0628\u0644\u064a \u0627\u0644\u0641\u0646\u064a:',${cr}`,
    `    { parse_mode: 'HTML' }${cr}`,
    `  );${cr}`,
    `});${cr}`,
    `${cr}`,
    `imageBot.callbackQuery('cancel_filter', async (ctx) => {${cr}`,
    `  await ctx.answerCallbackQuery();${cr}`,
    `  ctx.session.activeFilter = undefined;${cr}`,
    `  await ctx.deleteMessage().catch(() => {});${cr}`,
    `});${cr}`,
    `${cr}`,
  ];

  lines.splice(insertIdx, 0, ...filterCallbacks);
  fs.writeFileSync(path, lines.join('\n'), 'utf8');
  console.log('TASK2: ✅ Filter callbacks inserted before callbackHandler line');
}

console.log('\n✅ All three tasks applied. Run: npm run build');
