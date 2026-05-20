"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAiPDF = generateAiPDF;
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
        // Strip AI-output code fences that sneak through
        .replace(/^```[a-z]*\n?/gm, '')
        .replace(/^```$/gm, '');
}
// ─── Local font paths ─────────────────────────────────────────────────────────
const FONTS_DIR = path_1.default.join(process.cwd(), 'assets', 'fonts');
function fontUrl(filename) {
    // Puppeteer reads local file:// paths fine on Linux/Windows
    return `file://${FONTS_DIR.replace(/\\/g, '/')}/${filename}`;
}
const TEMPLATES = {
    tables: {
        name: 'Professional Tables',
        headingColor: '#1a2744',
        accentColor: '#1a2744',
        bgColor: '#ffffff',
        textColor: '#1a1a1a',
        fontSizePt: 11,
        lineHeight: 1.75,
        tableHeaderBg: '#1a2744',
        tableHeaderColor: '#ffffff',
        tableBorder: '1px solid #8e9fbb',
        tableAltBg: '#f0f4fa',
        h1Style: 'font-size: 18pt; border-bottom: 3px solid #1a2744; padding-bottom: 8px;',
        h2Style: 'font-size: 14pt; color: #1a2744; border-right: 4px solid #1a2744; padding-right: 10px;',
        h3Style: 'font-size: 12pt; color: #2d4a7a;',
        blockquoteStyle: 'border-right: 4px solid #1a2744; background: #eef2fa; padding: 10px 16px; color: #2d4a7a;',
        hrStyle: 'border: 2px solid #1a2744;',
        extraCSS: `
      .document-body { padding-top: 0.5cm; }
      p { margin-bottom: 10px; }
    `,
    },
    report: {
        name: 'Corporate Report',
        headingColor: '#003366',
        accentColor: '#006699',
        bgColor: '#ffffff',
        textColor: '#222222',
        fontSizePt: 12,
        lineHeight: 1.85,
        tableHeaderBg: '#003366',
        tableHeaderColor: '#ffffff',
        tableBorder: '1px solid #b0c4d8',
        tableAltBg: '#f4f8fc',
        h1Style: 'font-size: 20pt; color: #003366; letter-spacing: -0.5px; padding-bottom: 6px; border-bottom: 2px solid #006699;',
        h2Style: 'font-size: 15pt; color: #003366; margin-top: 28px;',
        h3Style: 'font-size: 13pt; color: #006699;',
        blockquoteStyle: 'border-right: 5px solid #006699; background: #f0f8ff; padding: 12px 18px; font-style: italic;',
        hrStyle: 'border: 1.5px solid #006699; opacity: 0.4;',
        extraCSS: `
      .document-body { padding-top: 0.8cm; }
      p { margin-bottom: 14px; line-height: 1.9; }
    `,
    },
    formal: {
        name: 'Formal Official',
        headingColor: '#111111',
        accentColor: '#333333',
        bgColor: '#ffffff',
        textColor: '#111111',
        fontSizePt: 12,
        lineHeight: 2.0,
        tableHeaderBg: '#222222',
        tableHeaderColor: '#ffffff',
        tableBorder: '1px solid #444444',
        tableAltBg: '#f5f5f5',
        h1Style: 'font-size: 18pt; text-align: center; letter-spacing: 1px; border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 20px;',
        h2Style: 'font-size: 14pt; font-weight: bold; text-decoration: underline;',
        h3Style: 'font-size: 12pt; font-weight: bold;',
        blockquoteStyle: 'border: 1px solid #ccc; padding: 10px 16px; background: #fafafa;',
        hrStyle: 'border: 1px solid #111; margin: 24px 0;',
        extraCSS: `
      .document-body { padding-top: 1cm; }
      p { text-align: justify; margin-bottom: 18px; }
    `,
    },
    creative: {
        name: 'Creative Modern',
        headingColor: '#6c2eb9',
        accentColor: '#e040fb',
        bgColor: '#ffffff',
        textColor: '#1e1e2e',
        fontSizePt: 12,
        lineHeight: 1.8,
        tableHeaderBg: 'linear-gradient(90deg, #6c2eb9, #e040fb)',
        tableHeaderColor: '#ffffff',
        tableBorder: '1px solid #d0b0f0',
        tableAltBg: '#faf4ff',
        h1Style: 'font-size: 22pt; background: linear-gradient(90deg, #6c2eb9, #e040fb); -webkit-background-clip: text; -webkit-text-fill-color: transparent; padding-bottom: 8px;',
        h2Style: 'font-size: 16pt; color: #6c2eb9; border-right: 5px solid #e040fb; padding-right: 12px;',
        h3Style: 'font-size: 13pt; color: #8e44c9;',
        blockquoteStyle: 'border-right: 5px solid #e040fb; background: #faf4ff; padding: 12px 18px; color: #6c2eb9; border-radius: 6px;',
        hrStyle: 'border: 2px solid; border-image: linear-gradient(90deg,#6c2eb9,#e040fb) 1; margin: 20px 0;',
        extraCSS: `
      .document-body { padding-top: 0.5cm; }
      p { margin-bottom: 14px; }
    `,
    },
    minimal: {
        name: 'Minimal Elegant',
        headingColor: '#222222',
        accentColor: '#888888',
        bgColor: '#ffffff',
        textColor: '#333333',
        fontSizePt: 12,
        lineHeight: 2.0,
        tableHeaderBg: '#444444',
        tableHeaderColor: '#ffffff',
        tableBorder: '1px solid #dddddd',
        tableAltBg: '#fafafa',
        h1Style: 'font-size: 18pt; font-weight: 300; letter-spacing: 2px; border-bottom: 1px solid #ccc; padding-bottom: 10px;',
        h2Style: 'font-size: 14pt; font-weight: 400; color: #555;',
        h3Style: 'font-size: 12pt; color: #777;',
        blockquoteStyle: 'border-right: 3px solid #ccc; padding: 8px 16px; color: #666; font-style: italic;',
        hrStyle: 'border: 0; border-top: 1px solid #ddd; margin: 28px 0;',
        extraCSS: `
      .document-body { padding-top: 1.2cm; }
      p { margin-bottom: 18px; }
    `,
    },
    academic: {
        name: 'Academic Research',
        headingColor: '#1b3a4b',
        accentColor: '#2e7d32',
        bgColor: '#fffffe',
        textColor: '#1a1a1a',
        fontSizePt: 11.5,
        lineHeight: 1.9,
        tableHeaderBg: '#1b3a4b',
        tableHeaderColor: '#ffffff',
        tableBorder: '1px solid #7a9e9f',
        tableAltBg: '#f0f6f0',
        h1Style: 'font-size: 17pt; color: #1b3a4b; text-align: center; letter-spacing: 0.5px; border-bottom: 2px solid #2e7d32; padding-bottom: 8px;',
        h2Style: 'font-size: 14pt; color: #1b3a4b; border-right: 4px solid #2e7d32; padding-right: 10px;',
        h3Style: 'font-size: 12pt; color: #2e7d32;',
        blockquoteStyle: 'border-right: 4px solid #2e7d32; background: #f0f6f0; padding: 10px 16px; font-style: italic;',
        hrStyle: 'border: 1.5px solid #2e7d32; opacity: 0.5;',
        extraCSS: `
      .document-body { padding-top: 1cm; }
      p { text-align: justify; margin-bottom: 14px; }
    `,
    },
    default: {
        name: 'Default',
        headingColor: '#1a1a2e',
        accentColor: '#2c3e50',
        bgColor: '#ffffff',
        textColor: '#1a1a1a',
        fontSizePt: 13,
        lineHeight: 1.9,
        tableHeaderBg: '#2c3e50',
        tableHeaderColor: '#ffffff',
        tableBorder: '1px solid #ccc',
        tableAltBg: '#f8f9fa',
        h1Style: 'font-size: 18pt;',
        h2Style: 'font-size: 14pt;',
        h3Style: 'font-size: 12pt;',
        blockquoteStyle: 'border-right: 4px solid #2c3e50; padding: 10px 16px; background: #f5f5f5;',
        hrStyle: 'border: 1px solid #ccc;',
        extraCSS: '.document-body { padding-top: 1cm; }',
    },
};
// ─── HTML builder ─────────────────────────────────────────────────────────────
function buildHtml(htmlContent, tpl) {
    const cairoRegular = fontUrl('Cairo-Regular.ttf');
    const cairoBold = fontUrl('Cairo-Bold.ttf');
    const notoRegular = fontUrl('NotoSansArabic-Regular.ttf');
    const notoBold = fontUrl('NotoSansArabic-Bold.ttf');
    // Fallback: if Cairo.ttf exists (old path) use it too
    const omniaUrl = fontUrl('Omnia.ttf');
    return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <style>
    /* ── Local font declarations ── */
    @font-face {
      font-family: 'Cairo';
      src: url('${cairoRegular}') format('truetype');
      font-weight: 400;
      font-style: normal;
    }
    @font-face {
      font-family: 'Cairo';
      src: url('${cairoBold}') format('truetype');
      font-weight: 700;
      font-style: normal;
    }
    @font-face {
      font-family: 'Noto Sans Arabic';
      src: url('${notoRegular}') format('truetype');
      font-weight: 400;
    }
    @font-face {
      font-family: 'Noto Sans Arabic';
      src: url('${notoBold}') format('truetype');
      font-weight: 700;
    }
    /* Omnia fallback (old installs) */
    @font-face {
      font-family: 'Omnia';
      src: url('${omniaUrl}') format('truetype');
    }

    /* ── Page geometry ── */
    @page {
      size: A4;
      margin: 2.5cm 2cm 2.5cm 2cm;
    }

    /* ── Global reset & Arabic base ── */
    *, *::before, *::after { box-sizing: border-box; }

    html, body {
      direction: rtl;
      text-align: right;
      font-family: 'Cairo', 'Noto Sans Arabic', 'Omnia', Arial, sans-serif !important;
      unicode-bidi: plaintext;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
      margin: 0;
      padding: 0;
      font-size: ${tpl.fontSizePt}pt;
      line-height: ${tpl.lineHeight};
      color: ${tpl.textColor};
      background: ${tpl.bgColor};
    }

    /* Force Arabic font on ALL elements */
    p, div, span, li, td, th, h1, h2, h3, h4, h5, h6, blockquote, pre {
      direction: rtl;
      unicode-bidi: plaintext;
      font-family: 'Cairo', 'Noto Sans Arabic', 'Omnia', Arial, sans-serif !important;
    }

    /* ── Document body wrapper ── */
    .document-body { width: 100%; }

    /* ── Headings ── */
    h1 {
      color: ${tpl.headingColor};
      margin-top: 24px; margin-bottom: 14px;
      page-break-after: avoid;
      ${tpl.h1Style}
    }
    h2 {
      color: ${tpl.headingColor};
      margin-top: 20px; margin-bottom: 10px;
      page-break-after: avoid;
      ${tpl.h2Style}
    }
    h3 {
      color: ${tpl.headingColor};
      margin-top: 16px; margin-bottom: 8px;
      page-break-after: avoid;
      ${tpl.h3Style}
    }

    /* ── Paragraphs ── */
    p { word-wrap: break-word; }

    /* ── Blockquote ── */
    blockquote {
      margin: 16px 0;
      ${tpl.blockquoteStyle}
    }

    /* ── Horizontal rule ── */
    hr { ${tpl.hrStyle} }

    /* ── Enterprise table engine ── */
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      page-break-inside: avoid;
      direction: rtl;
      margin: 20px 0;
    }
    thead {
      display: table-header-group;
    }
    tr {
      page-break-inside: avoid;
    }
    th {
      background: ${tpl.tableHeaderBg};
      color: ${tpl.tableHeaderColor};
      padding: 10px 12px;
      text-align: right;
      font-weight: 700;
      border: ${tpl.tableBorder};
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    td {
      padding: 9px 12px;
      border: ${tpl.tableBorder};
      text-align: right;
      vertical-align: top;
      word-break: break-word;
      overflow-wrap: anywhere;
      white-space: normal;
    }
    tr:nth-child(even) td {
      background: ${tpl.tableAltBg};
    }

    /* ── Premium image engine ── */
    img {
      max-width: 100% !important;
      max-height: 45vh !important;
      object-fit: contain !important;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.08);
      display: block;
      margin: 12px auto;
    }

    /* ── Lists ── */
    ul, ol { padding-right: 20px; padding-left: 0; margin: 10px 0; }
    li { margin-bottom: 6px; }

    /* ── Code inline ── */
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }

    ${tpl.extraCSS}
  </style>
