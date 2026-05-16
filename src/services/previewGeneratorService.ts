// src/services/previewGeneratorService.ts
import sharp from 'sharp';
import arabicReshaper from 'arabic-reshaper';
import bidiFactory from 'bidi-js';

const bidiEngine = bidiFactory();

export interface PreviewLine {
  text: string;
  align: 'right' | 'center' | 'left';
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  size?: 'small' | 'normal' | 'large';
  style?: string;
  // Image-line fields (same as DocLine)
  type?: 'text' | 'image' | 'image_row';
  fileId?: string;
  imageLines?: number;
  imageMask?: 'square' | 'rounded' | 'circle';
  rowImages?: Array<{
    fileId: string;
    lines: number;
    align: 'right' | 'center' | 'left';
    mask: 'square' | 'rounded' | 'circle';
    caption?: string;
  }>;
}

export interface DocPreviewOptions {
  templateId: number;
  pageSize: string;
  lines?: PreviewLine[];
  selectedFont?: string;
  docBgColor?: string;   // e.g. '#1A1A1A' — colored template background
  docTextColor?: string; // e.g. '#FFFFFF' — colored template text color
}

// ─── Scale factor: old canvas was 400 wide, new is 800 ───────────────────────
const SCALE = 2;

// ─── Page Dimensions (800 wide, A4 ratio = 1:1.414) ─────────────────────────

const SIZE_HEIGHTS: Record<string, number> = {
  A4: 1131, A5: 800, A3: 1600, Letter: 1035, Legal: 1319, B5: 998, Executive: 982,
};

function getDims(pageSize: string): { w: number; h: number } {
  return { w: 800, h: SIZE_HEIGHTS[pageSize] ?? 1131 };
}

// ─── Arabic Text ─────────────────────────────────────────────────────────────

function fixArabicPunctuation(text: string): string {
  return text
    .replace(/\(/g, '\u202A(\u202C')
    .replace(/\)/g, '\u202A)\u202C')
    .replace(/\[/g, '\u202A[\u202C')
    .replace(/\]/g, '\u202A]\u202C');
}

function prepareArabic(text: string): string {
  if (!text) return '';
  try {
    const fixedText = fixArabicPunctuation(text);
    const reshaped: string = arabicReshaper.convertArabic(fixedText);
    return bidiEngine.getReorderedString(reshaped, { dir: 'rtl' });
  } catch {
    return text;
  }
}

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Template Names ──────────────────────────────────────────────────────────

export const TEMPLATE_NAMES: Record<number, string> = {
  1: 'كلاسيكي', 2: 'احترافي', 3: 'زوايا', 4: 'أشرطة', 5: 'إطار مزدوج',
};

// ─── Font size helpers ────────────────────────────────────────────────────────

function getFS(size?: string): number {
  // Base was 7.5 at scale-1. Scaled to 15 + extra +5 bump → effective visual size ~12.5 old-equivalent
  const base = 15;   // 7.5 * SCALE = 15, then +5 bump added below
  const bump = 5;
  if (size === 'small') return base - 3 + bump;
  if (size === 'large') return base + 4 + bump;
  return base + bump; // 'normal'
}

// ─── Telegram file URL helper (REST only, no bot instance) ───────────────────

async function getPreviewFileUrl(fileId: string): Promise<string> {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error('BOT_TOKEN not set');
  const res = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
  const json = await res.json() as { ok: boolean; result?: { file_path?: string } };
  if (!json.ok || !json.result?.file_path) {
    throw new Error(`getFile failed for preview: ${JSON.stringify(json)}`);
  }
  return `https://api.telegram.org/file/bot${token}/${json.result.file_path}`;
}

// ─── Fetch image + apply mask → return base64 PNG ────────────────────────────

