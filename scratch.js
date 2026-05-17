const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/index.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Remove buildPageSelectorKeyboard
const chunk0Regex = /function buildPageSelectorKeyboard\(\): InlineKeyboard \{[\s\S]*?return kb;\s*\n\}/;
content = content.replace(chunk0Regex, '');

// Replace premium AI flow
const chunk1Regex = /docBot\.callbackQuery\('start_premium_ai'[\s\S]*?ctx\.session\.pendingPremiumCost\s*=\s*undefined;\s*\}\);/;
const chunk1Replacement = `docBot.callbackQuery('start_premium_ai', async (ctx) => {
  ctx.session.awaitingPremiumImage = true;
  ctx.session.awaitingMoreText = false;
  ctx.session.referenceImageBuffer = undefined;
  ctx.session.collectedText = '';
  ctx.session.totalWords = 0;
  ctx.session.estimatedPages = 0;
  await ctx.answerCallbackQuery();
  await ctx.reply(
    \`🤖 <b>NizoAI PDF</b>\\n\\n\` +
    \`🔍 <b>ابحث عن نموذج يعجبك:</b>\\n\` +
    \`- <code>professional PDF template</code>\\n\` +
    \`- <code>academic document design</code>\\n\` +
    \`- <code>business letter template</code>\\n\\n\` +
    \`🖼 أرسل صورة النموذج المرجعي\\n\` +
    \`أو اضغط للنموذج الافتراضي:\`,
    { 
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().text('📄 النموذج الافتراضي', 'premium_use_default')
    }
  );
});

docBot.callbackQuery('premium_use_default', async (ctx) => {
  if (ctx.session.awaitingPremiumImage) {
    ctx.session.referenceImageBuffer = undefined;
    ctx.session.awaitingPremiumImage = false;
    ctx.session.awaitingMoreText = true;
    ctx.session.collectedText = '';
    ctx.session.totalWords = 0;
    ctx.session.estimatedPages = 0;
    await ctx.answerCallbackQuery('النموذج الافتراضي');
    await ctx.editMessageText(
      \`✅ تم حفظ النموذج. الآن أرسل المحتوى النصي رسالة رسالة.\\n\` +
      \`في كل رسالة سأحسب لك عدد الكلمات والصفحات المتوقعة.\\n\` +
      \`عندما تنتهي أرسل كلمة: تم\`,
      { parse_mode: 'HTML' }
    );
  } else {
    await ctx.answerCallbackQuery('هذا الخيار غير متاح الآن');
  }
});

docBot.callbackQuery(/^pages_(1|2|3|5|10|15|20|auto)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const choice = ctx.match[1];
  let pages = 1;
  let msg = '';
  if (choice === 'auto') {
    pages = ctx.session.estimatedPages ?? 1;
    msg = \`🤖 البوت اختار \${pages} صفحات بناءً على حجم المحتوى\`;
  } else {
    pages = parseInt(choice);
    msg = \`⏳ جاري معالجة \${pages} صفحة...\`;
  }
  
  const cost = calculatePremiumCost(pages);
  const telegramId = ctx.from.id.toString();
  const user = await User.findOne({ telegramId });

  if (!user || user.dailyQuota < cost) {
    await ctx.reply(\`❌ رصيدك الحالي \${user?.dailyQuota ?? 0} نقطة، وتحتاج \${cost} نقطة.\`);
    return;
  }

  await User.updateOne({ telegramId }, { $inc: { dailyQuota: -cost } });
  await ctx.editMessageText(msg).catch(() => {});

  try {
    const imageB64 = ctx.session.referenceImageBuffer;
    const collectedText = ctx.session.collectedText ?? '';
    
    const promptText = \`أنت مصمم مستندات PDF احترافي.
   
المطلوب: صمم مستند PDF بـ \${pages} صفحة/صفحات.

\${imageB64 ? 'النموذج المرجعي: [الصورة المرفقة - احتفظ بنفس الألوان والتصميم والهيكل]' : 'النموذج المرجعي: استخدم النموذج الافتراضي الاحترافي'}

المحتوى النصي المطلوب إدراجه:
\${collectedText}

تعليمات مهمة:
- احتفظ بنفس تصميم النموذج المرجعي (الألوان، الخطوط، الهيكل)
- استبدل النص الموجود في النموذج بالمحتوى المقدم فقط
- لا تضف محتوى من عندك
- نظم المحتوى بشكل احترافي عبر \${pages} صفحة
- اكتب باللغة العربية\`;

    let messages: any[] = [];
    if (imageB64) {
      messages = [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: \`data:image/jpeg;base64,\${imageB64}\` } },
            { type: 'text', text: promptText }
          ]
        }
      ];
    } else {
      messages = [{ role: 'user', content: promptText }];
    }

    const response = await aiClient.chat.completions.create({
      model: 'anthropic/claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages
    });

    const rawText = response.choices[0]?.message?.content ?? '';
    const cleaned = rawText
      .replace(/===\\s*(HEADER|BODY|FOOTER|PAGE BREAK|صفحة \\d+)\\s*===/gi, '')
      .replace(/===.*?===/gs, '')
      .replace(new RegExp(AI_EMOJI_REGEX.source, 'gu'), '')
      .trim();

    if (!cleaned) throw new Error('AI returned empty content');

    const words = cleaned.split(/\\s+/);
    const pageChunks: string[] = [];
    for (let i = 0; i < words.length; i += 350) {
      pageChunks.push(words.slice(i, i + 350).join(' '));
    }
    
    if (pageChunks.length > pages) pageChunks.length = pages;
    while (pageChunks.length < pages) pageChunks.push(pageChunks[pageChunks.length - 1] || '');

    const docLines: { text: string; align: 'right' }[] = [];
    for (let i = 0; i < pageChunks.length; i++) {
      const pgLines = pageChunks[i].split('\\n').map(l => ({ text: l, align: 'right' as const }));
      docLines.push(...pgLines);
      if (i < pageChunks.length - 1) docLines.push({ text: '---PAGE_BREAK---', align: 'right' });
    }

    const { generateDocumentFromLines } = await import('./services/pdfGeneratorService');
    const { buffer: pdfBuffer } = await generateDocumentFromLines(docLines, 'A4');

    const remaining = (user.dailyQuota - cost);
    const fileName  = \`nizoai_premium_\${Date.now()}.pdf\`;
    
    await ctx.replyWithDocument(
      new InputFile(pdfBuffer, fileName),
      {
        caption: \`✅ مستندك جاهز! 🎉\\n📄 \${pages} صفحة احترافية\\n📝 \${ctx.session.totalWords} كلمة\\n💰 تم خصم \${cost} نقطة\\n💳 رصيدك الحالي: \${remaining} نقطة\`,
        parse_mode: 'HTML'
      }
    );
  } catch (err: any) {
    await User.updateOne({ telegramId }, { $inc: { dailyQuota: cost } });
    console.error('[DocBot Premium AI] Error:', err?.message);
    await ctx.reply(\`❌ <b>فشل إنشاء المستند.</b>\\nتم استرداد نقاطك.\\n<code>\${err?.message ?? 'unknown error'}</code>\`, { parse_mode: 'HTML' });
  }

  ctx.session.awaitingPremiumImage  = false;
  ctx.session.awaitingMoreText      = false;
  ctx.session.referenceImageBuffer  = undefined;
  ctx.session.collectedText         = '';
});

docBot.callbackQuery('cancel_premium_ai', async (ctx) => {
  await ctx.answerCallbackQuery('تم الإلغاء');
  await ctx.editMessageText('❌ تم إلغاء الطلب.').catch(() => {});
  ctx.session.awaitingPremiumImage  = false;
  ctx.session.awaitingMoreText      = false;
});`;

