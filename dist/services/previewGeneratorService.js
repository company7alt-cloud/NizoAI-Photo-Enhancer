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
// ─── Scale factor: old canvas was 400 wide, new is 800 ───────────────────────
const SCALE = 2;
// ─── Page Dimensions (800 wide, A4 ratio = 1:1.414) ─────────────────────────
const SIZE_HEIGHTS = {
    A4: 1131, A5: 800, A3: 1600, Letter: 1035, Legal: 1319, B5: 998, Executive: 982,
};
function getDims(pageSize) {
    return { w: 800, h: SIZE_HEIGHTS[pageSize] ?? 1131 };
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
// ─── Font size helpers ────────────────────────────────────────────────────────
function getFS(size) {
    // Base was 7.5 at scale-1. Scaled to 15 + extra +5 bump → effective visual size ~12.5 old-equivalent
    const base = 15; // 7.5 * SCALE = 15, then +5 bump added below
    const bump = 5;
    if (size === 'small')
        return base - 3 + bump;
    if (size === 'large')
        return base + 4 + bump;
    return base + bump; // 'normal'
}
// ─── Telegram file URL helper (REST only, no bot instance) ───────────────────
async function getPreviewFileUrl(fileId) {
    const token = process.env.BOT_TOKEN;
    if (!token)
        throw new Error('BOT_TOKEN not set');
    const res = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
    const json = await res.json();
    if (!json.ok || !json.result?.file_path) {
        throw new Error(`getFile failed for preview: ${JSON.stringify(json)}`);
    }
    return `https://api.telegram.org/file/bot${token}/${json.result.file_path}`;
}
// ─── Fetch image + apply mask → return base64 PNG ────────────────────────────
async function fetchImageBase64(fileId, maxW, maxH, mask) {
    try {
        const url = await getPreviewFileUrl(fileId);
        const imgRes = await fetch(url);
        if (!imgRes.ok)
            throw new Error(`HTTP ${imgRes.status}`);
        const rawBuf = await imgRes.arrayBuffer();
        let buf = Buffer.from(new Uint8Array(rawBuf));
        // Resize to preview bounds first
        buf = await (0, sharp_1.default)(buf).resize(maxW, maxH, { fit: 'inside', withoutEnlargement: true }).toBuffer();
        const meta = await (0, sharp_1.default)(buf).metadata();
        const iw = meta.width ?? maxW;
        const ih = meta.height ?? maxH;
        if (mask === 'circle') {
            const size = Math.min(iw, ih);
            const r = Math.floor(size / 2);
            const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">` +
                `<circle cx="${r}" cy="${r}" r="${r}"/></svg>`;
            buf = await (0, sharp_1.default)(buf)
                .resize(size, size, { fit: 'cover', position: 'centre' })
                .composite([{ input: Buffer.from(svg), blend: 'dest-in' }])
                .png().toBuffer();
        }
        else if (mask === 'rounded') {
            const rx = Math.round(Math.min(iw, ih) * 0.1);
            const svg = `<svg width="${iw}" height="${ih}" xmlns="http://www.w3.org/2000/svg">` +
                `<rect x="0" y="0" width="${iw}" height="${ih}" rx="${rx}" ry="${rx}"/></svg>`;
            buf = await (0, sharp_1.default)(buf)
                .composite([{ input: Buffer.from(svg), blend: 'dest-in' }])
                .png().toBuffer();
        }
        else {
            // square — ensure PNG format for consistent embedding
            buf = await (0, sharp_1.default)(buf).png().toBuffer();
        }
        return buf.toString('base64');
    }
    catch (err) {
        console.error('[PREVIEW] fetchImageBase64 failed, skipping:', err);
        return null;
    }
}
// ─── SVG Builder ─────────────────────────────────────────────────────────────
async function buildSVG(opts, w, h) {
    const { templateId, lines = [] } = opts;
    const S = SCALE;
    const bgColor = opts.docBgColor || '#FFFFFF';
    const txtColor = opts.docTextColor || '#1a1a1a';
    // Content area defaults (scaled from old 20px margin)
    let cx = 40, cy = 40, cw = w - 80, ch = h - 80;
    let deco = '';
    switch (templateId) {
        case 1:
            deco = `<rect x="${6 * S}" y="${6 * S}" width="${w - 12 * S}" height="${h - 12 * S}" fill="none" stroke="#C8C8C8" stroke-width="${0.7 * S}"/>`;
            break;
        case 2:
            deco = `
        <rect x="0" y="0" width="${w}" height="${26 * S}" fill="#1A1A2E"/>
        <rect x="0" y="${h - 15 * S}" width="${w}" height="${15 * S}" fill="#1A1A2E"/>
        <line x1="${12 * S}" y1="${28 * S}" x2="${w - 12 * S}" y2="${28 * S}" stroke="#D0D0D0" stroke-width="${0.4 * S}"/>
        <text x="${w / 2}" y="${16 * S}" font-family="serif" font-size="${6 * S}" fill="#EAEAEA" text-anchor="middle">✦ مستند احترافي ✦</text>`;
            cy = 34 * S;
            ch = h - 52 * S;
            break;
        case 3: {
            const m = 8 * S, s = 14 * S;
            deco = `
        <polyline points="${m},${m + s} ${m},${m} ${m + s},${m}" fill="none" stroke="#E63946" stroke-width="${1.4 * S}"/>
        <polyline points="${w - m - s},${m} ${w - m},${m} ${w - m},${m + s}" fill="none" stroke="#E63946" stroke-width="${1.4 * S}"/>
        <polyline points="${m},${h - m - s} ${m},${h - m} ${m + s},${h - m}" fill="none" stroke="#E63946" stroke-width="${1.4 * S}"/>
        <polyline points="${w - m - s},${h - m} ${w - m},${h - m} ${w - m},${h - m - s}" fill="none" stroke="#E63946" stroke-width="${1.4 * S}"/>`;
            break;
        }
        case 4:
            deco = `
        <rect x="0" y="0" width="${5 * S}" height="${h}" fill="#457B9D"/>
        <rect x="${w - 5 * S}" y="0" width="${5 * S}" height="${h}" fill="#457B9D"/>`;
            cx = 13 * S;
            cw = w - 26 * S;
            break;
        case 5:
            deco = `
        <rect x="${4 * S}" y="${4 * S}" width="${w - 8 * S}" height="${h - 8 * S}" fill="none" stroke="#2D6A4F" stroke-width="${1.4 * S}"/>
        <rect x="${9 * S}" y="${9 * S}" width="${w - 18 * S}" height="${h - 18 * S}" fill="none" stroke="#95D5B2" stroke-width="${0.5 * S}"/>`;
            break;
    }
    // Render lines (text + images)
    let textSVG = '';
    let y = cy + 2;
    for (const line of lines) {
        if (y > cy + ch)
            break;
        // ── Image line ──────────────────────────────────────────────────────────
        if (line.type === 'image' && line.fileId) {
            const allocH = (line.imageLines || 5) * 15 * S / SCALE;
            if (y + allocH > cy + ch)
                break;
            const b64 = await fetchImageBase64(line.fileId, cw, allocH, line.imageMask);
            if (b64) {
                // Calculate position from align
                const imgMeta = await (0, sharp_1.default)(Buffer.from(b64, 'base64')).metadata().catch(() => ({ width: cw, height: allocH }));
                const iw = Math.min(imgMeta.width ?? cw, cw);
                const ih = Math.min(imgMeta.height ?? allocH, allocH);
                let imgX = cx; // left default
                if (line.align === 'right')
                    imgX = cx + cw - iw;
                else if (line.align === 'center')
                    imgX = cx + (cw - iw) / 2;
                textSVG += `<image x="${imgX}" y="${y}" width="${iw}" height="${ih}" href="data:image/png;base64,${b64}"/>\n`;
                y += ih + 8;
            }
            else {
                // Placeholder rect when image load failed
                textSVG += `<rect x="${cx}" y="${y}" width="${cw}" height="${allocH}" fill="#F0F0F0" rx="${4 * S}"/>`;
                textSVG += `<text x="${cx + cw / 2}" y="${y + allocH / 2}" font-family="sans-serif" font-size="${10 * S}" fill="#AAAAAA" text-anchor="middle" dominant-baseline="middle">📷</text>`;
                y += allocH + 8;
            }
            continue;
        }
        // ── Text line ──────────────────────────────────────────────────────────
        if (line.text === '---PAGE_BREAK---') {
            textSVG += `<line x1="${cx}" y1="${y}" x2="${cx + cw}" y2="${y}" stroke="#CCCCCC" stroke-width="${S}" stroke-dasharray="${3 * S},${3 * S}"/>`;
            y += 6 * S;
            continue;
        }
        const FS = getFS(line.size);
        const LH = FS * 2.2;
        if (y + LH > cy + ch)
            break;
        if (!line.text?.trim()) {
            y += LH * 0.6;
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
        const fontWeight = line.bold ? 'bold' : 'normal';
        const fontStyle = line.italic ? 'italic' : 'normal';
        if (line.style === 'highlight') {
            const approxWidth = Math.min(prepared.length * FS * 0.55, cw);
            const bgX = anchor === 'end' ? x - approxWidth : anchor === 'middle' ? x - approxWidth / 2 : x;
            textSVG += `<rect x="${bgX}" y="${y - FS}" width="${approxWidth}" height="${FS * 1.3}" fill="#FFF3A3" rx="${2 * S}"/>`;
        }
        if (line.style === 'quote') {
            textSVG += `<rect x="${cx}" y="${y - FS}" width="${3 * S}" height="${FS * 1.5}" fill="#457B9D" rx="${S}"/>`;
        }
        if (line.style === 'divider') {
            textSVG += `<line x1="${cx + 10 * S}" y1="${y - FS / 2}" x2="${cx + cw - 10 * S}" y2="${y - FS / 2}" stroke="#AAAAAA" stroke-width="${S}"/>`;
            y += LH * 0.5;
            continue;
        }
        textSVG += `<text x="${x}" y="${y}" font-family="'${opts.selectedFont || 'Amiri'}','Noto Naskh Arabic','Arabic Typesetting',serif" font-size="${FS}" font-weight="${fontWeight}" font-style="${fontStyle}" fill="${txtColor}" text-anchor="${anchor}">${prepared}</text>\n`;
        if (line.underline) {
            const approxWidth = Math.min(prepared.length * FS * 0.55, cw);
            const ulX = anchor === 'end' ? x - approxWidth : anchor === 'middle' ? x - approxWidth / 2 : x;
            textSVG += `<line x1="${ulX}" y1="${y + 2 * S}" x2="${ulX + approxWidth}" y2="${y + 2 * S}" stroke="#1a1a1a" stroke-width="${S * 0.7}"/>`;
        }
        y += LH;
    }
    // Empty state watermark
    const watermark = lines.length === 0
        ? `<text x="${w / 2}" y="${h / 2}" font-family="serif" font-size="${18 * S}" fill="#DDDDDD" text-anchor="middle" dominant-baseline="middle">معاينة النموذج</text>`
        : '';
    // Labels bottom-right
    const sizeLabel = escXml(opts.pageSize || 'A4');
    const tplLabel = escXml(exports.TEMPLATE_NAMES[templateId] || '');
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${bgColor}"/>
  ${deco}
  ${textSVG}
  ${watermark}
  <text x="${w - 8 * S}" y="${h - 4 * S}" font-family="sans-serif" font-size="${4.5 * S}" fill="#BBBBBB" text-anchor="end">${tplLabel} · ${sizeLabel}</text>
</svg>`;
}
// ─── Public API ──────────────────────────────────────────────────────────────
async function generatePreviewPNG(opts) {
    const { w, h } = getDims(opts.pageSize);
    const svg = await buildSVG(opts, w, h);
    return (0, sharp_1.default)(Buffer.from(svg, 'utf-8'))
        .png({ compressionLevel: 3 })
        .toBuffer();
}
//# sourceMappingURL=previewGeneratorService.js.map