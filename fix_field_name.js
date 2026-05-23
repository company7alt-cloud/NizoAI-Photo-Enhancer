const fs = require('fs');
let content = fs.readFileSync('src/index.ts', 'utf8');

// Fix: ctx.session?.awaitingImage → ctx.session?.isAwaitingImage
// Only inside the PHOTO GUARD block
content = content.replace(
  '      ctx.session?.awaitingImage ||',
  '      ctx.session?.isAwaitingImage ||'
);

fs.writeFileSync('src/index.ts', content, 'utf8');
console.log('✅ Fixed awaitingImage → isAwaitingImage in PHOTO GUARD');
