import puppeteer from 'puppeteer-core';
import { marked } from 'marked';

// ─── Pre-processor: runs BEFORE marked ───────────────────────
function preprocessMarkdown(text: string): string {
  // FIX 3: Strip LaTeX math — convert $formula$ to plain text
  return text
    .replace(/\$\$[\s\S]*?\$\$/g, '[معادلة]')
    .replace(/\$([^$\n]+)\$/g, (_, inner) =>
      inner
        .replace(/\\mu/g, 'μ')
        .replace(/\\times/g, '×')
        .replace(/\^{([^}]+)}/g, (__: string, exp: string) => exp)
        .replace(/[{}\\]/g, '')
        .trim()
    );
}

export async function generateAiPDF(markdownText: string): Promise<Buffer> {
  // FIX 1+2: Configure marked with GFM tables + HTML passthrough
  const renderer = new marked.Renderer();
  
  // @ts-ignore
  marked.use({
    gfm: true,
    breaks: true,
    renderer,
  });

  // FIX 1: Force table detection — re-format pipe tables before parsing
  const cleanedText = preprocessMarkdown(markdownText)
    .split('\n')
    .map(line => line.trim())
    .join('\n');

  // FIX 2: Use parseInline=false and do NOT sanitize — trust AI output
  const htmlContent = marked.parse(cleanedText) as string;

  // FIX 2: Restore any stripped span tags (fallback)
  const safeHtml = htmlContent
    .replace(/&lt;span style=/g, '<span style=')
    .replace(/&lt;\/span&gt;/g, '</span>')
    .replace(/&gt;/g, (m, offset, str) => {
      // only restore > that are part of span tags
      const before = str.substring(0, offset);
      return before.match(/<span style=[^>]*$/) ? '>' : m;
    });

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
    th { background: #1a1a2e; color: #fff; padding: 10px 14px; text-align: right; font-weight: bold; border: 1px solid #1a1a2e; }
    td { border: 1px solid #aaa; padding: 10px 14px; text-align: right; }
    tr:nth-child(even) td { background: #f5f7fa; }
    strong { font-weight: 700; }
    blockquote { border-right: 4px solid #457B9D; padding: 10px 16px; background: #f0f4f8; margin: 10px 0; }
    span[style] { display: inline !important; }
  </style>
</head>
<body>${safeHtml}</body>
</html>`;

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: '/usr/bin/chromium-browser',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      headless: true,
    });
    const page = await browser.newPage();
    // Use waitUntil: 'load' instead of 'networkidle0' to satisfy modern puppeteer types
    await page.setContent(fullHtml, { waitUntil: 'load' });
    const pdf = await page.pdf({
      format: 'A4',
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      printBackground: true,
    });
    return Buffer.from(pdf);
  } catch (err) {
    console.error('[PDF ERROR]', err);
    throw new Error('فشل في توليد PDF. حاول مجدداً.');
  } finally {
    if (browser) await browser.close();
  }
}
