// src/services/pdfGeneratorService.ts
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import arabicReshaper from 'arabic-reshaper';
import bidiFactory from 'bidi-js';
import https from 'https';

// Initialise the bidi engine once (singleton)
const bidiEngine = bidiFactory();

/**
 * Reshapes Arabic characters so they connect properly, then
 * applies the Unicode Bidirectional Algorithm so RTL text is
 * stored in the correct visual order for pdfkit.
 */
function prepareArabicText(text: string): string {
  if (!text) return text;
  // 1. Join/reshape Arabic letters
  const reshaped: string = arabicReshaper.convertArabic(text);
  // 2. Reorder for RTL visual display
  const reordered: string = bidiEngine.getReorderedString(reshaped, { dir: 'rtl' });
  return reordered;
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
        fileStream.on('finish', () => {
          fileStream.close();
          resolve(true);
        });
        fileStream.on('error', () => {
          resolve(false);
        });
      } else if (res.statusCode === 302 || res.statusCode === 301) {
        // Handle redirect
        https.get(res.headers.location!, (redirectRes) => {
          const fileStream = fs.createWriteStream(fontPath);
          redirectRes.pipe(fileStream);
          fileStream.on('finish', () => {
            fileStream.close();
            resolve(true);
          });
        }).on('error', () => resolve(false));
      } else {
        resolve(false);
      }
    }).on('error', () => resolve(false));
  });
}

// ─── Template line-capacity map ────────────────────────────────────────────────
// Each template ID maps to how many lines fit per page in that layout.
const TEMPLATE_LINE_CAPACITY: Record<number, number> = {
  1: 30,  // Clean / minimal
  2: 25,  // With header space
  3: 20,  // Large font
  4: 35,  // Dense / small font
  5: 28,  // Two-column header
};

