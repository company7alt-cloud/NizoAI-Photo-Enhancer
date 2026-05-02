const fs = require('fs');

const path = 'src/bot/handlers/callbackHandler.ts';
let code = fs.readFileSync(path, 'utf8');

// Fix buffer assignment by casting directly in push
code = code.replace(
  "convertedFiles.push({ buffer: converted, name: `image_${i + 1}.${ext}` });",
  "convertedFiles.push({ buffer: converted as any, name: `image_${i + 1}.${ext}` });"
);

// Remove _mimeOk to avoid unused variable warning
code = code.replace(
  "const _mimeOk = !['pdf', 'svg'].includes(format);",
  "// const _mimeOk = !['pdf', 'svg'].includes(format);"
);

fs.writeFileSync(path, code);
console.log('Patch complete.');