content = content.replace(chunk1Regex, chunk1Replacement);

// Replace message:photo
const chunk2Regex = /docBot\.on\(\['message:photo', 'message:document'\], async \(ctx, next\) => \{[\s\S]*?return next\(\);\n\}\);/;
const chunk2Replacement = `docBot.on(['message:photo', 'message:document'], async (ctx, next) => {
  if (ctx.session.awaitingPremiumImage) {
    let fileId: string | undefined;
    if (ctx.message?.photo) {
      fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    } else if (ctx.message?.document && ctx.message.document.mime_type?.startsWith('image/')) {
      fileId = ctx.message.document.file_id;
    }

    if (!fileId) return next();

    try {
      const waitMsg = await ctx.reply('⏳ جاري حفظ النموذج المرجعي...');
      const file = await ctx.api.getFile(fileId);
      const filePath = file.file_path;
      if (!filePath) throw new Error('File path not found');

      const res = await fetch(\`https://api.telegram.org/file/bot\${process.env.DOC_BOT_TOKEN}/\${filePath}\`);
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      ctx.session.referenceImageBuffer = buffer.toString('base64');
      ctx.session.awaitingPremiumImage = false;
      ctx.session.awaitingMoreText = true;
      ctx.session.collectedText = '';
      ctx.session.totalWords = 0;
      ctx.session.estimatedPages = 0;

      await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => {});
      await ctx.reply(
        \`✅ تم حفظ النموذج. الآن أرسل المحتوى النصي رسالة رسالة.\\n\` +
        \`في كل رسالة سأحسب لك عدد الكلمات والصفحات المتوقعة.\\n\` +
        \`عندما تنتهي أرسل كلمة: تم\`,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      console.error('Error fetching image for premium AI:', error);
      await ctx.reply('❌ حدث خطأ أثناء معالجة الصورة، يرجى المحاولة بصورة أخرى.');
    }
    return;
  }
  return next();
});`;

