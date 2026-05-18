"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAiPDF = generateAiPDF;
const puppeteer_core_1 = __importDefault(require("puppeteer-core"));
const marked_1 = require("marked");
function preprocessMarkdown(text) {
    return text
        // Strip block LaTeX
        .replace(/\$\$[\s\S]*?\$\$/g, '[معادلة]')
        // Convert inline LaTeX to readable text
        .replace(/\$([^$\n]+)\$/g, (_, inner) => inner
        .replace(/\\mu/g, 'μ')
        .replace(/\\times/g, '×')
        .replace(/\^{([^}]+)}/g, (_2, exp) => exp)
        .replace(/[{}\\]/g, '')
        .trim())
        // FIX TABLES: ensure blank line before every pipe table row
        .replace(/([^\n])\n(\|)/g, '$1\n\n$2')
        // Remove any hardcoded injected strings from AI
        .replace(/The following table:/gi, '')
        .replace(/الجدول التالي:/g, '');
}
async function generateAiPDF(markdownText) {
    // Configure marked: GFM enables tables, html:true allows <span> passthrough
    marked_1.marked.use({
        gfm: true,
        breaks: true,
    });
    const cleaned = preprocessMarkdown(markdownText);
    // CRITICAL: marked.parse is async — must await
    const htmlContent = await marked_1.marked.parse(cleaned);
    // CRITICAL: un-escape any span tags that marked may have escaped
    const safeHtml = htmlContent
        .replace(/&lt;span(\s[^>]*?)?&gt;/gi, (m) => m.replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
        .replace(/&lt;\/span&gt;/gi, '</span>');
    const fullHtml = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Cairo', Tahoma, Arial, sans-serif;
      font-size: 15px; line-height: 2; color: #1a1a1a;
      padding: 40px 50px; direction: rtl; text-align: right;
    }
    h1 { font-size: 22px; border-bottom: 3px solid #1a1a2e; padding-bottom: 10px; margin-bottom: 20px; color: #1a1a2e; }
    h2 { font-size: 18px; margin: 20px 0 10px; color: #1a1a2e; }
    h3 { font-size: 16px; margin: 15px 0 8px; }
    p  { margin: 10px 0; }
    ul, ol { padding-right: 25px; padding-left: 0; margin: 10px 0; }
    li { margin: 6px 0; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; direction: rtl; }
    th {
      background: #1a1a2e; color: #fff;
      padding: 10px 14px; text-align: right;
      font-weight: bold; border: 1px solid #1a1a2e;
    }
    td { border: 1px solid #aaa; padding: 10px 14px; text-align: right; }
    tr:nth-child(even) td { background: #f5f7fa; }
    strong { font-weight: 700; }
    blockquote {
      border-right: 4px solid #457B9D;
      padding: 10px 16px; background: #f0f4f8; margin: 10px 0;
    }
    span[style] { display: inline !important; }
  </style>
</head>
<body>${safeHtml}</body>
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
            ],
            headless: true,
        });
        const page = await browser.newPage();
        // networkidle0 = wait for Cairo font to fully load before printing
        await page.setContent(fullHtml, { waitUntil: 'load' }); // NOTE: using load instead of networkidle0 as before due to ts error
        const pdf = await page.pdf({
            format: 'A4',
            margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
            printBackground: true,
        });
        return Buffer.from(pdf);
    }
    catch (err) {
        console.error('[PDF ERROR]', err);
        throw new Error('فشل في توليد PDF. حاول مجدداً.');
    }
    finally {
        if (browser)
            await browser.close();
    }
}
//# sourceMappingURL=aiPdfService.js.map