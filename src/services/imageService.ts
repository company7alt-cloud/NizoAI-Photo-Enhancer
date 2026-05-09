import Replicate from "replicate";
import sharp from "sharp";
import pixelmatch from "pixelmatch";
import { Context } from "grammy";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_KEY || '',
});

async function enhance2K(inputBuffer: Buffer): Promise<Buffer> {
  const metadata = await sharp(inputBuffer).metadata();
  const width = metadata.width || 1000;
  const height = metadata.height || 1000;
  const pixels = width * height;

  // Only upscale if image is smaller than 2K
  const TARGET_PIXELS = 2048 * 2048;
  const needsUpscale = pixels < TARGET_PIXELS;

  const scale = needsUpscale ? Math.sqrt(TARGET_PIXELS / pixels) : 1;
  const newWidth = Math.round(width * Math.min(scale, 4));
  const newHeight = Math.round(height * Math.min(scale, 4));

  const processed = await sharp(inputBuffer)
    .resize({
      width: newWidth,
      height: newHeight,
      fit: 'fill',
      kernel: sharp.kernel.lanczos3,
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
    return await sharp(inputBuffer)
      .resize({ width: newWidth, height: newHeight, fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .jpeg({ quality: 88, chromaSubsampling: '4:4:4', force: true, mozjpeg: true })
      .toBuffer();
  }
  return processed;
}

const MAX_INPUT_DIMENSION = 1400;
export async function enhance(
  telegramFileUrl: string,
  resolution: '2K' | '4K' | '8K'
): Promise<Buffer> {
  try {
    // STEP 1: Download from Telegram
    const imageResponse = await fetch(telegramFileUrl);
    if (!imageResponse.ok) throw new Error(`Download failed: ${imageResponse.status}`);
    const rawArray = await imageResponse.arrayBuffer();
    const rawBuffer = Buffer.from(new Uint8Array(rawArray)) as Buffer;
    console.log(`[ImageService] Downloaded: ${(rawBuffer.length / 1024).toFixed(1)} KB`);

    if (resolution === '2K') {
      console.log(`[ImageService] Enhancing 2K locally using sharp`);
      const finalBuffer = await enhance2K(rawBuffer);
      console.log(`[ImageService] ✅ Final 2K size: ${(finalBuffer.length / 1024).toFixed(1)} KB`);
      return finalBuffer;
    }

    // STEP 2: Resize if needed
    const metadata = await sharp(rawBuffer).metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;
    console.log(`[ImageService] Input dimensions: ${width}x${height}`);

    let processedBuffer: Buffer;
    if (width > MAX_INPUT_DIMENSION || height > MAX_INPUT_DIMENSION) {
      processedBuffer = await sharp(rawBuffer)
        .resize(MAX_INPUT_DIMENSION, MAX_INPUT_DIMENSION, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ quality: 92 })
        .toBuffer();
      console.log(`[ImageService] Resized to: ${(processedBuffer.length / 1024).toFixed(1)} KB`);
    } else {
      processedBuffer = await sharp(rawBuffer).jpeg({ quality: 92 }).toBuffer();
    }

    const base64Image = `data:image/jpeg;base64,${processedBuffer.toString('base64')}`;
    const scale = (resolution as string) === '2K' ? 2 : 4;
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

    let resultUrl: string;
    if (typeof output === 'string') {
      resultUrl = output;
    } else if (Array.isArray(output) && output.length > 0) {
      resultUrl = output[0] as string;
    } else {
      throw new Error(`Unexpected output format: ${JSON.stringify(output)}`);
    }

    if (!resultUrl) throw new Error('Empty result URL from Replicate');

    // STEP 5: Download result
    console.log(`[ImageService] Downloading result from: ${resultUrl}`);
    const resultResponse = await fetch(resultUrl);
    if (!resultResponse.ok) throw new Error(`Result download failed: ${resultResponse.status}`);
    const resultRawArray = await resultResponse.arrayBuffer();
    const resultBuffer = Buffer.from(new Uint8Array(resultRawArray)) as Buffer;
    console.log(`[ImageService] Result: ${(resultBuffer.length / 1024).toFixed(1)} KB`);

    // STEP 6: Post-process
    let finalBuffer: Buffer;
    if (resolution === '4K') {
      const processed = await sharp(resultBuffer)
        .resize({ width: 3840, height: 3840, fit: 'inside', withoutEnlargement: false })
        .sharpen({ sigma: 1.5, m1: 0.8, m2: 0.8 })
        .jpeg({ quality: 95, chromaSubsampling: '4:4:4', force: true })
        .toBuffer();

      const MAX_SIZE = 4 * 1024 * 1024;
      if (processed.length > MAX_SIZE) {
        finalBuffer = await sharp(resultBuffer)
          .resize({ width: 3840, height: 3840, fit: 'inside' })
          .sharpen({ sigma: 1.2 })
          .jpeg({ quality: 88, chromaSubsampling: '4:4:4', force: true })
          .toBuffer();
      } else {
        finalBuffer = processed;
      }
    } else {
      finalBuffer = await sharp(resultBuffer)
        .jpeg({ quality: 80, chromaSubsampling: '4:2:0' })
        .toBuffer();
    }

    console.log(`[ImageService] ✅ Final size: ${(finalBuffer.length / 1024).toFixed(1)} KB`);
    return finalBuffer;

  } catch (error: any) {
    console.error(`[ImageService] ❌ Error: ${error?.message || error}`);
    throw error;
  }
}

export async function enhanceWithNanoBanana(base64Image: string, aiPrompt: string): Promise<Buffer> {
  console.log('[ImageService] Sending to SDXL with prompt:', aiPrompt);
  const output = await replicate.run(
    "stability-ai/sdxl",
    {
      input: {
        image: `data:image/jpeg;base64,${base64Image}`,
        prompt: aiPrompt,
        prompt_strength: 0.7,
        num_inference_steps: 40,
        refine: "expert_ensemble_refiner"
      }
    }
  );

  let resultUrl: string = "";
  if (Array.isArray(output) && output.length > 0) resultUrl = output[0] as string;
  else if (typeof output === 'string') resultUrl = output;
  else throw new Error('SDXL returned invalid format');

  const resultResponse = await fetch(resultUrl);
  const resultRawData = await resultResponse.arrayBuffer();
  return Buffer.from(new Uint8Array(resultRawData)) as Buffer;
}

export async function process4KAi(imageUrl: string): Promise<Buffer> {
  const imageResponse = await fetch(imageUrl);
  const rawImage = await imageResponse.arrayBuffer();
  const imageBuffer = Buffer.from(new Uint8Array(rawImage)) as Buffer;

  const metadata = await sharp(imageBuffer).metadata();
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
    processedInput = await sharp(imageBuffer)
      .resize({ width: newWidth, height: newHeight, fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .jpeg({ quality: 98, chromaSubsampling: '4:4:4', force: true })
      .toBuffer();
  }

  // Convert to base64 for Replicate
  const base64Image = `data:image/jpeg;base64,${processedInput.toString('base64')}`;

  const output = await replicate.run(
    "nightmareai/real-esrgan",
    {
      input: {
        image: base64Image,
        scale: 2,
        face_enhance: false
      }
    }
  );

  const imageOutput = Array.isArray(output) ? output[0] : output;
  if (!imageOutput) throw new Error('No output from Replicate');
  const response = await fetch(imageOutput.toString());
  const arrayBuffer = await response.arrayBuffer();
  const resultBuffer = await sharp(Buffer.from(new Uint8Array(arrayBuffer)))
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

export async function processProEnhance(
  imageUrl: string,
  quality: string,
  scale: number,
  imageType: string
): Promise<Buffer> {
  // Fixes TS6133 (unused variable) by logging the settings
  console.log(`[ProEnhance] Quality: ${quality}, Scale: ${scale}, Type: ${imageType}`);

  // Fixes TS7016 (No node-fetch needed, Node 18+ has native fetch)
  const imgResponse = await fetch(imageUrl);
  const arrayBuffer = await imgResponse.arrayBuffer();
  // Fixes TS2322 (Type casting to ArrayBuffer)
  const inputBuffer = Buffer.from(new Uint8Array(arrayBuffer)) as Buffer;

  const metadata = await sharp(inputBuffer).metadata();
  const w = metadata.width || 800;
  const h = metadata.height || 800;
  const pixels = w * h;
  const MAX_PIXELS = 1_000_000;

  let processedInput = inputBuffer;
  if (pixels > MAX_PIXELS) {
    const s = Math.sqrt(MAX_PIXELS / pixels);
    processedInput = await sharp(inputBuffer)
      .resize({ width: Math.round(w * s), height: Math.round(h * s), fit: 'fill', kernel: sharp.kernel.lanczos3 })
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

  const Replicate = (await import('replicate')).default;
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

  const outputUrl = typeof prediction.output === 'string' ? prediction.output : (prediction.output as string[])[0];

  const resultResponse = await fetch(outputUrl);
  const resultArray = await resultResponse.arrayBuffer();

  return await sharp(Buffer.from(new Uint8Array(resultArray)) as Buffer)
    .sharpen({ sigma: 0.8 })
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4', force: true, mozjpeg: true })
    .toBuffer();
}

export async function processNanoBanana(imageUrl: string): Promise<Buffer> {
  try {
    console.log('[NanoAI] Starting via Replicate Real-ESRGAN...');

    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) throw new Error(`Download failed: ${imageResponse.status}`);
    const rawBuffer = Buffer.from(new Uint8Array(await imageResponse.arrayBuffer()));

    const metadata = await sharp(rawBuffer).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    let processedBuffer: Buffer;
    if (width > 1400 || height > 1400) {
      processedBuffer = Buffer.from(await sharp(rawBuffer)
        .resize(1400, 1400, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 92 })
        .toBuffer());
    } else {
      processedBuffer = Buffer.from(await sharp(rawBuffer).jpeg({ quality: 92 }).toBuffer());
    }

    const base64Image = `data:image/jpeg;base64,${processedBuffer.toString('base64')}`;

    let prediction = await replicate.predictions.create({
      version: "42fed1c4974146d4d2414e2be2c5277c7fcf05fcc3a73abf41610695738c1d7b",
      input: { image: base64Image, scale: 4, face_enhance: false }
    });

    console.log(`[NanoAI] Prediction created: ${prediction.id}`);

    const startTime = Date.now();
    while (prediction.status !== 'succeeded' && prediction.status !== 'failed') {
      if (Date.now() - startTime > 90000) throw new Error('NanoAI timeout after 90 seconds');
      await new Promise(r => setTimeout(r, 2000));
      prediction = await replicate.predictions.get(prediction.id);
      console.log(`[NanoAI] Status: ${prediction.status}`);
    }

    if (prediction.status === 'failed') {
      throw new Error(`NanoAI prediction failed: ${prediction.error}`);
    }

    const output = prediction.output;
    let resultUrl: string;
    if (typeof output === 'string') resultUrl = output;
    else if (Array.isArray(output) && output.length > 0) resultUrl = String(output[0]);
    else throw new Error(`Unexpected NanoAI output: ${JSON.stringify(output)}`);

    const resultResponse = await fetch(resultUrl);
    if (!resultResponse.ok) throw new Error(`NanoAI result download failed: ${resultResponse.status}`);
    const resultBuffer = Buffer.from(new Uint8Array(await resultResponse.arrayBuffer()));

    let finalBuffer = Buffer.from(await sharp(resultBuffer)
      .sharpen({ sigma: 1.5, m1: 2.0, m2: 0.8 })
      .jpeg({ quality: 88 })
      .toBuffer());

    if (finalBuffer.length > 2 * 1024 * 1024) {
      finalBuffer = Buffer.from(await sharp(finalBuffer).jpeg({ quality: 75 }).toBuffer());
    }

    console.log(`[NanoAI] ✅ Done: ${(finalBuffer.length / 1024).toFixed(1)} KB`);
    return finalBuffer;

  } catch (error: any) {
    console.error(`[NanoAI] ❌ Error: ${error?.message || error}`);
    throw error;
  }
}

// FUNCTION 1: Extract red-marked region coordinates from reference image
export async function extractMaskCoordinates(
  imageUrl: string
): Promise<{ minX: number; minY: number; width: number; height: number } | null> {
  const imageResponse = await fetch(imageUrl);
  const rawBuffer = Buffer.from(new Uint8Array(await imageResponse.arrayBuffer()));

  const metadata = await sharp(rawBuffer).metadata();
  const imgWidth  = metadata.width!;
  const imgHeight = metadata.height!;

  const { data, info } = await sharp(rawBuffer)
    .raw()
    .toBuffer({ resolveWithObject: true });

  let minX = imgWidth, minY = imgHeight, maxX = 0, maxY = 0;
  let hasMarker = false;

  for (let i = 0; i < imgWidth * imgHeight; i++) {
    const r = data[i * info.channels];
    const g = data[i * info.channels + 1];
    const b = data[i * info.channels + 2];

    // Detect red marker: high red, low green+blue
    if (r > 140 && g < 110 && b < 110) {
      hasMarker = true;
      const x = i % imgWidth;
      const y = Math.floor(i / imgWidth);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (!hasMarker) return null;

  // Add 15px padding for seamless blending
  minX = Math.max(0, minX - 15);
  minY = Math.max(0, minY - 15);
  maxX = Math.min(imgWidth  - 1, maxX + 15);
  maxY = Math.min(imgHeight - 1, maxY + 15);

  return {
    minX,
    minY,
    width:  maxX - minX,
    height: maxY - minY,
  };
}

// FUNCTION 2: Generate mask and send to Replicate inpainting
export async function processTwoStepInpainting(
  cleanImageUrl: string,
  coords: { minX: number; minY: number; width: number; height: number }
): Promise<Buffer> {
  const imageResponse = await fetch(cleanImageUrl);
  const rawBuffer = Buffer.from(new Uint8Array(await imageResponse.arrayBuffer()));

  const metadata = await sharp(rawBuffer).metadata();
  const imgW = metadata.width!;
  const imgH = metadata.height!;

  // Generate black mask with white rectangle over the target area
  const baseMask = await sharp({
    create: { width: imgW, height: imgH, channels: 3, background: { r: 0, g: 0, b: 0 } }
  }).png().toBuffer();

  const whiteBox = await sharp({
    create: { width: coords.width, height: coords.height, channels: 3, background: { r: 255, g: 255, b: 255 } }
  }).png().toBuffer();

  const finalMaskBuffer = await sharp(baseMask)
    .composite([{ input: whiteBox, left: coords.minX, top: coords.minY }])
    .blur(4)
    .png()
    .toBuffer();

  const imageBase64 = `data:image/jpeg;base64,${(await sharp(rawBuffer).jpeg({ quality: 95 }).toBuffer()).toString('base64')}`;
  const maskBase64  = `data:image/png;base64,${finalMaskBuffer.toString('base64')}`;

  const output = await replicate.run(
    "stability-ai/stable-diffusion-inpainting:95b7223104132402a9ae91cc677285bc5eb997834bd2349fa486f53910fd68b3",
    {
      input: {
        image:  imageBase64,
        mask:   maskBase64,
        prompt: "remove the element in the masked area completely, fill seamlessly with the surrounding background texture and lighting, preserve all original product features, branding, shape, and design details exactly as they are",
        negative_prompt: "watermark, text, logo, blur, distortion, artifacts, changing original design, redesigning product",
        disable_safety_checker: true,
        num_inference_steps: 30,
        guidance_scale: 7.5
      }
    }
  );

  const resultUrl = Array.isArray(output) ? output[0] : output;
  if (!resultUrl) throw new Error('Inpainting API returned no image.');

  const res = await fetch(resultUrl.toString());
  return Buffer.from(new Uint8Array(await res.arrayBuffer())) as Buffer;
}

// ── AUTO WATERMARK REMOVAL (bottom-right corner, SDXL inpainting + sharp fallback) ──
export async function removeBottomRightWatermarkAI(imageUrl: string): Promise<Buffer> {
  // STEP 1 — Download original image
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) throw new Error(`Download failed: ${imageResponse.status}`);
  const inputBuffer = Buffer.from(new Uint8Array(await imageResponse.arrayBuffer()));

  // STEP 2 — Read metadata
  const meta = await sharp(inputBuffer).metadata();
  const W   = meta.width!;
  const H   = meta.height!;
  const fmt = (meta.format ?? 'jpeg') as keyof sharp.FormatEnum;
  console.log(`[AutoEraser] Dimensions: ${W}x${H}`);

  // STEP 3 — Define watermark zone (bottom-right corner)
  const zoneX = Math.round(W * 0.70);
  const zoneY = Math.round(H * 0.83);
  const zoneW = W - zoneX;
  const zoneH = H - zoneY;
  console.log(`[AutoEraser] Zone: x=${zoneX} y=${zoneY} w=${zoneW} h=${zoneH}`);

  // STEP 4 — Build black mask with white rectangle over the watermark zone (sharp only)
  const maskBuffer = await sharp({
    create: { width: W, height: H, channels: 3, background: { r: 0, g: 0, b: 0 } }
  })
    .composite([{
      input: await sharp({
        create: { width: zoneW, height: zoneH, channels: 3, background: { r: 255, g: 255, b: 255 } }
      }).png().toBuffer(),
      left: zoneX,
      top:  zoneY
    }])
    .png()
    .toBuffer();

  // STEP 5 — Base64 data URIs
  const imageB64 = `data:image/jpeg;base64,${(await sharp(inputBuffer).jpeg({ quality: 95 }).toBuffer()).toString('base64')}`;
  const maskB64  = `data:image/png;base64,${maskBuffer.toString('base64')}`;

  // STEP 6 — Replicate SDXL inpainting with 120 s timeout
  console.log(`[AutoEraser] Calling Replicate...`);
  let resultBuffer: Buffer;

  try {
    const replicateOutput = await Promise.race<unknown>([
      replicate.run(
        "lucataco/sdxl-inpainting:a5b13068cc81a89a4fbeefeccc774869fcb34df4dbc92c1555e0f2771d49dde7",
        {
          input: {
            image:                imageB64,
            mask:                 maskB64,
            prompt:               "seamless background continuation, matching texture and lighting, photorealistic, no watermark, no logo, no text, 8k quality",
            negative_prompt:      "watermark, logo, text, star, mark, signature, blur, distortion, artifact, smear, low quality",
            num_inference_steps:  40,
            guidance_scale:       8,
            strength:             0.99,
          }
        }
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Replicate timeout after 120 s')), 120_000)
      )
    ]);

    // STEP 7 — Fetch and decode the output URL
    const outputUrl = Array.isArray(replicateOutput)
      ? String(replicateOutput[0])
      : String(replicateOutput);

    const replicateResponse = await fetch(outputUrl);
    const resultArrayBuffer = await replicateResponse.arrayBuffer();
    resultBuffer = Buffer.from(resultArrayBuffer);

    // STEP 8 — Resize to exact original dimensions and format
    resultBuffer = fmt === 'png'
      ? await sharp(resultBuffer)
          .resize(W, H, { fit: 'fill', kernel: sharp.kernel.lanczos3, withoutEnlargement: false })
          .png({ compressionLevel: 0 })
          .toBuffer()
      : fmt === 'webp'
      ? await sharp(resultBuffer)
          .resize(W, H, { fit: 'fill', kernel: sharp.kernel.lanczos3, withoutEnlargement: false })
          .webp({ quality: 100, lossless: true })
          .toBuffer()
      : await sharp(resultBuffer)
          .resize(W, H, { fit: 'fill', kernel: sharp.kernel.lanczos3, withoutEnlargement: false })
          .jpeg({ quality: 100 })
          .toBuffer();

    console.log(`[AutoEraser] Done. Output size: ${resultBuffer.length} bytes`);

  } catch (err: any) {
    // ── FALLBACK: sharp patch clone from the region directly LEFT of the zone ──
    console.log(`[AutoEraser] Replicate failed, using fallback: ${err?.message}`);

    const patchBuffer = await sharp(inputBuffer)
      .extract({ left: zoneX - zoneW, top: zoneY, width: zoneW, height: zoneH })
      .resize(zoneW, zoneH, { fit: 'fill' })
      .sharpen({ sigma: 1.2 })
      .toBuffer();

    resultBuffer = fmt === 'png'
      ? await sharp(inputBuffer)
          .composite([{ input: patchBuffer, left: zoneX, top: zoneY }])
          .resize(W, H, { fit: 'fill', kernel: sharp.kernel.lanczos3, withoutEnlargement: false })
          .png({ compressionLevel: 0 })
          .toBuffer()
      : fmt === 'webp'
      ? await sharp(inputBuffer)
          .composite([{ input: patchBuffer, left: zoneX, top: zoneY }])
          .resize(W, H, { fit: 'fill', kernel: sharp.kernel.lanczos3, withoutEnlargement: false })
          .webp({ quality: 100, lossless: true })
          .toBuffer()
      : await sharp(inputBuffer)
          .composite([{ input: patchBuffer, left: zoneX, top: zoneY }])
          .resize(W, H, { fit: 'fill', kernel: sharp.kernel.lanczos3, withoutEnlargement: false })
          .jpeg({ quality: 100 })
          .toBuffer();

    console.log(`[AutoEraser] Fallback done. Output size: ${resultBuffer.length} bytes`);
  }

  return resultBuffer;
}

export async function convertImageFormat(
  buffer: Buffer,
  format: 'jpg' | 'png' | 'webp' | 'gif' | 'tiff'
): Promise<{ buffer: Buffer; mimeType: string; ext: string }> {
  let result: Buffer;
  let mimeType: string;

  switch (format) {
    case 'jpg':
      result = await sharp(buffer).jpeg({ quality: 95 }).toBuffer() as Buffer;
      mimeType = 'image/jpeg';
      break;
    case 'png':
      result = await sharp(buffer).png({ compressionLevel: 6 }).toBuffer() as Buffer;
      mimeType = 'image/png';
      break;
    case 'webp':
      result = await sharp(buffer).webp({ quality: 95 }).toBuffer() as Buffer;
      mimeType = 'image/webp';
      break;
    case 'gif':
      result = await sharp(buffer).gif().toBuffer() as Buffer;
      mimeType = 'image/gif';
      break;
    case 'tiff':
      result = await sharp(buffer).tiff({ quality: 95 }).toBuffer() as Buffer;
      mimeType = 'image/tiff';
      break;
    default:
      result = buffer;
      mimeType = 'image/png';
  }

  return { buffer: result, mimeType, ext: format === 'jpg' ? 'jpg' : format };
}

export async function getFileBuffer(fileId: string, ctx: Context): Promise<Buffer> {
  const file = await ctx.api.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function generateMaskFromDiff(
  markedBuf: Buffer,
  rawBuf: Buffer
): Promise<{ maskBuffer: Buffer; width: number; height: number }> {
  // Prevent OOM: Resize both buffers to a max of 1024x1024 
  const resizeOpts = { width: 1024, height: 1024, fit: 'inside' as const, withoutEnlargement: true };
  
  const markedImg = sharp(markedBuf).resize(resizeOpts);
  const rawImg = sharp(rawBuf).resize(resizeOpts);

  const { width, height } = (await rawImg.metadata()) as { width: number; height: number };

  const [markedRaw, rawRaw] = await Promise.all([
    markedImg.ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    rawImg.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  ]);

  const diffImage = new Uint8ClampedArray(width * height * 4);

  pixelmatch(
    markedRaw.data,
    rawRaw.data,
    diffImage,
    width,
    height,
    { threshold: 0.15, includeAA: true }
  );

  // Generate binary mask: white for diff, black for match
  const maskPixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < diffImage.length; i += 4) {
    const isDiff = diffImage[i] > 0 || diffImage[i + 1] > 0 || diffImage[i + 2] > 0;
    const color = isDiff ? 255 : 0;
    maskPixels[i] = color;     // R
    maskPixels[i + 1] = color; // G
    maskPixels[i + 2] = color; // B
    maskPixels[i + 3] = 255;   // A
  }

  // Morphological dilation to expand edges
  const maskBuffer = await sharp(maskPixels, { raw: { width, height, channels: 4 } })
    .blur(5)
    .threshold(40)
    .png()
    .toBuffer();

  return { maskBuffer, width, height };
}

export async function removeCustomAreaAI(
  rawBuffer: Buffer,
  maskBuffer: Buffer
): Promise<Buffer> {
  const metadata = await sharp(rawBuffer).metadata();
  const rawWidth = metadata.width || 1024;
  const rawHeight = metadata.height || 1024;

  const resizedRaw = await sharp(rawBuffer)
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .jpeg()
    .toBuffer();

  const { width: resizedWidth, height: resizedHeight } = await sharp(resizedRaw).metadata();

  const resizedMask = await sharp(maskBuffer)
    .resize(resizedWidth, resizedHeight, { fit: 'fill' })
    .blur(8)
    .threshold(10)
    .png()
    .toBuffer();

  const imageBase64 = `data:image/jpeg;base64,${resizedRaw.toString('base64')}`;
  const maskBase64 = `data:image/png;base64,${resizedMask.toString('base64')}`;

  const modelId = process.env.REPLICATE_INPAINT_MODEL_ID || "lucataco/sdxl-inpainting:a5b13068cc81a89a4fbeefeccc774869fcb34df4dbc92c1555e0f2771d49dde7";

  const replicateOutput = await Promise.race<unknown>([
    replicate.run(
      modelId as `${string}/${string}:${string}`,
      {
        input: {
          image: imageBase64,
          mask: maskBase64,
          prompt: "seamless background, original texture, clean, photo realistic",
          negative_prompt: "text, watermark, logo, blurry, distorted, deformed",
          num_inference_steps: 50,
          guidance_scale: 8
        }
      }
    ),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Replicate timeout after 120 s')), 120_000)
    )
  ]);

  const outputUrl = Array.isArray(replicateOutput)
    ? String(replicateOutput[0])
    : String(replicateOutput);

  if (!outputUrl || outputUrl === "undefined") {
    throw new Error("Failed to generate image from AI.");
  }

  const replicateResponse = await fetch(outputUrl);
  if (!replicateResponse.ok) throw new Error(`Result download failed: ${replicateResponse.status}`);
  const resultArrayBuffer = await replicateResponse.arrayBuffer();
  const resultBuffer = Buffer.from(resultArrayBuffer);

  const finalBuffer = await sharp(resultBuffer)
    .resize(rawWidth, rawHeight, { fit: 'fill' })
    .toBuffer();

  return finalBuffer;
}
