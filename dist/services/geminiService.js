"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateEnhancementPrompt = generateEnhancementPrompt;
// src/services/geminiService.ts
const generative_ai_1 = require("@google/generative-ai");
async function generateEnhancementPrompt(imageBase64, mimeType = 'image/jpeg') {
    const genAI = new generative_ai_1.GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const prompt = `You are a professional product photographer and image enhancement expert.
  Analyze this image carefully and write a detailed English prompt (80-120 words) that describes
  exactly how to enhance this specific image into a hyper-realistic 4K professional shot.
  Focus on: lighting conditions, material textures, color accuracy, surface details,
  shadows, reflections, and background. Preserve ALL original features, shapes, branding,
  and design elements. Output ONLY the prompt text, nothing else.`;
    const imagePart = {
        inlineData: {
            data: imageBase64,
            mimeType: mimeType
        }
    };
    const generateCall = async () => {
        const result = await model.generateContent([prompt, imagePart]);
        const generatedPrompt = result.response.text().trim();
        if (!generatedPrompt || generatedPrompt.length < 20) {
            throw new Error('gemini_empty_response');
        }
        return generatedPrompt;
    };
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('gemini_timeout')), 30000));
    return Promise.race([generateCall(), timeoutPromise]);
}
//# sourceMappingURL=geminiService.js.map