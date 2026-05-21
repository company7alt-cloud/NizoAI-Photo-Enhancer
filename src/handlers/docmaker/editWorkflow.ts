import { BotContext } from '../../utils/validators';
import { User } from '../../database/models/User';
import { showDynamicLoading } from '../../utils/loading';
import { generateAiPDF } from '../../services/aiPdfService';
import { sendTextChunksWithEditButton } from './textOutput';
import { InputFile } from 'grammy';
// We need to import OpenAI to do callAI for edits
import OpenAI from 'openai';

const aiClient = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY ?? '',
});

export async function handleEditPdfDocCallback(ctx: BotContext): Promise<void> {
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
    try { await loadingState.stop(); } catch {}
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
