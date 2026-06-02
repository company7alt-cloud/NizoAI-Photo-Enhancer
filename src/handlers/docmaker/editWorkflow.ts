import { BotContext } from '../../utils/validators';
import { User } from '../../database/models/User';
import { showDynamicLoading } from '../../utils/loading';
import { generateAiPDF, generateAiPDFFromHtml, generateAiPDFAndHtml } from '../../services/aiPdfService';
import { sendTextChunksWithEditButton } from './textOutput';
import { InputFile } from 'grammy';
// We need to import OpenAI to do callAI for edits
import OpenAI from 'openai';

const aiClient = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY ?? '',
});

export async function handleEditPdfDocCallback(ctx: BotContext): Promise<void> {
  // ── Task 5: Route by PDF mode ──────────────────────────────────────────────
  const pdfMode = ctx.session?.lastPdfMode ?? 'free_auto';

  if (pdfMode === 'free_auto' || pdfMode === 'nizo_auto') {
    await ctx.answerCallbackQuery().catch(() => { });
    await handleAutoEdit(ctx);
    return;
  }

  if (pdfMode === 'free_pro' || pdfMode === 'nizo_pro') {
    await ctx.answerCallbackQuery().catch(() => { });
    await handleProEdit(ctx);
    return;
  }

  const originalText = ctx.session.lastAiGeneratedText || ctx.session.lastGeneratedDoc?.text;
  if (!originalText) {
    await ctx.answerCallbackQuery({
      text: '⚠️ انتهت صلاحية التعديل، أنشئ مستنداً جديداً',
      show_alert: true
    });
    return;
  }
  await ctx.answerCallbackQuery();
  ctx.session.awaitingEditRequest = true;
  ctx.session.workflowState = 'waiting_for_doc_edit'; // keep for backward compat

  await ctx.reply('✏️ أرسل التعديلات المطلوبة وسيتم تطبيقها على المستند:');
}

export async function handleEditPdfDocMessage(ctx: BotContext): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId || !ctx.message?.text) return;

  const user = await User.findOne({ telegramId: userId });
  if (!user) return;

  const originalText = ctx.session.lastAiGeneratedText || ctx.session.lastGeneratedDoc?.text;
  if (!originalText) {
    ctx.session.workflowState = null;
    ctx.session.awaitingEditRequest = false;
    return;
  }

  const pageCount = ctx.session.lastAiDocPages || ctx.session.lastGeneratedDoc?.pageCount || 1;
  const originalCost = ctx.session.lastGeneratedDoc?.originalCost || 0;
  const editCost = originalCost > 0 ? Math.ceil(originalCost / 2) : 1;

  if (user.dailyQuota < editCost) {
    await ctx.reply(`رصيدك (${user.dailyQuota}) غير كافٍ. تحتاج ${editCost} نقاط للتعديل.`);
    ctx.session.workflowState = null;
    return;
  }

  const loadingState = await showDynamicLoading(ctx, '✏️ جاري تطبيق التعديلات');
  // Atomic deduction
  await User.updateOne({ _id: user._id }, { $inc: { dailyQuota: -editCost } });

  try {
    const response = await aiClient.chat.completions.create({
      model: process.env.REPLICATE_AI_MODEL_ID || 'anthropic/claude-3-haiku',
      messages: [
        {
          role: 'system',
          content: `You are a silent document editor. You NEVER ask questions. You NEVER explain. You NEVER respond in English.
YOUR ONLY JOB: Apply the user's edit request directly to the original document and return the COMPLETE edited document — nothing else.

ABSOLUTE RULES:
1. OUTPUT ONLY: Return the full edited document in Arabic Markdown. No preamble, no explanation, no questions, no comments.
2. APPLY SILENTLY: Whatever the user asks — name change, image change, content change — just do it. No confirmation needed.
3. SAME STRUCTURE: Keep exact same formatting, headings, sections, and page count (${pageCount} pages).
4. ARABIC ONLY: The document must stay in Arabic. Never switch to English.
5. IMAGES: If user asks to change images, replace the relevant [IMAGE: old keyword] tags with [IMAGE: new English keyword] in the correct sections.
6. NEVER ask "Shall I proceed?", "Would you like?", or any question. Just output the edited document immediately.
7. No religious symbols or phrases anywhere.

ORIGINAL DOCUMENT TO EDIT:
${originalText}`
        },
        { role: 'user', content: ctx.message.text }
      ],
      temperature: 0.3,
    });

    const editedText = response.choices[0]?.message?.content ?? '';
    if (!editedText.trim()) throw new Error('AI returned empty content.');

    // Clean markdown blocks
    const cleanMarkdown = editedText.replace(/^```[a-z]*\n?/gm, '').replace(/```$/gm, '');

    await loadingState.stop();

    // Generate new PDF
    const pdfPath = await generateAiPDF(cleanMarkdown, ctx.session.aiDocStyle || 'default');

    await ctx.replyWithDocument(
      new InputFile(pdfPath, `NizoAI_Doc_Edited_${Date.now()}.pdf`),
      {
        caption: `✅ <b>تم تطبيق التعديلات بنجاح!</b>\n🎨 القالب: ${(ctx.session.aiDocStyle || 'default').toUpperCase()}`,
        parse_mode: 'HTML'
      }
    );

    // Send the chunks and edit button
    await sendTextChunksWithEditButton(ctx, cleanMarkdown);

    // Update session state
    ctx.session.lastGeneratedDoc = {
      text: cleanMarkdown,
      pageCount: pageCount,
      originalCost: editCost
    };
    ctx.session.lastAiGeneratedText = cleanMarkdown;
    ctx.session.awaitingEditRequest = false;
    ctx.session.workflowState = null;

  } catch (err: any) {
    try { await loadingState.stop(); } catch { }
    await User.updateOne({ _id: user._id }, { $inc: { dailyQuota: editCost } }); // refund
    console.error('[EditWorkflow] Error:', err?.message || err);
    const errMsg = err?.message || '';
    const userMsg = errMsg.includes('quota') || errMsg.includes('rate')
      ? '⚠️ الخدمة مشغولة الآن، حاول مرة أخرى بعد دقيقة. تم إعادة نقاطك.'
      : errMsg.includes('empty')
        ? '⚠️ النموذج لم يُرجع محتوى، حاول مرة أخرى. تم إعادة نقاطك.'
        : '⚠️ حدث خطأ أثناء التعديل. تم إعادة نقاطك تلقائياً.';
    await ctx.reply(userMsg);
    ctx.session.workflowState = null;
    ctx.session.awaitingEditRequest = false;
  }
}

