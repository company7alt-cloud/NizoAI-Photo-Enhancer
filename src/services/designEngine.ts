// src/services/designEngine.ts
// RUN: npm install canvas  (if canvas package is missing)

import fs from 'fs';
import sharp from 'sharp';
import { createCanvas, registerFont, loadImage } from 'canvas';
import path from 'path';
import type { DesignState } from '../utils/designState';

const FONTS_DIR = path.join(process.cwd(), 'assets', 'fonts');

// ── Safe Font Registration Wrapper ──────────────────────────────────────────
function safeRegisterFont(fontPath: string, config: { family: string; weight?: string }): void {
  if (fs.existsSync(fontPath)) {
    try {
      registerFont(fontPath, config);
    } catch (err) {
      console.error(`[Font Engine] Error registering ${config.family}:`, err);
    }
  } else {
    console.warn(`[Font Engine] Warning: Missing font file -> ${fontPath}`);
  }
}

// ── Arabic Fonts ──
safeRegisterFont(path.join(FONTS_DIR, 'Almarai-Light.ttf'),     { family: 'Almarai', weight: '300'    });
safeRegisterFont(path.join(FONTS_DIR, 'Almarai.ttf'),           { family: 'Almarai', weight: 'normal' });
safeRegisterFont(path.join(FONTS_DIR, 'Almarai-Bold.ttf'),      { family: 'Almarai', weight: 'bold'   });
safeRegisterFont(path.join(FONTS_DIR, 'Almarai-ExtraBold.ttf'), { family: 'Almarai', weight: '800'    });
safeRegisterFont(path.join(FONTS_DIR, 'ModernPro.ttf'),         { family: 'ModernPro', weight: 'normal' });
safeRegisterFont(path.join(FONTS_DIR, 'NotoNaskh.ttf'),         { family: 'NotoNaskh', weight: 'normal' });
safeRegisterFont(path.join(FONTS_DIR, 'Zeyada.ttf'),            { family: 'Zeyada',    weight: 'normal' });

