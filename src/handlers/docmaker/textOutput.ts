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
    '👇 <i>المس النص أدناه لنسخه فوراً.</i>';

  // Send text in <pre> block — Telegram renders it as tap-to-copy monospace
  const escaped = generatedText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  await ctx.reply(`${headerMsg}\n\n<pre>${escaped}</pre>`, { parse_mode: 'HTML' });

  // Edit button in a separate message so it always appears below the text
  await ctx.reply('✏️ هل تريد تعديل المستند؟', {
    reply_markup: {
      inline_keyboard: [[
        // @ts-ignore
        { text: 'تعديل ✏️', callback_data: 'edit_pdf_doc', style: 'success' as const }
      ]]
    }
  });
}
