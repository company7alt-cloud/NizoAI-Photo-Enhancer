import sharp from 'sharp';

export async function drawGridOnImage(
  inputBuffer: Buffer,
  cols: number,
  rows: number
): Promise<Buffer> {
  const meta = await sharp(inputBuffer).metadata();
  const W = meta.width!;
  const H = meta.height!;
  const cellW = W / cols;
  const cellH = H / rows;
  const lineW = Math.max(1, Math.round(W / 600));
  const fontSize = Math.max(16, Math.min(
    Math.floor(cellW * 0.38),
    Math.floor(cellH * 0.48),
    38
  ));

  const svgParts: string[] = [];

  for (let c = 1; c < cols; c++) {
    const x = Math.round(c * cellW);
    svgParts.push(
      `<line x1="${x}" y1="0" x2="${x}" y2="${H}" ` +
      `stroke="white" stroke-width="${lineW}" opacity="0.85"/>`
    );
  }

  for (let r = 1; r < rows; r++) {
    const y = Math.round(r * cellH);
    svgParts.push(
      `<line x1="0" y1="${y}" x2="${W}" y2="${y}" ` +
      `stroke="white" stroke-width="${lineW}" opacity="0.85"/>`
    );
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const num = String(r * cols + c + 1);
      const cx = Math.round(c * cellW + cellW / 2);
      const cy = Math.round(r * cellH + cellH / 2);
      svgParts.push(
        `<text x="${cx + 2}" y="${cy + 2}" ` +
        `font-family="Liberation Sans, DejaVu Sans, sans-serif" ` +
        `font-size="${fontSize}" font-weight="bold" ` +
        `text-anchor="middle" dominant-baseline="middle" ` +
        `fill="black" opacity="0.55">${num}</text>`
      );
      svgParts.push(
        `<text x="${cx}" y="${cy}" ` +
        `font-family="Liberation Sans, DejaVu Sans, sans-serif" ` +
        `font-size="${fontSize}" font-weight="bold" ` +
        `text-anchor="middle" dominant-baseline="middle" ` +
        `fill="white" opacity="1">${num}</text>`
      );
    }
  }

  const svg = Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">` +
    svgParts.join('') +
    `</svg>`,
    'utf-8'
  );

  return sharp(inputBuffer)
    .composite([{ input: svg, top: 0, left: 0 }])
    .jpeg({ quality: 88 })
    .toBuffer();
}

export const GRID_CONFIGS: Record<number, { cols: number; rows: number }> = {
  30:  { cols: 5,  rows: 6  },
  40:  { cols: 5,  rows: 8  },
  50:  { cols: 5,  rows: 10 },
  70:  { cols: 7,  rows: 10 },
  80:  { cols: 8,  rows: 10 },
  100: { cols: 10, rows: 10 },
  120: { cols: 10, rows: 12 },
};
