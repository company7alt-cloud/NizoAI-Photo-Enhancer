import Replicate from "replicate";
import sharp from "sharp";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_KEY || '',
});

async function enhance2K(inputBuffer: Buffer): Promise<Buffer> {
  const processed = await sharp(inputBuffer)
    .resize({
      width: 2048,
      height: 2048,
      fit: 'inside',         // keep aspect ratio, never crop
      withoutEnlargement: false, // allow upscaling for small images
    })
    .jpeg({
      quality: 92,           // high quality, no visible degradation
      chromaSubsampling: '4:4:4', // preserve color accuracy
      force: true,
    })
    .toBuffer();

  // Cap output at 2MB — if larger, reduce quality slightly
  const MAX_SIZE = 2 * 1024 * 1024; // 2MB
  if (processed.length > MAX_SIZE) {
    return await sharp(inputBuffer)
      .resize({ width: 2048, height: 2048, fit: 'inside' })
      .jpeg({ quality: 82, chromaSubsampling: '4:4:4', force: true })
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
    const rawBuffer = Buffer.from(await imageResponse.arrayBuffer());
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
    const resultBuffer = Buffer.from(await resultResponse.arrayBuffer());
    console.log(`[ImageService] Result: ${(resultBuffer.length / 1024).toFixed(1)} KB`);

    // STEP 6: Post-process
    let finalBuffer: Buffer;
    if (resolution === '4K') {
      finalBuffer = await sharp(resultBuffer)
        .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
        .toBuffer();
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
  return Buffer.from(await resultResponse.arrayBuffer());
}

export async function process4KAi(imageUrl: string): Promise<Buffer> {
  const imageResponse = await fetch(imageUrl);
  const rawImage = await imageResponse.arrayBuffer();
  const imageBuffer = Buffer.from(new Uint8Array(rawImage)) as Buffer;

  const metadata = await sharp(imageBuffer).metadata();
  const totalPixels = (metadata.width || 1920) * (metadata.height || 1080);
  const MAX_PIXELS = 1_000_000;

  let processBuffer = imageBuffer;
  if (totalPixels > MAX_PIXELS) {
    const scale = Math.sqrt(MAX_PIXELS / totalPixels);
    const newWidth = Math.floor((metadata.width || 1920) * scale);
    const newHeight = Math.floor((metadata.height || 1080) * scale);
    processBuffer = await sharp(imageBuffer)
      .resize(newWidth, newHeight, { kernel: sharp.kernel.lanczos3 })
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  const base64Image = `data:image/jpeg;base64,${processBuffer.toString('base64')}`;

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
  const rawData = await response.arrayBuffer();
  return Buffer.from(new Uint8Array(rawData)) as Buffer;
}