// ── Task 6: Auto Mode Edit Handler ────────────────────────────────────────────
export async function handleAutoEdit(ctx: BotContext): Promise<void> {
  const user = await User.findOne({ telegramId: ctx.from!.id });
  const editCount = ctx.session.editCount ?? 0;

  if (editCount >= 1) {
    await ctx.reply(
      '⚠️ لقد استخدمت التعديل المتاح لهذا المستند.\n' +
      'يمكنك إنشاء مستند جديد للحصول على تعديل جديد.'
    );
    return;
  }

  if (ctx.session.lastPdfMode === 'nizo_auto') {
    if ((user?.dailyQuota ?? 0) < 2) {
      await ctx.reply('⚠️ رصيدك غير كافٍ. تحتاج 2 نقاط للتعديل.');
      return;
    }
  }

  // FIX Vulnerability 2: set flag BEFORE waiting for user input
  ctx.session.awaitingAutoEdit = true;
  await ctx.reply('✏️ أرسل التعديلات المطلوبة وسيتم تطبيقها على المستند:');
}

// ── Task 7: Pro Mode Edit Handler ─────────────────────────────────────────────
export async function handleProEdit(ctx: BotContext): Promise<void> {
  const editCount = ctx.session.editCount ?? 0;
  const maxEdits = 3;

  if (editCount >= maxEdits) {
    await ctx.reply('⚠️ لقد استخدمت جميع تعديلاتك الـ 3 لهذا المستند.');
    return;
  }

  if (ctx.session.lastPdfMode === 'nizo_pro') {
    const user = await User.findOne({ telegramId: ctx.from!.id });
    if ((user?.dailyQuota ?? 0) < 2) {
      await ctx.reply('⚠️ رصيدك غير كافٍ. تحتاج 2 نقاط للتعديل.');
      return;
    }
  }

  ctx.session.proEditText = null;
  ctx.session.proEditImages = {};
  ctx.session.proEditCurrentImgPage = null;
  ctx.session.awaitingProEditText = false;
  ctx.session.proEditMenuMessageId = undefined;

  // Task 8 Fix: Show ONE combined message with image buttons (no separate text step)
  await showProImageEditMenu(ctx);
}

