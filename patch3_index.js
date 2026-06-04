// patch3_index.js — Applies PATCH 3A, 3B, 3C to src/index.ts using line numbers
const fs = require('fs');
const path = require('path');

const filepath = path.join(__dirname, 'src', 'index.ts');
const content = fs.readFileSync(filepath, 'utf8');
const lines = content.split('\n');

console.log(`Total lines: ${lines.length}`);

let changed = false;

// ── PATCH 3A: processingMsg string (around line 1215) ──
// Find the 4-line block: const processingMsg = await ctx.reply(  ...  );
for (let i = 0; i < lines.length - 3; i++) {
  if (
    lines[i].includes("const processingMsg = await ctx.reply(") &&
    lines[i + 2].trim() === "{ parse_mode: 'HTML' }" &&
    lines[i + 3].trim() === ");"
  ) {
    // Only replace the internet fetcher one (near line 1215), not others.
    // Check that line i+1 contains 'ط¬ط§ط±ظ' or a similar garbled Arabic for "جاري فحص"
    if (lines[i + 1].includes('\u062c\u0627\u0631\u064a \u0641\u062d\u0635') ||
        lines[i + 1].includes('\u062c\u0627\u0631\u064a \u0645\u0639\u0627\u0644\u062c\u0629') ||
        (i > 1200 && i < 1230)) {
      lines[i]     = "    const processingMsg = await ctx.reply(";
      lines[i + 1] = "      '\uD83C\uDF10 <b>\u062c\u0627\u0631\u064a \u0645\u0639\u0627\u0644\u062c\u0629 \u0627\u0644\u0631\u0627\u0628\u0637...</b>\\n\\n' +";
      // We need to insert extra lines, so splice
      const replacement = [
        "    const processingMsg = await ctx.reply(",
        "      '\uD83C\uDF10 <b>\u062c\u0627\u0631\u064a \u0645\u0639\u0627\u0644\u062c\u0629 \u0627\u0644\u0631\u0627\u0628\u0637...</b>\\n\\n' +",
        "      '\u2699\uFE0F \u064a\u062a\u0645 \u0627\u0644\u0622\u0646 \u062a\u062d\u0644\u064a\u0644 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a \u0648\u0627\u0633\u062a\u062e\u0631\u0627\u062c \u0627\u0644\u0635\u0648\u0631\u0629 \u0628\u0623\u0639\u0644\u0649 \u062c\u0648\u062f\u0629 \u0645\u062a\u0627\u062d\u0629\\n' +",
        "      '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\\n' +",
        "      '\u23F1 \u0642\u062f \u062a\u0633\u062a\u063a\u0631\u0642 \u0627\u0644\u0639\u0645\u0644\u064a\u0629 30-60 \u062b\u0627\u0646\u064a\u0629...',",
        "      { parse_mode: 'HTML' }",
        "    );"
      ];
      lines.splice(i, 4, ...replacement);
      console.log(`✅ PATCH 3A applied at line ${i + 1}`);
      changed = true;
      break;
    }
  }
}

if (!changed) {
  // Fallback: target by exact line number range (1215-1218, 0-indexed 1214-1217)
  const idx = 1214;
  if (lines[idx] && lines[idx].includes("const processingMsg = await ctx.reply(")) {
    const replacement = [
      "    const processingMsg = await ctx.reply(",
      "      '\uD83C\uDF10 <b>\u062c\u0627\u0631\u064a \u0645\u0639\u0627\u0644\u062c\u0629 \u0627\u0644\u0631\u0627\u0628\u0637...</b>\\n\\n' +",
      "      '\u2699\uFE0F \u064a\u062a\u0645 \u0627\u0644\u0622\u0646 \u062a\u062d\u0644\u064a\u0644 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a \u0648\u0627\u0633\u062a\u062e\u0631\u0627\u062c \u0627\u0644\u0635\u0648\u0631\u0629 \u0628\u0623\u0639\u0644\u0649 \u062c\u0648\u062f\u0629 \u0645\u062a\u0627\u062d\u0629\\n' +",
      "      '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\\n' +",
      "      '\u23F1 \u0642\u062f \u062a\u0633\u062a\u063a\u0631\u0642 \u0627\u0644\u0639\u0645\u0644\u064a\u0629 30-60 \u062b\u0627\u0646\u064a\u0629...',",
      "      { parse_mode: 'HTML' }",
      "    );"
    ];
    lines.splice(idx, 4, ...replacement);
    console.log(`✅ PATCH 3A (fallback) applied at line ${idx + 1}`);
    changed = true;
  }
}

