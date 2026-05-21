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
    /* ── Orphan & Widow Control ─────────────────── */
    p, li, td {
      orphans: 4;
      widows: 4;
    }
    h1, h2, h3, h4, h5, h6 {
      page-break-after: avoid;
      page-break-inside: avoid;
    }
    p, ul, ol, blockquote {
      page-break-inside: avoid;
    }
    /* If only 3 or fewer lines remain → force them up, never open new page */
    /* ─────────────────────────────────────────────── */
    /* ── Per-template overrides ── */
    ${extra}
  </style>
</head>
<body>
  ${bodyContent}
</body>
</html>`;
}

async function processImages(text: string): Promise<string> {
  // ── DISABLED: Old Pollinations URL interceptor (replaced by [IMAGE: keyword] system) ──
  // Fix 1: Convert markdown images to base64
  // Fix 2: Fix broken HTML img tags (RTL reversal causes src to appear wrong)
  // 
  // let processed_old = text;
  // const urlsToProcess: string[] = [];
  // let match_old;
  // const mdRegex = /https:\/\/image\.pollinations\.ai\/[^\s)"'>]+/g;
  // while ((match_old = mdRegex.exec(text)) !== null) {
  //   urlsToProcess.push(match_old[0].replace(/['"\)\]>]+$/, ''));
  // }
  // for (const url of [...new Set(urlsToProcess)]) {
  //   try {
  //     const cleanUrl = url.replace(/['"\)\]>\s]+$/, '').replace(/&amp;/g, '&');
  //     const response = await fetch(cleanUrl, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0' } });
  //     if (!response.ok) { continue; }
  //     const buffer = Buffer.from(await response.arrayBuffer());
  //     const base64 = buffer.toString('base64');
  //     const dataUri = `data:image/jpeg;base64,${base64}`;
  //     processed_old = processed_old.split(url).join(dataUri);
  //     processed_old = processed_old.replace(/>\s*img[\s\S]*?nologo=true['"<>\s]*/g, `<img src="${dataUri}" ... />`);
  //   } catch (err) { ... }
  // }
  // return processed_old;
  // ─────────────────────────────────────────────────────────────────────────────────

  // ── NEW: [IMAGE: keyword] interceptor ──
  // Matches tags emitted by the AI and replaces them with real Unsplash base64 images.
  const imageRegex = /\[IMAGE:\s*(.*?)\]/g;
  let processedText = text;
  const imageMatches = [...text.matchAll(imageRegex)];

  for (const imageMatch of imageMatches) {
    const fullTag = imageMatch[0];
    const keyword = imageMatch[1]?.trim() || 'professional illustration';
    try {
      console.log('[ImageInterceptor] Fetching Unsplash for:', keyword);
      const unsplashUrl = await fetchUnsplashImage(keyword);
      const imgRes = await fetch(unsplashUrl, { signal: AbortSignal.timeout(10000) });
      if (imgRes.ok) {
        const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
        const imgBase64 = imgBuffer.toString('base64');
        const imgHtml = `<br><img src="data:image/jpeg;base64,${imgBase64}" style="max-width:100%; max-height:350px; border-radius:8px; margin:15px auto; display:block;" alt="${keyword}"/><br>`;
        processedText = processedText.replace(fullTag, imgHtml);
        console.log('[ImageInterceptor] ✅ Unsplash image embedded for:', keyword);
      } else {
        console.warn('[ImageInterceptor] Unsplash HTTP failed for:', keyword, imgRes.status);
        processedText = processedText.replace(fullTag, ''); // Remove tag if fetch fails
      }
    } catch (err) {
      console.error('[ImageInterceptor] Failed/timed out for:', keyword, err);
      processedText = processedText.replace(fullTag, ''); // Never crash — just remove the tag
    }
  }

  return processedText;
}

// ─── Unsplash image fetcher (used as intelligent fallback) ────────────────────

async function fetchUnsplashImage(query: string): Promise<string> {
  try {
    const keyword = encodeURIComponent(query);
    const url = `https://api.unsplash.com/photos/random?query=${keyword}&orientation=landscape&content_filter=high`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}`
      },
      signal: AbortSignal.timeout(10000) // guard against undici DOMException TimeoutError
    });
    if (!response.ok) return getFallbackImage(query);
    const data = await response.json() as { urls?: { regular?: string } };
    return data?.urls?.regular ?? getFallbackImage(query);
  } catch {
    return getFallbackImage(query);
  }
}

function getFallbackImage(query: string): string {
  const keyword = encodeURIComponent(query);
  return `https://picsum.photos/seed/${keyword}/800/400`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateAiPDF(rawMarkdown: string, template: string = 'default'): Promise<string> {
  // 1. Sanitize
  const cleanMarkdown = sanitizeForPdf(rawMarkdown);

  // 1.5. Process Images
  const processedText = await processImages(cleanMarkdown);

  // 2. Markdown → HTML
  const bodyHtml = await Promise.resolve(marked.parse(processedText));

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
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none', '--disable-dev-shm-usage'],
    timeout: 90000,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: 'networkidle2' as any, timeout: 90000 });

    // CRITICAL: wait for Cairo to load (with 5s safety net)
    await page.evaluateHandle('document.fonts.ready');
    await new Promise(resolve => setTimeout(resolve, 1000));

    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '2.5cm', right: '2cm', bottom: '2.5cm', left: '2cm' },
      displayHeaderFooter: false,
      timeout: 90000,
    });
  } finally {
    await browser.close();
  }

  return pdfPath;
}
