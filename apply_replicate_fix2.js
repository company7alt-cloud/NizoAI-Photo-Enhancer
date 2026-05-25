const fs = require('fs');
const path = require('path');

let imgFile = path.join(__dirname, 'src/bot/handlers/imageHandler.ts');
let imgContent = fs.readFileSync(imgFile, 'utf8');

const startMarker = "void inputBuffer;";
const endMarker = "if (!outputUrl || outputUrl === 'undefined') throw new Error('empty_output');";

let startIndex = imgContent.indexOf(startMarker);
if (startIndex !== -1) {
    let endIndex = imgContent.indexOf(endMarker, startIndex);
    if (endIndex !== -1) {
        let blockToReplace = imgContent.substring(startIndex, endIndex + endMarker.length);
        
        let newBlock = `const base64Image = \`data:image/jpeg;base64,\${inputBuffer.toString('base64')}\`;
      const apiKey = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY || '';

      const replicateRes = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: {
          'Authorization': \`Token \${apiKey}\`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          version: '39ed52f2a78e134af7dc69b8ae843b9fc061116cc375ddec4040ddf5e4140bd1',
          input: {
            image:               base64Image,
            prompt:              HIDDEN_PROMPT,
            negative_prompt:     NEGATIVE_PROMPT,
            prompt_strength:     0.30,
            guidance_scale:      7.5,
            num_inference_steps: 22,
          }
        })
      });

      let prediction = await replicateRes.json() as any;

      // CRITICAL FIX: Catch Replicate rejections instantly — prevents infinite polling loop
      if (!replicateRes.ok || prediction.error || prediction.detail) {
        console.error('[MagicEnhance] Replicate rejected:', JSON.stringify(prediction));
        throw new Error(\`api_rejected: \${prediction.detail || prediction.error || replicateRes.status}\`);
      }
      if (!prediction.id) throw new Error('no_prediction_id');

      const startTime = Date.now();
      while (prediction.status !== 'succeeded' && prediction.status !== 'failed') {
        if (Date.now() - startTime > 600_000) throw new Error('timeout');
        await new Promise(r => setTimeout(r, 2500));
        const pollRes = await fetch(
          \`https://api.replicate.com/v1/predictions/\${prediction.id}\`,
          { headers: { 'Authorization': \`Token \${apiKey}\` } }
        );
        if (!pollRes.ok) {
          console.error('[MagicEnhance] Poll failed:', await pollRes.text());
          throw new Error('polling_failed');
        }
        prediction = await pollRes.json() as any;
      }

      if (prediction.status === 'failed') {
        console.error('[MagicEnhance] Failed logs:', prediction.logs || 'none');
        throw new Error('prediction_failed');
      }

      const outputUrl = Array.isArray(prediction.output)
        ? String(prediction.output[0])
        : String(prediction.output);
      if (!outputUrl || outputUrl === 'undefined') throw new Error('empty_output');`;
        
        imgContent = imgContent.substring(0, startIndex) + newBlock + imgContent.substring(endIndex + endMarker.length);
        fs.writeFileSync(imgFile, imgContent, 'utf8');
        console.log('Successfully replaced Replicate API block');
    } else {
        console.error('Could not find endMarker');
    }
} else {
    console.error('Could not find startMarker');
}