</head>
<body>
  <div class="document-body">
    ${htmlContent}
  </div>
</body>
</html>`;
}
// ─── Main export ──────────────────────────────────────────────────────────────
async function generateAiPDF(rawMarkdown, template = 'default') {
    // 1. Sanitize
    const cleanMarkdown = sanitizeForPdf(rawMarkdown);
    // 2. Convert Markdown → HTML
    const htmlContent = await Promise.resolve(marked_1.marked.parse(cleanMarkdown));
    // 3. Resolve template
    const tplKey = template in TEMPLATES ? template : 'default';
    const tpl = TEMPLATES[tplKey];
    // 4. Build full HTML
    const fullHtml = buildHtml(htmlContent, tpl);
    // 5. Ensure temp dir
    const pdfPath = path_1.default.join(process.cwd(), 'temp', `document_${Date.now()}.pdf`);
    if (!fs_1.default.existsSync(path_1.default.dirname(pdfPath))) {
        fs_1.default.mkdirSync(path_1.default.dirname(pdfPath), { recursive: true });
    }
    // 6. Puppeteer render
    const browser = await puppeteer_1.default.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
    });
    try {
        const page = await browser.newPage();
        await page.setContent(fullHtml, { waitUntil: 'load' });
        // Font loading with 5s max race (prevents deadlock on missing fonts)
        await Promise.race([
            page.evaluateHandle('document.fonts.ready'),
            new Promise(resolve => setTimeout(resolve, 5000)),
        ]);
        await page.pdf({
            path: pdfPath,
            format: 'A4',
            printBackground: true,
            margin: { top: '2.5cm', right: '2cm', bottom: '2.5cm', left: '2cm' },
            displayHeaderFooter: false,
        });
    }
    finally {
        await browser.close();
    }
    return pdfPath;
}
//# sourceMappingURL=aiPdfService.js.map