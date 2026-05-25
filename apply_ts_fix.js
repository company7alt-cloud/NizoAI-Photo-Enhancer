const fs = require('fs');
const path = require('path');

let imgFile = path.join(__dirname, 'src/bot/handlers/imageHandler.ts');
let imgContent = fs.readFileSync(imgFile, 'utf8');

let searchStr = "const apiKey = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY || '';";

if (imgContent.includes(searchStr)) {
    // Replace the first occurrence of apiKey within the magic enhance block with `void inputBuffer; \n const apiKey...`
    // We know it's right after `NEGATIVE_PROMPT`
    
    // Check if it already has `void inputBuffer`
    if (!imgContent.includes('void inputBuffer;')) {
        imgContent = imgContent.replace(searchStr, "void inputBuffer;\n      " + searchStr);
        fs.writeFileSync(imgFile, imgContent, 'utf8');
        console.log('Successfully added void inputBuffer; to suppress TS6133');
    } else {
        console.log('void inputBuffer; already exists');
    }
}
