"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.enhance = enhance;
const replicate_1 = __importDefault(require("replicate"));
const sharp_1 = __importDefault(require("sharp"));
const replicate = new replicate_1.default({
    auth: process.env.REPLICATE_API_KEY || '',
});
const MAX_INPUT_DIMENSION = 1400;
const MAX_OUTPUT_SIZE_BYTES = 2 * 1024 * 1024;
async function enhance(telegramFileUrl, resolution) {
    try {
        // STEP 1: Download from Telegram
        const imageResponse = await fetch(telegramFileUrl);
        if (!imageResponse.ok)
            throw new Error(`Download failed: ${imageResponse.status}`);
        const rawBuffer = Buffer.from(await imageResponse.arrayBuffer());
        console.log(`[ImageService] Downloaded: ${(rawBuffer.length / 1024).toFixed(1)} KB`);
        // STEP 2: Resize if needed
        const metadata = await (0, sharp_1.default)(rawBuffer).metadata();
        const width = metadata.width || 0;
        const height = metadata.height || 0;
        console.log(`[ImageService] Input dimensions: ${width}x${height}`);
        let processedBuffer;
        if (width > MAX_INPUT_DIMENSION || height > MAX_INPUT_DIMENSION) {
            processedBuffer = await (0, sharp_1.default)(rawBuffer)
                .resize(MAX_INPUT_DIMENSION, MAX_INPUT_DIMENSION, {
                fit: 'inside',
                withoutEnlargement: true
            })
                .jpeg({ quality: 92 })
                .toBuffer();
            console.log(`[ImageService] Resized to: ${(processedBuffer.length / 1024).toFixed(1)} KB`);
        }
        else {
            processedBuffer = await (0, sharp_1.default)(rawBuffer).jpeg({ quality: 92 }).toBuffer();
        }
        const base64Image = `data:image/jpeg;base64,${processedBuffer.toString('base64')}`;
        const scale = resolution === '2K' ? 2 : 4;
        console.log(`[ImageService] Sending to Replicate — ${resolution}, Scale: ${scale}x`);
        // STEP 3: Create prediction and poll for result
        let prediction = await replicate.predictions.create({
            version: "42fed1c4974146d4d2414e2be2c5277c7fcf05fcc3a73abf41610695738c1d7b",
            input: {
                image: base64Image,
                scale: scale,
                face_enhance: false
            }
        });
        console.log(`[ImageService] Prediction created: ${prediction.id}, status: ${prediction.status}`);
        // Poll until completed or failed
        const startTime = Date.now();
        const timeout = 90 * 1000; // 90 seconds
        while (prediction.status !== 'succeeded' && prediction.status !== 'failed') {
            if (Date.now() - startTime > timeout) {
                throw new Error('Replicate prediction timed out after 90 seconds');
            }
            await new Promise(resolve => setTimeout(resolve, 2000)); // wait 2 seconds
            prediction = await replicate.predictions.get(prediction.id);
            console.log(`[ImageService] Polling status: ${prediction.status}`);
        }
        if (prediction.status === 'failed') {
            console.error('[ImageService] Prediction failed:', prediction.error);
            throw new Error(`Replicate prediction failed: ${prediction.error}`);
        }
        // STEP 4: Extract output URL
        const output = prediction.output;
        console.log(`[ImageService] Raw output:`, JSON.stringify(output));
        let resultUrl;
        if (typeof output === 'string') {
            resultUrl = output;
        }
        else if (Array.isArray(output) && output.length > 0) {
            resultUrl = output[0];
        }
        else {
            throw new Error(`Unexpected output format: ${JSON.stringify(output)}`);
        }
        if (!resultUrl)
            throw new Error('Empty result URL from Replicate');
        // STEP 5: Download result
        console.log(`[ImageService] Downloading result from: ${resultUrl}`);
        const resultResponse = await fetch(resultUrl);
        if (!resultResponse.ok)
            throw new Error(`Result download failed: ${resultResponse.status}`);
        const resultBuffer = Buffer.from(await resultResponse.arrayBuffer());
        console.log(`[ImageService] Result: ${(resultBuffer.length / 1024).toFixed(1)} KB`);
        // STEP 6: Post-process
        let finalBuffer;
        if (resolution === '4K') {
            let sharpened = await (0, sharp_1.default)(resultBuffer)
                .sharpen({ sigma: 1.2, m1: 1.5, m2: 0.7 })
                .jpeg({ quality: 85 })
                .toBuffer();
            if (sharpened.length > MAX_OUTPUT_SIZE_BYTES) {
                sharpened = await (0, sharp_1.default)(sharpened).jpeg({ quality: 72 }).toBuffer();
            }
            finalBuffer = sharpened;
        }
        else {
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