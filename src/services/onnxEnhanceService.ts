// src/services/onnxEnhanceService.ts
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import path from 'path';

// ── CONSTANTS ────────────────────────────────────────
const MODEL_PATH = path.join(process.cwd(), 'RealESRGAN_x4.onnx');
const MAX_INPUT_EDGE   = 512;              // px — longest edge before processing
const MAX_FILE_BYTES   = 2 * 1024 * 1024; // 2 MB hard limit
const MAX_CONCURRENT   = 2;               // max simultaneous ONNX sessions
const JPEG_QUALITY     = 95;

// ── SESSION CACHE (load once, reuse forever) ─────────
let sessionCache: ort.InferenceSession | null = null;

async function getSession(): Promise<ort.InferenceSession> {
  if (!sessionCache) {
    console.log('[ONNX] Loading RealESRGAN model...');
    sessionCache = await ort.InferenceSession.create(MODEL_PATH, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
    });
    console.log('[ONNX] Model loaded and cached ✅');
  }
  return sessionCache;
}

// ── CONCURRENCY QUEUE ─────────────────────────────────
let activeJobs = 0;
const waitingQueue: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (activeJobs < MAX_CONCURRENT) {
    activeJobs++;
    return;
  }
  return new Promise<void>((resolve) => {
    waitingQueue.push(resolve);
  });
}

function releaseSlot(): void {
  if (waitingQueue.length > 0) {
    const next = waitingQueue.shift();
    if (next) next();
  } else {
    activeJobs = Math.max(0, activeJobs - 1);
  }
}

export function getQueuePosition(): number {
  return waitingQueue.length;
}

export function isAtCapacity(): boolean {
  return activeJobs >= MAX_CONCURRENT;
}

// ── MAIN ENHANCE FUNCTION ────────────────────────────
export async function enhanceWithONNX(inputBuffer: Buffer): Promise<Buffer> {

  // SAFETY GATE 1: file size
  if (inputBuffer.length > MAX_FILE_BYTES) {
    throw new Error('file_too_large');
  }

  // Wait for an available slot
  await acquireSlot();

  try {
    // STAGE 1: Read metadata
    const metadata = await sharp(inputBuffer).metadata();
    const origW = metadata.width  ?? 256;
    const origH = metadata.height ?? 256;

    console.log(`[ONNX] Original: ${origW}x${origH}`);

    // SAFETY GATE 2: resize longest edge to MAX before processing
    const scale = Math.min(1, MAX_INPUT_EDGE / Math.max(origW, origH));
    const procW = Math.round(origW * scale);
    const procH = Math.round(origH * scale);

    console.log(`[ONNX] Processing at: ${procW}x${procH}`);

    // STAGE 2: Prepare input — resize + extract raw RGB
    const { data: rawData } = await sharp(inputBuffer)
      .resize({ width: procW, height: procH, fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // STAGE 3: Convert to Float32Array tensor [1, 3, H, W]
    // Normalize pixels from 0-255 → 0.0-1.0
    const tensorData = new Float32Array(3 * procH * procW);

    for (let y = 0; y < procH; y++) {
      for (let x = 0; x < procW; x++) {
        const srcIdx = (y * procW + x) * 3;
        const r = rawData[srcIdx]     / 255.0;
        const g = rawData[srcIdx + 1] / 255.0;
        const b = rawData[srcIdx + 2] / 255.0;

        // Planar format: R channel, G channel, B channel
        tensorData[0 * procH * procW + y * procW + x] = r;
        tensorData[1 * procH * procW + y * procW + x] = g;
        tensorData[2 * procH * procW + y * procW + x] = b;
      }
    }

    // STAGE 4: Run ONNX inference
    const session   = await getSession();
    const inputName = session.inputNames[0];
    const tensor    = new ort.Tensor('float32', tensorData, [1, 3, procH, procW]);
    const feeds: Record<string, ort.Tensor> = { [inputName]: tensor };

    console.log('[ONNX] Running inference...');
    const results = await session.run(feeds);
    console.log('[ONNX] Inference complete ✅');

    // STAGE 5: Extract output tensor
    const outputName   = session.outputNames[0];
    const outputTensor = results[outputName];
    const outputData   = outputTensor.data as Float32Array;
    const outH         = outputTensor.dims[2] as number;
    const outW         = outputTensor.dims[3] as number;

    console.log(`[ONNX] Output: ${outW}x${outH}`);

    // STAGE 6: Convert tensor back to packed RGB Buffer [H, W, 3]
    const rgbBuffer = Buffer.alloc(outH * outW * 3);

    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const dstIdx = (y * outW + x) * 3;

        const r = outputData[0 * outH * outW + y * outW + x];
        const g = outputData[1 * outH * outW + y * outW + x];
        const b = outputData[2 * outH * outW + y * outW + x];

        // Clamp to 0-255
        rgbBuffer[dstIdx]     = Math.min(255, Math.max(0, Math.round(r * 255)));
        rgbBuffer[dstIdx + 1] = Math.min(255, Math.max(0, Math.round(g * 255)));
        rgbBuffer[dstIdx + 2] = Math.min(255, Math.max(0, Math.round(b * 255)));
      }
    }

    // STAGE 7: Encode to JPEG with maximum quality
    const finalBuffer = await sharp(rgbBuffer, {
      raw: { width: outW, height: outH, channels: 3 },
    })
      .jpeg({
        quality:           JPEG_QUALITY,
        chromaSubsampling: '4:4:4',
        force:             true,
      })
      .toBuffer();

    console.log(`[ONNX] Final output: ${finalBuffer.length} bytes`);
    return finalBuffer;

  } finally {
    releaseSlot();
  }
}
