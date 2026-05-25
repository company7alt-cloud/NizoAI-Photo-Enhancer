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

// FIX 3: RENAME ADMIN TOGGLE BUTTON
replaceInFile(
  'src/bot/handlers/callbackHandler.ts',
  "[{ text: `${l.btn_magic_enhance ? '🔴 مقفول' : '🟢 مفتوح'} — 🪤 تحسين احترافي`, callback_data: 'atoggle_btn_magic_enhance' }]",
  "[{ text: `${l.btn_magic_enhance ? '🔴 مقفل' : '🟢 مفتوح'} — 🪄 تحسين الصورة (AI)`, callback_data: 'atoggle_btn_magic_enhance' }]",
  2
);

// FIX 4: RENAME REPLY TEXT IN TRIGGER
replaceInFile(
  'src/bot/handlers/callbackHandler.ts',
  "'🪤 تحسين احترافي بالذكاء الاصطناعي\\n\\n' +",
  "'🪄 <b>تحسين الصورة (AI)</b>\\n\\n' +"
);

console.log("All replacements finished.");
