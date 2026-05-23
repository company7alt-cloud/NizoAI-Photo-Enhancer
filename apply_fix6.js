const fs = require('fs');

// ── FIX 6: Append handleProEditConfirm to editWorkflow.ts ─────────────────────
const ewPath = 'src/handlers/docmaker/editWorkflow.ts';
let ew = fs.readFileSync(ewPath, 'utf8');

if (ew.includes('handleProEditConfirm')) {
  console.log('handleProEditConfirm already exists in editWorkflow.ts — skipping append.');
} else {
  const appendBlock = `
// ── FIX 6: Proper pro_edit_confirm handler ────────────────────────────────────
export async function handleProEditConfirm(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => {});

  const editCount = ctx.session.editCount ?? 0;
  if (editCount >= 3) {
    await ctx.reply('\\u26a0\\ufe0f استخدمت جميع تعديلاتك الـ 3 لهذا المستند.');
    return;
  }

  const hasTextEdit = !!(ctx.session.proEditText?.trim());
  const hasImageEdit = Object.keys(ctx.session.proEditImages ?? {}).length > 0;

  if (!hasTextEdit && !hasImageEdit) {
    await ctx.reply('\\u26a0\\ufe0f لم تقم بأي تعديل. اضغط رقم صورة أو عدّل النص أولاً.');
    return;
  }

  // Deduct 2 points for nizo_pro edits
  if (ctx.session.lastPdfMode === 'nizo_pro') {
    const u = await User.findOne({ telegramId: ctx.from!.id });
    if ((u?.dailyQuota ?? 0) < 2) {
      await ctx.reply('\\u26a0\\ufe0f رصيدك غير كافٍ. تحتاج 2 نقاط للتعديل.');
      return;
    }
    await User.findOneAndUpdate(
      { telegramId: ctx.from!.id },
      { $inc: { dailyQuota: -2 } }
    );
  }

  const originalText = ctx.session.lastAiGeneratedText ||
    ctx.session.lastGeneratedDoc?.text || '';

  if (!originalText) {
    await ctx.reply('\\u26a0\\ufe0f انتهت صلاحية التعديل، أنشئ مستنداً جديداً.');
    return;
  }

  const pageCount = ctx.session.lastAiDocPages || ctx.session.lastGeneratedDoc?.pageCount || 1;
  const loadingState = await showDynamicLoading(ctx, '\\u270f\\ufe0f جاري تطبيق التعديلات');

  try {
    const response = await aiClient.chat.completions.create({
      model: process.env.REPLICATE_AI_MODEL_ID || 'anthropic/claude-3-haiku',
      messages: [
        {
          role: 'system',
          content: \`You are a silent document editor. Apply the user's edits and return the COMPLETE edited document in Arabic Markdown only. Keep exact same structure and page count (\${pageCount} pages). No explanations.\\n\\nORIGINAL DOCUMENT:\\n\${originalText}\`
        },
        {
          role: 'user',
          content: hasTextEdit ? ctx.session.proEditText! : 'طبّق تعديلات الصور المحددة فقط'
        }
      ],
      temperature: 0.3,
    });

    const editedText = response.choices[0]?.message?.content ?? '';
    if (!editedText.trim()) throw new Error('AI returned empty content.');

    const cleanMarkdown = editedText.replace(/^\`\`\`[a-z]*\\n?/gm, '').replace(/\`\`\`$/gm, '');
    await loadingState.stop();

    const pdfPath = await generateAiPDF(cleanMarkdown, ctx.session.aiDocStyle || 'default');
    await ctx.replyWithDocument(
      new InputFile(pdfPath, \`NizoAI_Doc_Edited_\${Date.now()}.pdf\`),
      {
        caption: \`\\u2705 <b>تم تطبيق التعديلات بنجاح!</b>\\n\\ud83c\\udfa8 القالب: \${(ctx.session.aiDocStyle || 'default').toUpperCase()}\`,
        parse_mode: 'HTML'
      }
    );

    ctx.session.lastAiGeneratedText = cleanMarkdown;
    ctx.session.lastGeneratedDoc = { text: cleanMarkdown, pageCount, originalCost: 0 };
    ctx.session.editCount = editCount + 1;
    const remaining = 3 - ctx.session.editCount;

    ctx.session.proEditText = null;
    ctx.session.proEditImages = {};
    ctx.session.proEditCurrentImgPage = null;
    ctx.session.awaitingProEditText = false;

    await sendTextChunksWithEditButton(ctx, cleanMarkdown);

    if (remaining > 0) {
      await ctx.reply(
        \`\\u2705 تم التعديل (\${ctx.session.editCount}/3)\\nمتبقي: \${remaining} تعديلات\`,
        {
          reply_markup: {
            inline_keyboard: [[
              { text: \`\\u270f\\ufe0f تعديل (\${remaining} متبقية)\`, callback_data: 'edit_pdf_doc' }
            ]]
          }
        }
      );
    } else {
      await ctx.reply('\\u2705 تم التعديل. لا تعديلات إضافية متاحة لهذا المستند.');
    }

  } catch (err) {
    try { await loadingState.stop(); } catch { /* silent */ }
    if (ctx.session.lastPdfMode === 'nizo_pro') {
      await User.findOneAndUpdate(
        { telegramId: ctx.from!.id },
        { $inc: { dailyQuota: 2 } }
      );
    }
    const e = err instanceof Error ? err : new Error(String(err));
    console.error('[ProEditConfirm] Error:', e.message);
    await ctx.reply('\\u26a0\\ufe0f حدث خطأ أثناء التعديل. تم إعادة نقاطك تلقائياً.');
  }
}
`;
  fs.writeFileSync(ewPath, ew + appendBlock, 'utf8');
  console.log('✅ handleProEditConfirm appended to editWorkflow.ts');
}

