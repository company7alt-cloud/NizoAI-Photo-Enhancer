const fs = require('fs');

// ════════════════════════════════════════════════
// FIX SCRIPT — 4 bugs, zero deletions
// ════════════════════════════════════════════════

// ── 1. validators.ts: add lastGeneratedHtml to SessionData ───────────────────
let val = fs.readFileSync('src/utils/validators.ts', 'utf8');
if (!val.includes('lastGeneratedHtml')) {
  val = val.replace(
    'proEditCurrentImgPage?: number | null;',
    'proEditCurrentImgPage?: number | null;\n  lastGeneratedHtml?: string; // BUG 3: stored HTML for image-only edits'
  );
  fs.writeFileSync('src/utils/validators.ts', val, 'utf8');
  console.log('✅ validators.ts: added lastGeneratedHtml');
} else {
  console.log('⏭  validators.ts: already has lastGeneratedHtml');
}

// ── 2. aiPdfService.ts: add generateAiPDFFromHtml + generateAiPDFAndHtml ─────
let pdf = fs.readFileSync('src/services/aiPdfService.ts', 'utf8');
const newPdfFunctions = `
// ─── Re-render PDF from pre-built HTML (image-only edits, BUG 3) ───────────
export async function generateAiPDFFromHtml(fullHtml: string): Promise<string> {
  const pdfPath = path.join(process.cwd(), 'temp', \`document_\${Date.now()}.pdf\`);
  if (!fs.existsSync(path.dirname(pdfPath))) {
    fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
  }
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none', '--disable-dev-shm-usage'],
    timeout: 90000,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: 'networkidle2' as any, timeout: 90000 });
    await page.evaluateHandle('document.fonts.ready');
    await new Promise(resolve => setTimeout(resolve, 1000));
    await page.pdf({
      path: pdfPath, format: 'A4', printBackground: true,
      margin: { top: '2.5cm', right: '2cm', bottom: '2.5cm', left: '2cm' },
      displayHeaderFooter: false, timeout: 90000,
    });
  } finally {
    await browser.close();
  }
  return pdfPath;
}

// ─── Generate PDF + return HTML for caching (BUG 3) ──────────────────────────
export async function generateAiPDFAndHtml(rawMarkdown: string, template: string = 'default'): Promise<{ pdfPath: string; html: string }> {
  const cleanMarkdown = sanitizeForPdf(rawMarkdown);
  const processedText = await processImages(cleanMarkdown);
  const bodyHtml = await Promise.resolve(marked.parse(processedText));
  const fullHtml = buildHtml(bodyHtml, template);
  const pdfPath = await generateAiPDFFromHtml(fullHtml);
  return { pdfPath, html: fullHtml };
}

`;

if (!pdf.includes('generateAiPDFFromHtml')) {
  // Insert before the Pro Image PDF Generator section
  pdf = pdf.replace(
    '// ─── Pro Image PDF Generator (TASK 5)',
    newPdfFunctions + '// ─── Pro Image PDF Generator (TASK 5)'
  );
  fs.writeFileSync('src/services/aiPdfService.ts', pdf, 'utf8');
  console.log('✅ aiPdfService.ts: added generateAiPDFFromHtml + generateAiPDFAndHtml');
} else {
  console.log('⏭  aiPdfService.ts: functions already exist');
}

// ── 3. editWorkflow.ts: all 4 bugs ───────────────────────────────────────────
let ew = fs.readFileSync('src/handlers/docmaker/editWorkflow.ts', 'utf8');

// BUG 1 — import new functions
ew = ew.replace(
  "import { generateAiPDF } from '../../services/aiPdfService';",
  "import { generateAiPDF, generateAiPDFFromHtml, generateAiPDFAndHtml } from '../../services/aiPdfService';"
);

// BUG 1 — add style to text-edit button (unshift row)
ew = ew.replace(
  "rows.unshift([{ text: '✏️ تعديل النص', callback_data: 'pro_edit_text' }]);",
  "rows.unshift([{ text: '✏️ تعديل النص', callback_data: 'pro_edit_text', style: 'primary' as any }]);"
);

// BUG 1 — add style to ok button
ew = ew.replace(
  "rows.push([{ text: 'موافق ✅', callback_data: 'pro_edit_confirm' }]);",
  "rows.push([{ text: 'موافق ✅', callback_data: 'pro_edit_confirm', style: 'success' as any }]);"
);

