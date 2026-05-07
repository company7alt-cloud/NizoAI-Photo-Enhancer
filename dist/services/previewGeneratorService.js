"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEMPLATE_NAMES = void 0;
exports.generatePreviewPNG = generatePreviewPNG;
// src/services/previewGeneratorService.ts
const sharp_1 = __importDefault(require("sharp"));
const arabic_reshaper_1 = __importDefault(require("arabic-reshaper"));
const bidi_js_1 = __importDefault(require("bidi-js"));
const bidiEngine = (0, bidi_js_1.default)();
// ─── Page Dimensions ──────────────────────────────────────────────────────────
const SIZE_HEIGHTS = {
    A4: 566, A5: 400, A3: 800, Letter: 517, Legal: 660, B5: 499, Executive: 491,
};
function getDims(pageSize) {
    return { w: 400, h: SIZE_HEIGHTS[pageSize] ?? 566 };
}
// ─── Arabic Text ─────────────────────────────────────────────────────────────
function prepareArabic(text) {
    if (!text)
        return '';
    try {
        const reshaped = arabic_reshaper_1.default.convertArabic(text);
        return bidiEngine.getReorderedString(reshaped, { dir: 'rtl' });
    }
    catch {
        return text;
    }
}
function escXml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
// ─── Template Names ──────────────────────────────────────────────────────────
exports.TEMPLATE_NAMES = {
    1: 'كلاسيكي', 2: 'احترافي', 3: 'زوايا', 4: 'أشرطة', 5: 'إطار مزدوج',
};
// ─── SVG Builder ─────────────────────────────────────────────────────────────
function buildSVG(opts, w, h) {
    const { templateId, lines = [] } = opts;
    const FS = 7.5;
    const LH = FS * 2.0;
    let deco = '';
    let cx = 20, cy = 20, cw = w - 40, ch = h - 40;
    switch (templateId) {
        case 1:
            deco = `<rect x="6" y="6" width="${w - 12}" height="${h - 12}" fill="none" stroke="#C8C8C8" stroke-width="0.7"/>`;
            break;
        case 2:
            deco = `
        <rect x="0" y="0" width="${w}" height="26" fill="#1A1A2E"/>
        <rect x="0" y="${h - 15}" width="${w}" height="15" fill="#1A1A2E"/>
        <line x1="12" y1="28" x2="${w - 12}" y2="28" stroke="#D0D0D0" stroke-width="0.4"/>
        <text x="${w / 2}" y="16" font-family="serif" font-size="6" fill="#EAEAEA" text-anchor="middle">✦ مستند احترافي ✦</text>`;
            cy = 34;
            ch = h - 52;
            break;
        case 3: {
            const m = 8, s = 14;
            deco = `
        <polyline points="${m},${m + s} ${m},${m} ${m + s},${m}" fill="none" stroke="#E63946" stroke-width="1.4"/>
        <polyline points="${w - m - s},${m} ${w - m},${m} ${w - m},${m + s}" fill="none" stroke="#E63946" stroke-width="1.4"/>
        <polyline points="${m},${h - m - s} ${m},${h - m} ${m + s},${h - m}" fill="none" stroke="#E63946" stroke-width="1.4"/>
        <polyline points="${w - m - s},${h - m} ${w - m},${h - m} ${w - m},${h - m - s}" fill="none" stroke="#E63946" stroke-width="1.4"/>`;
            break;
        }
        case 4:
            deco = `
        <rect x="0" y="0" width="5" height="${h}" fill="#457B9D"/>
        <rect x="${w - 5}" y="0" width="5" height="${h}" fill="#457B9D"/>`;
            cx = 13;
            cw = w - 26;
            break;
        case 5:
            deco = `
        <rect x="4" y="4" width="${w - 8}" height="${h - 8}" fill="none" stroke="#2D6A4F" stroke-width="1.4"/>
        <rect x="9" y="9" width="${w - 18}" height="${h - 18}" fill="none" stroke="#95D5B2" stroke-width="0.5"/>`;
            break;
    }
    // Render text lines
    let textSVG = '';
    let y = cy + FS + 2;
    const maxLines = Math.floor(ch / LH);
    const renderLines = lines.filter(l => l.text !== '---PAGE_BREAK---').slice(0, maxLines);
    for (const line of renderLines) {
        if (!line.text.trim()) {
            y += LH;
            continue;
        }
        const prepared = escXml(prepareArabic(line.text));
        let anchor = 'end', x = cx + cw;
        if (line.align === 'center') {
            anchor = 'middle';
            x = cx + cw / 2;
        }
        else if (line.align === 'left') {
            anchor = 'start';
            x = cx;
        }
        textSVG += `<text x="${x}" y="${y}" font-family="'Amiri','Noto Naskh Arabic','Arabic Typesetting',serif" font-size="${FS}" fill="#1a1a1a" text-anchor="${anchor}">${prepared}</text>\n`;
        y += LH;
    }
    // Empty state watermark
    const watermark = lines.length === 0
        ? `<text x="${w / 2}" y="${h / 2}" font-family="serif" font-size="9" fill="#DDDDDD" text-anchor="middle" dominant-baseline="middle">معاينة النموذج</text>`
        : '';
    // Size label bottom-right
    const sizeLabel = escXml(opts.pageSize || 'A4');
    const tplLabel = escXml(exports.TEMPLATE_NAMES[templateId] || '');
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#FFFFFF"/>
  ${deco}
  ${textSVG}
  ${watermark}
  <text x="${w - 8}" y="${h - 4}" font-family="sans-serif" font-size="4.5" fill="#BBBBBB" text-anchor="end">${tplLabel} · ${sizeLabel}</text>
</svg>`;
}
// ─── Public API ──────────────────────────────────────────────────────────────
async function generatePreviewPNG(opts) {
    const { w, h } = getDims(opts.pageSize);
    const svg = buildSVG(opts, w, h);
    return (0, sharp_1.default)(Buffer.from(svg, 'utf-8'))
        .png({ compressionLevel: 7 })
        .toBuffer();
}
//# sourceMappingURL=previewGeneratorService.js.map