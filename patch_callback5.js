const fs = require('fs');

const path = 'src/bot/handlers/callbackHandler.ts';
let code = fs.readFileSync(path, 'utf8');

// Fix processBuffer typing issue
code = code.replace(
  "let processBuffer = inputBuffer;",
  "let processBuffer: any = inputBuffer;"
);

fs.writeFileSync(path, code);
console.log('Patch complete.');