content = content.replace(chunk2Regex, chunk2Replacement);

// Replace message:text loop logic
const chunk3Regex = /\/\/ ── Custom pages number interceptor ─────────────────────────────────────────[\s\S]*?\/\/ ── Free AI Topic Interceptor/;
const chunk3Replacement = `// ── Paid PDF Text Loop ──────────────────────────────
  if (ctx.session.awaitingMoreText) {
    if (text === 'تم') {
      ctx.session.awaitingMoreText = false;
      const totalWords = ctx.session.totalWords ?? 0;
      const estimatedPages = ctx.session.estimatedPages ?? 1;

      const kb = new InlineKeyboard()
        .text('1 صفحة', 'pages_1')
        .text('2 صفحة', 'pages_2')
        .text('3 صفحات', 'pages_3')
        .text('5 صفحات', 'pages_5').row()
        .text('10 صفحات', 'pages_10')
        .text('15 صفحة', 'pages_15')
        .text('20 صفحة', 'pages_20').row()
        .text('🤖 تلقائي (يحدده البوت)', 'pages_auto');

      await ctx.reply(
        \`📊 ملخص المحتوى:\\n\` +
        \`─────────────────\\n\` +
        \`📝 إجمالي الكلمات: \${totalWords}\\n\` +
        \`📄 الصفحات المقترحة: ~\${estimatedPages}\\n\\n\` +
        \`اختر عدد الصفحات:\`,
        { parse_mode: 'HTML', reply_markup: kb }
      );
      return;
    }

    const currentWords = text.split(/\\s+/).filter(w => w.length > 0).length;
    const newTotal = (ctx.session.totalWords ?? 0) + currentWords;
    ctx.session.totalWords = newTotal;
    const est = Math.ceil(newTotal / 250);
    ctx.session.estimatedPages = est;
    ctx.session.collectedText = (ctx.session.collectedText ?? '') + '\\n' + text;

    await ctx.reply(
      \`📝 الكلمات حتى الآن: \${newTotal}\\n\` +
      \`📄 الصفحات المتوقعة: ~\${est}\\n\\n\` +
      \`هل لديك محتوى إضافي؟ أرسله أو أرسل 'تم' للمتابعة\`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  // ── Free AI Topic Interceptor`;

content = content.replace(chunk3Regex, chunk3Replacement);

// Replace Free AI logic
const chunk4Regex = /const response = await aiClient\.chat\.completions\.create\(\{\s*model: 'mistralai\/mistral-7b-instruct:free',[\s\S]*?throw new Error\('AI returned empty content'\);/;
const chunk4Replacement = `const FREE_AI_SYSTEM_PROMPT = 'أنت كاتب محتوى عربي محترف. اكتب المحتوى المطلوب بشكل منظم واضح. استخدم العناوين والفقرات. لا تستخدم رموز تعبيرية. اكتب باللغة العربية فقط.';

      let rawText = '';
      const FREE_MODELS = [
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
      if (!rawText) throw new Error('كلا النموذجين فشلا');

      const cleanedText = rawText.replace(new RegExp(AI_EMOJI_REGEX.source, 'gu'), '').trim();
      if (!cleanedText) throw new Error('AI returned empty content');`;

content = content.replace(chunk4Regex, chunk4Replacement);

fs.writeFileSync(filePath, content);
console.log('Replacements completed.');
