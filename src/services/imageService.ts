import Replicate from "replicate";
import sharp from "sharp";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_KEY,
});

const MAX_INPUT_DIMENSION = 1400;
const MAX_OUTPUT_SIZE_BYTES = 2 * 1024 * 1024;

export async function enhance(
  telegramFileUrl: string,
  resolution: '2K' | '4K' | '8K'
): Promise<Buffer> {
  try {
    const imageResponse = await fetch(telegramFileUrl);
    if (!imageResponse.ok) throw new Error(`Download failed: ${imageResponse.status}`);
    const rawBuffer = Buffer.from(await imageResponse.arrayBuffer());
    console.log(`[ImageService] Downloaded: ${(rawBuffer.length / 1024).toFixed(1)} KB`);

    const metadata = await sharp(rawBuffer).metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;
    console.log(`[ImageService] Input dimensions: ${width}x${height}`);

    let processedBuffer: Buffer;
    if (width > MAX_INPUT_DIMENSION || height > MAX_INPUT_DIMENSION) {
      console.log(`[ImageService] Resizing to max ${MAX_INPUT_DIMENSION}px...`);
      processedBuffer = await sharp(rawBuffer)
        .resize(MAX_INPUT_DIMENSION, MAX_INPUT_DIMENSION, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ quality: 92 })
        .toBuffer();
    } else {
      processedBuffer = await sharp(rawBuffer).jpeg({ quality: 92 }).toBuffer();
    }

    const base64Image = `data:image/jpeg;base64,${processedBuffer.toString('base64')}`;
    const scale = resolution === '2K' ? 2 : 4;
    console.log(`[ImageService] Sending to Replicate — ${resolution}, Scale: ${scale}x`);

    const output = await replicate.run(
      "nightmareai/real-esrgan:42fed1c4974146d4d2414e2be2c5277c7fcf05fcc3a73abf41610695738c1d7b",
      {
        input: {
          image: base64Image,
          scale: scale,
          face_enhance: false
        }
      }
    );

    let resultUrl: string;
    if (Array.isArray(output)) {
      resultUrl = output[0] as string;
    } else if (typeof output === 'string') {
      resultUrl = output;
    } else {
      console.error('[ImageService] Unexpected output format:', JSON.stringify(output));
      throw new Error('Replicate returned unexpected output format');
    }
    if (!resultUrl) throw new Error('Replicate returned empty URL');
    console.log(`[ImageService] Result URL: ${resultUrl}`);

    const resultResponse = await fetch(resultUrl);
    if (!resultResponse.ok) throw new Error(`Result download failed: ${resultResponse.status}`);
    const resultBuffer = Buffer.from(await resultResponse.arrayBuffer());
    console.log(`[ImageService] Result: ${(resultBuffer.length / 1024).toFixed(1)} KB`);

    let finalBuffer: Buffer;
    if (resolution === '4K') {
      let sharpened = await sharp(resultBuffer)
        .sharpen({ sigma: 1.2, m1: 1.5, m2: 0.7 })
        .jpeg({ quality: 85 })
        .toBuffer();
      if (sharpened.length > MAX_OUTPUT_SIZE_BYTES) {
        sharpened = await sharp(sharpened).jpeg({ quality: 72 }).toBuffer();
      }
      finalBuffer = sharpened;
    } else {
      finalBuffer = await sharp(resultBuffer).jpeg({ quality: 90 }).toBuffer();
    }

    console.log(`[ImageService] ✅ Final: ${(finalBuffer.length / 1024).toFixed(1)} KB`);
    return finalBuffer;

  } catch (error: any) {
    console.error(`[ImageService] ❌ Error: ${error?.message || error}`);
    throw error;
  }
}
