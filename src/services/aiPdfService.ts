import puppeteer from 'puppeteer';
import { marked } from 'marked';
import fs from 'fs';
import path from 'path';

export async function generateAiPDF(rawMarkdown: string): Promise<string> {
  // 1. Convert pure Markdown to HTML
  const htmlContent = marked.parse(rawMarkdown);

  // 2. Build the exact HTML template
  const fullHtml = `
  <!DOCTYPE html>
  <html dir="rtl" lang="ar">
  <head>
    <meta charset="UTF-8">
    <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap" rel="stylesheet">
    <style>
      * { box-sizing: border-box; }
      body {
        font-family: 'Tajawal', sans-serif;
        direction: rtl;
        text-align: right;
        font-size: 16px;
        line-height: 2.0; /* Perfect natural spacing */
        color: #000;
        margin: 0;
        padding: 0;
      }
      /* Native browser bi-directional support handles inline English automatically */
      h1, h2, h3 { color: #1a1a2e; margin-top: 24px; margin-bottom: 12px; page-break-after: avoid; }
      p { margin-bottom: 16px; text-align: justify; word-wrap: break-word; }

      /* Flawless tables */
      table {
        width: 100%;
        border-collapse: collapse;
        margin: 24px 0;
        page-break-inside: avoid;
      }
      th, td {
        border: 1px solid #bdc3c7;
        padding: 12px;
        text-align: right;
      }
      th { background-color: #34495e; color: white; }
      tr:nth-child(even) { background-color: #f8f9fa; }
    </style>
  </head>
  <body>
    ${htmlContent}
  </body>
  </html>`;

  const pdfPath = path.join(__dirname, '..', '..', 'temp', `document_${Date.now()}.pdf`);

  // Ensure temp dir exists
  if (!fs.existsSync(path.dirname(pdfPath))) fs.mkdirSync(path.dirname(pdfPath), { recursive: true });

  // 3. Launch Puppeteer to generate A4 PDF
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'] // Safe for VPS
  });
  const page = await browser.newPage();
  await page.setContent(fullHtml, { waitUntil: 'load' });
  await page.evaluateHandle('document.fonts.ready');

  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' }
  });

  await browser.close();
  return pdfPath;
}
