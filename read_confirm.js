const fs = require('fs');

// Find and show the exact pro_edit_confirm block in index.ts
const lines = fs.readFileSync('src/index.ts', 'utf8').split('\n');
const startIdx = lines.findIndex(l => l.includes("registerDocCallback('pro_edit_confirm'"));
if (startIdx === -1) { console.log('NOT FOUND'); process.exit(1); }

// Show 15 lines from there
for (let i = startIdx; i < Math.min(startIdx + 15, lines.length); i++) {
  console.log((i + 1) + ': ' + JSON.stringify(lines[i]));
}
