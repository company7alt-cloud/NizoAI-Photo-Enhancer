// src/services/pdfGeneratorService.ts
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import arabicReshaper from 'arabic-reshaper';
import bidiFactory from 'bidi-js';
import https from 'https';

// Initialise the bidi engine once (singleton)
const bidiEngine = bidiFactory();

const EMOJI_REGEX = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}]/gu;
function hasEmoji(str: string): boolean { return EMOJI_REGEX.test(str); }

function fixArabicPunctuation(text: string): string {
  return text
    .replace(/\(/g, '\u202A(\u202C')
    .replace(/\)/g, '\u202A)\u202C')
    .replace(/\[/g, '\u202A[\u202C')
    .replace(/\]/g, '\u202A]\u202C');
}


/**
 * Reshapes Arabic characters so they connect properly, then
 * applies the Unicode Bidirectional Algorithm so RTL text is
 * stored in the correct visual order for pdfkit.
 * FIXED: null/undefined guard + try/catch to prevent forEach crash.
 */
function prepareArabicText(text: string): string {
  if (!text || typeof text !== 'string' || text.trim() === '') return '';
  try {
    const fixedText = fixArabicPunctuation(text);
    const reshaped: string = arabicReshaper.convertArabic(fixedText);
    const reordered: string = bidiEngine.getReorderedString(reshaped, { dir: 'rtl' });
    return reordered;
  } catch {
    return text;
  }
}

// ─── Font Registration ─────────────────────────────────────────────────────────
// Uses process.cwd() — NOT __dirname — so fonts load correctly after npm run build.

function registerAllFonts(doc: PDFKit.PDFDocument): string {
  const possibleBases = [
    path.join(process.cwd(), 'src', 'assets', 'fonts'),
    path.join(process.cwd(), 'assets', 'fonts'),
    path.join(__dirname, '..', '..', 'assets', 'fonts'),
    path.join(__dirname, '..', 'assets', 'fonts'),
    path.join(__dirname, 'assets', 'fonts'),
  ];

  const fonts = [
    { name: 'Omnia',     file: 'Omnia.ttf' },
    { name: 'ModernPro', file: 'ModernPro.ttf' },
    { name: 'Thamanya',  file: 'Thamanya.ttf' },
    { name: 'Amiri',     file: 'Amiri.ttf' },
    { name: 'Cairo',     file: 'Cairo.ttf' },
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
        console.log('[FONTS] Registered:', f.name);
      } catch (e) {
        console.error('[FONTS] Failed to register', f.name, ':', e);
      }
    } else {
      console.warn('[FONTS] File not found:', fullPath);
    }
  }
  return registeredAny ? 'registered' : 'Helvetica';
}

// ─── Telegram File URL (pure REST — no bot instance needed) ────────────────────

