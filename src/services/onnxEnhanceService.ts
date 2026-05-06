// src/services/onnxEnhanceService.ts
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import path from 'path';

const MODEL_PATH = path.join(process.cwd(), 'RealESRGAN_x4.onnx');
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_CONCURRENT = 2;
const JPEG_QUALITY = 95;
const TILE_SIZE = 64;
const SCALE = 4;

let sessionCache: ort.InferenceSession | null = null;

async function getSession(): Promise<ort.InferenceSession> {
  if (!sessionCache) {
    console.log('[ONNX] Loading RealESRGAN model...');
    sessionCache = await ort.InferenceSession.create(MODEL_PATH, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
    });
    console.log('[ONNX] Model loaded ✅');
  }
  return sessionCache;
}

let activeJobs = 0;
const waitingQueue: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (activeJobs < MAX_CONCURRENT) { activeJobs++; return; }
  return new Promise<void>((resolve) => { waitingQueue.push(resolve); });
}

function releaseSlot(): void {
  if (waitingQueue.length > 0) {
    const next = waitingQueue.shift();
    if (next) next();
  } else {
    activeJobs = Math.max(0, activeJobs - 1);
  }
}

export function getQueuePosition(): number { return waitingQueue.length; }
export function isAtCapacity(): boolean { return activeJobs >= MAX_CONCURRENT; }

async function runTile(session: ort.InferenceSession, tileBuffer: Buffer, tileW: number, tileH: number): Promise<Buffer> {
  const tensorData = new Float32Array(3 * tileH * tileW);
  const raw = tileBuffer;

  for (let y = 0; y < tileH; y++) {
    for (let x = 0; x < tileW; x++) {
      const src = (y * tileW + x) * 3;
      tensorData[0 * tileH * tileW + y * tileW + x] = raw[src] / 255.0;
      tensorData[1 * tileH * tileW + y * tileW + x] = raw[src + 1] / 255.0;
      tensorData[2 * tileH * tileW + y * tileW + x] = raw[src + 2] / 255.0;
    }
  }

  const inputName = session.inputNames[0];
  const tensor = new ort.Tensor('float32', tensorData, [1, 3, tileH, tileW]);
  const results = await session.run({ [inputName]: tensor });

  const outputTensor = results[session.outputNames[0]];
  const outData = outputTensor.data as Float32Array;
  const outH = outputTensor.dims[2] as number;
  const outW = outputTensor.dims[3] as number;

  const rgb = Buffer.alloc(outH * outW * 3);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const dst = (y * outW + x) * 3;
      rgb[dst] = Math.min(255, Math.max(0, Math.round(outData[0 * outH * outW + y * outW + x] * 255)));
      rgb[dst + 1] = Math.min(255, Math.max(0, Math.round(outData[1 * outH * outW + y * outW + x] * 255)));
      rgb[dst + 2] = Math.min(255, Math.max(0, Math.round(outData[2 * outH * outW + y * outW + x] * 255)));
    }
  }
  return rgb;
}

export async function enhanceWithONNX(inputBuffer: Buffer): Promise<Buffer> {
  if (inputBuffer.length > MAX_FILE_BYTES) throw new Error('file_too_large');

  await acquireSlot();
  try {
    const metadata = await sharp(inputBuffer).metadata();
    const origW = metadata.width ?? 256;
    const origH = metadata.height ?? 256;

    // Resize to max 512 on longest edge
    const scale = Math.min(1, 512 / Math.max(origW, origH));
    const procW = Math.round(origW * scale);
    const procH = Math.round(origH * scale);

    console.log(`[ONNX] Processing: ${procW}x${procH} in ${TILE_SIZE}px tiles`);

    const { data: rawData } = await sharp(inputBuffer)
      .resize({ width: procW, height: procH, fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const session = await getSession();

    const tilesX = Math.ceil(procW / TILE_SIZE);
    const tilesY = Math.ceil(procH / TILE_SIZE);
    const outW = procW * SCALE;
    const outH = procH * SCALE;

    const outputCanvas = Buffer.alloc(outH * outW * 3, 0);

    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const tileX = tx * TILE_SIZE;
        const tileY = ty * TILE_SIZE;
        const tileW = Math.min(TILE_SIZE, procW - tileX);
        const tileH = Math.min(TILE_SIZE, procH - tileY);

        // Extract tile pixels
        const tileRaw = Buffer.alloc(tileH * tileW * 3);
        for (let y = 0; y < tileH; y++) {
          for (let x = 0; x < tileW; x++) {
            const src = ((tileY + y) * procW + (tileX + x)) * 3;
            const dst = (y * tileW + x) * 3;
            tileRaw[dst] = rawData[src];
            tileRaw[dst + 1] = rawData[src + 1];
            tileRaw[dst + 2] = rawData[src + 2];
          }
        }

        // Pad to TILE_SIZE x TILE_SIZE if needed
        let paddedTile = tileRaw;
        let runW = tileW;
        let runH = tileH;

        if (tileW < TILE_SIZE || tileH < TILE_SIZE) {
          paddedTile = Buffer.alloc(TILE_SIZE * TILE_SIZE * 3, 0);
          for (let y = 0; y < tileH; y++) {
            for (let x = 0; x < tileW; x++) {
              const src = (y * tileW + x) * 3;
              const dst = (y * TILE_SIZE + x) * 3;
              paddedTile[dst] = tileRaw[src];
              paddedTile[dst + 1] = tileRaw[src + 1];
              paddedTile[dst + 2] = tileRaw[src + 2];
            }
          }
          runW = TILE_SIZE;
          runH = TILE_SIZE;
        }

        const outTileRgb = await runTile(session, paddedTile, runW, runH);
        const outTileW = runW * SCALE;
        // const outTileH = runH * SCALE;
        const cropW = tileW * SCALE;
        const cropH = tileH * SCALE;
        const destX = tileX * SCALE;
        const destY = tileY * SCALE;

        // Write tile to canvas
        for (let y = 0; y < cropH; y++) {
          for (let x = 0; x < cropW; x++) {
            const src = (y * outTileW + x) * 3;
            const dst = ((destY + y) * outW + (destX + x)) * 3;
            outputCanvas[dst] = outTileRgb[src];
            outputCanvas[dst + 1] = outTileRgb[src + 1];
            outputCanvas[dst + 2] = outTileRgb[src + 2];
          }
        }
      }
    }

    console.log(`[ONNX] Output: ${outW}x${outH}`);

    const finalBuffer = await sharp(outputCanvas, {
      raw: { width: outW, height: outH, channels: 3 },
    }).jpeg({ quality: JPEG_QUALITY, chromaSubsampling: '4:4:4', force: true }).toBuffer();

    return finalBuffer;
  } finally {
    releaseSlot();
  }
}
