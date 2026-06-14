// src/services/designEngine.ts
// RUN: npm install canvas  (if canvas package is missing)

import sharp from 'sharp';
import { createCanvas, registerFont, loadImage } from 'canvas';
import path from 'path';
import type { DesignState } from '../utils/designState';

const FONTS_DIR = path.join(process.cwd(), 'assets', 'fonts');

// Almarai — 4 weights
registerFont(path.join(FONTS_DIR, 'Almarai-Light.ttf'),     { family: 'Almarai', weight: '300' });
registerFont(path.join(FONTS_DIR, 'Almarai.ttf'),           { family: 'Almarai', weight: 'normal' });
registerFont(path.join(FONTS_DIR, 'Almarai-Bold.ttf'),      { family: 'Almarai', weight: 'bold' });
registerFont(path.join(FONTS_DIR, 'Almarai-ExtraBold.ttf'), { family: 'Almarai', weight: '800' });

// Cormorant — 4 weights
registerFont(path.join(FONTS_DIR, 'Cormorant-Light.ttf'),  { family: 'Cormorant', weight: '300' });
registerFont(path.join(FONTS_DIR, 'Cormorant.ttf'),        { family: 'Cormorant', weight: 'normal' });
registerFont(path.join(FONTS_DIR, 'Cormorant-Medium.ttf'), { family: 'Cormorant', weight: '500' });
registerFont(path.join(FONTS_DIR, 'Cormorant-Bold.ttf'),   { family: 'Cormorant', weight: 'bold' });

// Single-weight fonts
registerFont(path.join(FONTS_DIR, 'Blacksword.otf'),  { family: 'Blacksword',  weight: 'normal' });
registerFont(path.join(FONTS_DIR, 'Bolding.ttf'),     { family: 'Bolding',     weight: 'normal' });
registerFont(path.join(FONTS_DIR, 'Canela.ttf'),      { family: 'Canela',      weight: 'normal' });
registerFont(path.join(FONTS_DIR, 'CanelaDeck.ttf'),  { family: 'CanelaDeck',  weight: 'normal' });
registerFont(path.join(FONTS_DIR, 'Freight.ttf'),     { family: 'Freight',     weight: 'normal' });
registerFont(path.join(FONTS_DIR, 'ModernPro.ttf'),   { family: 'ModernPro',   weight: 'normal' });
registerFont(path.join(FONTS_DIR, 'NotoNaskh.ttf'),   { family: 'NotoNaskh',   weight: 'normal' });
registerFont(path.join(FONTS_DIR, 'Playfair.ttf'),    { family: 'Playfair',    weight: 'normal' });
registerFont(path.join(FONTS_DIR, 'Zeyada.ttf'),      { family: 'Zeyada',      weight: 'normal' });

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
  // 1. First, process the BASE image (Apply Effects & Upscale)
  let basePipeline = sharp(originalBuffer);
  
  if (state.imageEffects.grayscale) basePipeline = basePipeline.grayscale();
  if (state.imageEffects.saturate) basePipeline = basePipeline.modulate({ saturation: 2.5 });
  if (state.imageEffects.invert) basePipeline = basePipeline.negate();
  
  const originalMeta = await sharp(originalBuffer).metadata();
  if (state.imageEffects.upscale && originalMeta.width) {
    basePipeline = basePipeline.resize({
      width: originalMeta.width * 2,
      kernel: sharp.kernel.lanczos3,
      withoutEnlargement: false
    });
  }

  // Resolve the processed base image to get its NEW dimensions
  const processedBaseBuffer = await basePipeline.toBuffer();
  const meta = await sharp(processedBaseBuffer).metadata();
  const W = meta.width!;
  const H = meta.height!;

  // 2. Calculate Bounding Box using the NEW dimensions
  const bbox = calculateBoundingBox(state.selectedCells, state.cols, state.rows, W, H);
  const { x, y, w, h } = bbox;

  let overlayBuf: Buffer | null = null;

  // 3. Generate Overlay based on the exact Bounding Box
  if (state.contentType === 'text') {
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');

    // STRICT USER-DEFINED LINES ONLY (No Auto-Wrap)
    const lines = state.contentValue.split('\n');
    
    let fontSize = Math.floor(h * 0.8); // Start large
    if (fontSize > w) fontSize = Math.floor(w * 0.8);

    // Calculate font size to fit the widest line and total height
    while (fontSize > 5) {
      ctx.font = `${state.fontWeight || 'normal'} ${fontSize}px "${state.selectedFont}"`;
      const maxLineWidth = Math.max(...lines.map(l => ctx.measureText(l).width));
      const totalHeight = lines.length * (fontSize * 1.4);

      if (maxLineWidth <= w * 0.95 && totalHeight <= h * 0.95) {
        break; // Fits perfectly!
      }
      fontSize -= 2;
    }

    ctx.fillStyle = state.textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    const lineHeight = fontSize * 1.4;
    const totalTextHeight = lines.length * lineHeight;
    const startY = (h - totalTextHeight) / 2 + (lineHeight / 2);

    lines.forEach((line, index) => {
      ctx.fillText(line, w / 2, startY + (index * lineHeight));
    });

    overlayBuf = canvas.toBuffer('image/png');
  } 
  else if (state.contentType === 'image' && state.contentValue) {
    const rawOverlay = Buffer.from(state.contentValue, 'base64');
    overlayBuf = await sharp(rawOverlay)
      .resize(w, h, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
  }

  // 4. Composite the Overlay onto the Processed Base Image
  let finalPipeline = sharp(processedBaseBuffer);
  if (overlayBuf) {
    finalPipeline = finalPipeline.composite([{ input: overlayBuf, left: x, top: y }]);
  }

  let resultBuffer = await finalPipeline.jpeg({ quality: 90 }).toBuffer();

  // 5. Apply Watermark ONLY if requested (Preview mode)
  if (applyWatermark) {
    resultBuffer = await addWatermark(resultBuffer);
  }

  return resultBuffer;
}