// ── Task 8 Fix: showProImageEditMenu ───────────────────────────────────────────────
export async function showProImageEditMenu(ctx: BotContext): Promise<void> {
  const totalImages = ctx.session.lastImageCount ?? 0;
  const rows: any[] = [];

  if (totalImages > 0) {
    // One descriptive button per image, one per row
    for (let n = 1; n <= totalImages; n++) {
      const isDone = ctx.session.proEditImages?.[n] != null;
      rows.push([{
        text: isDone ? `✅ الصورة ${n} — تم الاستبدال` : `🖼️ استبدال الصورة ${n}`,
        callback_data: 'pro_edit_img_' + n,
        style: 'primary' as any
      }]);
    }
  }

  // Text-edit button always at top
  rows.unshift([{ text: '✏️ تعديل النص', callback_data: 'pro_edit_text', style: 'primary' as any }]);

  rows.push([{ text: 'موافق ✅', callback_data: 'pro_edit_confirm', style: 'success' as any }]);
  rows.push([{ text: 'إلغاء', callback_data: 'cancel', style: 'danger' as any }]);

  const editCount = ctx.session.editCount ?? 0;
  const remaining = 3 - editCount;
  const imageCount = ctx.session.lastImageCount ?? 0;
  const caption = '✏️ تعديل المستند\n\n' +
    '• اضغط "تعديل النص" لتعديل محتوى المستند\n' +
    (imageCount > 0
      ? '• اضغط رقم الصورة لاستبدالها (كل صف = صفحة)\n'
      : '') +
    '• اضغط موافق عند الانتهاء\n\n' +
    '📊 التعديلات المتبقية: ' + remaining + '/3';

  const sentMsg = await ctx.reply(caption, { reply_markup: { inline_keyboard: rows } });
  ctx.session.proEditMenuMessageId = sentMsg.message_id;
}

