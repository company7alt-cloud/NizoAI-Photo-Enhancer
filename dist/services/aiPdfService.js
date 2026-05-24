"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAiPDF = generateAiPDF;
exports.generateAiPDFFromHtml = generateAiPDFFromHtml;
exports.getHtmlPageCount = getHtmlPageCount;
exports.generateAiPDFAndHtml = generateAiPDFAndHtml;
exports.generateProImagePDF = generateProImagePDF;
const puppeteer_1 = __importDefault(require("puppeteer"));
const marked_1 = require("marked");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// ─── Character sanitizer ──────────────────────────────────────────────────────
function sanitizeForPdf(text) {
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
const TEMPLATE_EXTRA = {
    tables: 'h1{border-bottom:3px solid #1a2744;} th{background:#1a2744;} body{font-size:11pt;}',
    report: 'h1{color:#003366;border-bottom:2px solid #006699;} h2{color:#003366;} th{background:#003366;}',
    formal: 'h1{text-align:center;letter-spacing:1px;border-bottom:2px solid #111;} body{line-height:2.0;font-size:12pt;}',
    creative: 'h1{color:#6c2eb9;} h2{color:#6c2eb9;border-right:5px solid #e040fb;padding-right:10px;} th{background:#6c2eb9;}',
    minimal: 'h1{font-weight:300;letter-spacing:2px;border-bottom:1px solid #ccc;} th{background:#444;} body{line-height:2.0;}',
    academic: 'h1{text-align:center;color:#1b3a4b;border-bottom:2px solid #2e7d32;} h2{color:#1b3a4b;border-right:4px solid #2e7d32;padding-right:10px;} th{background:#1b3a4b;}',
    default: '',
};
// ─── Main HTML builder ────────────────────────────────────────────────────────
function buildHtml(bodyContent, template) {
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
      max-width: 80% !important;
      max-height: 180px !important;
      object-fit: cover !important;
      display: block;
      margin: 8px auto;
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
async function processImages(text, isAutoMode) {
    if (isAutoMode === true) {
        // AUTO MODE: skip ALL image fetching
        // AND remove all [IMAGE:] tags to keep PDF text clean
        return text.replace(/\[IMAGE:\s*(.*?)\]/ig, '');
    }
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
        // Enhance keyword for better professional results
        // TASK 5 FIX: extract keywords with section context
        const enhancedKeyword = `${keyword} professional high quality`;
        try {
            console.log('[ImageInterceptor] Fetching Unsplash for:', keyword);
            const unsplashUrl = await fetchUnsplashImage(enhancedKeyword);
            const imgRes = await fetch(unsplashUrl, { signal: AbortSignal.timeout(10000) });
            if (imgRes.ok) {
                const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
                const imgBase64 = imgBuffer.toString('base64');
                const imgHtml = `<img src="data:image/jpeg;base64,${imgBase64}" style="max-width:80%; max-height:180px; object-fit:cover; border-radius:6px; margin:6px auto; display:block;" alt="${keyword}"/>`;
                processedText = processedText.replace(fullTag, imgHtml);
                console.log('[ImageInterceptor] ✅ Unsplash image embedded for:', keyword);
            }
            else {
                console.warn('[ImageInterceptor] Unsplash HTTP failed for:', keyword, imgRes.status);
                processedText = processedText.replace(fullTag, ''); // Remove tag if fetch fails
            }
        }
        catch (err) {
            console.error('[ImageInterceptor] Failed/timed out for:', keyword, err);
            processedText = processedText.replace(fullTag, ''); // Never crash — just remove the tag
        }
    }
    return processedText;
}
// ─── Unsplash image fetcher (used as intelligent fallback) ────────────────────
async function fetchUnsplashImage(query) {
    try {
        const keyword = encodeURIComponent(query.trim());
        const url = `https://api.unsplash.com/photos/random?query=${keyword}&orientation=landscape&content_filter=high`;
        const response = await fetch(url, {
            headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` },
            signal: AbortSignal.timeout(6000)
        });
        if (!response.ok)
            return getFallbackImage(query);
        const data = await response.json();
        return data?.urls?.regular ?? getFallbackImage(query);
    }
    catch {
        return getFallbackImage(query);
    }
}
function getFallbackImage(query) {
    const keyword = encodeURIComponent(query.trim());
    // Use Lorem Picsum with a consistent seed based on keyword hash
    const seed = keyword.substring(0, 20);
    return `https://picsum.photos/seed/${seed}/800/400`;
}
// ─── Main export ──────────────────────────────────────────────────────────────
async function generateAiPDF(rawMarkdown, template = 'default', skipImages = false) {
    // 1. Sanitize
    const cleanMarkdown = sanitizeForPdf(rawMarkdown);
    // 1.5. Process Images (skip for auto/text-only mode)
    const processedText = skipImages
        ? cleanMarkdown.replace(/\[IMAGE:[^\]]*\]/g, '')
        : await processImages(cleanMarkdown);
    // 2. Markdown → HTML
    const bodyHtml = await Promise.resolve(marked_1.marked.parse(processedText));
    // 3. Full HTML document
    const fullHtml = buildHtml(bodyHtml, template);
    // 4. Output path
    const pdfPath = path_1.default.join(process.cwd(), 'temp', `document_${Date.now()}.pdf`);
    if (!fs_1.default.existsSync(path_1.default.dirname(pdfPath))) {
        fs_1.default.mkdirSync(path_1.default.dirname(pdfPath), { recursive: true });
    }
    // 5. Puppeteer
    const browser = await puppeteer_1.default.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none', '--disable-dev-shm-usage'],
        timeout: 90000,
    });
    try {
        const page = await browser.newPage();
        await page.setContent(fullHtml, { waitUntil: 'networkidle2', timeout: 90000 });
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
    }
    finally {
        await browser.close();
    }
    return pdfPath;
}
// ─── Re-render PDF from pre-built HTML (BUG 3) ────────────────────────────────
async function generateAiPDFFromHtml(fullHtml) {
    const pdfPath = path_1.default.join(process.cwd(), 'temp', `document_${Date.now()}.pdf`);
    if (!fs_1.default.existsSync(path_1.default.dirname(pdfPath))) {
        fs_1.default.mkdirSync(path_1.default.dirname(pdfPath), { recursive: true });
    }
    const browser = await puppeteer_1.default.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none', '--disable-dev-shm-usage'],
        timeout: 90000,
    });
    try {
        const page = await browser.newPage();
        await page.setContent(fullHtml, { waitUntil: 'networkidle2', timeout: 90000 });
        await page.evaluateHandle('document.fonts.ready');
        await new Promise(resolve => setTimeout(resolve, 1000));
        await page.pdf({
            path: pdfPath, format: 'A4', printBackground: true,
            margin: { top: '2.5cm', right: '2cm', bottom: '2.5cm', left: '2cm' },
            displayHeaderFooter: false, timeout: 90000,
        });
    }
    finally {
        await browser.close();
    }
    return pdfPath;
}
function getHtmlPageCount(rawMarkdown) {
    const clean = rawMarkdown
        .replace(/[\u2028\u2029]/g, '\n')
        .replace(/[\u0000-\u0008]/g, '')
        .replace(/[\u000B\u000C]/g, '\n')
        .replace(/[\u000E-\u001F]/g, '')
        .replace(/[\uFFFD]/g, '')
        .replace(/^```[a-z]*\n?/gm, '')
        .replace(/^```$/gm, '');
    const bodyHtml = String(marked_1.marked.parse(clean));
    const hrMatches = bodyHtml.match(/<hr\b[^>]*>/gi);
    const classMatches = bodyHtml.match(/class="page"/gi);
    const pbMatches = bodyHtml.match(/page-break-after|page-break-before/gi);
    const hrCount = hrMatches ? hrMatches.length : 0;
    const classCount = classMatches ? classMatches.length : 0;
    const pbCount = pbMatches ? pbMatches.length : 0;
    const totalBreaks = Math.max(hrCount, classCount, pbCount);
    return totalBreaks > 0 ? totalBreaks + 1 : 1;
}
// ─── Generate PDF + return HTML for caching (BUG 3) ──────────────────────────
async function generateAiPDFAndHtml(rawMarkdown, template = 'default', isAutoMode) {
    const cleanMarkdown = sanitizeForPdf(rawMarkdown);
    const processedText = await processImages(cleanMarkdown, isAutoMode);
    const bodyHtml = await Promise.resolve(marked_1.marked.parse(processedText));
    const fullHtml = buildHtml(bodyHtml, template);
    const pdfPath = await generateAiPDFFromHtml(fullHtml);
    return { pdfPath, html: fullHtml };
}
async function generateProImagePDF(opts) {
    const { topic, images, botToken, template = 'default' } = opts;
    // Build HTML body â€” header + pages with user images
    let bodyHtml = `<h1>${topic}</h1>\n`;
    for (const pageData of images) {
        if (!pageData.photos || pageData.photos.length === 0)
            continue;
        bodyHtml += `<h2>الصفحة ${pageData.page}</h2>\n`;
        for (const file_id of pageData.photos) {
            try {
                // Step 1: Get file path from Telegram
                const fileInfoRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(file_id)}`, { signal: AbortSignal.timeout(10000) });
                if (!fileInfoRes.ok) {
                    console.warn(`[ProImagePDF] getFile failed for ${file_id}: ${fileInfoRes.status}`);
                    continue;
                }
                const fileInfoData = await fileInfoRes.json();
                const filePath = fileInfoData.result?.file_path;
                if (!filePath) {
                    console.warn(`[ProImagePDF] No file_path for ${file_id}`);
                    continue;
                }
                // Step 2: Download as Buffer and convert to Base64
                const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
                const response = await fetch(fileUrl, { signal: AbortSignal.timeout(15000) });
                if (!response.ok) {
                    console.warn(`[ProImagePDF] Download failed for ${file_id}: ${response.status}`);
                    continue;
                }
                const arrayBuffer = await response.arrayBuffer();
                const base64 = Buffer.from(arrayBuffer).toString('base64');
                const mimeType = 'image/jpeg';
                const dataUri = `data:${mimeType};base64,${base64}`;
                // Step 3: Inject Base64 into HTML (NOT raw URL)
                bodyHtml += `<img src="${dataUri}"
          style="width:100%; max-height:350px; object-fit:cover;
                 border-radius:10px; margin:15px 0; display:block;"
          alt="صورة الصفحة ${pageData.page}">\n`;
            }
            catch (err) {
                console.error(`[ProImagePDF] Error processing file_id ${file_id}:`, err);
                // Never crash â€” skip this image
            }
        }
        // Add caption if exists
        if (pageData.caption) {
            bodyHtml += `<p style="text-align:center; color:#666; font-size:13px; margin-top:5px;">${pageData.caption}</p>\n`;
        }
        bodyHtml += `<hr>\n`;
    }
    // Build full HTML document
    const fullHtml = buildHtml(bodyHtml, template);
    // Output path
    const pdfPath = path_1.default.join(process.cwd(), 'temp', `pro_doc_${Date.now()}.pdf`);
    if (!fs_1.default.existsSync(path_1.default.dirname(pdfPath))) {
        fs_1.default.mkdirSync(path_1.default.dirname(pdfPath), { recursive: true });
    }
    // Puppeteer
    const browser = await puppeteer_1.default.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none', '--disable-dev-shm-usage'],
        timeout: 90000,
    });
    try {
        const page = await browser.newPage();
        await page.setContent(fullHtml, { waitUntil: 'networkidle2', timeout: 90000 });
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
    }
    finally {
        await browser.close();
    }
    return pdfPath;
}
//# sourceMappingURL=aiPdfService.js.map