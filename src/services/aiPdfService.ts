// src/services/aiPdfService.ts
import { marked } from 'marked';
// html-pdf-node ships CJS only — use require to avoid ESM interop issues at runtime
// The @types package gives us compile-time safety
import htmlPdf from 'html-pdf-node';

export async function generateAiPDF(markdownText: string): Promise<Buffer> {
  // Strip unsupported Unicode emoji ranges and trim
  const cleaned = markdownText
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}]/gu, '')
    .trim();

  // Convert Markdown → HTML
  const htmlContent = await marked.parse(cleaned);

  // RTL-aware Arabic HTML wrapper
  const fullHtml = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: Tahoma, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.8;
      color: #1a1a1a;
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
    p { margin: 10px 0; direction: rtl; text-align: right; }
    ul, ol { margin: 10px 0; padding-right: 25px; padding-left: 0; direction: rtl; }
    li { margin: 5px 0; direction: rtl; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; direction: rtl; }
    th, td { border: 1px solid #ccc; padding: 10px; text-align: right; }
    th { background: #1a1a2e; color: white; font-weight: bold; }
    tr:nth-child(even) { background: #f5f5f5; }
    strong { font-weight: bold; }
    blockquote { border-right: 4px solid #457B9D; padding: 10px 15px; background: #f8f9fa; }
  </style>
</head>
<body>${htmlContent}</body>
</html>`;

  const file = { content: fullHtml };
  const options = {
    format: 'A4' as const,
    margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
    printBackground: true,
  };

  const pdfBuffer = await htmlPdf.generatePdf(file, options);
  return pdfBuffer;
}
