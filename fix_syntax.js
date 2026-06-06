const fs = require('fs');
let c = fs.readFileSync('src/index.ts', 'utf8');
c = c.replace(/if \(!rawText\) throw new Error\('كلا النموذجين فشلا'\);`\);\s*\}\s*\}/g, "if (!rawText) throw new Error('كلا النموذجين فشلا');");
fs.writeFileSync('src/index.ts', c);
console.log('Fixed syntax error');
