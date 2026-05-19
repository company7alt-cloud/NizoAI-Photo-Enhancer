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
  const htmlContent = await marked.parse(markdownText);

  const renderedHtml = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    /* CRITICAL WRAP & OVERLAP FIXES */
    * { box-sizing: border-box; }
    body {
      font-family: 'Tajawal', sans-serif;
      direction: rtl;
      text-align: right;
      color: #1a1a1a;
      line-height: 2.4; /* Prevents vertical overlapping */
      font-size: 16px;
      margin: 0;
      padding: 0;
      word-wrap: break-word; /* Forces long lines to break */
      overflow-wrap: break-word;
      white-space: pre-wrap; /* Respects paragraphs but wraps */
      max-width: 100%;
    }
    /* CONTAINER TO PREVENT BLEEDING OFF PAGE */
    .page-container {
      width: 100%;
      max-width: 185mm; /* Safe A4 width */
      margin: 0 auto;
    }
    h1, h2, h3 { line-height: 1.5; color: #2c3e50; page-break-after: avoid; margin-top: 20px; }
    p { margin-bottom: 15px; text-align: justify; }
    /* BULLETPROOF TABLES */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 25px 0;
      table-layout: fixed; /* Forces table to stay inside page */
      page-break-inside: avoid;
    }
    th, td {
      border: 2px solid #2c3e50; /* Clear grid lines */
      padding: 12px;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    th { background-color: #2c3e50; color: white; }
    tr:nth-child(even) { background-color: #f8f9fa; }
  </style>
</head>
<body>
  <div class="page-container">
    ${htmlContent}
  </div>
</body>
</html>`;
  const documentHtml = '\uFEFF' + renderedHtml;

  const uniqueId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const tmpHtml = path.join(os.tmpdir(), `doc_${uniqueId}.html`);
  const tmpPdf = path.join(os.tmpdir(), `doc_${uniqueId}.pdf`);

  try {
    await fs.promises.writeFile(tmpHtml, documentHtml, 'utf8');

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