async function fetchImageBase64(
  fileId: string,
  maxW: number,
  _maxH: number,
  mask?: 'square' | 'rounded' | 'circle'
): Promise<string | null> {
  try {
    const url = await getPreviewFileUrl(fileId);
    const imgRes = await fetch(url);
    if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`);
    const rawBuf = await imgRes.arrayBuffer();
    let buf: Buffer<ArrayBuffer> = Buffer.from(new Uint8Array(rawBuf)) as unknown as Buffer<ArrayBuffer>;

    const meta = await sharp(buf).metadata();
    const originalWidth = meta.width || 1;
    const originalHeight = meta.height || 1;
    const aspectRatio = originalWidth / originalHeight;

    // Use user requested formula:
    const scaledWidth = Math.min(maxW, originalWidth);
    const scaledHeight = scaledWidth / aspectRatio;

    buf = await sharp(buf)
      .resize(Math.round(scaledWidth), Math.round(scaledHeight), { fit: 'inside', withoutEnlargement: true })
      .png().toBuffer() as unknown as Buffer<ArrayBuffer>;

    if (mask === 'circle') {
      const size = Math.min(Math.round(scaledWidth), Math.round(scaledHeight));
      const r = Math.floor(size / 2);
      const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">` +
                  `<circle cx="${r}" cy="${r}" r="${r}"/></svg>`;
      buf = await sharp(buf)
        .resize(size, size, { fit: 'cover', position: 'centre' })
        .composite([{ input: Buffer.from(svg), blend: 'dest-in' }])
        .png().toBuffer() as unknown as Buffer<ArrayBuffer>;
    } else if (mask === 'rounded') {
      const iw = Math.round(scaledWidth);
      const ih = Math.round(scaledHeight);
      const rx = Math.round(Math.min(iw, ih) * 0.1);
      const svg = `<svg width="${iw}" height="${ih}" xmlns="http://www.w3.org/2000/svg">` +
                  `<rect x="0" y="0" width="${iw}" height="${ih}" rx="${rx}" ry="${rx}"/></svg>`;
      buf = await sharp(buf)
        .composite([{ input: Buffer.from(svg), blend: 'dest-in' }])
        .png().toBuffer() as unknown as Buffer<ArrayBuffer>;
    }

    return buf.toString('base64');
  } catch (err) {
    console.error('[PREVIEW] fetchImageBase64 failed, skipping:', err);
    return null;
  }
}

// ─── SVG Builder ─────────────────────────────────────────────────────────────

