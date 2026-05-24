const fs = require('fs');
let lines = fs.readFileSync('src/services/aiPdfService.ts', 'utf8').split('\n');
let start = -1, end = -1;
for(let i=0; i<lines.length; i++) {
  if (lines[i].includes("export async function generateAiPDF(rawMarkdown: string, template: string = 'default', isAutoMode?: boolean): Promise<string> {")) start = i;
  if (start !== -1 && lines[i].includes("const processedText = await processImages(cleanMarkdown, isAutoMode);")) { end = i; break; }
}
if (start !== -1 && end !== -1) {
  lines.splice(start, end-start+1,
    "export async function generateAiPDF(rawMarkdown: string, template: string = 'default', skipImages: boolean = false): Promise<string> {",
    "  // 1. Sanitize",
    "  const cleanMarkdown = sanitizeForPdf(rawMarkdown);",
    "",
    "  // 1.5. Process Images (skip for auto/text-only mode)",
    "  const processedText = skipImages",
    "    ? cleanMarkdown.replace(/\\[IMAGE:[^\\]]*\\]/g, '')",
    "    : await processImages(cleanMarkdown);"
  );
  fs.writeFileSync('src/services/aiPdfService.ts', lines.join('\n'));
  console.log('Patched aiPdfService.ts successfully.');
} else {
  console.log('Lines not found', start, end);
}
