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
    // ── Text overlay via canvas with manual word-wrap ──────────────────────
    let fontSize = Math.floor(h * 0.4);

    // Word-wrap algorithm
    const buildLines = (fSize: number): { lines: string[]; totalHeight: number } => {
      const tmpCanvas = createCanvas(w, h);
      const tmpCtx = tmpCanvas.getContext('2d');
      tmpCtx.font = `bold ${fSize}px '${state.selectedFont}'`;

      const words = state.contentValue.split(/\s+/).filter(Boolean);
      const lines: string[] = [];
      let currentLine = '';

      for (const word of words) {
        const testLine = currentLine ? currentLine + ' ' + word : word;
        const testWidth = tmpCtx.measureText(testLine).width;
        if (testWidth < w * 0.9 && currentLine) {
          currentLine = testLine;
        } else if (currentLine === '') {
          currentLine = word;
        } else {
          lines.push(currentLine);
          currentLine = word;
        }
      }
      if (currentLine) lines.push(currentLine);

      const totalHeight = lines.length * fSize * 1.3;
      return { lines, totalHeight };
    };

    // Shrink font until text fits
    let { lines, totalHeight } = buildLines(fontSize);

    // Check if any line is too wide
    const checkFit = (fSize: number, lns: string[]): boolean => {
      const tmpCanvas = createCanvas(w, h);
      const tmpCtx = tmpCanvas.getContext('2d');
      tmpCtx.font = `bold ${fSize}px '${state.selectedFont}'`;
      const tooWide = lns.some(l => tmpCtx.measureText(l).width > w * 0.9);
      return !tooWide;
    };

    while ((totalHeight > h * 0.9 || !checkFit(fontSize, lines)) && fontSize >= 8) {
      fontSize -= 2;
      const result = buildLines(fontSize);
      lines = result.lines;
      totalHeight = result.totalHeight;
    }

    // Draw on canvas
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');

    // Transparent background
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = state.textColor;
    ctx.font = `bold ${fontSize}px '${state.selectedFont}'`;
    ctx.textAlign = 'center';

    const startY = (h - totalHeight) / 2;
    for (let i = 0; i < lines.length; i++) {
      const lineY = startY + i * fontSize * 1.3 + fontSize; // +fontSize for baseline
      ctx.fillText(lines[i], w / 2, lineY);
    }

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
