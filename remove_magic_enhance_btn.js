const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src/bot/commands/start.ts');
let content = fs.readFileSync(file, 'utf8');

// The string block to remove
const blockToRemove = `          // @ts-ignore
          { text: nanoLocks.btn_magic_enhance ? '🔒 تحسين الصورة (AI) — مقفل' : '🪄 تحسين الصورة (AI)', callback_data: 'magic_enhance_start', style: 'primary' },`;

if (content.includes(blockToRemove)) {
    content = content.replace(blockToRemove, '').replace(/\n\s*\n/g, '\n'); // Clean up extra empty lines if any
    fs.writeFileSync(file, content, 'utf8');
    console.log('Successfully removed magic enhance button from start.ts');
} else {
    console.error('Block not found. Trying regex...');
    // Fallback regex to capture any whitespace/formatting variations
    const regex = /\s*\/\/\s*@ts-ignore\s*\{[^}]*magic_enhance_start[^}]*\},\s*/;
    if (regex.test(content)) {
        content = content.replace(regex, '\n');
        fs.writeFileSync(file, content, 'utf8');
        console.log('Successfully removed via regex');
    } else {
        console.error('Failed to find magic enhance button block');
    }
}
