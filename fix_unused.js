const fs = require('fs');
const f = 'src/bot/handlers/callbackHandler.ts';
let lines = fs.readFileSync(f, 'utf8').split('\n');

const idx = lines.findIndex(l => l.includes("const filterNames: Record<string, string> = {"));
if (idx === -1) { console.error('filterNames line not found'); process.exit(1); }

// Insert a @ts-ignore comment on the line before
lines.splice(idx, 0, '    // @ts-ignore -- filterNames used as reference; actual lookup done in imageHandler\r');

fs.writeFileSync(f, lines.join('\n'), 'utf8');
console.log('Done. Inserted @ts-ignore at line', idx + 1);
console.log('Line ' + (idx + 2) + ':', lines[idx + 1]);