export function getLineCapacity(templateId: number): number {
  return TEMPLATE_LINE_CAPACITY[templateId] ?? 25;
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface PdfPageParams {
  type: 'text' | 'image';
  lines?: string[];
  imageBuffer?: Buffer | string; // raw Buffer or base64 string
  overlayText?: string;
  captionText?: string;
}

export interface PdfGeneratorParams {
  pageSize: string | null;
  customSize: { width: number; height: number } | null;
  templateId?: number | null;
  pages: PdfPageParams[];
}

// ─── Template renderers ────────────────────────────────────────────────────────

function applyTemplate(doc: PDFKit.PDFDocument, templateId: number, pageWidth: number, pageHeight: number): void {
  doc.save();

  switch (templateId) {
    case 1: {
      // Clean minimal — thin border
      doc.rect(20, 20, pageWidth - 40, pageHeight - 40).stroke('#CCCCCC');
      break;
    }
    case 2: {
      // Header band
      doc.rect(0, 0, pageWidth, 50).fill('#1A1A2E').stroke('#1A1A2E');
      doc.rect(0, pageHeight - 40, pageWidth, 40).fill('#1A1A2E').stroke('#1A1A2E');
      break;
    }
    case 3: {
      // Decorative corners
      const sz = 30;
      doc.moveTo(20, 20 + sz).lineTo(20, 20).lineTo(20 + sz, 20).stroke('#E63946');
      doc.moveTo(pageWidth - 20 - sz, 20).lineTo(pageWidth - 20, 20).lineTo(pageWidth - 20, 20 + sz).stroke('#E63946');
      doc.moveTo(20, pageHeight - 20 - sz).lineTo(20, pageHeight - 20).lineTo(20 + sz, pageHeight - 20).stroke('#E63946');
      doc.moveTo(pageWidth - 20 - sz, pageHeight - 20).lineTo(pageWidth - 20, pageHeight - 20).lineTo(pageWidth - 20, pageHeight - 20 - sz).stroke('#E63946');
      break;
    }
    case 4: {
      // Two side bars
      doc.rect(0, 0, 8, pageHeight).fill('#457B9D').stroke('#457B9D');
      doc.rect(pageWidth - 8, 0, 8, pageHeight).fill('#457B9D').stroke('#457B9D');
      break;
    }
    case 5: {
      // Full outer frame with inner shadow
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
  // Returns { x, y, width, height } for the usable content area
  switch (templateId) {
    case 2: return { x: 40, y: 60, width: pageWidth - 80, height: pageHeight - 110 };
    case 4: return { x: 25, y: 20, width: pageWidth - 50, height: pageHeight - 40 };
    default: return { x: 40, y: 40, width: pageWidth - 80, height: pageHeight - 80 };
  }
}

// ─── Main generator ────────────────────────────────────────────────────────────

export async function generateDocument(params: PdfGeneratorParams): Promise<Buffer> {
  const fontPath = path.join(process.cwd(), 'assets', 'fonts', 'Amiri-Regular.ttf');
  await ensureFontExists(fontPath);

  return new Promise((resolve, reject) => {
    try {
      // Determine page dimensions
      const isCustom = params.customSize && params.customSize.width && params.customSize.height;
      const sizeOption: PDFKit.PDFDocumentOptions['size'] = isCustom
        ? [params.customSize!.width, params.customSize!.height]
        : ((params.pageSize ?? 'A4') as any);

      const doc = new PDFDocument({
        autoFirstPage: false,
        size: sizeOption,
        margin: 0,
      });

      // Register Arabic font if available; graceful fallback
      const fontPath = path.join(process.cwd(), 'assets', 'fonts', 'Amiri-Regular.ttf');
      const hasArabicFont = fs.existsSync(fontPath);
      if (hasArabicFont) {
        doc.registerFont('Arabic', fontPath);
      }

      const buffers: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      const templateId = params.templateId ?? 1;

      for (const page of params.pages) {
        doc.addPage();

        const pageWidth = doc.page.width;
        const pageHeight = doc.page.height;

        // Apply decorative template background / borders
        applyTemplate(doc, templateId, pageWidth, pageHeight);

        const bounds = getContentBounds(templateId, pageWidth, pageHeight);

        if (hasArabicFont) doc.font('Arabic');
        doc.fillColor('black');

        if (page.type === 'text' && page.lines && page.lines.length > 0) {
          // ── Text page ──────────────────────────────────────────────
          const fontSize = templateId === 3 ? 18 : (templateId === 4 ? 12 : 14);
          doc.fontSize(fontSize);

          let currentY = bounds.y;
          const lineHeight = fontSize * 1.6;

          for (const rawLine of page.lines) {
            if (currentY + lineHeight > bounds.y + bounds.height) break; // safety
            const processedLine = prepareArabicText(rawLine);
            doc.text(processedLine, bounds.x, currentY, {
              width: bounds.width,
              align: 'right',
              lineBreak: false,
            });
            currentY += lineHeight;
          }
        } else if (page.type === 'image' && page.imageBuffer) {
          // ── Image page ─────────────────────────────────────────────
          const imgBuf = typeof page.imageBuffer === 'string'
            ? Buffer.from(page.imageBuffer, 'base64')
            : page.imageBuffer;

          const maxImgHeight = page.captionText ? bounds.height - 60 : bounds.height - 20;
          const maxImgWidth = bounds.width;

          doc.image(imgBuf, bounds.x, bounds.y, {
            fit: [maxImgWidth, maxImgHeight],
            align: 'center',
            valign: 'center',
          });

          // Overlay text (centered, red, large)
          if (page.overlayText) {
            doc.fontSize(22).fillColor('#CC0000');
            const overlayProcessed = prepareArabicText(page.overlayText);
            doc.text(overlayProcessed, bounds.x, bounds.y + maxImgHeight / 2 - 14, {
              width: bounds.width,
              align: 'center',
              lineBreak: false,
            });
          }

          // Caption text at bottom
          if (page.captionText) {
            doc.fontSize(12).fillColor('#333333');
            const captionProcessed = prepareArabicText(page.captionText);
            doc.text(captionProcessed, bounds.x, bounds.y + bounds.height - 45, {
              width: bounds.width,
              align: 'center',
              lineBreak: false,
            });
          }
        }
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ─── Aligned-line document generator ──────────────────────────────────────────

export interface AlignedLine {
  text: string;
  align: 'right' | 'center' | 'left';
}

export async function generateDocumentFromLines(lines: AlignedLine[], pageSize: string = 'A4'): Promise<{ buffer: Buffer; pageCount: number }> {
  const fontPath = path.join(process.cwd(), 'assets', 'fonts', 'Amiri-Regular.ttf');
  await ensureFontExists(fontPath);

  return new Promise((resolve, reject) => {
    try {
      const PADDING   = 40;   // pt — enforced on all four sides
      const FONT_SIZE = 13;
      const LINE_H    = FONT_SIZE * 1.6; // 20.8 pt

      // Standardize page size
      let safePageSize: any = 'A4';
      if (['A3', 'A4', 'A5', 'Letter', 'Legal', 'B5', 'Executive'].includes(pageSize)) {
        safePageSize = pageSize;
      }

      const doc = new PDFDocument({ autoFirstPage: false, size: safePageSize, margin: 0 });

      // Arabic font (graceful fallback)
      const hasFont = fs.existsSync(fontPath);
      if (hasFont) doc.registerFont('Arabic', fontPath);

      const buffers: Buffer[] = [];
      let pageCount = 0;
      doc.on('data', (c: Buffer) => buffers.push(c));
      doc.on('end',  () => resolve({ buffer: Buffer.concat(buffers), pageCount }));
      doc.on('error', reject);

      const addPage = () => {
        doc.addPage();
        pageCount++;
        const W = doc.page.width;
        const H = doc.page.height;
        // Decorative thin border
        doc.save().rect(PADDING / 2, PADDING / 2, W - PADDING, H - PADDING)
           .lineWidth(0.5).stroke('#CCCCCC').restore();
        return { W, H };
      };

      let { W, H } = addPage();
      const contentW   = W - PADDING * 2;
      const maxY       = H - PADDING;
      let   currentY   = PADDING;

      if (hasFont) doc.font('Arabic');
      doc.fontSize(FONT_SIZE).fillColor('black');

      for (const line of lines) {
        // Auto-paginate
        if (currentY + LINE_H > maxY) {
          ({ W, H } = addPage());
          currentY = PADDING;
          if (hasFont) doc.font('Arabic');
          doc.fontSize(FONT_SIZE).fillColor('black');
        }

        if (line.text === '') {
          // Empty line — just advance Y
          currentY += LINE_H;
          continue;
        }

        const prepared = prepareArabicText(line.text);
        doc.text(prepared, PADDING, currentY, {
          width:     contentW,
          align:     line.align,
          lineBreak: false,
        });
        currentY += LINE_H;
      }

      doc.end();
    } catch (err) {
      console.error('[pdfGeneratorService] Error in generateDocumentFromLines:', err);
      reject(err);
    }
  });
}