// ── English Fonts ──
safeRegisterFont(path.join(FONTS_DIR, 'Blacksword.otf'),        { family: 'Blacksword',  weight: 'normal' });
safeRegisterFont(path.join(FONTS_DIR, 'Bolding.ttf'),           { family: 'Bolding',     weight: 'normal' });
safeRegisterFont(path.join(FONTS_DIR, 'Canela.ttf'),            { family: 'Canela',      weight: 'normal' });
safeRegisterFont(path.join(FONTS_DIR, 'CanelaDeck.ttf'),        { family: 'CanelaDeck',  weight: 'normal' });
safeRegisterFont(path.join(FONTS_DIR, 'Cormorant-Light.ttf'),   { family: 'Cormorant',   weight: '300'    });
safeRegisterFont(path.join(FONTS_DIR, 'Cormorant.ttf'),         { family: 'Cormorant',   weight: 'normal' });
safeRegisterFont(path.join(FONTS_DIR, 'Cormorant-Medium.ttf'),  { family: 'Cormorant',   weight: '500'    });
safeRegisterFont(path.join(FONTS_DIR, 'Cormorant-Bold.ttf'),    { family: 'Cormorant',   weight: 'bold'   });
safeRegisterFont(path.join(FONTS_DIR, 'Freight.ttf'),           { family: 'Freight',     weight: 'normal' });
safeRegisterFont(path.join(FONTS_DIR, 'Playfair.ttf'),          { family: 'Playfair',    weight: 'normal' });

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

  // 3. Generate Overlay & Composite (full-screen canvas prevents clipping)
  // Multiply the fraction by the total processed image Width (W) and Height (H)
  const moveX = (state.offsetX || 0) * W;
  const moveY = (state.offsetY || 0) * H;
  const scale = state.scaleMultiplier || 1.0;
  let finalPipeline = sharp(processedBaseBuffer);

  if (state.contentType === 'text') {
    // Full-screen canvas — text can be nudged anywhere without being clipped
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    const lines = state.contentValue.split('\n');
    let baseFontSize = Math.floor(h * 0.8);
    if (baseFontSize > w) baseFontSize = Math.floor(w * 0.8);

    // Calculate base font size to fit the grid bounding box
    while (baseFontSize > 5) {
      const cssWeight = state.fontWeight || 'normal';
      const fontFamily = state.selectedFont || 'Almarai';
      ctx.font = `${cssWeight} ${baseFontSize}px "${fontFamily}"`;
      const maxLineWidth = Math.max(...lines.map(l => ctx.measureText(l).width));
      const totalHeight = lines.length * (baseFontSize * 1.4);
      if (maxLineWidth <= w * 0.95 && totalHeight <= h * 0.95) break;
      baseFontSize -= 2;
    }

    // Apply user scale multiplier on top of the fitted base size
    const finalFontSize = baseFontSize * scale;
    const cssWeight = state.fontWeight || 'normal';
    const fontFamily = state.selectedFont || 'Almarai';
    ctx.font = `${cssWeight} ${finalFontSize}px "${fontFamily}"`;
    const opacity = (state.textOpacity ?? 100) / 100;
    const hexColor = state.textColor || '#FFFFFF';
    // Convert hex + opacity to rgba
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const lineHeight = finalFontSize * 1.4;
    const totalTextHeight = lines.length * lineHeight;

    // Centre on the bounding box, then apply offsets
    const centerX = x + (w / 2) + moveX;
    const centerY = y + (h / 2) + moveY;
    const startY = centerY - (totalTextHeight / 2) + (lineHeight / 2);

    lines.forEach((line, index) => {
      const lineY = startY + (index * lineHeight);

      if (state.shadowEnabled) {
        const sType    = state.shadowType    ?? 'drop';
        const sOffsetX = state.shadowOffsetX ?? 0;
        const sOffsetY = state.shadowOffsetY ?? 0;
        const sBlur    = state.shadowBlur    ?? 10;
        
        // Convert Hex to RGBA for Opacity support
        const hex = state.shadowColor || '#000000';
        const opacity = state.shadowOpacity ?? 0.8;
        const rr = parseInt(hex.slice(1,3), 16) || 0;
        const gg = parseInt(hex.slice(3,5), 16) || 0;
        const bb = parseInt(hex.slice(5,7), 16) || 0;
        const dynamicShadowColor = `rgba(${rr},${gg},${bb},${opacity})`;

        ctx.save();

        if (sType === 'glow') {
          // Glow: tight repeated passes
          ctx.shadowColor   = dynamicShadowColor;
          ctx.shadowBlur    = sBlur * 2;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0;
          ctx.fillText(line, centerX, lineY); 
          ctx.fillText(line, centerX, lineY); 

        } else if (sType === 'inner') {
          // Inner: tight shadow with source-atop
          ctx.shadowColor   = dynamicShadowColor;
          ctx.shadowBlur    = Math.min(sBlur, 8);
          ctx.shadowOffsetX = sOffsetX * 0.5;
          ctx.shadowOffsetY = sOffsetY * 0.5;
          ctx.globalCompositeOperation = 'source-atop';
          ctx.fillText(line, centerX, lineY);
          ctx.globalCompositeOperation = 'source-over';

        } else {
          // Drop (default)
          ctx.shadowColor   = dynamicShadowColor;
          ctx.shadowBlur    = sBlur;
          ctx.shadowOffsetX = sOffsetX;
          ctx.shadowOffsetY = sOffsetY;
          ctx.fillText(line, centerX, lineY);
        }

        ctx.restore();

        // Draw real text clean on top
        ctx.save();
        ctx.shadowColor = 'transparent';
        ctx.fillText(line, centerX, lineY);
        ctx.restore();

      } else {
        ctx.fillText(line, centerX, lineY);
      }
    });

    const overlayBuf = canvas.toBuffer('image/png');
    // Composite at 0,0 — full-screen transparent PNG
    finalPipeline = finalPipeline.composite([{ input: overlayBuf, left: 0, top: 0 }]);

  } else if (state.contentType === 'image' && state.contentValue) {
    const rawOverlay = Buffer.from(state.contentValue, 'base64');
    const scaledW = Math.max(1, Math.round(w * scale));
    const scaledH = Math.max(1, Math.round(h * scale));

    const resizedOverlay = await sharp(rawOverlay)
      .resize(scaledW, scaledH, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    const finalLeft = Math.round(x + (w - scaledW) / 2 + moveX);
    const finalTop  = Math.round(y + (h - scaledH) / 2 + moveY);

    finalPipeline = finalPipeline.composite([{ input: resizedOverlay, left: finalLeft, top: finalTop }]);
  }

  let resultBuffer = await finalPipeline.jpeg({ quality: 90 }).toBuffer();

  // 5. Apply Watermark ONLY if requested (Preview mode)
  if (applyWatermark) {
    resultBuffer = await addWatermark(resultBuffer);
  }

  return resultBuffer;
}