async function getTelegramFileUrl(fileId: string): Promise<string> {
  console.log(`[Image Debug] fileId: ${fileId}`);
  let token = process.env.BOT_TOKEN;
  let apiRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
  let json = await apiRes.json() as { ok: boolean; result?: { file_path?: string } };

  if (!json.ok || !json.result?.file_path) {
    console.log(`[Image Debug] BOT_TOKEN failed, trying DOC_BOT_TOKEN`);
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

// ─── Font Downloader ───────────────────────────────────────────────────────────

async function ensureFontExists(fontPath: string): Promise<boolean> {
  if (fs.existsSync(fontPath)) return true;

  const fontDir = path.dirname(fontPath);
  if (!fs.existsSync(fontDir)) {
    fs.mkdirSync(fontDir, { recursive: true });
  }

  const fontUrl = 'https://github.com/google/fonts/raw/main/ofl/amiri/Amiri-Regular.ttf';

  return new Promise((resolve) => {
    https.get(fontUrl, (res) => {
      if (res.statusCode === 200) {
        const fileStream = fs.createWriteStream(fontPath);
        res.pipe(fileStream);
        fileStream.on('finish', () => { fileStream.close(); resolve(true); });
        fileStream.on('error', () => { resolve(false); });
      } else if (res.statusCode === 302 || res.statusCode === 301) {
        https.get(res.headers.location!, (redirectRes) => {
          const fileStream = fs.createWriteStream(fontPath);
          redirectRes.pipe(fileStream);
          fileStream.on('finish', () => { fileStream.close(); resolve(true); });
        }).on('error', () => resolve(false));
      } else {
        resolve(false);
      }
    }).on('error', () => resolve(false));
  });
}

// ─── Template line-capacity map ────────────────────────────────────────────────
const TEMPLATE_LINE_CAPACITY: Record<number, number> = {
  1: 30,
  2: 25,
  3: 20,
  4: 35,
  5: 28,
};

export function getLineCapacity(templateId: number): number {
  return TEMPLATE_LINE_CAPACITY[templateId] ?? 25;
}

// ─── Types ─────────────────────────────────────────────────────────────────────

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

// ─── Rich line type (matches DocLine in validators.ts) ─────────────────────────

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

// ─── Template renderers ────────────────────────────────────────────────────────

function applyTemplate(doc: PDFKit.PDFDocument, templateId: number, pageWidth: number, pageHeight: number): void {
  doc.save();

  switch (templateId) {
    case 1: {
      doc.rect(20, 20, pageWidth - 40, pageHeight - 40).stroke('#CCCCCC');
      break;
    }
    case 2: {
      doc.rect(0, 0, pageWidth, 50).fill('#1A1A2E').stroke('#1A1A2E');
      doc.rect(0, pageHeight - 40, pageWidth, 40).fill('#1A1A2E').stroke('#1A1A2E');
      break;
    }
    case 3: {
      const sz = 30;
      doc.moveTo(20, 20 + sz).lineTo(20, 20).lineTo(20 + sz, 20).stroke('#E63946');
      doc.moveTo(pageWidth - 20 - sz, 20).lineTo(pageWidth - 20, 20).lineTo(pageWidth - 20, 20 + sz).stroke('#E63946');
      doc.moveTo(20, pageHeight - 20 - sz).lineTo(20, pageHeight - 20).lineTo(20 + sz, pageHeight - 20).stroke('#E63946');
      doc.moveTo(pageWidth - 20 - sz, pageHeight - 20).lineTo(pageWidth - 20, pageHeight - 20).lineTo(pageWidth - 20, pageHeight - 20 - sz).stroke('#E63946');
      break;
    }
    case 4: {
      doc.rect(0, 0, 8, pageHeight).fill('#457B9D').stroke('#457B9D');
      doc.rect(pageWidth - 8, 0, 8, pageHeight).fill('#457B9D').stroke('#457B9D');
      break;
    }
    case 5: {
      doc.rect(10, 10, pageWidth - 20, pageHeight - 20).lineWidth(3).stroke('#2D6A4F');
      doc.rect(16, 16, pageWidth - 32, pageHeight - 32).lineWidth(1).stroke('#95D5B2');
      break;
    }
    default:
      break;
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

// ─── Rich line renderer (used by generateDocumentFromLines) ────────────────────

/**
 * Renders a single RichLine onto the PDF at (x, currentY).
 * FONT SAFETY: Only Amiri-Regular is ever called. Bold/italic are simulated.
 * Returns the Y advance (lineHeight for the line).
 */
function renderRichLine(
  doc: PDFKit.PDFDocument,
  line: RichLine,
  x: number,
  currentY: number,
  contentW: number,
  baseSize: number,
  textColor: string = 'black'
): number {
  const style = line.style ?? 'normal';

  // ── divider: draw line, skip text ───────────────────────────────────────────
  if (style === 'divider') {
    doc.save()
      .moveTo(x, currentY + baseSize / 2)
      .lineTo(x + contentW, currentY + baseSize / 2)
      .lineWidth(0.8)
      .stroke('#888888')
      .restore();
    return baseSize * 1.6;
  }

  // ── size variant ─────────────────────────────────────────────────────────────
  const sizeMap: Record<string, number> = {
    small: baseSize - 4,
    normal: baseSize,
    large: baseSize + 6,
  };
  const fontSize = sizeMap[line.size ?? 'normal'] ?? baseSize;
  const lineH = fontSize * 1.6;

  // ── highlight: fill rect behind text ─────────────────────────────────────────
  if (style === 'highlight') {
    doc.save()
      .rect(x, currentY, contentW, lineH)
      .fill('#FFF9C4')
      .restore();
  }

  // ── quote: right-side border + indent ────────────────────────────────────────
  const quoteIndent = style === 'quote' ? 20 : 0;
  if (style === 'quote') {
    doc.save()
      .moveTo(x + contentW - 4, currentY)
      .lineTo(x + contentW - 4, currentY + lineH)
      .lineWidth(3)
      .stroke('#457B9D')
      .restore();
  }

  const effectiveW = contentW - quoteIndent;
  const effectiveX = x + quoteIndent;

  // ── bold simulation: slight lineWidth increase (no extra font file needed) ───
  if (line.bold) {
    doc.save().lineWidth(0.4);
  }

  const lineColor = (line as any).color || textColor;
  doc.fontSize(fontSize).fillColor(lineColor);

  // ── Typography controls ────────────────────────────────────────────────────
  const lineGap     = typeof (line as any).lineSpacing    === 'number' ? (line as any).lineSpacing    : 18;
  doc.lineGap(lineGap - fontSize); // pdfkit lineGap is extra space; subtract fontSize for net gap

  const newY = drawArabicParagraph(
    doc,
    line.text,
    effectiveX,
    currentY,
    effectiveW,
    line.align ?? 'right'
  );

  // Reset typography to defaults
  doc.lineGap(0);

  if (line.bold) doc.restore();

  // ── underline: draw line beneath text ────────────────────────────────────────
  if (line.underline) {
    try {
      const prepared = prepareArabicText(line.text);
      const tw = Math.min(doc.widthOfString(prepared), effectiveW);
      const lineY = currentY + fontSize + 1;
      // For RTL text the rendered start depends on alignment; approximate
      let lx = effectiveX;
      if ((line.align ?? 'right') === 'right') lx = effectiveX + effectiveW - tw;
      else if ((line.align ?? 'right') === 'center') lx = effectiveX + (effectiveW - tw) / 2;

      doc.save()
        .moveTo(lx, lineY)
        .lineTo(lx + tw, lineY)
        .lineWidth(0.6)
        .stroke('black')
        .restore();
    } catch {
      // underline calc failed — safe to skip
    }
  }

  // italic note: pdfkit with a non-italic font variant cannot tilt glyphs;
  // we skip the effect silently to avoid font registration errors.

  return newY > currentY ? (newY - currentY) : lineH;
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
            // +5 to original sizes: 3→18 became 23, 4→12 became 17, default 14 became 19
            const fontSize = templateId === 3 ? 23 : (templateId === 4 ? 17 : 19);
            doc.fontSize(fontSize);
            let currentY = bounds.y;
            const lineHeight = fontSize * 1.6;

            for (const rawLine of page.lines) {
              // CRASH FIX: skip null/undefined/non-string entries
              if (rawLine === null || rawLine === undefined) continue;
              const raw = String(rawLine).trim();
              if (currentY + lineHeight > bounds.y + bounds.height) break;
              if (raw === '---PAGE_BREAK---') { doc.addPage(); currentY = bounds.y; continue; }
              if (raw === '') { currentY += lineHeight; continue; }
              
              currentY = drawArabicParagraph(
                doc,
                raw,
                bounds.x,
                currentY,
                bounds.width,
                'right'
              );
            }
          } else if (page.type === 'image' && page.imageBuffer) {
            const imgBuf = typeof page.imageBuffer === 'string'
              ? Buffer.from(page.imageBuffer, 'base64')
              : page.imageBuffer;
            const maxImgHeight = page.captionText ? bounds.height - 60 : bounds.height - 20;
            doc.image(imgBuf, bounds.x, bounds.y, {
              fit: [bounds.width, maxImgHeight], align: 'center', valign: 'center',
            });
            if (page.overlayText) {
              doc.fontSize(27).fillColor('#CC0000');
              const overlayProcessed = prepareArabicText(page.overlayText);
              doc.text(overlayProcessed, bounds.x, bounds.y + maxImgHeight / 2 - 14, {
                width: bounds.width, align: 'center', lineBreak: false,
              });
            }
            if (page.captionText) {
              doc.fontSize(17).fillColor('#333333');
              const captionProcessed = prepareArabicText(page.captionText);
              doc.text(captionProcessed, bounds.x, bounds.y + bounds.height - 45, {
                width: bounds.width, align: 'center', lineBreak: false,
              });
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

function drawArabicParagraph(
  doc: any,
  rawText: string,
  startX: number,
  startY: number,
  width: number,
  align: string
): number {
  if (!rawText) return startY;
  const inputLines = rawText.split('\n');
  let currentY = startY;

  for (const inputLine of inputLines) {
    if (!inputLine.trim()) {
      currentY += doc.currentLineHeight();
      continue;
    }

    const isArabic = /[\u0600-\u06FF]/.test(inputLine);
    let pdfAlign = isArabic ? 'right' : 'left';
    if (align === 'center') pdfAlign = 'center';

    let finalLine = inputLine;
    if (isArabic) {
      finalLine = fixArabicPunctuation(finalLine);
    }

    if (hasEmoji(finalLine)) {
      const mainFont = doc._font ? doc._font.name : 'Amiri';
      const mainSize = doc._fontSize || 12;
      try {
        doc.font('NotoEmoji');
        doc.text(finalLine, startX, currentY, { 
          width, 
          align: pdfAlign, 
          lineBreak: false
        });
        doc.font(mainFont).fontSize(mainSize);
      } catch {
        doc.font(mainFont).fontSize(mainSize);
        const stripped = finalLine.replace(
          /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}\u{2300}-\u{23FF}\u{FE00}-\u{FEFF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FAFF}]/gu,
          ''
        );
        doc.text(stripped, startX, currentY, { 
          width, 
          align: pdfAlign, 
          lineBreak: false
        });
      }
    } else {
      doc.text(finalLine, startX, currentY, { 
        width, 
        align: pdfAlign, 
        lineBreak: false
      });
    }

    currentY = doc.y; 
  }

  return currentY;
}


// ─── Aligned-line document generator (doc maker flow) ─────────────────────────

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
      const PADDING   = 40;
      const BASE_SIZE = 18; // was 13, +5
      const LINE_H    = BASE_SIZE * 1.6;

      let safePageSize: any = 'A4';
      if (['A3', 'A4', 'A5', 'Letter', 'Legal', 'B5', 'Executive'].includes(pageSize)) {
        safePageSize = pageSize;
      }

      const doc = new PDFDocument({ autoFirstPage: false, size: safePageSize, margin: 0 });

      const fontStatus = registerAllFonts(doc);
      const chosenFont = fontStatus === 'Helvetica'
        ? 'Helvetica'
        : (selectedFont || 'Amiri');
      try {
        doc.font(chosenFont);
        console.log('[PDF] Using font:', chosenFont);
      } catch (e) {
        console.error('[PDF] Font apply failed, fallback Helvetica:', e);
        doc.font('Helvetica');
      }

      const buffers: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => buffers.push(chunk));

      let pageCount = 0;
      doc.on('pageAdded', () => { pageCount++; });

      const bgColor = docBgColor || '#FFFFFF';
      const txtColor = docTextColor || '#000000';

      const drawBackground = () => {
        if (bgColor !== '#FFFFFF') {
          doc.save();
          doc.rect(0, 0, doc.page.width, doc.page.height).fill(bgColor);
          doc.restore();
        }
      };

      const addPage = () => {
        doc.addPage();
        drawBackground();
        pageCount++;
        const W = doc.page.width;
        const H = doc.page.height;
        doc.save().rect(PADDING / 2, PADDING / 2, W - PADDING, H - PADDING)
           .lineWidth(0.5).stroke('#CCCCCC').restore();
        return { W, H };
      };

      let { W, H } = addPage();
      const contentW = W - PADDING * 2;
      const maxY     = H - PADDING;
      let currentY   = PADDING;

      try { doc.font(chosenFont); } catch {}

      doc.fontSize(BASE_SIZE).fillColor(txtColor);

      for (const line of lines) {
        // CRASH FIX: skip null/undefined entries
        if (!line || (line.text === undefined && (line as any).type === undefined)) continue;

        const richLine = line as any;

        // ── Full-bleed cover image ───────────────────────────────────────────────
        if (richLine.type === 'image_cover' && richLine.fileId) {
          try {
            const fileUrl = await getTelegramFileUrl(richLine.fileId);
            const imgRes  = await fetch(fileUrl);
            if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`);
            const imgBuffer = Buffer.from(new Uint8Array(await imgRes.arrayBuffer()));

            // Push to a fresh page if we are not at the very start
            if (currentY > PADDING + 5) {
              ({ W, H } = addPage());
              currentY = 0;
            }

            // Full-bleed: draw from (0,0) to full page dimensions, ignoring margins
            doc.image(imgBuffer, 0, 0, { width: doc.page.width, height: doc.page.height });

            // Start a fresh page for content that follows
            ({ W, H } = addPage());
            currentY = PADDING;
            doc.y = currentY;
            try { doc.font(chosenFont); } catch {}
            doc.fontSize(BASE_SIZE).fillColor(txtColor);
          } catch (err) {
            console.error('[PDF] Cover render failed:', err);
          }
          continue;
        }

        // ── Image / Image-Row line ───────────────────────────────────────────────
        if ((richLine.type === 'image' || richLine.type === 'image_row') && (richLine.fileId || richLine.rowImages)) {
          // Normalise: single image or array of row images
          const images: Array<{ fileId: string; lines: number; align: string; mask?: string; caption?: string }> =
            (richLine.rowImages && Array.isArray(richLine.rowImages) && richLine.rowImages.length > 0)
              ? richLine.rowImages
              : (richLine.fileId ? [{
                  fileId:  richLine.fileId,
                  lines:   richLine.imageLines || 5,
                  align:   richLine.align || 'center',
                  mask:    richLine.imageMask,
                  caption: undefined,
                }] : []);

          if (images.length === 0) continue;

          const allocH  = (images[0].lines || 5) * 20;
          const pageW   = doc.page.width - PADDING * 2;
          const gap     = 15;
          const imgW    =
            images.length === 1 ? pageW :
            images.length === 2 ? (pageW - gap) / 2 :
            (pageW - gap * 2) / 3;

          // Paginate if needed
          if (currentY + allocH > maxY) {
            ({ W, H } = addPage());
            currentY = PADDING;
            doc.y = currentY;
            try { doc.font(chosenFont); } catch {}
            doc.fontSize(BASE_SIZE).fillColor(txtColor);
          }

          for (let imgIdx = 0; imgIdx < images.length; imgIdx++) {
            const img = images[imgIdx];
            if (!img) continue;
            
            // X position:
            //  - Single image: respect per-image alignment setting
            //  - Multiple images: lay out left-to-right (index 0 = leftmost)
            let alignX: number;
            if (images.length === 1) {
              alignX =
                img.align === 'left'   ? PADDING :
                img.align === 'center' ? PADDING + (pageW / 2) - (imgW / 2) :
                /* right */              PADDING + pageW - imgW;
            } else {
              alignX = PADDING + imgIdx * (imgW + gap);
            }

            try {
              const fileUrl = await getTelegramFileUrl(img.fileId);
              const imgRes  = await fetch(fileUrl);
              if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status} fetching image`);
              let imgBuffer = Buffer.from(new Uint8Array(await imgRes.arrayBuffer()));
              console.log(`[Image Debug] buffer size:`, imgBuffer?.length);

              const imgMeta = await sharp(imgBuffer).metadata();
              const iw   = imgMeta.width  ?? 500;
              const ih   = imgMeta.height ?? 500;

              if (img.mask === 'circle') {
                const size = Math.min(iw, ih);
                const r    = Math.floor(size / 2);
                const svg  = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">` +
                             `<circle cx="${r}" cy="${r}" r="${r}"/></svg>`;
                imgBuffer = (await sharp(imgBuffer)
                  .resize(size, size, { fit: 'cover', position: 'centre' })
                  .composite([{ input: Buffer.from(svg), blend: 'dest-in' }])
                  .png().toBuffer()) as any;
              } else if (img.mask === 'rounded') {
                const rx  = Math.round(Math.min(iw, ih) * 0.1);
                const svg = `<svg width="${iw}" height="${ih}" xmlns="http://www.w3.org/2000/svg">` +
                            `<rect x="0" y="0" width="${iw}" height="${ih}" rx="${rx}" ry="${rx}"/></svg>`;
                imgBuffer = (await sharp(imgBuffer)
                  .composite([{ input: Buffer.from(svg), blend: 'dest-in' }])
                  .png().toBuffer()) as any;
              }

              const exportMeta = await sharp(imgBuffer).metadata();
              const originalWidth = exportMeta.width || 1;
              const originalHeight = exportMeta.height || 1;
              const aspectRatio = originalWidth / originalHeight;

              // User requested formula:
              const scaledWidth = Math.min(imgW, originalWidth);
              const scaledHeight = scaledWidth / aspectRatio;

              // Fit within allocH if still too tall
              let finalW = scaledWidth;
              let finalH = scaledHeight;
              if (finalH > allocH) {
                finalH = allocH;
                finalW = finalH * aspectRatio;
              }

              // Center the image in its box [alignX, currentY, imgW, allocH]
              const finalX = alignX + (imgW - finalW) / 2;
              const finalY = currentY + (allocH - finalH) / 2;

              doc.image(imgBuffer, finalX, finalY, { width: finalW, height: finalH });

              // Record the actual height used in this row for Y advance
              (richLine as any).rowActualH = Math.max((richLine as any).rowActualH || 0, finalH);

              // Per-image caption
              if (img.caption) {
                doc.fontSize(10).fillColor('#444444');
                drawArabicParagraph(
                  doc, 
                  img.caption, 
                  alignX, 
                  currentY + allocH + 2, 
                  imgW, 
                  'center'
                );
                doc.fontSize(BASE_SIZE).fillColor(txtColor);
              }
            } catch (err) {
              console.error('[PDF] Row image embed failed, skipping:', err);
              // Add placeholder text so user knows image was there
              doc.fillColor('#cccccc')
                 .fontSize(10)
                 .text('[صورة]', alignX, currentY + allocH / 2 - 5, { align: 'center', width: imgW });
            }
          }

          const rowActualH = (richLine as any).rowActualH || allocH;
          const hasCaption = images.some(i => i.caption);
          currentY += rowActualH + (hasCaption ? 18 : 0) + 12;
          doc.y = currentY;
          continue;
        }


        if (!line || (!('text' in line) && !(line as any).type)) continue;
        if ((line as any).type === 'image' || (line as any).type === 'image_row' || (line as any).type === 'image_cover') continue;
        if (line.text === null || line.text === undefined) continue;
        const raw = String(line.text).trim();

        if (raw === '---PAGE_BREAK---') {
          ({ W, H } = addPage());
          currentY = PADDING;
          try { doc.font(chosenFont); } catch {}
          doc.fontSize(BASE_SIZE).fillColor(txtColor);
          continue;
        }

        // Determine effective line height for this line (may vary by size)
        const sizeMap: Record<string, number> = { small: BASE_SIZE - 4, normal: BASE_SIZE, large: BASE_SIZE + 6 };
        const effectiveFontSize = sizeMap[richLine.size ?? 'normal'] ?? BASE_SIZE;
        const effectiveLineH = effectiveFontSize * 1.6;

        // Auto-paginate
        if (currentY + effectiveLineH > maxY) {
          ({ W, H } = addPage());
          currentY = doc.page.margins.top ?? PADDING;
          doc.y = currentY;
          try { doc.font(chosenFont); } catch {}
          doc.fontSize(BASE_SIZE).fillColor(txtColor);
        }

        if (raw === '') {
          currentY += LINE_H;
          continue;
        }

        // Render rich line
        const advance = renderRichLine(doc, richLine, PADDING, currentY, contentW, BASE_SIZE, txtColor);
        currentY += advance;
      }

      await new Promise<void>((res, rej) => {
        doc.on('end', res);
        doc.on('error', rej);
        doc.end();
      });

      const pdfBuffer = Buffer.concat(buffers);
      if (!pdfBuffer || pdfBuffer.length === 0) {
        throw new Error('PDF buffer is empty after generation');
      }
      resolve({ buffer: pdfBuffer, pageCount });

    } catch (err) {
      console.error('[pdfGeneratorService] Error in generateDocumentFromLines:', err);
      reject(err);
    }
  });
}
