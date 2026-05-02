const fs = require('fs');

const path = 'src/bot/handlers/callbackHandler.ts';
let code = fs.readFileSync(path, 'utf8');

// Fix 'upscale' not read
code = code.replace(
  "async function showFormatSelection(ctx: any, count: number, upscale: boolean): Promise<void> {",
  "async function showFormatSelection(ctx: any, count: number, _upscale: boolean): Promise<void> {"
);

// Fix format string cast
code = code.replace(
  "const format = data.replace('fconv_', '') as 'png' | 'jpg' | 'webp' | 'avif' | 'tiff';",
  "const format = data.replace('fconv_', '') as 'png' | 'jpg' | 'webp' | 'avif' | 'tiff' | 'pdf' | 'svg';"
);

// Fix TS2322 buffer issue
code = code.replace(
  "const converted = await convertBuffer(processBuffer);",
  "const converted = await convertBuffer(processBuffer) as any;"
);

// Fix mimeOk unused
code = code.replace(
  "const mimeOk = !['pdf', 'svg'].includes(format);",
  "const _mimeOk = !['pdf', 'svg'].includes(format);"
);

fs.writeFileSync(path, code);
console.log('Patch complete.');