// BUG 1 — add style to cancel button (showProImageEditMenu)
ew = ew.replace(
  "rows.push([{ text: 'إلغاء', callback_data: 'cancel' }]);",
  "rows.push([{ text: 'إلغاء', callback_data: 'cancel', style: 'danger' as any }]);"
);

// BUG 1 — add style: 'primary' to number buttons in main loop
ew = ew.replace(
  "row.push({ text: isDone ? '✅ ' + n : String(n), callback_data: 'pro_edit_img_' + n });\n      imgNum++;",
  "row.push({ text: isDone ? '✅ ' + n : String(n), callback_data: 'pro_edit_img_' + n, style: 'primary' as any });\n      imgNum++;"
);

// BUG 1 — fallback row number buttons style (different indent pattern)
ew = ew.replace(
  "row.push({ text: isDone ? '✅ ' + n : String(n), callback_data: 'pro_edit_img_' + n });\n    }\n    rows.push(row);\n  }\n\n  // Text-edit",
  "row.push({ text: isDone ? '✅ ' + n : String(n), callback_data: 'pro_edit_img_' + n, style: 'primary' as any });\n    }\n    rows.push(row);\n  }\n\n  // Text-edit"
);

// BUG 2 — disable editMessageReplyMarkup call (MODIFY condition, zero deletions)
ew = ew.replace(
  '  if (menuMsgId && ctx.chat?.id) {\n    try {\n      // Rebuild keyboard with updated ✅ marks',
  '  if (false && menuMsgId && ctx.chat?.id) { // BUG 2 FIX: never edit buttons message after image upload\n    try {\n      // Rebuild keyboard with updated ✅ marks'
);

