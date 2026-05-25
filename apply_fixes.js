const fs = require('fs');
const path = require('path');

function replaceInFile(filePath, oldStr, newStr, requiredCount = 1) {
  const fullPath = path.join(__dirname, filePath);
  let content = fs.readFileSync(fullPath, 'utf8');
  const count = content.split(oldStr).length - 1;
  
  if (count !== requiredCount) {
    console.error(`ERROR in ${filePath}: Found ${count} occurrences of string, expected ${requiredCount}`);
    return false;
  }
  
  content = content.split(oldStr).join(newStr);
  fs.writeFileSync(fullPath, content, 'utf8');
  console.log(`SUCCESS in ${filePath}: Replaced ${count} occurrences.`);
  return true;
}

// FIX 1: INCREASE REPLICATE TIMEOUT
replaceInFile(
  'src/bot/handlers/imageHandler.ts',
  "if (Date.now() - startTime > 120_000) throw new Error('timeout');",
  "if (Date.now() - startTime > 300_000) throw new Error('timeout'); // Increased to 5 mins for cold boots"
);

// FIX 2: RENAME BUTTON IN START COMMAND
// The previous text might use 🪤 or 🪄, let's read the file and replace via regex to be safe.
const startPath = path.join(__dirname, 'src/bot/commands/start.ts');
let startContent = fs.readFileSync(startPath, 'utf8');
startContent = startContent.replace(/\{ text: nanoLocks\.btn_magic_enhance \? '🔒 تحسين احترافي بالذكاء الاصطناعي — مقفل' : '.* تحسين احترافي بالذكاء الاصطناعي', callback_data: 'magic_enhance_start', style: 'primary' \}/,
  "{ text: nanoLocks.btn_magic_enhance ? '🔒 تحسين الصورة (AI) — مقفل' : '🪄 تحسين الصورة (AI)', callback_data: 'magic_enhance_start', style: 'primary' }");
fs.writeFileSync(startPath, startContent, 'utf8');
console.log('SUCCESS in src/bot/commands/start.ts (Regex replaced)');

// FIX 3: RENAME ADMIN TOGGLE BUTTON
replaceInFile(
  'src/bot/handlers/callbackHandler.ts',
  "[{ text: `${l.btn_magic_enhance ? '🔴 مقفل' : '🟢 مفتوح'} — 🪄 تحسين احترافي`, callback_data: 'atoggle_btn_magic_enhance' }]",
  "[{ text: `${l.btn_magic_enhance ? '🔴 مقفل' : '🟢 مفتوح'} — 🪄 تحسين الصورة (AI)`, callback_data: 'atoggle_btn_magic_enhance' }]",
  2
);

// FIX 4: RENAME REPLY TEXT IN TRIGGER
replaceInFile(
  'src/bot/handlers/callbackHandler.ts',
  "'🪄 تحسين احترافي بالذكاء الاصطناعي\\n\\n' +",
  "'🪄 <b>تحسين الصورة (AI)</b>\\n\\n' +"
);

console.log("All replacements finished.");
