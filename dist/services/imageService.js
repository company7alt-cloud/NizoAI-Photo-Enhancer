"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.enhance = enhance;
// src/services/imageService.ts
const replicate_1 = __importDefault(require("replicate"));
const sharp_1 = __importDefault(require("sharp"));
const replicate = new replicate_1.default({ auth: process.env.REPLICATE_API_TOKEN });
const MAX_INPUT_DIMENSION = 1400;
const MAX_OUTPUT_SIZE_BYTES = 2 * 1024 * 1024;
async function enhance(telegramFileUrl, resolution) {
    try {
        // STEP 1: Download image from Telegram into memory
        const imageResponse = await fetch(telegramFileUrl);
        if (!imageResponse.ok)
            throw new Error(`Download failed: ${imageResponse.status}`);
        const rawBuffer = Buffer.from(await imageResponse.arrayBuffer());
        console.log(`[ImageService] Downloaded: ${(rawBuffer.length / 1024).toFixed(1)} KB`);
        // STEP 2: PRE-PROCESS in memory — resize if too large to prevent GPU memory errors
        const metadata = await (0, sharp_1.default)(rawBuffer).metadata();
        const width = metadata.width || 0;
        const height = metadata.height || 0;
        console.log(`[ImageService] Input dimensions: ${width}x${height}`);
        let processedBuffer;
        if (width > MAX_INPUT_DIMENSION || height > MAX_INPUT_DIMENSION) {
            console.log(`[ImageService] Resizing to max ${MAX_INPUT_DIMENSION}px...`);
            processedBuffer = await (0, sharp_1.default)(rawBuffer)
                .resize(MAX_INPUT_DIMENSION, MAX_INPUT_DIMENSION, {
                fit: 'inside',
                withoutEnlargement: true
            })
                .jpeg({ quality: 92 })
                .toBuffer();
        }
        else {
            processedBuffer = await (0, sharp_1.default)(rawBuffer).jpeg({ quality: 92 }).toBuffer();
        }
        // STEP 3: Direct memory to base64 — zero disk I/O
        const base64Image = `data:image/jpeg;base64,${processedBuffer.toString('base64')}`;
        const scale = resolution === '2K' ? 2 : 4;
        console.log(`[ImageService] Sending to Replicate — ${resolution}, Scale: ${scale}x`);
        // STEP 4: Call Replicate Real-ESRGAN
        const output = await replicate.run("nightmareai/real-esrgan:42fed1c4974146d4d2414e2be2c5277c7fcf05fcc3a73abf41610695738c1d7b", {
            input: {
                image: base64Image,
                scale: scale,
                face_enhance: false
            }
        });
        const resultUrl = Array.isArray(output) ? String(output[0]) : String(output);
        if (!resultUrl || !resultUrl.startsWith('http')) {
            throw new Error(`Invalid URL returned from Replicate: ${resultUrl}`);
        }
        // STEP 5: Download result into memory
        const resultResponse = await fetch(resultUrl);
        if (!resultResponse.ok)
            throw new Error(`Result download failed: ${resultResponse.status}`);
        const resultBuffer = Buffer.from(await resultResponse.arrayBuffer());
        console.log(`[ImageService] Result: ${(resultBuffer.length / 1024).toFixed(1)} KB`);
        // STEP 6: POST-PROCESS based on resolution
        let finalBuffer;
        if (resolution === '4K') {
            console.log(`[ImageService] Applying 4K: sharpen + compress...`);
            let sharpened = await (0, sharp_1.default)(resultBuffer)
                .sharpen({ sigma: 1.2, m1: 1.5, m2: 0.7 })
                .jpeg({ quality: 85 })
                .toBuffer();
            if (sharpened.length > MAX_OUTPUT_SIZE_BYTES) {
                console.log(`[ImageService] Still too large, re-compressing to 72%...`);
                sharpened = await (0, sharp_1.default)(sharpened).jpeg({ quality: 72 }).toBuffer();
            }
            finalBuffer = sharpened;
        }
        else {
            // 2K: JPEG compression only, no sharpening, maximum speed
            finalBuffer = await (0, sharp_1.default)(resultBuffer).jpeg({ quality: 90 }).toBuffer();
        }
        console.log(`[ImageService] ✅ Final size: ${(finalBuffer.length / 1024).toFixed(1)} KB`);
        return finalBuffer;
    }
    catch (error) {
        console.error(`[ImageService] ❌ Error: ${error?.message || error}`);
        throw error;
    }
}
//# sourceMappingURL=imageService.js.map