if (!changed) {
  console.error('❌ PATCH 3A: block not found');
  process.exit(1);
}

// ── PATCH 3B: caption inside replyWithDocument(imageBuffer) ──
changed = false;
for (let i = 0; i < lines.length - 8; i++) {
  if (
    lines[i].includes("await ctx.replyWithDocument(new InputFile(imageBuffer, fileName), {") &&
    lines[i + 1].trim().startsWith("caption:")
  ) {
    // Find end of caption block (line before parse_mode:)
    let j = i + 2;
    while (j < lines.length && !lines[j].trim().startsWith("parse_mode:")) j++;
    // Replace lines i+1 .. j-1 with new caption
    const newCaption = [
      "        caption:",
      "          '\u2705 <b>\u062a\u0645 \u0627\u0633\u062a\u062e\u0631\u0627\u062c \u0627\u0644\u0635\u0648\u0631\u0629 \u0628\u0646\u062c\u0627\u062d!</b>\\n\\n' +",
      "          '\uD83D\uDC8E \u0627\u0644\u062c\u0648\u062f\u0629: \u0623\u0639\u0644\u0649 \u062f\u0642\u0629 \u0623\u0635\u0644\u064a\u0629 \u0645\u062a\u0627\u062d\u0629\\n' +",
      "          '\uD83D\uDCC1 \u062a\u0645 \u0627\u0644\u0625\u0631\u0633\u0627\u0644 \u0643\u0645\u0644\u0641 \u0644\u0644\u062d\u0641\u0627\u0638 \u0639\u0644\u0649 \u0627\u0644\u062c\u0648\u062f\u0629 \u0627\u0644\u0643\u0627\u0645\u0644\u0629',"
    ];
    lines.splice(i + 1, j - i - 1, ...newCaption);
    console.log(`✅ PATCH 3B applied at line ${i + 1}`);
    changed = true;
    break;
  }
}

if (!changed) {
  console.error('❌ PATCH 3B: replyWithDocument caption not found');
  process.exit(1);
}

