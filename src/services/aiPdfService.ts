// src/services/aiPdfService.ts
import puppeteer from 'puppeteer';
import { marked } from 'marked';

export async function generateAiPDF(markdownText: string): Promise<Buffer> {
  // Strip unsupported Unicode emoji ranges and trim
  const cleaned = markdownText
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}]/gu, '')
    .trim();

  // Convert Markdown → HTML (marked.parse returns a Promise<string>)
  const htmlContent = await marked.parse(cleaned);

  // RTL-aware, Arabic-ready full HTML wrapper
  const fullHtml = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Tahoma', 'Arial', 'DejaVu Sans', sans-serif;
      font-size: 14px;
      line-height: 1.8;
      color: #1a1a1a;
      background: #ffffff;
      padding: 40px 50px;
      direction: rtl;
      text-align: right;
    }
    h1, h2, h3 {
      font-weight: bold;
      margin: 20px 0 10px 0;
      color: #1a1a2e;
      direction: rtl;
      text-align: right;
    }
    h1 { font-size: 22px; border-bottom: 2px solid #1a1a2e; padding-bottom: 8px; }
    h2 { font-size: 18px; }
    h3 { font-size: 16px; }
    p {
      margin: 10px 0;
      direction: rtl;
      text-align: right;
      unicode-bidi: embed;
    }
    ul, ol {
      margin: 10px 0 10px 0;
      padding-right: 25px;
      padding-left: 0;
      direction: rtl;
      text-align: right;
    }
    li {
      margin: 5px 0;
      direction: rtl;
      text-align: right;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 15px 0;
      font-size: 13px;
      direction: rtl;
    }
    th, td {
      border: 1px solid #cccccc;
      padding: 10px 12px;
      text-align: right;
      direction: rtl;
    }
    th {
      background-color: #1a1a2e;
      color: #ffffff;
      font-weight: bold;
    }
    tr:nth-child(even) { background-color: #f5f5f5; }
    strong { font-weight: bold; }
    em { font-style: italic; }
    code {
      background: #f0f0f0;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: monospace;
      direction: ltr;
      unicode-bidi: embed;
    }
    blockquote {
      border-right: 4px solid #457B9D;
      border-left: none;
      padding: 10px 15px;
      margin: 10px 0;
      background: #f8f9fa;
      color: #555;
    }
    hr { border: none; border-top: 1px solid #cccccc; margin: 20px 0; }
    :lang(ar) { direction: rtl; unicode-bidi: embed; }
  </style>
</head>
<body>
  ${htmlContent}
</body>
</html>`;

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: 'load' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      printBackground: true,
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}
