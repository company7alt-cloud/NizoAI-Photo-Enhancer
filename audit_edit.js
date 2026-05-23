const fs = require('fs');
const lines = fs.readFileSync('src/index.ts', 'utf8').split('\n');
const keywords = ['edit_pdf', 'pro_edit', 'awaitingAutoEdit', 'awaitingProEdit',
  'processAutoEdit', 'processProEdit', 'handleEditPdf', 'lastImageCountPerPage',
  'lastPdfMode', 'lastOriginalPrompt', 'lastImageCount', 'editCount', 'showProImage'];
lines.forEach((l, i) => {
  if (keywords.some(k => l.includes(k))) {
    console.log((i + 1) + ': ' + l);
  }
});
