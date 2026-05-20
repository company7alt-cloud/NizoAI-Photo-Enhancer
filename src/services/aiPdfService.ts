import puppeteer from 'puppeteer';
import { marked } from 'marked';
import fs from 'fs';
import path from 'path';

// ─── Character sanitizer ──────────────────────────────────────────────────────

function sanitizeForPdf(text: string): string {
  return text
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(/[\u0000-\u0008]/g, '')
    .replace(/[\u000B\u000C]/g, '\n')
    .replace(/[\u000E-\u001F]/g, '')
    .replace(/[\uFFFD]/g, '')
    // Strip AI code fences that sneak through
    .replace(/^```[a-z]*\n?/gm, '')
    .replace(/^```$/gm, '');
}

// ─── Template CSS definitions ─────────────────────────────────────────────────

const TEMPLATE_EXTRA: Record<string, string> = {
  tables:   'h1{border-bottom:3px solid #1a2744;} th{background:#1a2744;} body{font-size:11pt;}',
  report:   'h1{color:#003366;border-bottom:2px solid #006699;} h2{color:#003366;} th{background:#003366;}',
  formal:   'h1{text-align:center;letter-spacing:1px;border-bottom:2px solid #111;} body{line-height:2.0;font-size:12pt;}',
  creative: 'h1{color:#6c2eb9;} h2{color:#6c2eb9;border-right:5px solid #e040fb;padding-right:10px;} th{background:#6c2eb9;}',
  minimal:  'h1{font-weight:300;letter-spacing:2px;border-bottom:1px solid #ccc;} th{background:#444;} body{line-height:2.0;}',
  academic: 'h1{text-align:center;color:#1b3a4b;border-bottom:2px solid #2e7d32;} h2{color:#1b3a4b;border-right:4px solid #2e7d32;padding-right:10px;} th{background:#1b3a4b;}',
  default:  '',
};

// ─── Main HTML builder ────────────────────────────────────────────────────────

function buildHtml(bodyContent: string, template: string): string {
  const extra = TEMPLATE_EXTRA[template] || TEMPLATE_EXTRA['default'];
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    * {
      direction: rtl;
      text-align: right;
      font-family: 'Cairo', sans-serif !important;
      unicode-bidi: plaintext;
      box-sizing: border-box;
    }
    @page { margin: 2.5cm 2cm 2.5cm 2cm; }
    body {
      font-size: 13pt;
      line-height: 1.85;
      color: #1a1a1a;
      margin: 0;
      padding: 0;
      background: #fff;
    }
    h1 {
      font-size: 20pt;
      font-weight: 700;
      border-bottom: 2px solid #2c3e50;
      padding-bottom: 8px;
      margin-bottom: 16px;
      page-break-after: avoid;
    }
    h2 {
      font-size: 16pt;
      font-weight: 600;
      color: #2c3e50;
      margin-top: 20px;
      page-break-after: avoid;
    }
    h3 {
      font-size: 14pt;
      font-weight: 600;
      page-break-after: avoid;
    }
    p { margin: 8px 0; text-align: justify; }
    ul, ol { padding-right: 20px; padding-left: 0; margin: 10px 0; }
    li { margin-bottom: 5px; }
    blockquote {
      border-right: 4px solid #2c3e50;
      background: #f5f5f5;
      padding: 10px 16px;
      margin: 12px 0;
    }
    hr { border: 1px solid #ccc; margin: 20px 0; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-size: 0.88em; }
    /* ── Enterprise table engine ── */
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      margin: 16px 0;
      page-break-inside: avoid;
      direction: rtl;
    }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    th {
      background-color: #2c3e50;
      color: white;
      padding: 10px 12px;
      font-weight: 700;
      border: 1px solid #555;
      word-break: break-word;
      overflow-wrap: anywhere;
      vertical-align: top;
    }
    td {
      padding: 9px 12px;
      border: 1px solid #ccc;
      word-break: break-word;
      overflow-wrap: anywhere;
      vertical-align: top;
      white-space: normal;
    }
    tr:nth-child(even) td { background-color: #f8f9fa; }
    /* ── Image safety ── */
    img {
      max-width: 100% !important;
      max-height: 45vh !important;
      object-fit: contain !important;
      display: block;
      margin: 12px auto;
      border-radius: 6px;
    }
    /* ── Per-template overrides ── */
    ${extra}
  </style>
</head>
<body>
  ${bodyContent}
</body>
</html>`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateAiPDF(rawMarkdown: string, template: string = 'default'): Promise<string> {
  // 1. Sanitize
  const cleanMarkdown = sanitizeForPdf(rawMarkdown);

  // 2. Markdown → HTML
  const bodyHtml = await Promise.resolve(marked.parse(cleanMarkdown));

  // 3. Full HTML document
  const fullHtml = buildHtml(bodyHtml, template);

  // 4. Output path
  const pdfPath = path.join(process.cwd(), 'temp', `document_${Date.now()}.pdf`);
  if (!fs.existsSync(path.dirname(pdfPath))) {
    fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
  }

  // 5. Puppeteer
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: 'load' });

    // CRITICAL: wait for Cairo to load (with 5s safety net)
    await page.evaluateHandle('document.fonts.ready');
    await new Promise(resolve => setTimeout(resolve, 1000));

    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '2.5cm', right: '2cm', bottom: '2.5cm', left: '2cm' },
      displayHeaderFooter: false,
    });
  } finally {
    await browser.close();
  }

  return pdfPath;
}
