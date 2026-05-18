"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAiPDF = generateAiPDF;
const puppeteer_core_1 = __importDefault(require("puppeteer-core"));
const marked_1 = require("marked");
// Configure marked ONCE at module level (outside the function):
marked_1.marked.use({
    gfm: true, // Enables GitHub Flavored Markdown = enables TABLE parsing
    breaks: true, // Line breaks work correctly
});
async function generateAiPDF(markdownText) {
    // marked v9+: no setOptions needed, inline HTML enabled by default
    const htmlContent = marked_1.marked.parse(markdownText, {
        async: false,
    });
    const fullHtml = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Cairo', Tahoma, Arial, sans-serif;
      font-size: 15px;
      line-height: 2;
      color: #1a1a1a;
      padding: 40px 50px;
      direction: rtl;
      text-align: right;
    }
    h1 {
      font-size: 22px;
      border-bottom: 3px solid #1a1a2e;
      padding-bottom: 10px;
      margin-bottom: 20px;
      color: #1a1a2e;
    }
    h2 { font-size: 18px; margin: 20px 0 10px; color: #1a1a2e; }
    h3 { font-size: 16px; margin: 15px 0 8px; }
    p  { margin: 10px 0; }
    ul, ol { padding-right: 25px; padding-left: 0; margin: 10px 0; }
    li { margin: 6px 0; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; direction: rtl; }
    th { background: #1a1a2e; color: #fff; padding: 10px 14px; text-align: right; font-weight: bold; border: 1px solid #1a1a2e; }
    td { border: 1px solid #aaa; padding: 10px 14px; text-align: right; }
    tr:nth-child(even) td { background: #f5f7fa; }
    strong { font-weight: 700; }
    blockquote {
      border-right: 4px solid #457B9D;
      padding: 10px 16px;
      background: #f0f4f8;
      margin: 10px 0;
    }
    span[style] { display: inline !important; }
  </style>
</head>
<body>${htmlContent}</body>
</html>`;
    let browser;
    try {
        browser = await puppeteer_core_1.default.launch({
            executablePath: '/usr/bin/chromium-browser',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--font-render-hinting=none',
            ],
            headless: true,
        });
        const page = await browser.newPage();
        await page.setContent(fullHtml, { waitUntil: 'load' });
        const pdfUint8Array = await page.pdf({
            format: 'A4',
            margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
            printBackground: true,
        });
        return Buffer.from(pdfUint8Array);
    }
    catch (error) {
        console.error('[PDF ERROR]', error);
        throw new Error('فشل في توليد ملف PDF. يرجى المحاولة لاحقاً.');
    }
    finally {
        if (browser)
            await browser.close();
    }
}
//# sourceMappingURL=aiPdfService.js.map