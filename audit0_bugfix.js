const fs = require('fs');

const path = 'src/index.ts';
let content = fs.readFileSync(path, 'utf8');
const lines = content.split('\n');

const audit = { a: [], b: [], c: [] };

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  // A) Mode selection keyboard
  if (line.includes('free_pdf_auto') || line.includes('free_pdf_pro') || line.includes('nizo_pdf_auto') || line.includes('nizo_pdf_pro')) {
    if (line.includes('text:')) {
      audit.a.push({ line: i + 1, content: line.trim() });
    }
  }

  // B) Edit button handler checking lastPdfMode
  if (line.includes('lastPdfMode') && (line.includes('??') || line.includes('==='))) {
    audit.b.push({ line: i + 1, content: line.trim() });
  }

  // C) lastPdfMode being SET
  if (line.includes('lastPdfMode') && line.includes('=')) {
    audit.c.push({ line: i + 1, content: line.trim() });
  }
}

console.log(JSON.stringify(audit, null, 2));