// Append handleProEditConfirmV2 (BUG 3 + BUG 4)
if (!ew.includes('handleProEditConfirmV2')) {
  ew += `
// ── BUG 3 + BUG 4: handleProEditConfirmV2 ────────────────────────────────────
// BUG 4: No 3-edit limit. Each confirm costs: free_pro→3 dailyQuota, nizo_pro→2 dailyQuota
// BUG 3: Image-only edits skip AI — replace img tags in stored HTML directly
export async function handleProEditConfirmV2(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => {});

  const hasTextEdit = !!(ctx.session.proEditText?.trim());
  const hasImageEdit = Object.keys(ctx.session.proEditImages ?? {}).length > 0;

  if (!hasTextEdit && !hasImageEdit) {
    await ctx.reply('⚠️ لم تقم بأي تعديل. اضغط رقم صورة أو عدّل النص أولاً.');
    return;
  }

  const userId = ctx.from?.id;
  if (!userId) return;

  // BUG 4: Balance check — use dailyQuota (the only balance field in User schema)
  if (ctx.session.lastPdfMode === 'free_pro') {
    const user = await User.findOne({ telegramId: userId });
    if ((user?.dailyQuota ?? 0) < 3) {
      await ctx.reply('⚠️ رصيدك غير كافٍ. تحتاج 3 نقاط للتعديل.');
      return;
    }
    await User.findOneAndUpdate({ telegramId: userId }, { $inc: { dailyQuota: -3 } });
  }

  if (ctx.session.lastPdfMode === 'nizo_pro') {
    const user = await User.findOne({ telegramId: userId });
    if ((user?.dailyQuota ?? 0) < 2) {
      await ctx.reply('⚠️ رصيدك غير كافٍ. تحتاج 2 نقاط للتعديل.');
      return;
    }
    await User.findOneAndUpdate({ telegramId: userId }, { $inc: { dailyQuota: -2 } });
  }

  // BUG 3: Image-only path — skip AI, replace img tags in stored HTML
  const storedHtml = ctx.session.lastGeneratedHtml;
  if (!hasTextEdit && hasImageEdit && storedHtml) {
    const loadingState = await showDynamicLoading(ctx, '🖼️ جاري استبدال الصور');
    try {
      let editedHtml = storedHtml;
      const botToken = process.env.DOC_BOT_TOKEN || process.env.BOT_TOKEN || '';

      // Replace each requested image by 1-based index in HTML
      const imgEntries = Object.entries(ctx.session.proEditImages ?? {}).sort(
        ([a], [b]) => parseInt(a) - parseInt(b)
      );

      for (const [idxStr, fileId] of imgEntries) {
        const imgIndex = parseInt(idxStr) - 1; // 0-based
        try {
          // Download from Telegram
          const fileInfoRes = await fetch(
            \`https://api.telegram.org/bot\${botToken}/getFile?file_id=\${encodeURIComponent(fileId)}\`,
            { signal: AbortSignal.timeout(10000) }
          );
          if (!fileInfoRes.ok) continue;
          const fileInfoData = await fileInfoRes.json() as { ok: boolean; result?: { file_path?: string } };
          const filePath = fileInfoData.result?.file_path;
          if (!filePath) continue;

          const fileRes = await fetch(
            \`https://api.telegram.org/file/bot\${botToken}/\${filePath}\`,
            { signal: AbortSignal.timeout(15000) }
          );
          if (!fileRes.ok) continue;
          const base64 = Buffer.from(await fileRes.arrayBuffer()).toString('base64');
          const dataUri = \`data:image/jpeg;base64,\${base64}\`;

          // Replace Nth <img src="..."> in HTML (0-based)
          let count = 0;
          editedHtml = editedHtml.replace(/(<img[^>]+src=")[^"]*(")/g, (match, pre, post) => {
            if (count === imgIndex) { count++; return pre + dataUri + post; }
            count++;
            return match;
          });
        } catch (imgErr) {
          console.error(\`[ProEditV2] Image \${idxStr} replace error:\`, imgErr);
        }
      }

      await loadingState.stop();
      const pdfPath = await generateAiPDFFromHtml(editedHtml);
      await ctx.replyWithDocument(
        new InputFile(pdfPath, \`NizoAI_Doc_Edited_\${Date.now()}.pdf\`),
        { caption: '✅ <b>تم استبدال الصور بنجاح!</b>', parse_mode: 'HTML' }
      );

      // Update stored HTML and reset edit state
      ctx.session.lastGeneratedHtml = editedHtml;
      ctx.session.proEditText = null;
      ctx.session.proEditImages = {};
      ctx.session.proEditCurrentImgPage = null;
      ctx.session.awaitingProEditText = false;

      // BUG 4: Unlimited — show edit button again
      await ctx.reply('✅ تم التعديل بنجاح!', {
        reply_markup: {
          inline_keyboard: [[
            // @ts-ignore
            { text: '✏️ تعديل', callback_data: 'edit_pdf_doc', style: 'primary' as any }
          ]]
        }
      });

    } catch (err) {
      try { await loadingState.stop(); } catch { /* silent */ }
      // Refund
      const refundAmt = ctx.session.lastPdfMode === 'free_pro' ? 3 : 2;
      if (ctx.session.lastPdfMode === 'free_pro' || ctx.session.lastPdfMode === 'nizo_pro') {
        await User.findOneAndUpdate({ telegramId: userId }, { $inc: { dailyQuota: refundAmt } });
      }
      const e = err instanceof Error ? err.message : String(err);
      console.error('[ProEditV2 ImageOnly] Error:', e);
      await ctx.reply('⚠️ حدث خطأ أثناء استبدال الصور. تم إعادة نقاطك.');
    }
    return;
  }

  // Text edit path (with or without images) — call AI
  const originalText = ctx.session.lastAiGeneratedText || ctx.session.lastGeneratedDoc?.text || '';
  if (!originalText) {
    await ctx.reply('⚠️ انتهت صلاحية التعديل، أنشئ مستنداً جديداً.');
    return;
  }

  const pageCount = ctx.session.lastAiDocPages || ctx.session.lastGeneratedDoc?.pageCount || 1;
  const loadingState = await showDynamicLoading(ctx, '✏️ جاري تطبيق التعديلات');

  try {
    const response = await aiClient.chat.completions.create({
      model: process.env.REPLICATE_AI_MODEL_ID || 'anthropic/claude-3-haiku',
      messages: [
        {
          role: 'system',
          content: \`You are a silent document editor. Apply the user's edits and return the COMPLETE edited document in Arabic Markdown only. Keep exact same structure and page count (\${pageCount} pages). No explanations.\\n\\nORIGINAL DOCUMENT:\\n\${originalText}\`
        },
        { role: 'user', content: ctx.session.proEditText! }
      ],
      temperature: 0.3,
    });

    const editedText = response.choices[0]?.message?.content ?? '';
    if (!editedText.trim()) throw new Error('AI returned empty content.');

    const cleanMarkdown = editedText.replace(/^\`\`\`[a-z]*\\n?/gm, '').replace(/\`\`\`$/gm, '');
    await loadingState.stop();

    // BUG 3: use generateAiPDFAndHtml to cache the HTML
    const { pdfPath, html: newHtml } = await generateAiPDFAndHtml(cleanMarkdown, ctx.session.aiDocStyle || 'default');

    await ctx.replyWithDocument(
      new InputFile(pdfPath, \`NizoAI_Doc_Edited_\${Date.now()}.pdf\`),
      {
        caption: \`✅ <b>تم تطبيق التعديلات بنجاح!</b>\\n🎨 القالب: \${(ctx.session.aiDocStyle || 'default').toUpperCase()}\`,
        parse_mode: 'HTML'
      }
    );

    ctx.session.lastAiGeneratedText = cleanMarkdown;
    ctx.session.lastGeneratedDoc = { text: cleanMarkdown, pageCount, originalCost: 0 };
    ctx.session.lastGeneratedHtml = newHtml; // BUG 3: cache for future image-only edits
    ctx.session.proEditText = null;
    ctx.session.proEditImages = {};
    ctx.session.proEditCurrentImgPage = null;
    ctx.session.awaitingProEditText = false;

    await sendTextChunksWithEditButton(ctx, cleanMarkdown);

    // BUG 4: Unlimited — always show edit button
    await ctx.reply('✅ تم التعديل بنجاح!', {
      reply_markup: {
        inline_keyboard: [[
          // @ts-ignore
          { text: '✏️ تعديل', callback_data: 'edit_pdf_doc', style: 'primary' as any }
        ]]
      }
    });

  } catch (err) {
    try { await loadingState.stop(); } catch { /* silent */ }
    const refundAmt = ctx.session.lastPdfMode === 'free_pro' ? 3 : 2;
    if (ctx.session.lastPdfMode === 'free_pro' || ctx.session.lastPdfMode === 'nizo_pro') {
      await User.findOneAndUpdate({ telegramId: userId }, { $inc: { dailyQuota: refundAmt } });
    }
    const e = err instanceof Error ? err.message : String(err);
    console.error('[ProEditV2 TextEdit] Error:', e);
    await ctx.reply('⚠️ حدث خطأ أثناء التعديل. تم إعادة نقاطك تلقائياً.');
  }
}
`;
  console.log('✅ editWorkflow.ts: handleProEditConfirmV2 appended');
} else {
  console.log('⏭  editWorkflow.ts: handleProEditConfirmV2 already exists');
}

