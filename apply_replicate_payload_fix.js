const fs = require('fs');
const path = require('path');

let imgFile = path.join(__dirname, 'src/bot/handlers/imageHandler.ts');
let imgContent = fs.readFileSync(imgFile, 'utf8');

// The block starts near: const base64Image = `data:image/jpeg;base64,${inputBuffer.toString('base64')}`;
// We can find the start by searching for `const base64Image`
let searchStr = "const base64Image = `data:image/jpeg;base64,${inputBuffer.toString('base64')}`;";

if (imgContent.includes(searchStr)) {
    // Find the end of the fetch block, which ends with `})` and `});`
    let startIdx = imgContent.indexOf(searchStr);
    
    // To be very precise, find the end of the fetch call
    let fetchStart = imgContent.indexOf("const replicateRes = await fetch('https://api.replicate.com/v1/predictions', {", startIdx);
    
    if (fetchStart !== -1) {
        let fetchEndStr = "});";
        let fetchEnd = imgContent.indexOf(fetchEndStr, fetchStart);
        
        if (fetchEnd !== -1) {
            let blockToReplace = imgContent.substring(startIdx, fetchEnd + fetchEndStr.length);
            
            let newBlock = `const apiKey = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY || '';

      // Call Replicate via REST API using direct URL to avoid Base64 timeout bottlenecks
      const replicateRes = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: {
          'Authorization': \`Token \${apiKey}\`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          version: '39ed52f2a78e134af7dc69b8ae843b9fc061116cc375ddec4040ddf5e4140bd1',
          input: {
            image:               fileUrl, // 💡 CRITICAL: Use direct Telegram URL
            prompt:              HIDDEN_PROMPT,
            negative_prompt:     NEGATIVE_PROMPT,
            prompt_strength:     0.30,
            guidance_scale:      7.5,
            num_inference_steps: 22, // 💡 CRITICAL: Reduced to 22 for faster generation without losing quality
          }
        })
      });`;
            
            imgContent = imgContent.substring(0, startIdx) + newBlock + imgContent.substring(fetchEnd + fetchEndStr.length);
            fs.writeFileSync(imgFile, imgContent, 'utf8');
            console.log('Successfully replaced payload block in imageHandler.ts');
        } else {
            console.error('Could not find end of fetch block');
        }
    } else {
        console.error('Could not find fetch call');
    }
} else {
    console.error('Could not find base64Image line');
}
