const fs = require('fs');
const path = require('path');

function searchInFile(filePath, queries) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const results = [];
  for (let i = 0; i < lines.length; i++) {
    for (const query of queries) {
      if (typeof query === 'string' && lines[i].includes(query)) {
        results.push({ line: i + 1, content: lines[i].trim(), query });
      } else if (query instanceof RegExp && query.test(lines[i])) {
        results.push({ line: i + 1, content: lines[i].trim(), query: query.toString() });
      }
    }
  }
  return results;
}

const audit = {
  a: searchInFile('src/index.ts', ['edit_pdf_doc', 'handleEditPdfDocCallback']),
  b: searchInFile('src/services/aiPdfService.ts', ['originalPrompt', 'systemPrompt', 'userTopic', 'lastOriginalPrompt']),
  c1: searchInFile('src/index.ts', ['generateAiPDF', 'nizo_pdf_auto', 'free_pdf_auto']),
  c2: searchInFile('src/services/aiPdfService.ts', ['generateAiPDF', 'generateProImagePDF']),
  d: searchInFile('src/database/models/User.ts', ['UserSchema', 'new mongoose.Schema']),
  e: searchInFile('src/index.ts', ['free_pdf_auto', 'free_pdf_pro', 'nizo_pdf_auto', 'nizo_pdf_pro', 'تلقائي', 'احترافي']),
  f: searchInFile('src/index.ts', ['editCount', 'freeAutoEdits', 'paidAutoEdits']),
  g: searchInFile('src/index.ts', ['on(\'message\')', 'on("message")', 'imageBot.on(\'message\')', 'imageBot.on("message")'])
};

console.log(JSON.stringify(audit, null, 2));
