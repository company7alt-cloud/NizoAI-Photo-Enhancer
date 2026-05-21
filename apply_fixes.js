const fs = require('fs');

function applyFixes() {
  // ── FIX 1: index.ts image guard ──
  let indexTs = fs.readFileSync('src/index.ts', 'utf8');
  const target1 = `    // ── CASE 2: Image sent ──\r\n    const isPhoto = !!ctx.message?.photo;\r\n    const isImageDoc = !!ctx.message?.document && ((ctx.message.document.mime_type?.startsWith('image/')) ?? false);\r\n\r\n    if (isPhoto || isImageDoc) {`;
  const replacement1 = `    // ── CASE 2: Image sent ──\r\n    const isPhoto = !!ctx.message?.photo;\r\n    const isImageDoc = !!ctx.message?.document && ((ctx.message.document.mime_type?.startsWith('image/')) ?? false);\r\n\r\n    if (isPhoto || isImageDoc) {\r\n      const isInManualDoc = (ctx.session as any).isInDocMaker === true;\r\n      const isInAiFlow = (ctx.session as any).awaitingPremiumImage === true || \r\n                         (ctx.session as any).awaitingFreeAiTopic === true ||\r\n                         (ctx.session as any).awaitingPremiumText === true;\r\n\r\n      if (!isInManualDoc || isInAiFlow) return next();`;
  
  if (indexTs.includes(target1)) {
    indexTs = indexTs.replace(target1, replacement1);
    console.log('✅ FIX 1 applied.');
  } else {
    console.log('❌ FIX 1 target not found. (Maybe already applied?)');
  }

  // ── FIX 3 (Part 1): index.ts edit state saving for premium ──
  const premiumTarget = `      ctx.session.lastGeneratedDoc = {\r\n        text: cleanMarkdown,\r\n        pageCount: finalPages,\r\n        originalCost: finalCost\r\n      };\r\n      await sendTextChunksWithEditButton(ctx, cleanMarkdown);`;
  const premiumReplacement = `      ctx.session.lastGeneratedDoc = {\r\n        text: cleanMarkdown,\r\n        pageCount: finalPages,\r\n        originalCost: finalCost\r\n      };\r\n      ctx.session.lastAiGeneratedText = cleanMarkdown;\r\n      ctx.session.lastAiDocPages = finalPages;\r\n      await sendTextChunksWithEditButton(ctx, cleanMarkdown);`;
  if (indexTs.includes(premiumTarget)) {
    indexTs = indexTs.replace(premiumTarget, premiumReplacement);
    console.log('✅ FIX 3 (Premium) applied.');
  } else {
    console.log('❌ FIX 3 (Premium) target not found.');
  }

  // ── FIX 3 (Part 2): index.ts edit state saving for free ──
  const freeTarget = `      await ctx.replyWithDocument(\r\n        new InputFile(pdfBuffer, fileName),\r\n        { caption: '✅ مستندك المجاني جاهز! 📄\\n\\nمدعوم بـ AI Free PDF ⚡' }\r\n      );`;
  const freeReplacement = `      await ctx.replyWithDocument(\r\n        new InputFile(pdfBuffer, fileName),\r\n        { caption: '✅ مستندك المجاني جاهز! 📄\\n\\nمدعوم بـ AI Free PDF ⚡' }\r\n      );\r\n\r\n      ctx.session.lastAiGeneratedText = cleanMarkdown;\r\n      ctx.session.lastAiDocPages = detectedPages;\r\n      ctx.session.lastGeneratedDoc = {\r\n        text: cleanMarkdown,\r\n        pageCount: detectedPages,\r\n        originalCost: 0\r\n      }; // Adding back compatibility for edit Workflow\r\n      await sendTextChunksWithEditButton(ctx, cleanMarkdown);`;
  if (indexTs.includes(freeTarget)) {
    indexTs = indexTs.replace(freeTarget, freeReplacement);
    console.log('✅ FIX 3 (Free) applied.');
  } else {
    console.log('❌ FIX 3 (Free) target not found.');
  }

  fs.writeFileSync('src/index.ts', indexTs, 'utf8');

  // ── FIX 3 (Part 3): SessionData interface ──
  let validatorsTs = fs.readFileSync('src/utils/validators.ts', 'utf8');
  const validatorTarget = `  workflowState?: 'waiting_for_doc_edit' | null;\r\n  lastGeneratedDoc?: {\r\n    text: string;\r\n    pageCount: number;\r\n    originalCost: number;\r\n  } | null;\r\n}`;
  const validatorReplacement = `  workflowState?: 'waiting_for_doc_edit' | null;\r\n  lastGeneratedDoc?: {\r\n    text: string;\r\n    pageCount: number;\r\n    originalCost: number;\r\n  } | null;\r\n  lastAiGeneratedText?: string;\r\n  lastAiDocPages?: number;\r\n  awaitingEditRequest?: boolean;\r\n}`;
  if (validatorsTs.includes(validatorTarget)) {
    validatorsTs = validatorsTs.replace(validatorTarget, validatorReplacement);
    fs.writeFileSync('src/utils/validators.ts', validatorsTs, 'utf8');
    console.log('✅ FIX 3 (SessionData) applied.');
  } else {
    console.log('❌ FIX 3 (SessionData) target not found.');
  }

  // ── FIX 2: promptAnalyzerService.ts ──
  let analyzerTs = fs.readFileSync('src/services/promptAnalyzerService.ts', 'utf8');
  
  const freeAiPromptTarget = `    'USER ORIGINAL REQUEST (unchanged):',`;
  const freeAiPromptReplacement = `    'VISUAL ENHANCEMENT PROTOCOL:',\r\n    'When the topic benefits from a visual aid (medical diagram, chart, logo, anatomical illustration, infographic), embed ONE relevant image using this format:',\r\n    "<img src='https://image.pollinations.ai/prompt/{english_description}?width=600&height=300&nologo=true' style='max-width:100%; margin:15px auto; display:block;' />",\r\n    '',\r\n    'Where {english_description} is a descriptive English prompt with spaces replaced by %20.',\r\n    'Examples:',\r\n    '- Human heart anatomy: https://image.pollinations.ai/prompt/human%20heart%20anatomy%20medical%20diagram%20vector%20white%20background?width=600&height=300&nologo=true',\r\n    '- Business chart: https://image.pollinations.ai/prompt/professional%20business%20chart%20infographic%20clean%20design?width=600&height=300&nologo=true',\r\n    '',\r\n    'Use maximum 2 images per document. Only add images when genuinely relevant.',\r\n    '',\r\n    'USER ORIGINAL REQUEST (unchanged):',`;
  
  if (analyzerTs.includes(freeAiPromptTarget)) {
    analyzerTs = analyzerTs.replace(freeAiPromptTarget, freeAiPromptReplacement);
    console.log('✅ FIX 2 (Free AI Prompt) applied.');
  } else {
    console.log('❌ FIX 2 (Free AI Prompt) target not found.');
  }

  const premiumAiPromptTarget = `    '=== AUTO DETECTION ===',`;
  const premiumAiPromptReplacement = `    '=== VISUAL ENHANCEMENT PROTOCOL ===',\r\n    'When the topic benefits from a visual aid (medical diagram, chart, logo, anatomical illustration, infographic), embed ONE relevant image using this format:',\r\n    "<img src='https://image.pollinations.ai/prompt/{english_description}?width=600&height=300&nologo=true' style='max-width:100%; margin:15px auto; display:block;' />",\r\n    '',\r\n    'Where {english_description} is a descriptive English prompt with spaces replaced by %20.',\r\n    'Examples:',\r\n    '- Human heart anatomy: https://image.pollinations.ai/prompt/human%20heart%20anatomy%20medical%20diagram%20vector%20white%20background?width=600&height=300&nologo=true',\r\n    '- Business chart: https://image.pollinations.ai/prompt/professional%20business%20chart%20infographic%20clean%20design?width=600&height=300&nologo=true',\r\n    '',\r\n    'Use maximum 2 images per document. Only add images when genuinely relevant.',\r\n    '',\r\n    '=== AUTO DETECTION ===',`;

  if (analyzerTs.includes(premiumAiPromptTarget)) {
    analyzerTs = analyzerTs.replace(premiumAiPromptTarget, premiumAiPromptReplacement);
    console.log('✅ FIX 2 (Premium AI Prompt) applied.');
  } else {
    console.log('❌ FIX 2 (Premium AI Prompt) target not found.');
  }

  fs.writeFileSync('src/services/promptAnalyzerService.ts', analyzerTs, 'utf8');

  // ── FIX 3 (Part 4): editWorkflow.ts ──
  let editTs = fs.readFileSync('src/handlers/docmaker/editWorkflow.ts', 'utf8');
  
  const callbackTarget = `export async function handleEditPdfDocCallback(ctx: BotContext): Promise<void> {\r\n  if (!ctx.session.lastGeneratedDoc) {\r\n    await ctx.answerCallbackQuery({\r\n      text: 'انتهت صلاحية التعديل. أنشئ مستنداً جديداً أولاً.',\r\n      show_alert: true\r\n    });\r\n    return;\r\n  }\r\n  const editCost = Math.ceil(ctx.session.lastGeneratedDoc.originalCost / 2);\r\n  \r\n  await ctx.reply(\r\n    \`✏️ أرسل التعديلات المطلوبة على النص.\\n\\n\` +\r\n    \`💳 سيُخصم \${editCost} نقاط عند التنفيذ.\\n\\n\` +\r\n    \`⚠️ لا يمكن زيادة عدد الصفحات في هذه المرحلة.\`\r\n  );\r\n  \r\n  ctx.session.workflowState = 'waiting_for_doc_edit';\r\n  await ctx.answerCallbackQuery();\r\n}`;
  
  const callbackReplacement = `export async function handleEditPdfDocCallback(ctx: BotContext): Promise<void> {\r\n  const originalText = ctx.session.lastAiGeneratedText || ctx.session.lastGeneratedDoc?.text;\r\n  if (!originalText) {\r\n    await ctx.answerCallbackQuery({\r\n      text: '⚠️ انتهت صلاحية التعديل، أنشئ مستنداً جديداً',\r\n      show_alert: true\r\n    });\r\n    return;\r\n  }\r\n  const editCost = ctx.session.lastGeneratedDoc ? Math.ceil(ctx.session.lastGeneratedDoc.originalCost / 2) : 0;\r\n  \r\n  await ctx.answerCallbackQuery();\r\n  ctx.session.awaitingEditRequest = true;\r\n  ctx.session.workflowState = 'waiting_for_doc_edit'; // keep for backward compat\r\n  \r\n  await ctx.reply('✏️ أرسل التعديلات المطلوبة وسيتم تطبيقها على المستند:');\r\n}`;

  if (editTs.includes(callbackTarget)) {
    editTs = editTs.replace(callbackTarget, callbackReplacement);
    console.log('✅ FIX 3 (editWorkflow Callback) applied.');
  } else {
    console.log('❌ FIX 3 (editWorkflow Callback) target not found.');
  }

  const msgTarget = `  if (!ctx.session.lastGeneratedDoc) {\r\n    ctx.session.workflowState = null;\r\n    return;\r\n  }\r\n\r\n  const { text: originalText, pageCount, originalCost } = ctx.session.lastGeneratedDoc;\r\n  const editCost = Math.ceil(originalCost / 2);`;
  const msgReplacement = `  const originalText = ctx.session.lastAiGeneratedText || ctx.session.lastGeneratedDoc?.text;\r\n  if (!originalText) {\r\n    ctx.session.workflowState = null;\r\n    ctx.session.awaitingEditRequest = false;\r\n    return;\r\n  }\r\n\r\n  const pageCount = ctx.session.lastAiDocPages || ctx.session.lastGeneratedDoc?.pageCount || 1;\r\n  const originalCost = ctx.session.lastGeneratedDoc?.originalCost || 0;\r\n  const editCost = Math.ceil(originalCost / 2);`;

  if (editTs.includes(msgTarget)) {
    editTs = editTs.replace(msgTarget, msgReplacement);
    console.log('✅ FIX 3 (editWorkflow Message 1) applied.');
  } else {
    console.log('❌ FIX 3 (editWorkflow Message 1) target not found.');
  }

  const msgTarget2 = `    // Update session state\r\n    ctx.session.lastGeneratedDoc = {\r\n      text: cleanMarkdown,\r\n      pageCount: pageCount,\r\n      originalCost: editCost\r\n    };\r\n    ctx.session.workflowState = null;`;
  const msgReplacement2 = `    // Update session state\r\n    ctx.session.lastGeneratedDoc = {\r\n      text: cleanMarkdown,\r\n      pageCount: pageCount,\r\n      originalCost: editCost\r\n    };\r\n    ctx.session.lastAiGeneratedText = cleanMarkdown;\r\n    ctx.session.awaitingEditRequest = false;\r\n    ctx.session.workflowState = null;`;

  if (editTs.includes(msgTarget2)) {
    editTs = editTs.replace(msgTarget2, msgReplacement2);
    console.log('✅ FIX 3 (editWorkflow Message 2) applied.');
  } else {
    console.log('❌ FIX 3 (editWorkflow Message 2) target not found.');
  }

  fs.writeFileSync('src/handlers/docmaker/editWorkflow.ts', editTs, 'utf8');

}

applyFixes();
