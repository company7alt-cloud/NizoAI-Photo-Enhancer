"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getQueuePosition = getQueuePosition;
exports.isAtCapacity = isAtCapacity;
exports.enhanceWithONNX = enhanceWithONNX;
// src/services/onnxEnhanceService.ts
const ort = __importStar(require("onnxruntime-node"));
const sharp_1 = __importDefault(require("sharp"));
const path_1 = __importDefault(require("path"));
const MODEL_PATH = path_1.default.join(process.cwd(), 'RealESRGAN_x4.onnx');
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_CONCURRENT = 2;
const JPEG_QUALITY = 95;
const TILE_SIZE = 64;
const SCALE = 4;
let sessionCache = null;
async function getSession() {
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
const waitingQueue = [];
async function acquireSlot() {
    if (activeJobs < MAX_CONCURRENT) {
        activeJobs++;
        return;
    }
    return new Promise((resolve) => { waitingQueue.push(resolve); });
}
function releaseSlot() {
    if (waitingQueue.length > 0) {
        const next = waitingQueue.shift();
        if (next)
            next();
    }
    else {
        activeJobs = Math.max(0, activeJobs - 1);
    }
}
function getQueuePosition() { return waitingQueue.length; }
function isAtCapacity() { return activeJobs >= MAX_CONCURRENT; }
async function runTile(session, tileBuffer, tileW, tileH) {
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
    const outData = outputTensor.data;
    const outH = outputTensor.dims[2];
    const outW = outputTensor.dims[3];
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
async function enhanceWithONNX(inputBuffer) {
    if (inputBuffer.length > MAX_FILE_BYTES)
        throw new Error('file_too_large');
    await acquireSlot();
    try {
        const metadata = await (0, sharp_1.default)(inputBuffer).metadata();
        const origW = metadata.width ?? 256;
        const origH = metadata.height ?? 256;
        // Resize to max 512 on longest edge
        const scale = Math.min(1, 512 / Math.max(origW, origH));
        const procW = Math.round(origW * scale);
        const procH = Math.round(origH * scale);
        console.log(`[ONNX] Processing: ${procW}x${procH} in ${TILE_SIZE}px tiles`);
        const { data: rawData } = await (0, sharp_1.default)(inputBuffer)
            .resize({ width: procW, height: procH, fit: 'fill', kernel: sharp_1.default.kernel.lanczos3 })
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
        const finalBuffer = await (0, sharp_1.default)(outputCanvas, {
            raw: { width: outW, height: outH, channels: 3 },
        }).jpeg({ quality: JPEG_QUALITY, chromaSubsampling: '4:4:4', force: true }).toBuffer();
        return finalBuffer;
    }
    finally {
        releaseSlot();
    }
}
//# sourceMappingURL=onnxEnhanceService.js.map