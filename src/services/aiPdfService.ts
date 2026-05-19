import { marked } from 'marked';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import util from 'util';

const execAsync = util.promisify(exec);
marked.use({ gfm: true, breaks: true });

export async function generateAiPDF(markdownText: string): Promise<Buffer> {
  // Parse the raw AI Markdown directly. Telegram-safe text must never enter here.
  const convertedHtml = await marked.parse(markdownText);

  const renderedHtml = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap');
    @page { margin: 25mm 20mm; }
    * { box-sizing: border-box; }
    body {
      direction: rtl;
      text-align: right;
      font-family: 'Tajawal', sans-serif;
      font-size: 15px;
      line-height: 2;
      padding: 0;
      margin: 0;
      color: #1a1a1a;
      background: #fff;
    }
    h1 {
      font-size: 28px;
      line-height: 1.6;
      font-weight: 800;
      color: #111827;
      border-bottom: 3px solid #2c3e50;
      padding-bottom: 10px;
      margin: 0 0 22px;
    }
    h2 {
      font-size: 22px;
      line-height: 1.7;
      font-weight: 700;
      color: #1f2937;
      margin: 28px 0 12px;
      page-break-after: avoid;
    }
    h3 {
      font-size: 18px;
      line-height: 1.8;
      font-weight: 700;
      color: #374151;
      margin: 22px 0 8px;
      page-break-after: avoid;
    }
    p, li, td, th, span { unicode-bidi: plaintext; }
    p { margin: 0 0 13px; }
    ul, ol { padding-right: 28px; padding-left: 0; margin: 12px 0 18px; }
    li { margin: 6px 0; }
    table { width: 100%; border-collapse: collapse; margin: 25px 0; font-size: 14px; page-break-inside: avoid; direction: rtl; }
    th { background-color: #2c3e50; color: white; padding: 12px; border: 1px solid #2c3e50; text-align: right; font-weight: 700; }
    td { padding: 12px; border: 1px solid #dddddd; text-align: right; vertical-align: top; }
    tr:nth-child(even) { background-color: #f8f9fa; }
    p, li, td { widows: 3; orphans: 3; }
    strong { font-weight: 700; }
    em { font-style: italic; }
    hr { border: none; border-top: 1px solid #d1d5db; margin: 24px 0; }
    blockquote {
      border-right: 4px solid #2c3e50;
      border-left: none;
      padding: 12px 16px;
      margin: 18px 0;
      background: #f8f9fa;
      color: #374151;
    }
    @media print {
      h1, h2 { page-break-before: auto; }
      h1, h2, h3 { page-break-after: avoid; }
      table, pre, blockquote { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
${convertedHtml}
</body>
</html>`;
  const htmlContent = '\uFEFF' + renderedHtml;

  const uniqueId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const tmpHtml = path.join(os.tmpdir(), `doc_${uniqueId}.html`);
  const tmpPdf = path.join(os.tmpdir(), `doc_${uniqueId}.pdf`);

  try {
    await fs.promises.writeFile(tmpHtml, htmlContent, 'utf8');

    await execAsync(
      `wkhtmltopdf --encoding utf-8 --page-size A4 --margin-top 25mm --margin-bottom 25mm --margin-left 20mm --margin-right 20mm --enable-local-file-access "${tmpHtml}" "${tmpPdf}"`,
      { timeout: 30000 }
    );

    return await fs.promises.readFile(tmpPdf);
  } finally {
    try {
      await fs.promises.unlink(tmpHtml);
    } catch (error) {
      console.error('[AI PDF] Failed to delete temporary HTML:', error);
    }

    try {
      await fs.promises.unlink(tmpPdf);
    } catch (error) {
      console.error('[AI PDF] Failed to delete temporary PDF:', error);
    }
  }
}
