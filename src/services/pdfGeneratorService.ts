// src/services/pdfGeneratorService.ts
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import arabicReshaper from 'arabic-reshaper';
import https from 'https';

function prepareArabicText(text: string): string {
  if (!text || typeof text !== 'string' || text.trim() === '') return '';
  try {
    const cleaned = text
      .replace(/[\uFFFD\uFFFC\uFFFB\uFFFA]/g, '')
      .replace(/[\u200B\u200C\u200D\u200E\u200F]/g, '')
      .replace(/[\u202A\u202B\u202C\u202D\u202E]/g, '')
      .replace(/[\uFEFF]/g, '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .trim();
    const hasArabic = /[\u0600-\u06FF]/.test(cleaned);
    if (!hasArabic) return cleaned;
    return arabicReshaper.convertArabic(cleaned);
  } catch (error) {
    console.error('[PDF] Arabic text preparation failed:', error);
    return text;
  }
}

function registerAllFonts(doc: PDFKit.PDFDocument): string {
  const possibleBases = [
    path.join(process.cwd(), 'src', 'assets', 'fonts'),
    path.join(process.cwd(), 'assets', 'fonts'),
    path.join(__dirname, '..', '..', 'assets', 'fonts'),
    path.join(__dirname, '..', 'assets', 'fonts'),
    path.join(__dirname, 'assets', 'fonts'),
  ];

  const fonts = [
    { name: 'Omnia', file: 'Omnia.ttf' },
    { name: 'ModernPro', file: 'ModernPro.ttf' },
    { name: 'Thamanya', file: 'Thamanya.ttf' },
    { name: 'Amiri', file: 'Amiri.ttf' },
    { name: 'Amiri-Regular', file: 'Amiri-Regular.ttf' },
    { name: 'Amiri-Bold', file: 'Amiri-Bold.ttf' },
    { name: 'Cairo', file: 'Cairo.ttf' },
    { name: 'Almarai', file: 'Almarai.ttf' },
    { name: 'NotoNaskh', file: 'NotoNaskh.ttf' },
    { name: 'NotoEmoji', file: 'NotoEmoji.ttf' },
  ];

  let fontsDir: string | null = null;
  for (const base of possibleBases) {
    if (fs.existsSync(path.join(base, 'Amiri.ttf'))) {
      fontsDir = base;
      break;
    }
  }

  if (!fontsDir) {
    console.error('[FONTS] Could not find fonts dir. Checked:', possibleBases);
    return 'Helvetica';
  }

  console.log('[FONTS] Using fonts from:', fontsDir);
  let registeredAny = false;

  for (const f of fonts) {
    const fullPath = path.join(fontsDir, f.file);
    if (fs.existsSync(fullPath)) {
      try {
        doc.registerFont(f.name, fullPath);
        registeredAny = true;
      } catch (e) {
        console.error('[FONTS] Failed to register', f.name, ':', e);
      }
    }
  }
  return registeredAny ? 'registered' : 'Helvetica';
}

async function getTelegramFileUrl(fileId: string): Promise<string> {
  let token = process.env.BOT_TOKEN;
  let apiRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
  let json = await apiRes.json() as { ok: boolean; result?: { file_path?: string } };

  if (!json.ok || !json.result?.file_path) {
    token = process.env.DOC_BOT_TOKEN;
    if (token) {
      apiRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
      json = await apiRes.json() as { ok: boolean; result?: { file_path?: string } };
    }
  }

  if (!json.ok || !json.result?.file_path) {
    throw new Error(`Telegram getFile failed for fileId: ${fileId}`);
  }
  return `https://api.telegram.org/file/bot${token}/${json.result.file_path}`;
}

async function ensureFontExists(fontPath: string): Promise<boolean> {
  if (fs.existsSync(fontPath)) return true;
  const fontDir = path.dirname(fontPath);
  if (!fs.existsSync(fontDir)) fs.mkdirSync(fontDir, { recursive: true });
  const fontUrl = 'https://github.com/google/fonts/raw/main/ofl/amiri/Amiri-Regular.ttf';
  return new Promise((resolve) => {
    https.get(fontUrl, (res) => {
      if (res.statusCode === 200) {
        const fileStream = fs.createWriteStream(fontPath);
        res.pipe(fileStream);
        fileStream.on('finish', () => { fileStream.close(); resolve(true); });
        fileStream.on('error', () => resolve(false));
      } else {
        resolve(false);
      }
    }).on('error', () => resolve(false));
  });
}

const TEMPLATE_LINE_CAPACITY: Record<number, number> = { 1: 30, 2: 25, 3: 20, 4: 35, 5: 28 };
export function getLineCapacity(templateId: number): number {
  return TEMPLATE_LINE_CAPACITY[templateId] ?? 25;
}

export interface PdfPageParams {
  type: 'text' | 'image';
  lines?: string[];
  imageBuffer?: Buffer | string;
  overlayText?: string;
  captionText?: string;
}

export interface PdfGeneratorParams {
  pageSize: string | null;
  customSize: { width: number; height: number } | null;
  templateId?: number | null;
  pages: PdfPageParams[];
}

export interface RichLine {
  text: string;
  align: 'right' | 'center' | 'left';
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  size?: 'small' | 'normal' | 'large';
  style?: 'normal' | 'quote' | 'divider' | 'highlight';
  letterSpacing?: number;
  lineSpacing?: number;
}

function applyTemplate(doc: PDFKit.PDFDocument, templateId: number, pageWidth: number, pageHeight: number): void {
  doc.save();
  switch (templateId) {
    case 1: doc.rect(20, 20, pageWidth - 40, pageHeight - 40).stroke('#CCCCCC'); break;
    case 2:
      doc.rect(0, 0, pageWidth, 50).fill('#1A1A2E').stroke('#1A1A2E');
      doc.rect(0, pageHeight - 40, pageWidth, 40).fill('#1A1A2E').stroke('#1A1A2E');
      break;
    case 3: {
      const sz = 30;
      doc.moveTo(20, 20 + sz).lineTo(20, 20).lineTo(20 + sz, 20).stroke('#E63946');
      doc.moveTo(pageWidth - 20 - sz, 20).lineTo(pageWidth - 20, 20).lineTo(pageWidth - 20, 20 + sz).stroke('#E63946');
      doc.moveTo(20, pageHeight - 20 - sz).lineTo(20, pageHeight - 20).lineTo(20 + sz, pageHeight - 20).stroke('#E63946');
      doc.moveTo(pageWidth - 20 - sz, pageHeight - 20).lineTo(pageWidth - 20, pageHeight - 20).lineTo(pageWidth - 20, pageHeight - 20 - sz).stroke('#E63946');
      break;
    }
    case 4:
      doc.rect(0, 0, 8, pageHeight).fill('#457B9D').stroke('#457B9D');
      doc.rect(pageWidth - 8, 0, 8, pageHeight).fill('#457B9D').stroke('#457B9D');
      break;
    case 5:
      doc.rect(10, 10, pageWidth - 20, pageHeight - 20).lineWidth(3).stroke('#2D6A4F');
      doc.rect(16, 16, pageWidth - 32, pageHeight - 32).lineWidth(1).stroke('#95D5B2');
      break;
    default: break;
  }
  doc.restore();
}

function getContentBounds(templateId: number, pageWidth: number, pageHeight: number) {
  switch (templateId) {
    case 2: return { x: 40, y: 60, width: pageWidth - 80, height: pageHeight - 110 };
    case 4: return { x: 25, y: 20, width: pageWidth - 50, height: pageHeight - 40 };
    default: return { x: 40, y: 40, width: pageWidth - 80, height: pageHeight - 80 };
  }
}

// ─── THE CORE FIX: drawArabicText renders ONE line, returns its height ────────
// Does NOT track pages, does NOT use doc.y — purely renders at (x, y) and returns lineHeight.
function drawArabicText(
  doc: any,
  text: string,
  x: number,
  y: number,
  width: number,
  align: 'right' | 'center' | 'left',
  fontSize: number
): number {
  if (!text || !text.trim()) return fontSize * 1.6;

  const isArabic = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(text);
  const prepared = isArabic ? prepareArabicText(text) : text;

  // Auto-detect alignment if not specified
  let pdfAlign: 'right' | 'center' | 'left' = align;
  if (!align || align === 'right') {
    pdfAlign = isArabic ? 'right' : 'left';
  }

  try {
    doc.fontSize(fontSize);
    doc.text(prepared, x, y, {
      width,
      align: pdfAlign,
      lineBreak: false,
      continued: false,
    });
  } catch (e) {
    console.error('[PDF] drawArabicText crash:', e);
  }

  return fontSize * 1.6;
}

// ─── renderRichLine: applies styling, calls drawArabicText, returns height ────
function renderRichLine(
  doc: PDFKit.PDFDocument,
  line: RichLine,
  x: number,
  y: number,
  contentW: number,
  baseSize: number,
  textColor: string = 'black'
): number {
  const style = line.style ?? 'normal';

  // divider
  if (style === 'divider') {
    doc.save()
      .moveTo(x, y + baseSize / 2)
      .lineTo(x + contentW, y + baseSize / 2)
      .lineWidth(0.8).stroke('#888888')
      .restore();
    return baseSize * 1.6;
  }

  const sizeMap: Record<string, number> = { small: baseSize - 4, normal: baseSize, large: baseSize + 6 };
  const fontSize = sizeMap[line.size ?? 'normal'] ?? baseSize;
  const lineH = fontSize * 1.6;

  // highlight background
  if (style === 'highlight') {
    doc.save().rect(x, y, contentW, lineH).fill('#FFF9C4').restore();
  }

  // quote border
  const quoteIndent = style === 'quote' ? 20 : 0;
  if (style === 'quote') {
    doc.save()
      .moveTo(x + contentW - 4, y)
      .lineTo(x + contentW - 4, y + lineH)
      .lineWidth(3).stroke('#457B9D')
      .restore();
  }

  const effectiveW = contentW - quoteIndent;
  const effectiveX = x + quoteIndent;
  const lineColor = (line as any).color || textColor;

  doc.fillColor(lineColor);

  const align = line.align ?? 'right';
  drawArabicText(doc as any, line.text, effectiveX, y, effectiveW, align, fontSize);

  // underline
  if (line.underline) {
    try {
      const prepared = prepareArabicText(line.text);
      const tw = Math.min((doc as any).widthOfString(prepared), effectiveW);
      const lineY = y + fontSize + 1;
      let lx = effectiveX;
      if (align === 'right') lx = effectiveX + effectiveW - tw;
      else if (align === 'center') lx = effectiveX + (effectiveW - tw) / 2;
      doc.save().moveTo(lx, lineY).lineTo(lx + tw, lineY).lineWidth(0.6).stroke('black').restore();
    } catch { /* skip */ }
  }

  return lineH;
}

// ─── Main generator (wizard flow) ─────────────────────────────────────────────
export async function generateDocument(params: PdfGeneratorParams): Promise<Buffer> {
  const fontPath = path.join(process.cwd(), 'assets', 'fonts', 'Amiri-Regular.ttf');
  await ensureFontExists(fontPath);

  return new Promise((resolve, reject) => {
    try {
      const isCustom = params.customSize && params.customSize.width && params.customSize.height;
      const sizeOption: PDFKit.PDFDocumentOptions['size'] = isCustom
        ? [params.customSize!.width, params.customSize!.height]
        : ((params.pageSize ?? 'A4') as any);

      const doc = new PDFDocument({ autoFirstPage: false, size: sizeOption, margin: 0 });
      const fontPathInner = path.join(process.cwd(), 'assets', 'fonts', 'Amiri-Regular.ttf');
      const hasArabicFont = fs.existsSync(fontPathInner);
      if (hasArabicFont) doc.registerFont('Arabic', fontPathInner);

      const buffers: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      const templateId = params.templateId ?? 1;

      if (params.pages && Array.isArray(params.pages)) {
        for (const page of params.pages) {
          if (!page) continue;
          doc.addPage();
          const pageWidth = doc.page.width;
          const pageHeight = doc.page.height;
          applyTemplate(doc, templateId, pageWidth, pageHeight);
          const bounds = getContentBounds(templateId, pageWidth, pageHeight);
          if (hasArabicFont) doc.font('Arabic');
          doc.fillColor('black');

          if (page.type === 'text' && page.lines && page.lines.length > 0) {
            const fontSize = templateId === 3 ? 23 : (templateId === 4 ? 17 : 19);
            doc.fontSize(fontSize);
            let currentY = bounds.y;
            const lineHeight = fontSize * 1.6;

            for (const rawLine of page.lines) {
              if (rawLine === null || rawLine === undefined) continue;
              const raw = String(rawLine).trim();
              if (currentY + lineHeight > bounds.y + bounds.height) break;
              if (raw === '---PAGE_BREAK---') { doc.addPage(); currentY = bounds.y; continue; }
              if (raw === '') { currentY += lineHeight; continue; }
              drawArabicText(doc as any, raw, bounds.x, currentY, bounds.width, 'right', fontSize);
              currentY += lineHeight;
            }
          } else if (page.type === 'image' && page.imageBuffer) {
            const imgBuf = typeof page.imageBuffer === 'string'
              ? Buffer.from(page.imageBuffer, 'base64')
              : page.imageBuffer;
            const maxImgHeight = page.captionText ? bounds.height - 60 : bounds.height - 20;
            doc.image(imgBuf, bounds.x, bounds.y, { fit: [bounds.width, maxImgHeight], align: 'center', valign: 'center' });
            if (page.overlayText) {
              doc.fontSize(27).fillColor('#CC0000');
              const op = prepareArabicText(page.overlayText);
              doc.text(op, bounds.x, bounds.y + maxImgHeight / 2 - 14, { width: bounds.width, align: 'center', lineBreak: false });
            }
            if (page.captionText) {
              doc.fontSize(17).fillColor('#333333');
              const cp = prepareArabicText(page.captionText);
              doc.text(cp, bounds.x, bounds.y + bounds.height - 45, { width: bounds.width, align: 'center', lineBreak: false });
            }
          }
        }
      }
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export interface AlignedLine {
  text: string;
  align: 'right' | 'center' | 'left';
}

export async function generateDocumentFromLines(
  lines: (RichLine | AlignedLine)[],
  pageSize: string = 'A4',
  selectedFont?: string,
  docBgColor?: string,
  docTextColor?: string
): Promise<{ buffer: Buffer; pageCount: number }> {
  if (!lines || !Array.isArray(lines) || lines.length === 0) {
    throw new Error('No lines to generate');
  }

  return new Promise(async (resolve, reject) => {
    try {
      const PADDING = 50;
      const BASE_SIZE = 16;

      let safePageSize: any = 'A4';
      if (['A3', 'A4', 'A5', 'Letter', 'Legal', 'B5', 'Executive'].includes(pageSize)) {
        safePageSize = pageSize;
      }

      const doc = new PDFDocument({ autoFirstPage: false, size: safePageSize, margin: 0 });
      const fontStatus = registerAllFonts(doc);

      const fontMap: Record<string, string> = {
        'Almarai': 'Almarai', 'almarai': 'Almarai',
        'NotoNaskh': 'NotoNaskh', 'noto': 'NotoNaskh', 'Noto': 'NotoNaskh',
        'ModernPro': 'ModernPro', 'AndoPro': 'ModernPro', 'ando_pro': 'ModernPro',
        'Amiri': 'Amiri', 'Cairo': 'Cairo', 'Omnia': 'Omnia', 'Thamanya': 'Thamanya',
      };

      const resolvedFont = selectedFont ? (fontMap[selectedFont] ?? selectedFont) : 'Amiri';
      const chosenFont = fontStatus === 'Helvetica' ? 'Helvetica' : resolvedFont;

      try { doc.font(chosenFont); } catch (e) {
        console.error('[PDF] Font apply failed, fallback Helvetica:', e);
        doc.font('Helvetica');
      }

      const buffers: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => buffers.push(chunk));

      const bgColor = docBgColor || '#FFFFFF';
      const txtColor = docTextColor || '#000000';
      let pageCount = 0;

      // ── addPage: adds page, draws bg, resets font/color, returns dimensions ──
      const addPage = (): { W: number; H: number } => {
        doc.addPage();
        pageCount++;
        // Draw background
        if (bgColor !== '#FFFFFF') {
          doc.save();
          // const hex = bgColor.replace('#', '');
          doc.rect(0, 0, doc.page.width, doc.page.height).fill(bgColor);
          doc.restore();
        }
        // CRITICAL: restore font and color AFTER background draw
        try { doc.font(chosenFont); } catch (e) { /* skip */ }
        doc.fontSize(BASE_SIZE).fillColor(txtColor);
        return { W: doc.page.width, H: doc.page.height };
      };

      let { W, H } = addPage();
      const contentW = W - PADDING * 2;
      // maxY: leave PADDING at bottom
      const maxY = H - PADDING;
      let currentY = PADDING;

      // Ensure font set after first page
      try { doc.font(chosenFont); } catch (_) { }
      doc.fontSize(BASE_SIZE).fillColor(txtColor);

      for (const line of lines) {
        if (!line || (line.text === undefined && (line as any).type === undefined)) continue;

        const richLine = line as any;

        // ── Cover image ──────────────────────────────────────────────────────
        if (richLine.type === 'image_cover' && richLine.fileId) {
          try {
            const fileUrl = await getTelegramFileUrl(richLine.fileId);
            const imgRes = await fetch(fileUrl);
            if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`);
            const imgBuffer = Buffer.from(new Uint8Array(await imgRes.arrayBuffer()));
            if (currentY > PADDING + 5) {
              ({ W, H } = addPage());
              currentY = 0;
            }
            doc.image(imgBuffer, 0, 0, { width: doc.page.width, height: doc.page.height });
            ({ W, H } = addPage());
            currentY = PADDING;
          } catch (err) {
            console.error('[PDF] Cover render failed:', err);
          }
          continue;
        }

        // ── Image row ────────────────────────────────────────────────────────
        if ((richLine.type === 'image' || richLine.type === 'image_row') && (richLine.fileId || richLine.rowImages)) {
          const images: Array<{ fileId: string; lines: number; align: string; mask?: string; caption?: string }> =
            (richLine.rowImages && Array.isArray(richLine.rowImages) && richLine.rowImages.length > 0)
              ? richLine.rowImages
              : (richLine.fileId ? [{
                fileId: richLine.fileId, lines: richLine.imageLines || 5,
                align: richLine.align || 'center', mask: richLine.imageMask, caption: undefined,
              }] : []);

          if (images.length === 0) continue;

          const allocH = (images[0].lines || 5) * 20;
          const pageW = doc.page.width - PADDING * 2;
          const gap = 15;
          const imgW = images.length === 1 ? pageW : images.length === 2 ? (pageW - gap) / 2 : (pageW - gap * 2) / 3;

          if (currentY + allocH > maxY) {
            ({ W, H } = addPage());
            currentY = PADDING;
          }

          for (let imgIdx = 0; imgIdx < images.length; imgIdx++) {
            const img = images[imgIdx];
            if (!img) continue;
            let alignX = images.length === 1
              ? (img.align === 'left' ? PADDING : img.align === 'center' ? PADDING + (pageW / 2) - (imgW / 2) : PADDING + pageW - imgW)
              : PADDING + imgIdx * (imgW + gap);

            try {
              const fileUrl = await getTelegramFileUrl(img.fileId);
              const imgRes = await fetch(fileUrl);
              if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`);
              let imgBuffer = Buffer.from(new Uint8Array(await imgRes.arrayBuffer()));

              const imgMeta = await sharp(imgBuffer).metadata();
              const iw = imgMeta.width ?? 500;
              const ih = imgMeta.height ?? 500;

              if (img.mask === 'circle') {
                const size = Math.min(iw, ih);
                const r = Math.floor(size / 2);
                const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${r}" cy="${r}" r="${r}"/></svg>`;
                imgBuffer = (await sharp(imgBuffer).resize(size, size, { fit: 'cover', position: 'centre' }).composite([{ input: Buffer.from(svg), blend: 'dest-in' }]).png().toBuffer()) as any;
              } else if (img.mask === 'rounded') {
                const rx = Math.round(Math.min(iw, ih) * 0.1);
                const svg = `<svg width="${iw}" height="${ih}" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="${iw}" height="${ih}" rx="${rx}" ry="${rx}"/></svg>`;
                imgBuffer = (await sharp(imgBuffer).composite([{ input: Buffer.from(svg), blend: 'dest-in' }]).png().toBuffer()) as any;
              }

              const exportMeta = await sharp(imgBuffer).metadata();
              const ow = exportMeta.width || 1;
              const oh = exportMeta.height || 1;
              const ar = ow / oh;
              let finalW = Math.min(imgW, ow);
              let finalH = finalW / ar;
              if (finalH > allocH) { finalH = allocH; finalW = finalH * ar; }

              const finalX = alignX + (imgW - finalW) / 2;
              const finalY = currentY + (allocH - finalH) / 2;
              doc.image(imgBuffer, finalX, finalY, { width: finalW, height: finalH });
              (richLine as any).rowActualH = Math.max((richLine as any).rowActualH || 0, finalH);

              if (img.caption) {
                doc.fontSize(10).fillColor('#444444');
                drawArabicText(doc as any, img.caption, alignX, currentY + allocH + 2, imgW, 'center', 10);
                doc.fontSize(BASE_SIZE).fillColor(txtColor);
              }
            } catch (err) {
              console.error('[PDF] Image embed failed:', err);
              doc.fillColor('#cccccc').fontSize(10).text('[صورة]', alignX, currentY + allocH / 2 - 5, { align: 'center', width: imgW });
            }
          }

          const rowActualH = (richLine as any).rowActualH || allocH;
          const hasCaption = images.some(i => i.caption);
          currentY += rowActualH + (hasCaption ? 18 : 0) + 12;
          continue;
        }

        // ── Text lines ───────────────────────────────────────────────────────
        if (!line || (!('text' in line) && !(line as any).type)) continue;
        if ((line as any).type === 'image' || (line as any).type === 'image_row' || (line as any).type === 'image_cover') continue;
        if (line.text === null || line.text === undefined) continue;

        const raw = String(line.text).trim();

        // PAGE_BREAK
        if (raw === '---PAGE_BREAK---') {
          ({ W, H } = addPage());
          currentY = PADDING;
          continue;
        }

        // Font size for this line
        const sizeMap: Record<string, number> = { small: BASE_SIZE - 4, normal: BASE_SIZE, large: BASE_SIZE + 6 };
        const effectiveFontSize = sizeMap[richLine.size ?? 'normal'] ?? BASE_SIZE;
        const effectiveLineH = effectiveFontSize * 1.6;

        // ── PAGINATION: only trigger when currentY truly exceeds page ────────
        if (currentY + effectiveLineH > maxY) {
          ({ W, H } = addPage());
          currentY = PADDING;
        }

        // Empty line = blank space
        if (raw === '') {
          currentY += effectiveLineH;
          continue;
        }

        // Restore font before each line
        try { doc.font(chosenFont); } catch (_) { }
        doc.fontSize(effectiveFontSize).fillColor(txtColor);

        // ── RENDER: use renderRichLine which calls drawArabicText ─────────────
        // renderRichLine returns the lineHeight — we add it to currentY ONCE
        const lineH = renderRichLine(doc, richLine, PADDING, currentY, contentW, BASE_SIZE, txtColor);

        // Restore font/color after render
        try { doc.font(chosenFont); } catch (_) { }
        doc.fontSize(BASE_SIZE).fillColor(txtColor);

        // Advance by exactly one line height — NO double-counting
        currentY += lineH;
      }

      await new Promise<void>((res, rej) => {
        doc.on('end', res);
        doc.on('error', rej);
        doc.end();
      });

      const pdfBuffer = Buffer.concat(buffers);
      if (!pdfBuffer || pdfBuffer.length === 0) throw new Error('PDF buffer is empty');
      resolve({ buffer: pdfBuffer, pageCount });

    } catch (err) {
      console.error('[pdfGeneratorService] Error:', err);
      reject(err);
    }
  });
}