async function buildSVG(opts: DocPreviewOptions, w: number, h: number): Promise<string> {
  const { templateId, lines = [] } = opts;
  const S = SCALE;

  const bgColor  = opts.docBgColor  || '#FFFFFF';
  const txtColor = opts.docTextColor || '#1a1a1a';

  // Content area defaults (scaled from old 20px margin)
  let cx = 40, cy = 40, cw = w - 80, ch = h - 80;

  let deco = '';

  switch (templateId) {
    case 1:
      deco = `<rect x="${6*S}" y="${6*S}" width="${w - 12*S}" height="${h - 12*S}" fill="none" stroke="#C8C8C8" stroke-width="${0.7*S}"/>`;
      break;
    case 2:
      deco = `
        <rect x="0" y="0" width="${w}" height="${26*S}" fill="#1A1A2E"/>
        <rect x="0" y="${h - 15*S}" width="${w}" height="${15*S}" fill="#1A1A2E"/>
        <line x1="${12*S}" y1="${28*S}" x2="${w - 12*S}" y2="${28*S}" stroke="#D0D0D0" stroke-width="${0.4*S}"/>
        <text x="${w/2}" y="${16*S}" font-family="serif" font-size="${6*S}" fill="#EAEAEA" text-anchor="middle">✦ مستند احترافي ✦</text>`;
      cy = 34*S; ch = h - 52*S;
      break;
    case 3: {
      const m = 8*S, s = 14*S;
      deco = `
        <polyline points="${m},${m+s} ${m},${m} ${m+s},${m}" fill="none" stroke="#E63946" stroke-width="${1.4*S}"/>
        <polyline points="${w-m-s},${m} ${w-m},${m} ${w-m},${m+s}" fill="none" stroke="#E63946" stroke-width="${1.4*S}"/>
        <polyline points="${m},${h-m-s} ${m},${h-m} ${m+s},${h-m}" fill="none" stroke="#E63946" stroke-width="${1.4*S}"/>
        <polyline points="${w-m-s},${h-m} ${w-m},${h-m} ${w-m},${h-m-s}" fill="none" stroke="#E63946" stroke-width="${1.4*S}"/>`;
      break;
    }
    case 4:
      deco = `
        <rect x="0" y="0" width="${5*S}" height="${h}" fill="#457B9D"/>
        <rect x="${w - 5*S}" y="0" width="${5*S}" height="${h}" fill="#457B9D"/>`;
      cx = 13*S; cw = w - 26*S;
      break;
    case 5:
      deco = `
        <rect x="${4*S}" y="${4*S}" width="${w - 8*S}" height="${h - 8*S}" fill="none" stroke="#2D6A4F" stroke-width="${1.4*S}"/>
        <rect x="${9*S}" y="${9*S}" width="${w - 18*S}" height="${h - 18*S}" fill="none" stroke="#95D5B2" stroke-width="${0.5*S}"/>`;
      break;
  }

  // Render lines (text + images)
  let textSVG = '';
  let y = cy + 2;

  for (const line of lines) {
    if (y > cy + ch) break;

    // ── Image / Image-Row line ───────────────────────────────────────────────
    if ((line.type === 'image' || line.type === 'image_row') && (line.fileId || line.rowImages)) {
      const images = (line.rowImages && line.rowImages.length > 0)
        ? line.rowImages
        : (line.fileId ? [{ fileId: line.fileId, lines: line.imageLines || 5, align: line.align || 'center', mask: line.imageMask }] : []);

      if (images.length === 0) continue;

      const allocH = (images[0].lines || 5) * 15 * S / SCALE;
      if (y + allocH > cy + ch) break;

      const gap = 15 * S;
      const imgW = images.length === 1 ? cw : images.length === 2 ? (cw - gap) / 2 : (cw - gap * 2) / 3;

      const imagesWithMeta = await Promise.all(images.map(async (img) => {
        const b64 = await fetchImageBase64(img.fileId, imgW, allocH, img.mask as any);
        if (!b64) return { b64: null, iw: imgW, ih: allocH };
        const meta = await sharp(Buffer.from(b64, 'base64')).metadata().catch(() => ({ width: imgW, height: allocH }));
        return { b64, iw: meta.width || imgW, ih: meta.height || allocH };
      }));

      // Calculate the tallest image in this row to determine the actual Y advance
      const rowActualH = Math.max(...imagesWithMeta.map(im => im.ih), 0);

      for (let imgIdx = 0; imgIdx < images.length; imgIdx++) {
        const img = images[imgIdx];
        const im = imagesWithMeta[imgIdx];
        
        let alignX: number;
        if (images.length === 1) {
          alignX = img.align === 'left' ? cx : img.align === 'center' ? cx + (cw / 2) - (im.iw / 2) : cx + cw - im.iw;
        } else {
          alignX = cx + imgIdx * (imgW + gap) + (imgW - im.iw) / 2;
        }

        if (im.b64) {
          const imgY = y + (rowActualH - im.ih) / 2;
          textSVG += `<image x="${alignX}" y="${imgY}" width="${im.iw}" height="${im.ih}" href="data:image/png;base64,${im.b64}"/>\n`;
        } else {
          textSVG += `<rect x="${alignX}" y="${y}" width="${imgW}" height="${allocH}" fill="#F0F0F0" rx="${4*S}"/>`;
          textSVG += `<text x="${alignX + imgW/2}" y="${y + allocH/2}" font-family="sans-serif" font-size="${10*S}" fill="#AAAAAA" text-anchor="middle" dominant-baseline="middle">📷</text>`;
        }
      }
      y += rowActualH + 8;
      continue;
    }

    // ── Text line ──────────────────────────────────────────────────────────
    if (line.text === '---PAGE_BREAK---') {
      textSVG += `<line x1="${cx}" y1="${y}" x2="${cx + cw}" y2="${y}" stroke="#CCCCCC" stroke-width="${S}" stroke-dasharray="${3*S},${3*S}"/>`;
      y += 6*S;
      continue;
    }

    const FS = getFS(line.size);
    const LH = FS * 2.2;

    if (y + LH > cy + ch) break;
    if (!line.text?.trim()) { y += LH * 0.6; continue; }

    const isArabic = /[\u0600-\u06FF]/.test(line.text || '');
    const prepared = escXml(isArabic ? prepareArabic(line.text) : line.text);
    
    let anchor = isArabic ? 'end' : 'start';
    let x = isArabic ? cx + cw : cx;
    
    if (line.align === 'center') { anchor = 'middle'; x = cx + cw / 2; }

    const fontWeight = line.bold ? 'bold' : 'normal';
    const fontStyle = line.italic ? 'italic' : 'normal';

    if (line.style === 'highlight') {
      const approxWidth = Math.min(prepared.length * FS * 0.55, cw);
      const bgX = anchor === 'end' ? x - approxWidth : anchor === 'middle' ? x - approxWidth / 2 : x;
      textSVG += `<rect x="${bgX}" y="${y - FS}" width="${approxWidth}" height="${FS * 1.3}" fill="#FFF3A3" rx="${2*S}"/>`;
    }

    if (line.style === 'quote') {
      textSVG += `<rect x="${cx}" y="${y - FS}" width="${3*S}" height="${FS * 1.5}" fill="#457B9D" rx="${S}"/>`;
    }

    if (line.style === 'divider') {
      textSVG += `<line x1="${cx + 10*S}" y1="${y - FS/2}" x2="${cx + cw - 10*S}" y2="${y - FS/2}" stroke="#AAAAAA" stroke-width="${S}"/>`;
      y += LH * 0.5;
      continue;
    }

    textSVG += `<text x="${x}" y="${y}" font-family="'${opts.selectedFont || 'Amiri'}', 'Noto Color Emoji', 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Naskh Arabic', 'Arabic Typesetting', serif" font-size="${FS}" font-weight="${fontWeight}" font-style="${fontStyle}" fill="${txtColor}" text-anchor="${anchor}">${prepared}</text>\n`;

    if (line.underline) {
      const approxWidth = Math.min(prepared.length * FS * 0.55, cw);
      const ulX = anchor === 'end' ? x - approxWidth : anchor === 'middle' ? x - approxWidth / 2 : x;
      textSVG += `<line x1="${ulX}" y1="${y + 2*S}" x2="${ulX + approxWidth}" y2="${y + 2*S}" stroke="#1a1a1a" stroke-width="${S * 0.7}"/>`;
    }

    y += LH;
  }

  // Empty state watermark
  const watermark = lines.length === 0
    ? `<text x="${w/2}" y="${h/2}" font-family="serif" font-size="${18*S}" fill="#DDDDDD" text-anchor="middle" dominant-baseline="middle">معاينة النموذج</text>`
    : '';

  // Labels bottom-right
  const sizeLabel = escXml(opts.pageSize || 'A4');
  const tplLabel = escXml(TEMPLATE_NAMES[templateId] || '');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${bgColor}"/>
  ${deco}
  ${textSVG}
  ${watermark}
  <text x="${w - 8*S}" y="${h - 4*S}" font-family="sans-serif" font-size="${4.5*S}" fill="#BBBBBB" text-anchor="end">${tplLabel} · ${sizeLabel}</text>
</svg>`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function generatePreviewPNG(opts: DocPreviewOptions): Promise<Buffer> {
  const { w, h } = getDims(opts.pageSize);
  const svg = await buildSVG(opts, w, h);
  return sharp(Buffer.from(svg, 'utf-8'))
    .png({ compressionLevel: 3 })
    .toBuffer();
}
