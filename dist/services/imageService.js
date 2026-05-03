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
exports.enhance = enhance;
exports.enhanceWithNanoBanana = enhanceWithNanoBanana;
exports.process4KAi = process4KAi;
exports.processProEnhance = processProEnhance;
exports.processNanoBanana = processNanoBanana;
exports.processWatermarkEraser = processWatermarkEraser;
exports.convertImageFormat = convertImageFormat;
const replicate_1 = __importDefault(require("replicate"));
const sharp_1 = __importDefault(require("sharp"));
const replicate = new replicate_1.default({
    auth: process.env.REPLICATE_API_KEY || '',
});
async function enhance2K(inputBuffer) {
    const metadata = await (0, sharp_1.default)(inputBuffer).metadata();
    const width = metadata.width || 1000;
    const height = metadata.height || 1000;
    const pixels = width * height;
    // Only upscale if image is smaller than 2K
    const TARGET_PIXELS = 2048 * 2048;
    const needsUpscale = pixels < TARGET_PIXELS;
    const scale = needsUpscale ? Math.sqrt(TARGET_PIXELS / pixels) : 1;
    const newWidth = Math.round(width * Math.min(scale, 4));
    const newHeight = Math.round(height * Math.min(scale, 4));
    const processed = await (0, sharp_1.default)(inputBuffer)
        .resize({
        width: newWidth,
        height: newHeight,
        fit: 'fill',
        kernel: sharp_1.default.kernel.lanczos3,
    })
        .sharpen({ sigma: 0.8, m1: 0.3, m2: 0.3 })
        .jpeg({
        quality: 95,
        chromaSubsampling: '4:4:4',
        force: true,
        mozjpeg: true,
    })
        .toBuffer();
    const MAX_SIZE = 2 * 1024 * 1024;
    if (processed.length > MAX_SIZE) {
        return await (0, sharp_1.default)(inputBuffer)
            .resize({ width: newWidth, height: newHeight, fit: 'fill', kernel: sharp_1.default.kernel.lanczos3 })
            .jpeg({ quality: 88, chromaSubsampling: '4:4:4', force: true, mozjpeg: true })
            .toBuffer();
    }
    return processed;
}
const MAX_INPUT_DIMENSION = 1400;
async function enhance(telegramFileUrl, resolution) {
    try {
        // STEP 1: Download from Telegram
        const imageResponse = await fetch(telegramFileUrl);
        if (!imageResponse.ok)
            throw new Error(`Download failed: ${imageResponse.status}`);
        const rawArray = await imageResponse.arrayBuffer();
        const rawBuffer = Buffer.from(new Uint8Array(rawArray));
        console.log(`[ImageService] Downloaded: ${(rawBuffer.length / 1024).toFixed(1)} KB`);
        if (resolution === '2K') {
            console.log(`[ImageService] Enhancing 2K locally using sharp`);
            const finalBuffer = await enhance2K(rawBuffer);
            console.log(`[ImageService] ✅ Final 2K size: ${(finalBuffer.length / 1024).toFixed(1)} KB`);
            return finalBuffer;
        }
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
        const resultRawArray = await resultResponse.arrayBuffer();
        const resultBuffer = Buffer.from(new Uint8Array(resultRawArray));
        console.log(`[ImageService] Result: ${(resultBuffer.length / 1024).toFixed(1)} KB`);
        // STEP 6: Post-process
        let finalBuffer;
        if (resolution === '4K') {
            const processed = await (0, sharp_1.default)(resultBuffer)
                .resize({ width: 3840, height: 3840, fit: 'inside', withoutEnlargement: false })
                .sharpen({ sigma: 1.5, m1: 0.8, m2: 0.8 })
                .jpeg({ quality: 95, chromaSubsampling: '4:4:4', force: true })
                .toBuffer();
            const MAX_SIZE = 4 * 1024 * 1024;
            if (processed.length > MAX_SIZE) {
                finalBuffer = await (0, sharp_1.default)(resultBuffer)
                    .resize({ width: 3840, height: 3840, fit: 'inside' })
                    .sharpen({ sigma: 1.2 })
                    .jpeg({ quality: 88, chromaSubsampling: '4:4:4', force: true })
                    .toBuffer();
            }
            else {
                finalBuffer = processed;
            }
        }
        else {
            finalBuffer = await (0, sharp_1.default)(resultBuffer)
                .jpeg({ quality: 80, chromaSubsampling: '4:2:0' })
                .toBuffer();
        }
        console.log(`[ImageService] ✅ Final size: ${(finalBuffer.length / 1024).toFixed(1)} KB`);
        return finalBuffer;
    }
    catch (error) {
        console.error(`[ImageService] ❌ Error: ${error?.message || error}`);
        throw error;
    }
}
async function enhanceWithNanoBanana(base64Image, aiPrompt) {
    console.log('[ImageService] Sending to SDXL with prompt:', aiPrompt);
    const output = await replicate.run("stability-ai/sdxl", {
        input: {
            image: `data:image/jpeg;base64,${base64Image}`,
            prompt: aiPrompt,
            prompt_strength: 0.7,
            num_inference_steps: 40,
            refine: "expert_ensemble_refiner"
        }
    });
    let resultUrl = "";
    if (Array.isArray(output) && output.length > 0)
        resultUrl = output[0];
    else if (typeof output === 'string')
        resultUrl = output;
    else
        throw new Error('SDXL returned invalid format');
    const resultResponse = await fetch(resultUrl);
    const resultRawData = await resultResponse.arrayBuffer();
    return Buffer.from(new Uint8Array(resultRawData));
}
async function process4KAi(imageUrl) {
    const imageResponse = await fetch(imageUrl);
    const rawImage = await imageResponse.arrayBuffer();
    const imageBuffer = Buffer.from(new Uint8Array(rawImage));
    const metadata = await (0, sharp_1.default)(imageBuffer).metadata();
    const width = metadata.width || 1000;
    const height = metadata.height || 1000;
    const pixels = width * height;
    // Cap at 1,200,000 pixels before sending to Replicate to avoid CUDA OOM
    const MAX_PIXELS = 1_200_000;
    let processedInput = imageBuffer;
    if (pixels > MAX_PIXELS) {
        const scale = Math.sqrt(MAX_PIXELS / pixels);
        const newWidth = Math.round(width * scale);
        const newHeight = Math.round(height * scale);
        processedInput = await (0, sharp_1.default)(imageBuffer)
            .resize({ width: newWidth, height: newHeight, fit: 'fill', kernel: sharp_1.default.kernel.lanczos3 })
            .jpeg({ quality: 98, chromaSubsampling: '4:4:4', force: true })
            .toBuffer();
    }
    // Convert to base64 for Replicate
    const base64Image = `data:image/jpeg;base64,${processedInput.toString('base64')}`;
    const output = await replicate.run("nightmareai/real-esrgan", {
        input: {
            image: base64Image,
            scale: 2,
            face_enhance: false
        }
    });
    const imageOutput = Array.isArray(output) ? output[0] : output;
    if (!imageOutput)
        throw new Error('No output from Replicate');
    const response = await fetch(imageOutput.toString());
    const arrayBuffer = await response.arrayBuffer();
    const resultBuffer = await (0, sharp_1.default)(Buffer.from(new Uint8Array(arrayBuffer)))
        .sharpen({ sigma: 0.6, m1: 0.2, m2: 0.2 })
        .jpeg({
        quality: 97,
        chromaSubsampling: '4:4:4',
        force: true,
        mozjpeg: true,
    })
        .toBuffer();
    return resultBuffer;
}
async function processProEnhance(imageUrl, quality, scale, imageType) {
    // Fixes TS6133 (unused variable) by logging the settings
    console.log(`[ProEnhance] Quality: ${quality}, Scale: ${scale}, Type: ${imageType}`);
    // Fixes TS7016 (No node-fetch needed, Node 18+ has native fetch)
    const imgResponse = await fetch(imageUrl);
    const arrayBuffer = await imgResponse.arrayBuffer();
    // Fixes TS2322 (Type casting to ArrayBuffer)
    const inputBuffer = Buffer.from(new Uint8Array(arrayBuffer));
    const metadata = await (0, sharp_1.default)(inputBuffer).metadata();
    const w = metadata.width || 800;
    const h = metadata.height || 800;
    const pixels = w * h;
    const MAX_PIXELS = 1_000_000;
    let processedInput = inputBuffer;
    if (pixels > MAX_PIXELS) {
        const s = Math.sqrt(MAX_PIXELS / pixels);
        processedInput = await (0, sharp_1.default)(inputBuffer)
            .resize({ width: Math.round(w * s), height: Math.round(h * s), fit: 'fill', kernel: sharp_1.default.kernel.lanczos3 })
            .jpeg({ quality: 98, force: true })
            .toBuffer();
    }
    const base64Image = `data:image/jpeg;base64,${processedInput.toString('base64')}`;
    const faceEnhance = imageType === 'face';
    const modelName = imageType === 'art' ? 'RealESRGAN_x4plus_anime_6B' : 'RealESRGAN_x4plus';
    const input = {
        image: base64Image,
        scale: scale,
        face_enhance: faceEnhance,
        model: modelName,
    };
    const Replicate = (await Promise.resolve().then(() => __importStar(require('replicate')))).default;
    const replicate = new Replicate({ auth: process.env.REPLICATE_API_KEY });
    let prediction = await replicate.predictions.create({
        version: 'nightmareai/real-esrgan',
        input,
    });
    while (!['succeeded', 'failed', 'canceled'].includes(prediction.status)) {
        await new Promise((r) => setTimeout(r, 2000));
        prediction = await replicate.predictions.get(prediction.id);
    }
    if (prediction.status !== 'succeeded' || !prediction.output) {
        throw new Error(`Pro Enhance failed: ${prediction.status}`);
    }
    const outputUrl = typeof prediction.output === 'string' ? prediction.output : prediction.output[0];
    const resultResponse = await fetch(outputUrl);
    const resultArray = await resultResponse.arrayBuffer();
    return await (0, sharp_1.default)(Buffer.from(new Uint8Array(resultArray)))
        .sharpen({ sigma: 0.8 })
        .jpeg({ quality: 95, chromaSubsampling: '4:4:4', force: true, mozjpeg: true })
        .toBuffer();
}
async function processNanoBanana(imageUrl) {
    try {
        console.log('[NanoAI] Starting via Replicate Real-ESRGAN...');
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok)
            throw new Error(`Download failed: ${imageResponse.status}`);
        const rawBuffer = Buffer.from(new Uint8Array(await imageResponse.arrayBuffer()));
        const metadata = await (0, sharp_1.default)(rawBuffer).metadata();
        const width = metadata.width ?? 0;
        const height = metadata.height ?? 0;
        let processedBuffer;
        if (width > 1400 || height > 1400) {
            processedBuffer = Buffer.from(await (0, sharp_1.default)(rawBuffer)
                .resize(1400, 1400, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 92 })
                .toBuffer());
        }
        else {
            processedBuffer = Buffer.from(await (0, sharp_1.default)(rawBuffer).jpeg({ quality: 92 }).toBuffer());
        }
        const base64Image = `data:image/jpeg;base64,${processedBuffer.toString('base64')}`;
        let prediction = await replicate.predictions.create({
            version: "42fed1c4974146d4d2414e2be2c5277c7fcf05fcc3a73abf41610695738c1d7b",
            input: { image: base64Image, scale: 4, face_enhance: false }
        });
        console.log(`[NanoAI] Prediction created: ${prediction.id}`);
        const startTime = Date.now();
        while (prediction.status !== 'succeeded' && prediction.status !== 'failed') {
            if (Date.now() - startTime > 90000)
                throw new Error('NanoAI timeout after 90 seconds');
            await new Promise(r => setTimeout(r, 2000));
            prediction = await replicate.predictions.get(prediction.id);
            console.log(`[NanoAI] Status: ${prediction.status}`);
        }
        if (prediction.status === 'failed') {
            throw new Error(`NanoAI prediction failed: ${prediction.error}`);
        }
        const output = prediction.output;
        let resultUrl;
        if (typeof output === 'string')
            resultUrl = output;
        else if (Array.isArray(output) && output.length > 0)
            resultUrl = String(output[0]);
        else
            throw new Error(`Unexpected NanoAI output: ${JSON.stringify(output)}`);
        const resultResponse = await fetch(resultUrl);
        if (!resultResponse.ok)
            throw new Error(`NanoAI result download failed: ${resultResponse.status}`);
        const resultBuffer = Buffer.from(new Uint8Array(await resultResponse.arrayBuffer()));
        let finalBuffer = Buffer.from(await (0, sharp_1.default)(resultBuffer)
            .sharpen({ sigma: 1.5, m1: 2.0, m2: 0.8 })
            .jpeg({ quality: 88 })
            .toBuffer());
        if (finalBuffer.length > 2 * 1024 * 1024) {
            finalBuffer = Buffer.from(await (0, sharp_1.default)(finalBuffer).jpeg({ quality: 75 }).toBuffer());
        }
        console.log(`[NanoAI] ✅ Done: ${(finalBuffer.length / 1024).toFixed(1)} KB`);
        return finalBuffer;
    }
    catch (error) {
        console.error(`[NanoAI] ❌ Error: ${error?.message || error}`);
        throw error;
    }
}
async function processWatermarkEraser(imageUrl) {
    try {
        console.log('[Eraser] Starting via Replicate LaMa inpainting...');
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok)
            throw new Error(`Download failed: ${imageResponse.status}`);
        const rawBuffer = Buffer.from(new Uint8Array(await imageResponse.arrayBuffer()));
        // Resize to max 1024px to prevent OOM on Render 512MB RAM
        const metadata = await (0, sharp_1.default)(rawBuffer).metadata();
        const width = metadata.width ?? 0;
        const height = metadata.height ?? 0;
        console.log(`[Eraser] Input: ${width}x${height}`);
        const MAX_DIM = 1024;
        let workingBuffer;
        let finalWidth;
        let finalHeight;
        if (width > MAX_DIM || height > MAX_DIM) {
            workingBuffer = Buffer.from(await (0, sharp_1.default)(rawBuffer)
                .resize(MAX_DIM, MAX_DIM, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 95 })
                .toBuffer());
            const newMeta = await (0, sharp_1.default)(workingBuffer).metadata();
            finalWidth = newMeta.width ?? MAX_DIM;
            finalHeight = newMeta.height ?? MAX_DIM;
        }
        else {
            workingBuffer = Buffer.from(await (0, sharp_1.default)(rawBuffer).jpeg({ quality: 95 }).toBuffer());
            finalWidth = width;
            finalHeight = height;
        }
        // Auto-detect watermark region: bottom-right corner 10% x 8%
        const wmWidth = Math.ceil(finalWidth * 0.10);
        const wmHeight = Math.ceil(finalHeight * 0.08);
        const wmLeft = finalWidth - wmWidth;
        const wmTop = finalHeight - wmHeight;
        console.log(`[Eraser] Mask region: left=${wmLeft} top=${wmTop} w=${wmWidth} h=${wmHeight}`);
        // Generate white mask on black background using SVG
        const svgMask = `<svg xmlns="http://www.w3.org/2000/svg" width="${finalWidth}" height="${finalHeight}">
      <rect width="${finalWidth}" height="${finalHeight}" fill="black"/>
      <rect x="${wmLeft}" y="${wmTop}" width="${wmWidth}" height="${wmHeight}" fill="white" rx="4"/>
    </svg>`;
        const maskBuffer = Buffer.from(await (0, sharp_1.default)(Buffer.from(svgMask))
            .resize(finalWidth, finalHeight)
            .png()
            .toBuffer());
        // Convert to base64 data URIs
        const imageBase64 = `data:image/jpeg;base64,${workingBuffer.toString('base64')}`;
        const maskBase64 = `data:image/png;base64,${maskBuffer.toString('base64')}`;
        // Send to Replicate LaMa — best free inpainting model
        console.log('[Eraser] Sending to Replicate LaMa...');
        let prediction = await replicate.predictions.create({
            version: "cjwbw/lama:1a7737078263158fbce9d0a68d87a416a20d75586ae797dd08ac774597b416bb",
            input: {
                image: imageBase64,
                mask: maskBase64
            }
        });
        console.log(`[Eraser] Prediction: ${prediction.id}`);
        const startTime = Date.now();
        while (prediction.status !== 'succeeded' && prediction.status !== 'failed') {
            if (Date.now() - startTime > 90000)
                throw new Error('Eraser timeout after 90 seconds');
            await new Promise(r => setTimeout(r, 2000));
            prediction = await replicate.predictions.get(prediction.id);
            console.log(`[Eraser] Status: ${prediction.status}`);
        }
        if (prediction.status === 'failed') {
            throw new Error(`Eraser prediction failed: ${prediction.error}`);
        }
        const output = prediction.output;
        let resultUrl;
        if (typeof output === 'string')
            resultUrl = output;
        else if (Array.isArray(output) && output.length > 0)
            resultUrl = String(output[0]);
        else
            throw new Error(`Unexpected eraser output: ${JSON.stringify(output)}`);
        const resultResponse = await fetch(resultUrl);
        if (!resultResponse.ok)
            throw new Error(`Eraser result download failed: ${resultResponse.status}`);
        const resultBuffer = Buffer.from(new Uint8Array(await resultResponse.arrayBuffer()));
        // Light sharpening to restore detail after inpainting
        const finalBuffer = Buffer.from(await (0, sharp_1.default)(resultBuffer)
            .sharpen({ sigma: 0.8 })
            .jpeg({ quality: 92 })
            .toBuffer());
        console.log(`[Eraser] ✅ Done: ${(finalBuffer.length / 1024).toFixed(1)} KB`);
        return finalBuffer;
    }
    catch (error) {
        console.error(`[Eraser] ❌ Error: ${error?.message || error}`);
        throw error;
    }
}
async function convertImageFormat(buffer, format) {
    let result;
    let mimeType;
    switch (format) {
        case 'jpg':
            result = await (0, sharp_1.default)(buffer).jpeg({ quality: 95 }).toBuffer();
            mimeType = 'image/jpeg';
            break;
        case 'png':
            result = await (0, sharp_1.default)(buffer).png({ compressionLevel: 6 }).toBuffer();
            mimeType = 'image/png';
            break;
        case 'webp':
            result = await (0, sharp_1.default)(buffer).webp({ quality: 95 }).toBuffer();
            mimeType = 'image/webp';
            break;
        case 'gif':
            result = await (0, sharp_1.default)(buffer).gif().toBuffer();
            mimeType = 'image/gif';
            break;
        case 'tiff':
            result = await (0, sharp_1.default)(buffer).tiff({ quality: 95 }).toBuffer();
            mimeType = 'image/tiff';
            break;
        default:
            result = buffer;
            mimeType = 'image/png';
    }
    return { buffer: result, mimeType, ext: format === 'jpg' ? 'jpg' : format };
}
//# sourceMappingURL=imageService.js.map