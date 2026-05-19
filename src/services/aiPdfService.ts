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
    @page { margin: 2.5cm; }
    * { box-sizing: border-box; }
    body {
      direction: rtl;
      text-align: right;
      font-family: 'Arial', sans-serif;
      font-size: 13pt;
      line-height: 1.8;
      color: #222;
      background: #fff;
    }
    h1 { font-size: 20pt; border-bottom: 2px solid #333; padding-bottom: 8px; }
    h2 { font-size: 16pt; margin-top: 24px; }
    h3 { font-size: 14pt; }
    p, li, td, th, span { unicode-bidi: plaintext; }
    p { margin: 10px 0; }
    ul, ol { padding-right: 25px; padding-left: 0; margin: 10px 0; }
    li { margin: 5px 0; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; page-break-inside: avoid; direction: rtl; }
    th, td { border: 1px solid #555; padding: 8px 12px; text-align: right; }
    th { background: #f0f0f0; font-weight: bold; }
    p, li, td { widows: 3; orphans: 3; }
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
      `wkhtmltopdf --encoding utf-8 --page-size A4 --margin-top 25mm --margin-bottom 25mm --margin-left 25mm --margin-right 25mm --enable-local-file-access "${tmpHtml}" "${tmpPdf}"`,
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
