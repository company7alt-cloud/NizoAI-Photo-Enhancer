"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAiPDF = generateAiPDF;
const marked_1 = require("marked");
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const util_1 = __importDefault(require("util"));
const execAsync = util_1.default.promisify(child_process_1.exec);
marked_1.marked.use({ gfm: true, breaks: true });
function assertRawPdfMarkdown(markdownText) {
    if (/The following table:\s*(?:"|\r?\n\s*")/i.test(markdownText)) {
        throw new Error('AI_PDF_INPUT_CONTAMINATED: Telegram table text reached PDF renderer');
    }
}
async function generateAiPDF(markdownText) {
    // Parse the raw AI Markdown directly. Telegram-safe text must never enter here.
    assertRawPdfMarkdown(markdownText);
    const htmlContent = await marked_1.marked.parse(markdownText);
    const renderedHtml = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Tajawal', Arial, sans-serif;
    direction: rtl;
    text-align: right;
    font-size: 16px;
    line-height: 2.2;
    color: #000;
    margin: 0 auto;
    padding: 0;
    width: 100%;
    max-width: 175mm !important; /* STRICT A4 BOUNDARY */
    word-wrap: break-word !important;
    overflow-wrap: break-word !important;
    white-space: pre-wrap !important; /* FORCES WRAP ON LONG ARABIC STRINGS */
  }
  h1, h2, h3 { color: #1a1a2e; page-break-after: avoid; }
  table { 
    width: 100%; 
    border-collapse: collapse; 
    margin: 20px 0; 
    table-layout: fixed !important; /* FORCES TABLE TO FIT */
    page-break-inside: avoid;
  }
  th, td { 
    border: 1px solid #333; 
    padding: 10px; 
    word-wrap: break-word !important; 
    overflow-wrap: break-word !important;
  }
  th { background-color: #f4f4f4; font-weight: bold; }
  </style>
</head>
<body>
${htmlContent}
</body>
</html>`;
    const documentHtml = '\uFEFF' + renderedHtml;
    const uniqueId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const tmpHtml = path_1.default.join(os_1.default.tmpdir(), `doc_${uniqueId}.html`);
    const tmpPdf = path_1.default.join(os_1.default.tmpdir(), `doc_${uniqueId}.pdf`);
    try {
        await fs_1.default.promises.writeFile(tmpHtml, documentHtml, 'utf8');
        await execAsync(`wkhtmltopdf --encoding utf-8 --page-size A4 --margin-top 15mm --margin-bottom 15mm --margin-left 15mm --margin-right 15mm --enable-local-file-access "${tmpHtml}" "${tmpPdf}"`, { timeout: 30000 });
        return await fs_1.default.promises.readFile(tmpPdf);
    }
    finally {
        try {
            await fs_1.default.promises.unlink(tmpHtml);
        }
        catch (error) {
            console.error('[AI PDF] Failed to delete temporary HTML:', error);
        }
        try {
            await fs_1.default.promises.unlink(tmpPdf);
        }
        catch (error) {
            console.error('[AI PDF] Failed to delete temporary PDF:', error);
        }
    }
}
//# sourceMappingURL=aiPdfService.js.map