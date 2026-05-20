"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAiPDF = generateAiPDF;
const puppeteer_1 = __importDefault(require("puppeteer"));
const marked_1 = require("marked");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
function sanitizeForPdf(text) {
    return text
        // Remove or replace characters that cause empty boxes
        .replace(/[\u2028\u2029]/g, '\n') // line/paragraph separators
        .replace(/[\u0000-\u0008]/g, '') // control chars
        .replace(/[\u000B\u000C]/g, '\n') // vertical tab, form feed
        .replace(/[\u000E-\u001F]/g, '') // other control chars
        .replace(/[\uFFFD]/g, ''); // replacement character
}
async function generateAiPDF(rawMarkdown) {
    // 1. Sanitize the AI response BEFORE converting to HTML
    const cleanMarkdown = sanitizeForPdf(rawMarkdown);
    // 2. Convert pure Markdown to HTML
    const htmlContent = marked_1.marked.parse(cleanMarkdown);
    // 3. Build the exact HTML template
    const fullHtml = `
  <!DOCTYPE html>
  <html dir="rtl" lang="ar">
  <head>
    <meta charset="UTF-8">
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;700&display=swap" rel="stylesheet">
    <style>
      @font-face {
        font-family: 'Omnia';
        src: url('/root/bot/assets/fonts/Omnia.ttf') format('truetype');
        unicode-range: U+0600-06FF, U+0750-077F, U+FB50-FDFF, U+FE70-FEFF;
      }
      @font-face {
        font-family: 'Cairo';
        src: url('/root/bot/assets/fonts/Cairo.ttf') format('truetype');
      }
      @font-face {
        font-family: 'ModernPro';
        src: url('/root/bot/assets/fonts/ModernPro.ttf') format('truetype');
      }

      @page {
        margin: 2.5cm 2cm 2.5cm 2cm;
        /* top right bottom left */
      }

      * { box-sizing: border-box; }
      body {
        font-family: 'Omnia', 'Cairo', 'ModernPro', 'Noto Sans Arabic', 'Arial', sans-serif;
        direction: rtl;
        text-align: right;
        margin: 0;
        padding: 0;
        font-size: 13pt;
        line-height: 1.9;
        color: #1a1a1a;
      }

      /* First page top spacing */
      .document-body {
        padding-top: 1cm;
      }

      /* Native browser bi-directional support handles inline English automatically */
      h1, h2, h3 { color: #1a1a2e; margin-top: 24px; margin-bottom: 12px; page-break-after: avoid; }
      p { margin-bottom: 16px; text-align: justify; word-wrap: break-word; }

      /* Flawless tables */
      table {
        width: 100%;
        border-collapse: collapse;
        margin: 20px 0;
        page-break-inside: avoid;
        direction: rtl;
      }

      th {
        background-color: #2c3e50;
        color: white;
        padding: 10px 14px;
        text-align: right;
        font-weight: bold;
        border: 1px solid #555;
      }

      td {
        padding: 9px 14px;
        border: 1px solid #ccc;
        text-align: right;
        vertical-align: top;
      }

      tr:nth-child(even) {
        background-color: #f8f9fa;
      }
    </style>
  </head>
  <body>
    <div class="document-body">
      ${htmlContent}
    </div>
  </body>
  </html>`;
    const pdfPath = path_1.default.join(__dirname, '..', '..', 'temp', `document_${Date.now()}.pdf`);
    // Ensure temp dir exists
    if (!fs_1.default.existsSync(path_1.default.dirname(pdfPath)))
        fs_1.default.mkdirSync(path_1.default.dirname(pdfPath), { recursive: true });
    // 3. Launch Puppeteer to generate A4 PDF
    const browser = await puppeteer_1.default.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'] // Safe for VPS
    });
    const page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: 'load' });
    await page.evaluateHandle('document.fonts.ready');
    await new Promise(resolve => setTimeout(resolve, 800));
    await page.pdf({
        path: pdfPath,
        format: 'A4',
        printBackground: true,
        margin: {
            top: '2.5cm',
            right: '2cm',
            bottom: '2.5cm',
            left: '2cm',
        },
        displayHeaderFooter: false,
    });
    await browser.close();
    return pdfPath;
}
//# sourceMappingURL=aiPdfService.js.map