// ── FIX 6b: Wire up handleProEditConfirm in index.ts ──────────────────────────
const idxPath = 'src/index.ts';
let idx = fs.readFileSync(idxPath, 'utf8');

// 1. Add to import statement
const oldImport = "import { handleEditPdfDocCallback, handleEditPdfDocMessage, showProImageEditMenu, processAutoEditMessage, processProEditTextMessage, processProEditImageUpload } from './handlers/docmaker/editWorkflow';";
const newImport = "import { handleEditPdfDocCallback, handleEditPdfDocMessage, showProImageEditMenu, processAutoEditMessage, processProEditTextMessage, processProEditImageUpload, handleProEditConfirm } from './handlers/docmaker/editWorkflow';";

if (!idx.includes('handleProEditConfirm')) {
  if (!idx.includes(oldImport)) {
    console.error('ERROR: import line not found in index.ts — cannot patch import.');
    process.exit(1);
  }
  idx = idx.replace(oldImport, newImport);
  console.log('✅ Import patched in index.ts');
} else {
  console.log('handleProEditConfirm already imported — skipping import patch.');
}

// 2. Replace the broken pro_edit_confirm callback body
const oldConfirm = `registerDocCallback('pro_edit_confirm', 'pro_edit_confirm', async (ctx) => {
  await ctx.answerCallbackQuery().catch(() => {});
  ctx.session.editCount = (ctx.session.editCount ?? 0) + 1;
  ctx.session.workflowState = 'waiting_for_doc_edit';
  
  // Forward to handleEditPdfDocMessage passing the text as pseudo-message
  const pseudoCtx = Object.create(ctx);
  pseudoCtx.message = { text: ctx.session.proEditText || 'تطبيق تعديلات الصور فقط' };
  await handleEditPdfDocMessage(pseudoCtx);
});`;

const newConfirm = `registerDocCallback('pro_edit_confirm', 'pro_edit_confirm', async (ctx) => {
  await handleProEditConfirm(ctx);
});`;

if (idx.includes(oldConfirm)) {
  idx = idx.replace(oldConfirm, newConfirm);
  console.log('✅ pro_edit_confirm callback replaced in index.ts');
} else {
  console.log('⚠️  pro_edit_confirm old body not found verbatim — checking if already patched...');
  if (idx.includes('handleProEditConfirm(ctx)')) {
    console.log('   Already patched — skipping.');
  } else {
    console.error('ERROR: Cannot locate pro_edit_confirm body to replace. Manual fix required.');
    process.exit(1);
  }
}

fs.writeFileSync(idxPath, idx, 'utf8');
console.log('✅ index.ts saved.');
console.log('\nAll fixes applied. Running build next...');
