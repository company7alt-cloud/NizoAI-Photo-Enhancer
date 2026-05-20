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
  if (!ctx.session.lastGeneratedDoc) {
    await ctx.answerCallbackQuery({
      text: 'انتهت صلاحية التعديل. أنشئ مستنداً جديداً أولاً.',
      show_alert: true
    });
    return;
  }
  const editCost = Math.ceil(ctx.session.lastGeneratedDoc.originalCost / 2);
  
  await ctx.reply(
    `✏️ أرسل التعديلات المطلوبة على النص.\n\n` +
    `💳 سيُخصم ${editCost} نقاط عند التنفيذ.\n\n` +
    `⚠️ لا يمكن زيادة عدد الصفحات في هذه المرحلة.`
  );
  
  ctx.session.workflowState = 'waiting_for_doc_edit';
  await ctx.answerCallbackQuery();
}

export async function handleEditPdfDocMessage(ctx: BotContext): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId || !ctx.message?.text) return;

  const user = await User.findOne({ telegramId: userId });
  if (!user) return;

  if (!ctx.session.lastGeneratedDoc) {
    ctx.session.workflowState = null;
    return;
  }

  const { text: originalText, pageCount, originalCost } = ctx.session.lastGeneratedDoc;
  const editCost = Math.ceil(originalCost / 2);

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
          content: `You are a professional document editor.
ABSOLUTE RULES — no exceptions under any circumstances:
1. DO NOT add new pages. Document MUST stay exactly ${pageCount} page(s).
2. DO NOT add new major sections not present in the original.
3. If the user's message asks to ADD pages or increase document length —
   IGNORE that part silently. Apply all other edits and nothing more.
4. Apply requested changes seamlessly, preserving formatting and style.
5. No religious symbols or phrases anywhere in the document.

ORIGINAL DOCUMENT:
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
    ctx.session.workflowState = null;

  } catch (err: any) {
    await loadingState.stop();
    await User.updateOne({ _id: user._id }, { $inc: { dailyQuota: editCost } }); // refund
    await ctx.reply("حدث خطأ أثناء التعديل. تم إعادة نقاطك تلقائياً.");
    ctx.session.workflowState = null;
  }
}
