import Replicate from "replicate";
import sharp from "sharp";

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

export async function processWatermarkEraser(imageUrl: string): Promise<Buffer> {
  try {
    console.log('[Eraser] Starting via Replicate LaMa inpainting...');

    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) throw new Error(`Download failed: ${imageResponse.status}`);
    const rawBuffer = Buffer.from(new Uint8Array(await imageResponse.arrayBuffer()));

    // Resize to max 1024px to prevent OOM on Render 512MB RAM
    const metadata = await sharp(rawBuffer).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    console.log(`[Eraser] Input: ${width}x${height}`);

    const MAX_DIM = 1024;
    let workingBuffer: Buffer;
    let finalWidth: number;
    let finalHeight: number;

    if (width > MAX_DIM || height > MAX_DIM) {
      workingBuffer = Buffer.from(await sharp(rawBuffer)
        .resize(MAX_DIM, MAX_DIM, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 95 })
        .toBuffer());
      const newMeta = await sharp(workingBuffer).metadata();
      finalWidth = newMeta.width ?? MAX_DIM;
      finalHeight = newMeta.height ?? MAX_DIM;
    } else {
      workingBuffer = Buffer.from(await sharp(rawBuffer).jpeg({ quality: 95 }).toBuffer());
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

    const maskBuffer = Buffer.from(await sharp(Buffer.from(svgMask))
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
      if (Date.now() - startTime > 90000) throw new Error('Eraser timeout after 90 seconds');
      await new Promise(r => setTimeout(r, 2000));
      prediction = await replicate.predictions.get(prediction.id);
      console.log(`[Eraser] Status: ${prediction.status}`);
    }

    if (prediction.status === 'failed') {
      throw new Error(`Eraser prediction failed: ${prediction.error}`);
    }

    const output = prediction.output;
    let resultUrl: string;
    if (typeof output === 'string') resultUrl = output;
    else if (Array.isArray(output) && output.length > 0) resultUrl = String(output[0]);
    else throw new Error(`Unexpected eraser output: ${JSON.stringify(output)}`);

    const resultResponse = await fetch(resultUrl);
    if (!resultResponse.ok) throw new Error(`Eraser result download failed: ${resultResponse.status}`);
    const resultBuffer = Buffer.from(new Uint8Array(await resultResponse.arrayBuffer()));

    // Light sharpening to restore detail after inpainting
    const finalBuffer = Buffer.from(await sharp(resultBuffer)
      .sharpen({ sigma: 0.8 })
      .jpeg({ quality: 92 })
      .toBuffer());

    console.log(`[Eraser] ✅ Done: ${(finalBuffer.length / 1024).toFixed(1)} KB`);
    return finalBuffer;

  } catch (error: any) {
    console.error(`[Eraser] ❌ Error: ${error?.message || error}`);
    throw error;
  }
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
