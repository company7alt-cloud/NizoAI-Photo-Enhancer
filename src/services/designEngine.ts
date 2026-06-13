// src/services/designEngine.ts
// RUN: npm install canvas  (if canvas package is missing)

import sharp from 'sharp';
import { createCanvas, registerFont, loadImage } from 'canvas';
import path from 'path';
import type { DesignState } from '../utils/designState';

// ── Register fonts at module load ────────────────────────────────────────────
const FONTS_DIR = path.join(process.cwd(), 'assets', 'fonts');
registerFont(path.join(FONTS_DIR, 'Almarai.ttf'),   { family: 'Almarai' });
registerFont(path.join(FONTS_DIR, 'ModernPro.ttf'), { family: 'ModernPro' });
registerFont(path.join(FONTS_DIR, 'NotoNaskh.ttf'), { family: 'NotoNaskh' });

// ── EXPORT 1: calculateBoundingBox ───────────────────────────────────────────
export function calculateBoundingBox(
  selectedCells: number[],
  cols: number,
  rows: number,
  imageWidth: number,
  imageHeight: number
): { x: number; y: number; w: number; h: number } {
  const cellW = imageWidth / cols;
  const cellH = imageHeight / rows;

  let minCol = Infinity;
  let maxCol = -Infinity;
  let minRow = Infinity;
  let maxRow = -Infinity;

  for (const cell of selectedCells) {
    const col = (cell - 1) % cols;
    const row = Math.floor((cell - 1) / cols);
    if (col < minCol) minCol = col;
    if (col > maxCol) maxCol = col;
    if (row < minRow) minRow = row;
    if (row > maxRow) maxRow = row;
  }

  let x = Math.floor(minCol * cellW);
  let y = Math.floor(minRow * cellH);
  let w = Math.ceil((maxCol - minCol + 1) * cellW);
  let h = Math.ceil((maxRow - minRow + 1) * cellH);

  // Clamp to image bounds
  x = Math.max(0, Math.min(x, imageWidth - 1));
  y = Math.max(0, Math.min(y, imageHeight - 1));
  w = Math.max(1, Math.min(w, imageWidth - x));
  h = Math.max(1, Math.min(h, imageHeight - y));

  return { x, y, w, h };
}

// ── EXPORT 2: addWatermark ───────────────────────────────────────────────────
export async function addWatermark(imageBuffer: Buffer): Promise<Buffer> {
  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width!;
  const height = meta.height!;

  // Build repeating watermark SVG
  const text = '@NizoAI_Bot';
  const stepX = 150;
  const stepY = 150;

  let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`;

  for (let y = 0; y < height + stepY; y += stepY) {
    for (let x = 0; x < width + stepX; x += stepX) {
      svgContent +=
        `<text ` +
        `x="${x}" y="${y}" ` +
        `font-family="sans-serif" font-size="18" font-weight="bold" ` +
        `fill="white" opacity="0.22" ` +
        `transform="rotate(-30, ${x}, ${y})" ` +
        `text-anchor="middle">${text}</text>`;
    }
  }

  svgContent += '</svg>';

  const svgBuffer = Buffer.from(svgContent, 'utf-8');

  return sharp(imageBuffer)
    .composite([{ input: svgBuffer, top: 0, left: 0 }])
    .jpeg({ quality: 85 })
    .toBuffer();
}

// ── EXPORT 3: compositeDesign ────────────────────────────────────────────────
export async function compositeDesign(
  originalBuffer: Buffer,
  state: DesignState,
  applyWatermark: boolean
): Promise<Buffer> {
  // a. Get image dimensions
  const meta = await sharp(originalBuffer).metadata();
  const W = meta.width!;
  const H = meta.height!;

  // b. Calculate bounding box
  const bbox = calculateBoundingBox(
    state.selectedCells, state.cols, state.rows, W, H
  );
  const { x, y, w, h } = bbox;

  // c. Build overlay buffer
  let overlayBuffer: Buffer;

  if (state.contentType === 'text') {
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');

    let fontSize = Math.floor(h * 0.4); // Start with a large legible size
    if (fontSize > w / 2) fontSize = Math.floor(w / 2);
    let lines: string[] = [];

    // Robust Word-Wrap & Auto-Scaling Loop
    while (fontSize > 10) {
      // CRITICAL: Font family MUST be wrapped in quotes for canvas to recognize it
      ctx.font = `bold ${fontSize}px "${state.selectedFont}"`;
      lines = [];
      
      // Respect manual newlines from user
      const paragraphs = state.contentValue.split('\n');

      for (const p of paragraphs) {
        const words = p.split(' ');
        let currentLine = words[0] || '';
        
        for (let i = 1; i < words.length; i++) {
          const word = words[i];
          const testLine = currentLine + ' ' + word;
          const metrics = ctx.measureText(testLine);
          
          if (metrics.width < w * 0.95) {
            currentLine = testLine;
          } else {
            lines.push(currentLine);
            currentLine = word;
          }
        }
        lines.push(currentLine);
      }

      const lineHeight = fontSize * 1.4;
      const totalHeight = lines.length * lineHeight;
      const isTooWide = lines.some(l => ctx.measureText(l).width > w * 0.95);

      // If it fits both width and height, we found the perfect font size!
      if (totalHeight <= h * 0.95 && !isTooWide) break;
      
      // Otherwise, shrink slightly and recalculate
      fontSize -= 2;
    }

    ctx.fillStyle = state.textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lineHeight = fontSize * 1.4;
    
    // Calculate starting Y to vertically center the block of text
    const startY = (h - (lines.length * lineHeight)) / 2 + (lineHeight / 2);

    // Draw each line
    lines.forEach((line, index) => {
      ctx.fillText(line, w / 2, startY + (index * lineHeight));
    });

    overlayBuffer = canvas.toBuffer('image/png');
  } else {
    // ── Image overlay ─────────────────────────────────────────────────────
    let overlayBuf = Buffer.from(state.contentValue, 'base64');

    overlayBuffer = await sharp(overlayBuf)
      .resize(w, h, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    // Free memory immediately
    (overlayBuf as unknown) = undefined;
  }

  // d. Composite overlay onto original
  let pipeline = sharp(originalBuffer)
    .composite([{ input: overlayBuffer, left: x, top: y }]);

  // Free overlay buffer
  (overlayBuffer as unknown) = undefined;

  // e. Apply image effects in order
  if (state.imageEffects.grayscale) pipeline = pipeline.grayscale();
  if (state.imageEffects.saturate)  pipeline = pipeline.modulate({ saturation: 2.5 });
  if (state.imageEffects.invert)    pipeline = pipeline.negate();
  if (state.imageEffects.upscale) {
    pipeline = pipeline.resize({
      width: W * 2,
      kernel: sharp.kernel.lanczos3,
      withoutEnlargement: false,
    });
  }

  // f. Convert to JPEG
  let resultBuffer = await pipeline.jpeg({ quality: 90 }).toBuffer();

  // g. Apply watermark if requested
  if (applyWatermark) {
    resultBuffer = await addWatermark(resultBuffer);
  }

  // h. Return result
  return resultBuffer;
}
