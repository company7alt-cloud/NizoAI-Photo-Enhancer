const fs = require('fs');
let code = fs.readFileSync('src/index.ts', 'utf8');

const dmMiddleware = `
bot.use(async (ctx, next) => {
  if (ctx.callbackQuery) {
    const { handleDocMakerCallback } = await import('./bot/handlers/docMakerHandler');
    const handled = await handleDocMakerCallback(ctx as any);
    if (handled) return;
  } else if (ctx.message) {
    const { handleDocMakerMessage } = await import('./bot/handlers/docMakerHandler');
    const handled = await handleDocMakerMessage(ctx as any);
    if (handled) return;
  }
  await next();
});
`;

code = code.replace("// ─── Commands ──────────────────────────────────────────────────────────────────", dmMiddleware + "\n// ─── Commands ──────────────────────────────────────────────────────────────────");

fs.writeFileSync('src/index.ts', code);