// ── Task 8: Message Handlers for Auto/Pro Edits ──────────────────────────────
export async function processAutoEditMessage(ctx: BotContext): Promise<void> {
  const userEditText = ctx.message?.text?.trim() ?? '';
  if (!userEditText) return;

  // ── Auto Edit Image Guard ─────────────────────────────────────────────
  function _detectImgKwAutoEdit(t: string): string[] {
    const kws = [
      'صورة','صور','صوره','صورتي','الصورة','الصور',
      'اضف صورة','ضف صورة','أضف صورة','ادرج صورة',
      'أدرج صورة','ارفق صورة','حط صورة','خلي فيه صورة',
      'ابغا صورة','مع صورة','فيه صورة','يحتوي صورة',
      'تضمين صورة','صور احترافية','صور توضيحية',
      'صور للمستند','صورة لكل','صور لكل','صورة في كل',
      'image','images','photo','photos','picture','pictures',
      'img','add image','with image','include image',
    ];
    const out: string[] = [];
    t.split('\n').forEach((line, i) => {
      const low = line.toLowerCase().trim();
      if (!low) return;
      const hits = Array.from(new Set(
        kws.filter(k => low.includes(k.toLowerCase()))
      ));
      if (hits.length) out.push(`• السطر ${i + 1}: [ ${hits.join('، ')} ]`);
    });
    return out;
  }
  const _autoEditIssues = _detectImgKwAutoEdit(userEditText);
  if (_autoEditIssues.length > 0) {
    ctx.session.awaitingAutoEdit = true;
    await ctx.reply(
      '⚠️ <b>تنبيه التعديل — تم رفض الطلب</b>\n\n' +
      'التعديل الذي أرسلته يحتوي على طلب صور في المواضع التالية:\n' +
      _autoEditIssues.join('\n') + '\n\n' +
      '✏️ هذا المستند (تلقائي) مخصص للنصوص فقط.\n\n' +
      '📌 <b>يرجى اتباع الخطوات التالية:</b>\n' +
      '١. احذف الكلمات المذكورة أعلاه من طلب التعديل\n' +
      '٢. أرسل التعديل مجدداً وسيتم تعديل الملف فوراً',
      { parse_mode: 'HTML' }
    );
    return;
  }
  // ─────────────────────────────────────────────────────────────────────

  // ── Free Mode Edit Amnesia fix: prefer dedicated free fields first ──
  const originalText = ctx.session.freeLastAiGeneratedText
    || ctx.session.lastAiGeneratedText
    || ctx.session.lastGeneratedDoc?.text
    || '';
  if (!originalText) {
    ctx.session.awaitingAutoEdit = false;
    await ctx.reply('⚠️ انتهت صلاحية التعديل، أنشئ مستنداً جديداً.');
    return;
  }

  const originalPageCount = ctx.session.freeLastAiDocPages
    || ctx.session.lastAiDocPages
    || ctx.session.lastGeneratedDoc?.pageCount
    || 1;

  const user = await User.findOne({ telegramId: ctx.from!.id });
  if (!user) return;

  ctx.session.awaitingAutoEdit = false;
  ctx.session.editCount = (ctx.session.editCount ?? 0) + 1;

  const loadingState = await showDynamicLoading(ctx, '✏️ جاري تطبيق التعديلات');

  try {
    const response = await aiClient.chat.completions.create({
      model: process.env.REPLICATE_AI_MODEL_ID || 'anthropic/claude-3-haiku',
      messages: [
        {
          role: 'system',
          content:
            'You are a silent document editor. Your ONLY job is to apply the user edit to the document below and return it COMPLETE.\n\n' +
            'ABSOLUTE RULES:\n' +
            '1. Return the FULL edited document in Arabic Markdown ONLY — no greetings, no explanations.\n' +
            `2. Keep EXACTLY ${ctx.session.freeLastAiDocPages || ctx.session.lastGeneratedDoc?.pageCount || ctx.session.lastAiDocPages || 1} page(s). Never add or remove pages.\n` +
            '3. Keep exact same structure and headings.\n' +
            '4. CRITICAL: NO images, NO [IMAGE:] tags — this is text-only auto mode.\n' +
            '5. Never ask questions. Never say "here is the document". Output document only.\n\n' +
            '══════════════════════════════════════\n' +
            'ORIGINAL DOCUMENT (apply edits to this):\n' +
            '══════════════════════════════════════\n' +
            originalText,
        },
        { role: 'user', content: userEditText },
      ],
      temperature: 0.3,
    });

    const editedText = response.choices[0]?.message?.content ?? '';
    if (!editedText.trim()) throw new Error('AI returned empty content.');

    const cleanMarkdown = editedText
      .replace(/^```[a-z]*\n?/gm, '')
      .replace(/```$/gm, '')
      .replace(/\[IMAGE:[^\]]*\]/gi, '');

    await loadingState.stop();

    // Count pages using ## headings (each ## = one page)
    const _h2Count = (cleanMarkdown.match(/^## /gm) ?? []).length;
    const newPageCount = _h2Count > 0 ? _h2Count : originalPageCount;

    // Fixed edit cost: always 1 point per edit, no page-based deduction
    const _editFixedCost = 1;
    if ((user.dailyQuota ?? 0) < _editFixedCost) {
      await ctx.reply(
        '⚠️ رصيدك غير كافٍ للتعديل. تحتاج نقطة واحدة.'
      );
      ctx.session.editCount = Math.max(0, ctx.session.editCount - 1);
      ctx.session.awaitingAutoEdit = true;
      return;
    }
    await User.updateOne({ _id: user._id }, { $inc: { dailyQuota: -_editFixedCost } });

    ctx.session.isAutoMode = true;
    const { generateAiPDF } = await import('../../services/aiPdfService');
    const pdfPath = await generateAiPDF(
      cleanMarkdown,
      ctx.session.aiDocStyle || 'default',
      true
    );
    ctx.session.isAutoMode = false;

    ctx.session.lastPageCount = newPageCount;
    ctx.session.lastAiDocPages = newPageCount;
    ctx.session.lastAiGeneratedText = cleanMarkdown;
    ctx.session.lastGeneratedDoc = {
      text: cleanMarkdown,
      pageCount: newPageCount,
      originalCost: ctx.session.lastGeneratedDoc?.originalCost ?? 0,
    };

    await ctx.replyWithDocument(
      new InputFile(pdfPath, `NizoAI_Doc_Edited_${Date.now()}.pdf`),
      {
        caption:
          `✅ <b>تم تطبيق التعديلات بنجاح!</b>\n` +
          `📄 عدد الصفحات: ${newPageCount}`,
        parse_mode: 'HTML',
      }
    );

    // ── Persist updated text BEFORE sending chunks (Edit Amnesia fix) ──
    ctx.session.lastAiGeneratedText = cleanMarkdown;
    ctx.session.lastAiDocPages = newPageCount;
    ctx.session.lastGeneratedDoc = {
      text: cleanMarkdown,
      pageCount: newPageCount,
      originalCost: ctx.session.lastGeneratedDoc?.originalCost ?? 0,
    };

    const { sendTextChunksWithEditButton } = await import('./textOutput');
    await sendTextChunksWithEditButton(ctx, cleanMarkdown);

  } catch (err: any) {
    try { await loadingState.stop(); } catch { }
    ctx.session.editCount = Math.max(0, ctx.session.editCount - 1);
    ctx.session.isAutoMode = false;
    console.error('[AutoEdit] Error:', err?.message || err);
    await ctx.reply('⚠️ حدث خطأ أثناء التعديل. يمكنك المحاولة مرة أخرى.');
    ctx.session.awaitingAutoEdit = true;
  }
}

export async function processProEditTextMessage(ctx: BotContext): Promise<void> {
  const text = ctx.message?.text;
  if (!text) return;

  ctx.session.awaitingProEditText = false;
  ctx.session.proEditText = text;

  await ctx.reply('✅ تم استلام التعديلات النصية.');
  await showProImageEditMenu(ctx);
}

export async function processProEditImageUpload(ctx: BotContext): Promise<boolean> {
  if (ctx.session.proEditCurrentImgPage == null) return false;

  let fileId: string | undefined;
  if (ctx.message?.photo) {
    fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
  } else if (ctx.message?.document && ctx.message.document.mime_type?.startsWith('image/')) {
    fileId = ctx.message.document.file_id;
  }

  if (!fileId) return false;

  const page = ctx.session.proEditCurrentImgPage;

  // BUG 1 FIX: save file_id directly (no download needed at capture time)
  if (!ctx.session.proEditImages) ctx.session.proEditImages = {};
  ctx.session.proEditImages[page] = fileId;
  ctx.session.proEditCurrentImgPage = null; // Clear lock

  // BUG 1 FIX: Edit the original buttons message in-place to show ✅ on button N
  const menuMsgId = ctx.session.proEditMenuMessageId;
  if (menuMsgId && ctx.chat?.id) {
    try {
      const updatedRows = buildProEditRows(ctx);
      await ctx.api.editMessageReplyMarkup(
        ctx.chat!.id,
        menuMsgId,
        { reply_markup: { inline_keyboard: updatedRows } }
      ).catch(() => { }); // Never crash if edit fails
    } catch (_) { /* silent */ }
  }

  await ctx.reply('✅ صورة ' + page + ' جاهزة');
  return true;
}


// ── FIX 6: Proper pro_edit_confirm handler ────────────────────────────────────
export async function handleProEditConfirm(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => { });

  const editCount = ctx.session.editCount ?? 0;
  if (editCount >= 3) {
    await ctx.reply('\u26a0\ufe0f استخدمت جميع تعديلاتك الـ 3 لهذا المستند.');
    return;
  }

  const hasTextEdit = !!(ctx.session.proEditText?.trim());
  const hasImageEdit = Object.keys(ctx.session.proEditImages ?? {}).length > 0;

  if (!hasTextEdit && !hasImageEdit) {
    await ctx.reply('\u26a0\ufe0f لم تقم بأي تعديل. اضغط رقم صورة أو عدّل النص أولاً.');
    return;
  }

  // Deduct 2 points for nizo_pro edits
  if (ctx.session.lastPdfMode === 'nizo_pro') {
    const u = await User.findOne({ telegramId: ctx.from!.id });
    if ((u?.dailyQuota ?? 0) < 2) {
      await ctx.reply('\u26a0\ufe0f رصيدك غير كافٍ. تحتاج 2 نقاط للتعديل.');
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
    await ctx.reply('\u26a0\ufe0f انتهت صلاحية التعديل، أنشئ مستنداً جديداً.');
    return;
  }

  const pageCount = ctx.session.lastAiDocPages || ctx.session.lastGeneratedDoc?.pageCount || 1;
  const loadingState = await showDynamicLoading(ctx, '\u270f\ufe0f جاري تطبيق التعديلات');

  const finalPrompt =
    (ctx.session.lastOriginalPrompt ?? '') +
    '\n\n════ طلب التعديل من العميل ════\n' +
    (hasTextEdit ? (ctx.session.proEditText ?? 'لا توجد تعديلات نصية') : 'طبّق تعديلات الصور المحددة فقط') +
    '\n══════════════════════════════\n\n' +
    '⚠️ أوامر صارمة جداً للتعديل (CRITICAL INSTRUCTIONS):\n' +
    '1. يجب عليك إعادة كتابة المستند بالكامل من البداية للنهاية مع تطبيق التعديل المطلوب فقط.\n' +
    '2. إياك أن تختصر النص أو تكتب عبارات مثل "الباقي كما هو". أريد المستند كاملاً.\n' +
    '3. يجب أن تعيد جميع علامات الصور [IMAGE: Keyword] في أماكنها الصحيحة تماماً كما كانت في النص الأصلي، لكي لا يختل التصميم.\n' +
    '4. أعطني المستند النهائي كاملاً الآن.';

  try {
    const response = await aiClient.chat.completions.create({
      model: process.env.REPLICATE_AI_MODEL_ID || 'anthropic/claude-3-haiku',
      messages: [
        {
          role: 'system',
          content: `You are a silent document editor. Apply the user's edits and return the COMPLETE edited document in Arabic Markdown only. Keep exact same structure and page count (${pageCount} pages). No explanations.\n\nORIGINAL DOCUMENT:\n${originalText}`
        },
        {
          role: 'user',
          content: finalPrompt
        }
      ],
      temperature: 0.3,
    });

    const editedText = response.choices[0]?.message?.content ?? '';
    if (!editedText.trim()) throw new Error('AI returned empty content.');

    const cleanMarkdown = editedText.replace(/^```[a-z]*\n?/gm, '').replace(/```$/gm, '');
    await loadingState.stop();

    const pdfPath = await generateAiPDF(cleanMarkdown, ctx.session.aiDocStyle || 'default');
    await ctx.replyWithDocument(
      new InputFile(pdfPath, `NizoAI_Doc_Edited_${Date.now()}.pdf`),
      {
        caption: `\u2705 <b>تم تطبيق التعديلات بنجاح!</b>\n\ud83c\udfa8 القالب: ${(ctx.session.aiDocStyle || 'default').toUpperCase()}`,
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
        `\u2705 تم التعديل (${ctx.session.editCount}/3)\nمتبقي: ${remaining} تعديلات`,
        {
          reply_markup: {
            inline_keyboard: [[
              { text: `\u270f\ufe0f تعديل (${remaining} متبقية)`, callback_data: 'edit_pdf_doc' }
            ]]
          }
        }
      );
    } else {
      await ctx.reply('\u2705 تم التعديل. لا تعديلات إضافية متاحة لهذا المستند.');
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
    await ctx.reply('\u26a0\ufe0f حدث خطأ أثناء التعديل. تم إعادة نقاطك تلقائياً.');
  }
}

// ── BUG 3 + BUG 4: handleProEditConfirmV2 ────────────────────────────────────
// BUG 4: No 3-edit limit. Each confirm costs: free_pro→3 dailyQuota, nizo_pro→2 dailyQuota
// BUG 3: Image-only edits skip AI — replace img tags in stored HTML directly
export async function handleProEditConfirmV2(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => { });

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
  if (!hasTextEdit && hasImageEdit) {
    const loadingState = await showDynamicLoading(ctx, '🖼️ جاري استبدال الصور');
    try {
      // If no cached HTML, regenerate it first
      let editedHtml = storedHtml;
      if (!editedHtml) {
        const originalMd = ctx.session.lastAiGeneratedText || ctx.session.lastGeneratedDoc?.text || '';
        if (!originalMd) {
          await ctx.reply('⚠️ انتهت صلاحية التعديل، أنشئ مستنداً جديداً.');
          return;
        }
        const { html: freshHtml } = await generateAiPDFAndHtml(originalMd, ctx.session.aiDocStyle || 'default');
        editedHtml = freshHtml;
      }
      // BUG 2 FIX: use replaceImagesInHtml (1-based index, proper mime detection)
      editedHtml = await replaceImagesInHtml(editedHtml, ctx.session.proEditImages ?? {}, ctx);

      await loadingState.stop();
      const pdfPath = await generateAiPDFFromHtml(editedHtml);

      // BUG 3: Success message with text preview
      const textPreview = (ctx.session.lastGeneratedText ?? '')
        .replace(/#{1,6}\s/g, '')
        .replace(/\*\*/g, '')
        .trim()
        .substring(0, 800);

      await ctx.replyWithDocument(
        new InputFile(pdfPath, `NizoAI_Doc_Edited_${Date.now()}.pdf`),
        {
          caption:
            textPreview +
            '\n\n---\n### إعداد الطالب\n' +
            (ctx.from?.first_name ?? 'المستخدم'),
          reply_markup: {
            inline_keyboard: [[
              // @ts-ignore
              { text: '✏️ تعديل', callback_data: 'edit_pdf_doc', style: 'success' as any }
            ]]
          }
        }
      );

      // Update stored HTML and reset edit state
      ctx.session.lastGeneratedHtml = editedHtml;
      ctx.session.proEditText = null;
      ctx.session.proEditImages = {};
      ctx.session.proEditCurrentImgPage = null;
      ctx.session.awaitingProEditText = false;

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

  const finalPrompt =
    (ctx.session.lastOriginalPrompt ?? '') +
    '\n\n════ طلب التعديل من العميل ════\n' +
    (ctx.session.proEditText ?? 'لا توجد تعديلات نصية') +
    '\n══════════════════════════════\n\n' +
    '⚠️ أوامر صارمة جداً للتعديل (CRITICAL INSTRUCTIONS):\n' +
    '1. يجب عليك إعادة كتابة المستند بالكامل من البداية للنهاية مع تطبيق التعديل المطلوب فقط.\n' +
    '2. إياك أن تختصر النص أو تكتب عبارات مثل "الباقي كما هو". أريد المستند كاملاً.\n' +
    '3. يجب أن تعيد جميع علامات الصور [IMAGE: Keyword] في أماكنها الصحيحة تماماً كما كانت في النص الأصلي، لكي لا يختل التصميم.\n' +
    '4. أعطني المستند النهائي كاملاً الآن.';

  try {
    const response = await aiClient.chat.completions.create({
      model: process.env.REPLICATE_AI_MODEL_ID || 'anthropic/claude-3-haiku',
      messages: [
        {
          role: 'system',
          content: `You are a silent document editor. Apply the user's edits and return the COMPLETE edited document in Arabic Markdown only. Keep exact same structure and page count (${pageCount} pages). No explanations.\n\nORIGINAL DOCUMENT:\n${originalText}`
        },
        { role: 'user', content: finalPrompt }
      ],
      temperature: 0.3,
    });

    // ── FIX 2: Unified Image Engine ────────────────────────────────────

    // ── STEP 1: Get AI-edited markdown ───────────────────────────────────────────
    const editedText = response.choices[0]?.message?.content ?? '';
    if (!editedText.trim()) throw new Error('AI returned empty content.');
    const cleanMarkdown = editedText.replace(/^```[a-z]*\n?/gm, '').replace(/```$/gm, '');
    await loadingState.stop();

    // ── STEP 2: Build fresh HTML (Unsplash images are a side-effect we will override) ─
    const { html: freshHtml } = await generateAiPDFAndHtml(
      cleanMarkdown,
      ctx.session.aiDocStyle || 'default'
    );

    // ── STEP 3: Snapshot original image srcs from cached HTML ────────────────────
    const originalHtml = ctx.session.lastGeneratedHtml ?? '';
    const originalSrcs = [...originalHtml.matchAll(/<img[^>]+src="([^"]+)"/ig)].map(m => m[1]);

    // ── STEP 4: Replace every <img> in freshHtml with a numbered placeholder ────────
    let imgCounter = 0;
    const unsplashSrcs: string[] = [];
    let patchedHtml = freshHtml.replace(/<img[^>]+src="([^"]+)"[^>]*>/ig, (_match, src) => {
      unsplashSrcs.push(src as string);
      imgCounter++;
      return `|||IMG_SLOT_${imgCounter}|||`;
    });

    // ── STEP 5: Resolve each slot — priority: user upload > original > Unsplash ─────
    await ctx.reply('⏳ جاري دمج الصور وتجهيز المستند...');
    const botToken = process.env.DOC_BOT_TOKEN || process.env.BOT_TOKEN || '';

    for (let slot = 1; slot <= imgCounter; slot++) {
      const customFileId = ctx.session.proEditImages?.[slot];
      let finalSrc = '';

      if (customFileId) {
        // A) User uploaded a custom replacement for this slot
        try {
          const fileInfoRes = await fetch(
            `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(customFileId)}`,
            { signal: AbortSignal.timeout(10000) }
          );
          if (fileInfoRes.ok) {
            const fileInfoData = await fileInfoRes.json() as { ok: boolean; result?: { file_path?: string } };
            const filePath = fileInfoData.result?.file_path;
            if (filePath) {
              const fileRes = await fetch(
                `https://api.telegram.org/file/bot${botToken}/${filePath}`,
                { signal: AbortSignal.timeout(15000) }
              );
              if (fileRes.ok) {
                const base64 = Buffer.from(await fileRes.arrayBuffer()).toString('base64');
                const mime = filePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
                finalSrc = `data:${mime};base64,${base64}`;
              }
            }
          }
        } catch (e) {
          console.error('[UnifiedEngine] slot', slot, 'custom fetch failed, using original:', e);
          finalSrc = originalSrcs[slot - 1] || unsplashSrcs[slot - 1] || '';
        }
      } else {
        // B) No replacement — restore original; fallback to Unsplash if AI added new slot
        finalSrc = originalSrcs[slot - 1] || unsplashSrcs[slot - 1] || '';
      }

      // FIX 3: object-fit:contain prevents stretching
      const imgTag = finalSrc
        ? `<img src="${finalSrc}" style="width:100%; max-height:400px; object-fit:contain; border-radius:8px; margin:15px auto; display:block;" alt="صورة ${slot}" />`
        : '';

      patchedHtml = patchedHtml.replace(`|||IMG_SLOT_${slot}|||`, imgTag);
    }

    // ── STEP 6: Render final PDF from fully patched HTML ───────────────────────
    const finalPdfPath = await generateAiPDFFromHtml(patchedHtml);

    // ── STEP 7: Persist new state ─────────────────────────────────────────────────
    ctx.session.lastGeneratedHtml = patchedHtml;
    ctx.session.lastAiGeneratedText = cleanMarkdown;
    ctx.session.lastGeneratedDoc = { text: cleanMarkdown, pageCount, originalCost: 0 };
    ctx.session.lastImageCount = imgCounter; // sync button count with actual rendered images
    ctx.session.lastGeneratedText = cleanMarkdown;
    ctx.session.proEditText = null;
    ctx.session.proEditImages = {};
    ctx.session.proEditCurrentImgPage = null;
    ctx.session.awaitingProEditText = false;

    // ── STEP 8: Send PDF to user ───────────────────────────────────────────────
    const textPreview = cleanMarkdown
      .replace(/#{1,6}\s/g, '')
      .replace(/\*\*/g, '')
      .trim()
      .substring(0, 800);

    await ctx.replyWithDocument(
      new InputFile(finalPdfPath, `NizoAI_Doc_Edited_${Date.now()}.pdf`),
      {
        caption: textPreview + '\n\n---\n### إعداد الطالب\n' + (ctx.from?.first_name ?? 'المستخدم'),
        reply_markup: {
          inline_keyboard: [[
            // @ts-ignore
            { text: '✏️ تعديل', callback_data: 'edit_pdf_doc', style: 'success' as any }
          ]]
        }
      }
    );

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

// ── FIX 1: buildProEditRows — one descriptive button per row ─────────────────
function buildProEditRows(ctx: BotContext): any[][] {
  const rows: any[][] = [];

  rows.push([{
    text: '✏️ تعديل النص',
    callback_data: 'pro_edit_text',
    style: 'primary' as any
  }]);

  const imageCount = ctx.session.lastImageCount ?? 0;

  for (let i = 1; i <= imageCount; i++) {
    const isDone = ctx.session.proEditImages?.[i] != null;
    rows.push([{
      text: isDone ? `✅ الصورة ${i} — تم الاستبدال` : `🖼️ استبدال الصورة ${i}`,
      callback_data: `pro_edit_img_${i}`,
      style: 'primary' as any
    }]);
  }

  rows.push([{ text: '✅ موافق — تطبيق التعديلات', callback_data: 'pro_edit_confirm', style: 'success' as any }]);
  rows.push([{ text: '❌ إلغاء', callback_data: 'cancel', style: 'danger' as any }]);
  return rows;
}

// ── BUG 2: replaceImagesInHtml — replaces <img> src with Telegram user uploads ─
async function replaceImagesInHtml(
  html: string,
  editImages: Record<number, string>,
  _ctx: BotContext
): Promise<string> {
  let result = html;
  const matches = [...html.matchAll(/(<img[^>]+src=")([^"]*)("|[^>]*>)/g)];
  let imgIndex = 1;

  for (const match of matches) {
    const fileId = editImages[imgIndex];
    if (fileId) {
      try {
        const botToken = process.env.DOC_BOT_TOKEN || process.env.BOT_TOKEN || '';
        const fileInfoRes = await fetch(
          `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`,
          { signal: AbortSignal.timeout(10000) }
        );
        if (fileInfoRes.ok) {
          const fileInfoData = await fileInfoRes.json() as { ok: boolean; result?: { file_path?: string } };
          const filePath = fileInfoData.result?.file_path;
          if (filePath) {
            const fileRes = await fetch(
              `https://api.telegram.org/file/bot${botToken}/${filePath}`,
              { signal: AbortSignal.timeout(15000) }
            );
            if (fileRes.ok) {
              const base64 = Buffer.from(await fileRes.arrayBuffer()).toString('base64');
              const ext = filePath.split('.').pop() ?? 'jpeg';
              const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
              const dataUri = `data:${mime};base64,${base64}`;
              result = result.replace(match[0], match[0].replace(match[2], dataUri));
            }
          }
        }
      } catch (e) {
        console.error('[replaceImagesInHtml] Image replacement error:', imgIndex, e);
      }
    }
    imgIndex++;
  }
  return result;
}