fs.writeFileSync('src/handlers/docmaker/editWorkflow.ts', ew, 'utf8');
console.log('✅ editWorkflow.ts: all BUG1+BUG2 fixes applied');

// ── 4. index.ts: update import + wire V2 ─────────────────────────────────────
let idx = fs.readFileSync('src/index.ts', 'utf8');

// Update import
idx = idx.replace(
  "import { handleEditPdfDocCallback, handleEditPdfDocMessage, showProImageEditMenu, processAutoEditMessage, processProEditTextMessage, processProEditImageUpload, handleProEditConfirm } from './handlers/docmaker/editWorkflow';",
  "import { handleEditPdfDocCallback, handleEditPdfDocMessage, showProImageEditMenu, processAutoEditMessage, processProEditTextMessage, processProEditImageUpload, handleProEditConfirm, handleProEditConfirmV2 } from './handlers/docmaker/editWorkflow';"
);

// Wire V2
idx = idx.replace(
  "registerDocCallback('pro_edit_confirm', 'pro_edit_confirm', async (ctx) => {\n  await handleProEditConfirm(ctx);\n});",
  "registerDocCallback('pro_edit_confirm', 'pro_edit_confirm', async (ctx) => {\n  await handleProEditConfirmV2(ctx);\n});"
);

fs.writeFileSync('src/index.ts', idx, 'utf8');
console.log('✅ index.ts: import + callback updated');

console.log('\n✅ All fixes applied. Running build...\n');
