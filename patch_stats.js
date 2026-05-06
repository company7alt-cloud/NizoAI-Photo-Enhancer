const fs = require('fs');

function patchCallbackHandler() {
    let content = fs.readFileSync('src/bot/handlers/callbackHandler.ts', 'utf8');

    // Add show_global_stats handler
    const handlerStr = `
  if (data === 'show_global_stats') {
    const { getGlobalCounter } = await import('../../services/statsService');
    const total = await getGlobalCounter();
    
    // Format the number nicely (e.g., 5,023)
    const formattedTotal = total.toLocaleString('en-US');

    await ctx.answerCallbackQuery({
      text: \`🚀 إحصائيات البوت:\\n\\nتمت معالجة وتحسين أكثر من [ \${formattedTotal} ] صورة وملف بنجاح عبر نظامنا الذكي! 🌟\`,
      show_alert: true
    }).catch(() => {});
    return;
  }
`;

    if (!content.includes("data === 'show_global_stats'")) {
        content = content.replace("if (!data || !ctx.from) return;", "if (!data || !ctx.from) return;\n" + handlerStr);
    }

    // Replace replyWithDocument
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('await ctx.replyWithDocument(')) {
            if (i > 0 && lines[i-1].includes('incrementGlobalCounter')) continue; // Already added
            
            // Just insert the block before the line
            lines.splice(i, 0, "      const { incrementGlobalCounter } = await import('../../services/statsService');");
            lines.splice(i + 1, 0, "      await incrementGlobalCounter();");
            i += 2; // skip the lines we just added
        }
    }
    
    fs.writeFileSync('src/bot/handlers/callbackHandler.ts', lines.join('\n'));
}

function patchImageHandler() {
    let content = fs.readFileSync('src/bot/handlers/imageHandler.ts', 'utf8');

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('await ctx.replyWithDocument(')) {
            if (i > 0 && lines[i-1].includes('incrementGlobalCounter')) continue; // Already added
            
            // Just insert the block before the line, indent it matching
            const match = lines[i].match(/^\\s+/);
            const indent = match ? match[0] : '';
            lines.splice(i, 0, indent + "const { incrementGlobalCounter } = await import('../../services/statsService');");
            lines.splice(i + 1, 0, indent + "await incrementGlobalCounter();");
            i += 2; // skip the lines we just added
        }
    }
    
    fs.writeFileSync('src/bot/handlers/imageHandler.ts', lines.join('\n'));
}

patchCallbackHandler();
patchImageHandler();
console.log('Patched correctly');
