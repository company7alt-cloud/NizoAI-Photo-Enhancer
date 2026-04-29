import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export async function generateNanoBananaPrompt(base64Image: string): Promise<string> {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const prompt = `Act as an elite 3D architectural and product visualization artist. Analyze this image and write a highly detailed, 150-word English prompt to recreate or enhance the subject into a hyper-realistic, striking commercial ad. Incorporate intricate material studies (e.g., polished terrazzo, matte metals, high-gloss finishes). Specify dramatic studio lighting, an 85mm camera lens, physical based rendering (PBR), and render engines like Octane Render or Unreal Engine 5. Output ONLY the raw English prompt string, no pleasantries.`;

  const result = await model.generateContent([
    prompt,
    { inlineData: { data: base64Image, mimeType: 'image/jpeg' } }
  ]);
  return result.response.text().trim();
}
