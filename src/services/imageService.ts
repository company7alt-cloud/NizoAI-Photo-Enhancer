import Replicate from "replicate";
import sharp from "sharp";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_KEY || '',
});

async function enhance2K(inputBuffer: Buffer): Promise<Buffer> {
  const metadata = await sharp(inputBuffer).metadata();
  const newWidth  = (metadata.width  || 1920) * 2;
  const newHeight = (metadata.height || 1080) * 2;

  const enhanced = await sharp(inputBuffer)
    .resize(newWidth, newHeight, {
      kernel: sharp.kernel.lanczos3,   // Best upscaling algorithm
      fastShrinkOnLoad: false
    })
    .sharpen({
      sigma: 1.2,      // Sharpness radius
      m1: 1.5,         // Flat area sharpening
      m2: 0.7,         // Edge sharpening
      x1: 2.0,
      y2: 10.0,
      y3: 20.0
    })
    .clahe({
      width: 8,        // Contrast enhancement tile width
      height: 8,       // Contrast enhancement tile height
      maxSlope: 3      // Prevents over-brightening
    })
    .jpeg({
      quality: 82,
      chromaSubsampling: '4:4:4',  // Preserve full color detail
      mozjpeg: true                // Better compression algorithm
    })
    .toBuffer();

  return enhanced;
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
}

export async function process4KAi(imageUrl: string): Promise<Buffer> {
  const HIDDEN_PROMPT = "Enhance product realism while preserving all original features, shape, branding, labels, and design details, maintain natural surface texture and fine material details, improve lighting balance and tone, refine color depth without over-smoothing, visible micro-textures, material grain, small natural imperfections, fine surface details, subtle light reflections and realistic highlights, natural gloss or matte finish according to the product material, tiny edge details, sharp contours, realistic shadows, stray fine fibers or dust particles where appropriate, subsurface light interaction for translucent materials, light glow through edges where natural, organic texture, ultra-realistic photo-quality finish.";

  const output = await replicate.run(
    "stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b",
    {
      input: {
        image: imageUrl,
        prompt: HIDDEN_PROMPT,
        prompt_strength: 0.65,
        num_inference_steps: 30,
        guidance_scale: 7.5,
        output_format: "jpg",
        output_quality: 95
      }
    }
  );

  const imageOutput = Array.isArray(output) ? output[0] : output;
  const response = await fetch(imageOutput.toString());
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
