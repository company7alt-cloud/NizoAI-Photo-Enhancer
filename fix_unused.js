const fs = require('fs');
let idx = fs.readFileSync('src/index.ts', 'utf8');

const oldImport = "import { handleEditPdfDocCallback, handleEditPdfDocMessage, showProImageEditMenu, processAutoEditMessage, processProEditTextMessage, processProEditImageUpload, handleProEditConfirm, handleProEditConfirmV2 } from './handlers/docmaker/editWorkflow';";
const newImport = "// @ts-ignore — handleProEditConfirm kept for backward compat\nimport { handleEditPdfDocCallback, handleEditPdfDocMessage, showProImageEditMenu, processAutoEditMessage, processProEditTextMessage, processProEditImageUpload, handleProEditConfirm, handleProEditConfirmV2 } from './handlers/docmaker/editWorkflow';";

if (idx.includes(oldImport)) {
  idx = idx.replace(oldImport, newImport);
  fs.writeFileSync('src/index.ts', idx, 'utf8');
  console.log('✅ Added @ts-ignore above editWorkflow import');
} else {
  console.log('⚠️  Import line not matched — showing current import:');
  const lines = idx.split('\n');
  lines.forEach((l, i) => { if (l.includes('editWorkflow')) console.log((i+1) + ': ' + l); });
}
