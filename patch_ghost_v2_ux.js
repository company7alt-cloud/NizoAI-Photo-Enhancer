// patch_ghost_v2_ux.js — Applies PATCH 1A and 1B to src/index.ts
const fs = require('fs');
const path = require('path');

const filepath = path.join(__dirname, 'src', 'index.ts');
const content = fs.readFileSync(filepath, 'utf8');
const lines = content.split('\n');

console.log(`Total lines: ${lines.length}`);

// ── PATCH 1A: Replace processingMsg block (lines 1215-1221, 0-indexed 1214-1220) ──
let found1a = false;
for (let i = 0; i < lines.length - 3; i++) {
  if (
    lines[i].includes("const processingMsg = await ctx.reply(") &&
    lines[i + 5] !== undefined &&
    lines[i + 5].trim() === ");" &&
    // Only the internet fetcher one (confirm by context: lines after it contain waitMessages)
    i > 1200 && i < 1240
  ) {
    // Find exact end of this reply() call
    let end = i + 1;
    while (end < lines.length && !lines[end].trim().startsWith(');')) end++;
    // Replace i..end (inclusive) with the new clean block
    const replacement = [
      "    const processingMsg = await ctx.reply(",
      "      '\u23F3 <b>\u062c\u0627\u0631\u064a \u0627\u0644\u0628\u062d\u062b \u0639\u0646 \u0627\u0644\u0635\u0648\u0631\u0629...</b>\\n\\n' +",
      "      '\u0644\u062d\u0638\u0627\u062a \u0645\u0646 \u0641\u0636\u0644\u0643\u060c \u064a\u062a\u0645 \u0627\u0644\u0622\u0646 \u062c\u0644\u0628 \u0627\u0644\u0635\u0648\u0631\u0629 \u0628\u0623\u0639\u0644\u0649 \u062c\u0648\u062f\u0629 \u0645\u062a\u0648\u0641\u0631\u0629 \uD83C\uDF10',",
      "      { parse_mode: 'HTML' }",
      "    );"
    ];
    lines.splice(i, end - i + 1, ...replacement);
    console.log(`\u2705 PATCH 1A applied at line ${i + 1}`);
    found1a = true;
    break;
  }
}

if (!found1a) {
  console.error('\u274C PATCH 1A: processingMsg block not found');
  process.exit(1);
}

// ── PATCH 1B: Replace entire catch block ──
let found1b = false;
for (let i = 0; i < lines.length - 5; i++) {
  if (
    lines[i].includes("} catch (err: any) {") &&
    lines[i + 1].includes("const errMsg: string") &&
    i > 1300 && i < 1380
  ) {
    // Find end of catch block by brace matching
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
      "      // Remove the waiting message quietly",
      "      clearInterval(fetchInterval);",
      "      await ctx.api.deleteMessage(ctx.chat!.id, processingMsg.message_id).catch(() => {});",
      "      console.error('[ImageFetcher-v10]', (err as Error).message);",
      "",
      "      // Send the unified, friendly apology message for ANY failure",
      "      await ctx.reply(",
      "        '\uD83E\uDD7A <b>\u0639\u0630\u0631\u0627\u064b\u060c \u0644\u0645 \u0646\u062a\u0645\u0643\u0646 \u0645\u0646 \u062c\u0644\u0628 \u0647\u0630\u0647 \u0627\u0644\u0635\u0648\u0631\u0629.</b>\\n\\n' +",
      "        '\u0627\u0637\u0645\u0626\u0646 \u064a\u0627 \u0635\u062f\u064a\u0642\u064a\u060c <b>\u062a\u0645 \u0625\u0631\u062c\u0627\u0639 \u0645\u062d\u0627\u0648\u0644\u062a\u0643 \u0648\u0644\u0646 \u064a\u062a\u0645 \u062e\u0635\u0645 \u0623\u064a \u0631\u0635\u064a\u062f \u0645\u0646\u0643</b> \uD83C\uDF81\\n\\n' +",
      "        '\u064a\u0631\u062c\u0649 \u0625\u0639\u0627\u062f\u0629 \u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0629 \u0628\u0631\u0627\u0628\u0637 \u0622\u062e\u0631\u060c \u0648\u0625\u0630\u0627 \u062a\u0643\u0631\u0631\u062a \u0627\u0644\u0645\u0634\u0643\u0644\u0629 \u0644\u0627 \u062a\u062a\u0631\u062f\u062f \u0641\u064a \u0641\u062a\u062d \u0628\u0644\u0627\u063a \u0648\u0645\u0631\u0627\u0633\u0644\u0629 \u0627\u0644\u0645\u0637\u0648\u0631 \uD83D\uDEE0\uFE0F',",
      "        { parse_mode: 'HTML' }",
      "      );",
      "    }"
    ];
    lines.splice(i, j - i + 1, ...newCatch);
    console.log(`\u2705 PATCH 1B applied at line ${i + 1}`);
    found1b = true;
    break;
  }
}

if (!found1b) {
  console.error('\u274C PATCH 1B: catch block not found');
  process.exit(1);
}

fs.writeFileSync(filepath, lines.join('\n'), 'utf8');
console.log('\n\u2705 All PATCH 1 sub-patches applied. File saved as UTF-8.');
