const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/index.ts');
let content = fs.readFileSync(filePath, 'utf8');

// BUG 1: Free AI Fallback
const freeAiRegex = /\/\/ Model 1: Llama 3\.1 8B \(primary\)[\s\S]*?\} catch \(fallbackErr: any\) \{[\s\S]*?throw new Error[^}]*\}[\s\S]*?\}/;
const freeAiReplacement = `const FREE_MODELS = [
        'deepseek/deepseek-v4-flash:free',
        'google/gemma-4-31b-it:free',
        'openai/gpt-oss-20b:free'
      ];

      for (const model of FREE_MODELS) {
        try {
          const response = await aiClient.chat.completions.create({
            model,
            messages: [
              { role: 'system', content: FREE_AI_SYSTEM_PROMPT },
              { role: 'user',   content: text },
            ]
          });
          if (response.choices[0]?.message?.content) {
            rawText = response.choices[0].message.content;
            break;
          }
        } catch (e: any) {
          console.error(\`[Free AI] Model \${model} failed:\`, e.message);
          continue;
        }
      }
      if (!rawText) throw new Error('كلا النموذجين فشلا');`;

content = content.replace(freeAiRegex, freeAiReplacement);

// BUG 2: Paid PDF Text Collection Loop
const paidLoopRegex = /const currentWords = text\.split\(\/\\s\+\/\)\.filter\(w => w\.length > 0\)\.length;[\s\S]*?return;\s*\n\s*\}/;
const paidLoopReplacement = `ctx.session.collectedText = (ctx.session.collectedText ?? '') + '\\n' + text;
    const totalWords = ctx.session.collectedText.split(/\\s+/).filter(Boolean).length;
    const estimatedPages = Math.ceil(totalWords / 250);
    ctx.session.totalWords = totalWords;
    ctx.session.estimatedPages = estimatedPages;

    await ctx.reply(
      \`📝 الكلمات حتى الآن: \${totalWords}\\n\` +
      \`📄 الصفحات المتوقعة: ~\${estimatedPages}\\n\\n\` +
      \`هل لديك محتوى إضافي؟ أرسله أو أرسل <b>تم</b> للمتابعة\`,
      { parse_mode: 'HTML' }
    );
    return;
  }`;

content = content.replace(paidLoopRegex, paidLoopReplacement);

// Ensure awaitingMoreText is set BEFORE the handler checks it in docBot.on('message:text')
// Not necessary as long as the state is correctly tracked in the session, but we will make sure docBot.on is ordered correctly.

fs.writeFileSync(filePath, content);
console.log('Fixed bugs.');
