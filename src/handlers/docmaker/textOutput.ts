import { BotContext } from '../../utils/validators';

export function splitSafe(text: string, limit = 4096): string[] {
  const chunks: string[] = [];
  const paras = text.split(/\n\n+/);
  let cur = '';
  for (const p of paras) {
    const next = cur ? cur + '\n\n' + p : p;
    if (next.length > limit) {
      if (cur) chunks.push(cur.trim());
      // Single paragraph longer than limit: hard-split only as last resort
      if (p.length > limit) {
        for (let i = 0; i < p.length; i += limit) {
          chunks.push(p.slice(i, i + limit));
        }
        cur = '';
      } else {
        cur = p;
      }
    } else {
      cur = next;
    }
  }
  if (cur) chunks.push(cur.trim());
  return chunks;
}

export async function sendTextChunksWithEditButton(ctx: BotContext, generatedText: string): Promise<void> {
  if (!generatedText?.trim()) return;

  // ── Fix Edit Amnesia: always persist latest text before sending ──
  ctx.session.lastAiGeneratedText = generatedText;
  if (ctx.session.lastGeneratedDoc) {
    ctx.session.lastGeneratedDoc.text = generatedText;
  }

  const headerMsg =
    '📄 <b>تم تجهيز نص المستند بالكامل!</b>\n\n' +
    '👇 <i>اضغط الزر الأزرق لنسخ النص، أو الأخضر لتعديله.</i>';

  await ctx.reply(headerMsg, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          // @ts-ignore
          { text: '📋 نسخ النص', callback_data: 'copy_generated_text', style: 'primary' as const }
        ],
        [
          // @ts-ignore
          { text: 'تعديل ✏️', callback_data: 'edit_pdf_doc', style: 'success' as const }
        ]
      ]
    }
  });
}
