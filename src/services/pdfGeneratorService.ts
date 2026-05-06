// src/services/pdfGeneratorService.ts
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import arabicReshaper from 'arabic-reshaper';
import bidiFactory from 'bidi-js';

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
