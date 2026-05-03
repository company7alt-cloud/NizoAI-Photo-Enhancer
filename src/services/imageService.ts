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
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');

  // Download original image
  const imageResponse = await fetch(imageUrl);
  const rawBuffer = Buffer.from(new Uint8Array(await imageResponse.arrayBuffer()));

  const metadata = await sharp(rawBuffer).metadata();
  const width  = metadata.width!;
  const height = metadata.height!;

  // Gemini watermark: bottom-right corner, ~5.5% of each dimension
  const wmW    = Math.ceil(width  * 0.055);
  const wmH    = Math.ceil(height * 0.055);
  const wmLeft = width  - wmW;
  const wmTop  = height - wmH;

  // Step 1: Crop just the watermark region + surrounding context
  // We crop a larger area (3x watermark size) for Gemini to understand context
  const contextW    = Math.min(width,  wmW * 3);
  const contextH    = Math.min(height, wmH * 3);
  const contextLeft = Math.max(0, width  - contextW);
  const contextTop  = Math.max(0, height - contextH);

  const contextPatch = await sharp(rawBuffer)
    .extract({ left: contextLeft, top: contextTop, width: contextW, height: contextH })
    .png()
    .toBuffer();

  const contextBase64 = contextPatch.toString('base64');

  // Step 2: Ask Gemini to describe the background under the watermark
  const geminiResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              text: `This image shows a bottom-right corner of a photo. There is a small white 4-pointed star watermark in the very bottom-right corner. 
              
              Describe ONLY the background texture/color/pattern that exists directly behind and around this watermark star, in precise detail. 
              What are the exact RGB color values or color description of the pixels surrounding the star? Is it dark, light, gradient? What texture?
              
              Respond in this exact JSON format only, no other text:
              {"bg_color": "description", "is_dark": true/false, "dominant_color": "hex color like #1a1a1a", "texture": "solid/gradient/detailed"}`
            },
            {
              inline_data: {
                mime_type: 'image/png',
                data: contextBase64
              }
            }
          ]
        }],
        generationConfig: { temperature: 0.1 }
      })
    }
  );

  let bgInfo = { is_dark: true, dominant_color: '#000000', texture: 'solid' };

  if (geminiResponse.ok) {
    try {
      const geminiData = await geminiResponse.json();
      const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const jsonMatch = text.match(/\{.*\}/s);
      if (jsonMatch) {
        bgInfo = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.log('[Eraser] Could not parse Gemini response, using fallback');
    }
  }

  // Step 3: Sample actual pixels from the area just ABOVE the watermark
  const sampleH    = Math.max(4, Math.ceil(wmH * 0.8));
  const sampleTop  = Math.max(0, wmTop - sampleH - 2);
  const sampleLeft = Math.max(0, wmLeft - Math.ceil(wmW * 0.5));
  const sampleW    = Math.min(width - sampleLeft, wmW + Math.ceil(wmW * 0.5));

  const samplePatch = await sharp(rawBuffer)
    .extract({ left: sampleLeft, top: sampleTop, width: sampleW, height: sampleH })
    .toBuffer();

  // Get average color from the sample patch
  const { dominant } = await sharp(samplePatch)
    .resize(1, 1, { fit: 'cover' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const avgR = dominant[0] ?? 0;
  const avgG = dominant[1] ?? 0;
  const avgB = dominant[2] ?? 0;
  void avgR; void avgG; void avgB; // suppress unused variable warnings

  // Step 4: Build fill patch matching the exact background
  const sampleAbove = await sharp(rawBuffer)
    .extract({
      left: wmLeft,
      top: Math.max(0, wmTop - wmH * 2),
      width: wmW,
      height: Math.min(wmH * 2, wmTop)
    })
    .toBuffer();

  const fillPatch = await sharp(sampleAbove)
    .resize(wmW, wmH, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .blur(0.8)
    .modulate({
      brightness: bgInfo.is_dark ? 0.98 : 1.02,
      saturation: 0.95
    })
    .toBuffer();

  // Step 5: Apply fill with feathered edges for seamless blending
  const maskSvg = Buffer.from(`
    <svg width="${wmW}" height="${wmH}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="fade" cx="30%" cy="30%" r="80%">
          <stop offset="0%" stop-color="white" stop-opacity="1"/>
          <stop offset="70%" stop-color="white" stop-opacity="1"/>
          <stop offset="100%" stop-color="white" stop-opacity="0.6"/>
        </radialGradient>
      </defs>
      <rect width="${wmW}" height="${wmH}" fill="url(#fade)"/>
    </svg>
  `);

  const maskedFill = await sharp(fillPatch)
    .composite([{ input: maskSvg, blend: 'dest-in' }])
    .toBuffer();

  // Step 6: Composite onto original image
  const result = await sharp(rawBuffer)
    .composite([{
      input: maskedFill,
      left: wmLeft,
      top: wmTop,
      blend: 'over'
    }])
    .png({ compressionLevel: 6 })
    .toBuffer();

  console.log(`[Eraser] ✅ Watermark removed. BG: ${bgInfo.dominant_color}, Dark: ${bgInfo.is_dark}`);
  return result as Buffer;
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
