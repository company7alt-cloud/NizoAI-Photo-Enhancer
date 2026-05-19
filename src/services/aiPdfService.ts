import { marked } from 'marked';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import util from 'util';

const execAsync = util.promisify(exec);
marked.use({ gfm: true, breaks: true });

export async function generateAiPDF(markdownText: string): Promise<Buffer> {
  // Step 1: Parse markdown to HTML — NO preprocessing, pass raw text
  const htmlContent = await marked.parse(markdownText);

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
  const tmpHtml = path.join(os.tmpdir(), `doc_${uniqueId}.html`);
  const tmpPdf = path.join(os.tmpdir(), `doc_${uniqueId}.pdf`);

  try {
    await fs.promises.writeFile(tmpHtml, '\uFEFF' + fullHtml, 'utf8');
    
    // Execute asynchronously to avoid blocking the Node.js event loop
    await execAsync(`wkhtmltopdf --encoding utf-8 --page-size A4 --margin-top 15mm --margin-bottom 15mm --margin-left 15mm --margin-right 15mm --enable-local-file-access "${tmpHtml}" "${tmpPdf}"`, { timeout: 30000 });
    
    const pdfBuffer = await fs.promises.readFile(tmpPdf);
    return pdfBuffer;
  } finally {
    // Clean up temporary files
    try { await fs.promises.unlink(tmpHtml); } catch {}
    try { await fs.promises.unlink(tmpPdf); } catch {}
  }
}
