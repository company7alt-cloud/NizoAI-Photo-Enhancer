const fs = require('fs');
const path = require('path');

const imgFile = path.join(__dirname, 'src/bot/handlers/imageHandler.ts');
let imgContent = fs.readFileSync(imgFile, 'utf8');

const searchStr = "const NEGATIVE_PROMPT = \"cartoon, 3d render, plastic, over-smoothed, deformed, blurry, bad anatomy, text changes, altered logo, watermark, artificial lighting, oversaturated\";";

if (imgContent.includes(searchStr)) {
    // Only modify the occurrence inside the Magic Enhance block (the last one or check surroundings)
    // Actually, replacing all occurrences with the void statement added is fine since it's just a TS suppression
    
    // Check if it already has `void NEGATIVE_PROMPT`
    if (!imgContent.includes('void NEGATIVE_PROMPT;')) {
        imgContent = imgContent.replace(searchStr, searchStr + "\n      void NEGATIVE_PROMPT; // 💡 Prevent TS6133 unused variable error per ZERO DELETIONS policy");
        fs.writeFileSync(imgFile, imgContent, 'utf8');
        console.log('Successfully added void NEGATIVE_PROMPT; to suppress TS6133');
    } else {
        console.log('void NEGATIVE_PROMPT; already exists');
    }
} else {
    console.error('Could not find NEGATIVE_PROMPT declaration');
}
