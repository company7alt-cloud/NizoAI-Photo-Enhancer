const fs = require('fs');

// ── Diagnose all 3 issues ────────────────────────────────────────────────────

// 1. Check if generateAiPDFFromHtml is actually in aiPdfService.ts
const pdfSvc = fs.readFileSync('src/services/aiPdfService.ts', 'utf8');
console.log('generateAiPDFFromHtml in aiPdfService?', pdfSvc.includes('generateAiPDFFromHtml'));

// 2. Show the marker line in aiPdfService
const lines = pdfSvc.split('\n');
lines.forEach((l, i) => {
  if (l.includes('Pro Image PDF Generator')) console.log(`aiPdfService L${i+1}: ${JSON.stringify(l)}`);
});

// 3. Check index.ts pro_edit_confirm callback
const idx = fs.readFileSync('src/index.ts', 'utf8');
const idxLines = idx.split('\n');
idxLines.forEach((l, i) => {
  if (l.includes('pro_edit_confirm') || l.includes('ProEditConfirmV2') || l.includes('ProEditConfirm')) {
    console.log(`index.ts L${i+1}: ${l.trim()}`);
  }
});

// 4. Show editWorkflow line 322 context
const ew = fs.readFileSync('src/handlers/docmaker/editWorkflow.ts', 'utf8');
const ewLines = ew.split('\n');
for (let i = 318; i < 328; i++) {
  console.log(`editWorkflow L${i+1}: ${ewLines[i]}`);
}
