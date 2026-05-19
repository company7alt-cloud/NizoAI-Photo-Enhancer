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
async function generateAiPDF(markdownText) {
    // Step 1: Parse markdown to HTML — NO preprocessing, pass raw text
    const htmlContent = await marked_1.marked.parse(markdownText);
    // Step 2: Wrap in RTL-aware HTML
    const fullHtml = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      direction: rtl;
      text-align: right;
      font-family: 'Cairo', Tahoma, Arial, sans-serif;
      font-size: 15px;
      line-height: 1.9;
      color: #222;
      padding: 50px 60px;
      background: #fff;
    }
    h1 { font-size: 24px; font-weight: 700; color: #1a1a2e; border-bottom: 3px solid #1a1a2e; padding-bottom: 10px; margin-bottom: 20px; }
    h2 { font-size: 19px; font-weight: 700; color: #1a1a2e; margin: 20px 0 10px; }
    h3 { font-size: 16px; font-weight: 700; color: #333; margin: 15px 0 8px; }
    p, li, td, th, span { unicode-bidi: plaintext; }
    p { margin: 10px 0; }
    ul, ol { padding-right: 25px; padding-left: 0; margin: 10px 0; }
    li { margin: 5px 0; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; direction: rtl; }
    th {
      background-color: #1a1a2e;
      color: #ffffff;
      font-weight: 700;
      padding: 12px 15px;
      text-align: right;
      border: 1px solid #1a1a2e;
    }
    td {
      padding: 10px 15px;
      text-align: right;
      border: 1px solid #ccc;
    }
    tr:nth-child(even) td { background-color: #f5f7fa; }
    tr:hover td { background-color: #eef1f7; }
    strong { font-weight: 700; }
    em { font-style: italic; }
    hr { border: none; border-top: 1px solid #ddd; margin: 20px 0; }
    blockquote {
      border-right: 4px solid #457B9D;
      border-left: none;
      padding: 10px 15px;
      margin: 15px 0;
      background: #f8f9fa;
      color: #555;
    }
  </style>
</head>
<body>
${htmlContent}
</body>
</html>`;
    // Step 3: Use wkhtmltopdf via child_process asynchronously
    const uniqueId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const tmpHtml = path_1.default.join(os_1.default.tmpdir(), `doc_${uniqueId}.html`);
    const tmpPdf = path_1.default.join(os_1.default.tmpdir(), `doc_${uniqueId}.pdf`);
    try {
        await fs_1.default.promises.writeFile(tmpHtml, '\uFEFF' + fullHtml, 'utf8');
        // Execute asynchronously to avoid blocking the Node.js event loop
        await execAsync(`wkhtmltopdf --encoding utf-8 --page-size A4 --margin-top 15mm --margin-bottom 15mm --margin-left 15mm --margin-right 15mm --enable-local-file-access "${tmpHtml}" "${tmpPdf}"`, { timeout: 30000 });
        const pdfBuffer = await fs_1.default.promises.readFile(tmpPdf);
        return pdfBuffer;
    }
    finally {
        // Clean up temporary files
        try {
            await fs_1.default.promises.unlink(tmpHtml);
        }
        catch { }
        try {
            await fs_1.default.promises.unlink(tmpPdf);
        }
        catch { }
    }
}
//# sourceMappingURL=aiPdfService.js.map