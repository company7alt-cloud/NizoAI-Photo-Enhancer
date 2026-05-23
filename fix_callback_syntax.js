const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/bot/handlers/callbackHandler.ts');
let lines = fs.readFileSync(filePath, 'utf8').split('\n');

// Lines are 1-indexed in the file; 0-indexed in the array
// Broken region: lines 121–134 (array indices 120–133)
// We replace indices 120–133 (14 lines) with the fixed block

const fixed = [
  "    const filterType = data.replace('filter_', '');\r",
  "    const cost = ['anime', 'ghibli'].includes(filterType) ? 3 : 2;\r",
  "\r",
  lines[120], // keep: "    const filterNames: Record<string, string> = {\r"
  lines[121], // keep: "      'filter_restore': ...,\r"
  lines[122], // keep: "      'filter_face': ...,\r"
  "      'filter_color': '\uD83C\uDFA8 \u062A\u0644\u0648\u064A\u0646 \u0627\u0644\u0635\u0648\u0631',\r",
  "      'filter_anime': '\uD83C\uDF38 \u062A\u062D\u0648\u064A\u0644 \u0623\u0646\u0645\u064A',\r",
  "      'filter_ghibli': ' \u062A\u0623\u062B\u064A\u0631 \u062C\u064A\u0628\u0644\u064A',\r",
  "    };\r",
  "\r",
  "    if (ctx.session) ctx.session.awaitingFilterAction = data;\r",
  "\r",
  lines[123], // keep: "    await ctx.editMessageText(\r"
  lines[124], // keep: "      `...أرسل الصورة الآن...`\r"
  lines[125], // keep: "      `...30-60 ثانية...`\r"
  lines[126], // keep: "      `...${cost}...`\r"
  lines[127], // keep: "      `...تُخصم...`\r"
  lines[128], // keep: "      {\r"
  lines[129], // keep: "        parse_mode: 'HTML',\r"
  lines[130], // keep: "        reply_markup: ...\r"
  lines[131], // keep: "      }\r"
  lines[132], // keep: "    ).catch(() => {});\r"
  lines[133], // keep: "    return;\r"
];

// Splice: remove indices 120–133 (14 lines), insert fixed block
lines.splice(120, 14, ...fixed);

fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
console.log('✅ Fix applied. New lines 119-150:');
const verify = fs.readFileSync(filePath, 'utf8').split('\n');
for (let i = 119; i <= 150; i++) {
  process.stdout.write((i + 1) + ': ' + verify[i] + '\n');
}