// ── PATCH 3C: catch block body ──
changed = false;
for (let i = 0; i < lines.length - 5; i++) {
  if (
    lines[i].includes("} catch (err: unknown) {") &&
    lines[i + 1].includes("clearInterval(fetchInterval);")
  ) {
    // Find end of catch block using brace depth
    let j = i + 1;
    let depth = 1;
    while (j < lines.length && depth > 0) {
      for (const ch of lines[j]) {
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
      }
      if (depth > 0) j++;
    }
    const newCatch = [
      "    } catch (err: any) {",
      "      const errMsg: string = (err?.message ?? '').toUpperCase();",
      "",
      "      clearInterval(fetchInterval);",
      "      await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id).catch(() => {});",
      "      console.error('[ImageFetcher-v10]', (err as Error).message);",
      "",
      "      if (",
      "        errMsg.includes('VIP_PROXIES_EXHAUSTED') ||",
      "        errMsg.includes('CORRUPTED')             ||",
      "        errMsg.includes('HTML')",
      "      ) {",
      "        await ctx.reply(",
      "          '\u274C <b>\u062a\u0639\u0630\u0651\u0631 \u0627\u0633\u062a\u062e\u0631\u0627\u062c \u0627\u0644\u0635\u0648\u0631\u0629 \u0645\u0646 \u0647\u0630\u0627 \u0627\u0644\u0631\u0627\u0628\u0637.</b>\\n\\n' +",
      "          '\u0642\u062f \u062a\u0643\u0648\u0646 \u0627\u0644\u0635\u0648\u0631\u0629 \u0645\u062d\u0645\u064a\u0629 \u0628\u0642\u064a\u0648\u062f \u0627\u0644\u0648\u0635\u0648\u0644\u060c \u0623\u0648 \u0623\u0646 \u0627\u0644\u0631\u0627\u0628\u0637 \u063a\u064a\u0631 \u0645\u062f\u0639\u0648\u0645 \u062d\u0627\u0644\u064a\u0627\u064b.\\n' +",
      "          '\u064a\u0631\u062c\u0649 \u062a\u062c\u0631\u0628\u0629 \u0631\u0627\u0628\u0637 \u0645\u062e\u062a\u0644\u0641 \u0623\u0648 \u0631\u0641\u0639 \u0627\u0644\u0635\u0648\u0631\u0629 \u0645\u0628\u0627\u0634\u0631\u0629 \uD83D\uDD17',",
      "          { parse_mode: 'HTML' }",
      "        );",
      "      } else if (",
      "        errMsg.includes('TIMEOUT') ||",
      "        errMsg.includes('TIME_OUT')",
      "      ) {",
      "        await ctx.reply(",
      "          '\u23F3 <b>\u0627\u0646\u062a\u0647\u062a \u0645\u0647\u0644\u0629 \u0627\u0644\u0627\u062a\u0635\u0627\u0644 \u0628\u0627\u0644\u062e\u0627\u062f\u0645.</b>\\n\\n' +",
      "          '\u0627\u0644\u0645\u0635\u062f\u0631 \u0644\u0627 \u064a\u0633\u062a\u062c\u064a\u0628 \u062d\u0627\u0644\u064a\u0627\u064b \u0623\u0648 \u0623\u0646 \u062d\u062c\u0645 \u0627\u0644\u0645\u0644\u0641 \u0643\u0628\u064a\u0631 \u062c\u062f\u0627\u064b.\\n' +",
      "          '\u064a\u0631\u062c\u0649 \u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0629 \u0645\u062c\u062f\u062f\u0627\u064b \u0628\u0639\u062f \u0642\u0644\u064a\u0644 \u26A1',",
      "          { parse_mode: 'HTML' }",
      "        );",
      "      } else if (errMsg.includes('ALL_LAYERS_EXHAUSTED')) {",
      "        await ctx.reply(",
      "          '\u26A0\uFE0F <b>\u0644\u0645 \u064a\u062a\u0645\u0643\u0646 \u0627\u0644\u0646\u0638\u0627\u0645 \u0645\u0646 \u0627\u0633\u062a\u062e\u0631\u0627\u062c \u0627\u0644\u0635\u0648\u0631\u0629.</b>\\n\\n' +",
      "          '\u0647\u0630\u0627 \u0627\u0644\u0631\u0627\u0628\u0637 \u0644\u0627 \u064a\u062f\u0639\u0645 \u0627\u0644\u0627\u0633\u062a\u062e\u0631\u0627\u062c \u0627\u0644\u0645\u0628\u0627\u0634\u0631.\\n' +",
      "          '\u064a\u0631\u062c\u0649 \u0631\u0641\u0639 \u0627\u0644\u0635\u0648\u0631\u0629 \u064a\u062f\u0648\u064a\u0627\u064b \u0623\u0648 \u062a\u062c\u0631\u0628\u0629 \u0631\u0627\u0628\u0637 \u0622\u062e\u0631 \uD83D\uDCCE',",
      "          { parse_mode: 'HTML' }",
      "        );",
      "      } else {",
      "        await ctx.reply(",
      "          '\u26A0\uFE0F <b>\u062d\u062f\u062b \u062e\u0637\u0623 \u0623\u062b\u0646\u0627\u0621 \u0645\u0639\u0627\u0644\u062c\u0629 \u0627\u0644\u0631\u0627\u0628\u0637.</b>\\n\\n' +",
      "          '\u064a\u0631\u062c\u0649 \u0627\u0644\u062a\u0623\u0643\u062f \u0645\u0646 \u0635\u062d\u0629 \u0627\u0644\u0631\u0627\u0628\u0637 \u0648\u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0629 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649 \uD83D\uDD04',",
      "          { parse_mode: 'HTML' }",
      "        );",
      "      }",
      "    }"
    ];
    lines.splice(i, j - i + 1, ...newCatch);
    console.log(`✅ PATCH 3C applied at line ${i + 1}`);
    changed = true;
    break;
  }
}

if (!changed) {
  console.error('❌ PATCH 3C: catch block not found');
  process.exit(1);
}

fs.writeFileSync(filepath, lines.join('\n'), 'utf8');
console.log('\n✅ All PATCH 3 sub-patches applied. File saved as UTF-8.');
