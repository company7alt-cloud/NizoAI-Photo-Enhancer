const fs = require('fs');
const path = require('path');

const imgFile = path.join(__dirname, 'src/bot/handlers/imageHandler.ts');
let imgContent = fs.readFileSync(imgFile, 'utf8');

// We need to strictly match inside the awaitingMagicEnhanceImage block
const magicMarker = "if (user?.awaitingMagicEnhanceImage) {";
const magicStart = imgContent.indexOf(magicMarker);

if (magicStart === -1) {
    console.error("Could not find magic enhance block marker.");
    process.exit(1);
}

const startMarker = "const apiKey = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY || '';";
const endMarker = "if (!outputUrl || outputUrl === 'undefined') throw new Error('empty_output');";

const startIndex = imgContent.indexOf(startMarker, magicStart);
if (startIndex === -1) {
    console.error("Could not find start marker inside magic enhance block.");
    process.exit(1);
}

const endIndex = imgContent.indexOf(endMarker, startIndex);
if (endIndex === -1) {
    console.error("Could not find end marker after start marker.");
    process.exit(1);
}

const siliconBlock = `const siliconApiKey = process.env.SILICONFLOW_API_KEY || '';
      if (!siliconApiKey) throw new Error('SILICONFLOW_API_KEY is missing');

      // Call SiliconFlow API directly (Synchronous) for this specific feature
      const siliconRes = await fetch('https://api.siliconflow.cn/v1/images/generations', {
        method: 'POST',
        headers: {
          'Authorization': \`Bearer \${siliconApiKey}\`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'Qwen/Qwen-Image-Edit',
          prompt: HIDDEN_PROMPT,
          image: base64Image,
          image_size: "1024x1024"
        })
      });

      if (!siliconRes.ok) {
        const errDetails = await siliconRes.text();
        console.error('[MagicEnhance] SiliconFlow API Error:', errDetails);
        throw new Error(\`api_rejected: \${siliconRes.status}\`);
      }

      const prediction = await siliconRes.json() as any;
      const outputUrl = prediction.images?.[0]?.url;

      if (!outputUrl) {
        console.error('[MagicEnhance] Empty Output from SiliconFlow:', JSON.stringify(prediction));
        throw new Error('empty_output');
      }`;

imgContent = imgContent.substring(0, startIndex) + siliconBlock + imgContent.substring(endIndex + endMarker.length);
fs.writeFileSync(imgFile, imgContent, 'utf8');
console.log('Successfully replaced Replicate with SiliconFlow exclusively in Magic Enhance flow.');
