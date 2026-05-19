import { marked } from 'marked';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import util from 'util';

const execAsync = util.promisify(exec);
marked.use({ gfm: true, breaks: true });

function assertRawPdfMarkdown(markdownText: string): void {
  if (/The following table:\s*(?:"|\r?\n\s*")/i.test(markdownText)) {
    throw new Error('AI_PDF_INPUT_CONTAMINATED: Telegram table text reached PDF renderer');
  }
}

export async function generateAiPDF(markdownText: string): Promise<Buffer> {
  // Parse the raw AI Markdown directly. Telegram-safe text must never enter here.
  assertRawPdfMarkdown(markdownText);
  const htmlContent = await marked.parse(markdownText);

  const renderedHtml = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
  @page { size: A4; margin: 15mm; }
  body {
    font-family: 'Tajawal', sans-serif;
    direction: rtl;
    text-align: right;
    font-size: 16px;
    line-height: 1.8;
    color: #111;
    width: 100%;
    margin: 0;
    padding: 0;
    word-wrap: break-word;
  }
  h1, h2, h3 { color: #2c3e50; page-break-after: avoid; margin-bottom: 10px; }
  p { margin-bottom: 15px; }
  table { 
    width: 100%; 
    border-collapse: collapse; 
    margin: 20px 0; 
    page-break-inside: avoid; 
  }
  th, td { 
    border: 1px solid #333; 
    padding: 8px; 
    text-align: right; 
  }
  th { background-color: #eee; font-weight: bold; }
  /* Inline LTR fix for old webkit */
  b, strong, span, i { direction: rtl; unicode-bidi: embed; }
  </style>
</head>
<body>
${htmlContent}
</body>
</html>`;
  const documentHtml = '\uFEFF' + renderedHtml;

  const uniqueId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const tmpHtml = path.join(os.tmpdir(), `doc_${uniqueId}.html`);
  const tmpPdf = path.join(os.tmpdir(), `doc_${uniqueId}.pdf`);

  try {
    await fs.promises.writeFile(tmpHtml, documentHtml, 'utf8');

    await execAsync(
      `wkhtmltopdf --encoding utf-8 --page-size A4 --margin-top 15mm --margin-bottom 15mm --margin-left 15mm --margin-right 15mm --enable-local-file-access "${tmpHtml}" "${tmpPdf}"`,
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
