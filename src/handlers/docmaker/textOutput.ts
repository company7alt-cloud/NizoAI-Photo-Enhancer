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

  // ── Escape HTML only — keep markdown symbols so user gets full text ──
  const escaped = generatedText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const headerMsg =
    '📄 <b>تم تجهيز نص المستند بالكامل!</b>\n' +
    '👆 <i>المس النص أدناه لنسخه فوراً</i>';

  const MAX_PRE = 3500;

  if (escaped.length <= MAX_PRE) {
    // ── Single message: header + pre block + edit button ──
    await ctx.reply(
      headerMsg + '\n\n<pre>' + escaped + '</pre>',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '✏️ تعديل النص', callback_data: 'edit_pdf_doc' }
          ]]
        }
      }
    );
  } else {
    // ── Split into chunks preserving pre blocks ──
    const chunks: string[] = [];
    let remaining = escaped;
    while (remaining.length > 0) {
      chunks.push(remaining.slice(0, MAX_PRE));
      remaining = remaining.slice(MAX_PRE);
    }

    // First chunk with header
    await ctx.reply(
      headerMsg + '\n\n<pre>' + chunks[0] + '</pre>',
      { parse_mode: 'HTML' }
    );

    // Middle chunks
    for (let i = 1; i < chunks.length - 1; i++) {
      await ctx.reply(
        '<pre>' + chunks[i] + '</pre>',
        { parse_mode: 'HTML' }
      );
    }

    // Last chunk with edit button
    await ctx.reply(
      '<pre>' + chunks[chunks.length - 1] + '</pre>',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '✏️ تعديل النص', callback_data: 'edit_pdf_doc' }
          ]]
        }
      }
    );
  }
}
