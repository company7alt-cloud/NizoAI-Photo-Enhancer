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
  const chunks = splitSafe(generatedText);
  if (chunks.length === 0) return;

  for (let i = 0; i < chunks.length - 1; i++) {
    await ctx.reply(chunks[i], { parse_mode: 'Markdown' });
  }

  const lastChunk = chunks[chunks.length - 1];
  
  try {
    await ctx.reply(lastChunk, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          // @ts-ignore
          { text: 'تعديل ✏️', callback_data: 'edit_pdf_doc', style: 'success' }
        ]]
      }
    });
  } catch (err: any) {
    // If grammY still throws even with @ts-ignore, fallback to raw Bot API
    if (ctx.chat) {
      await ctx.api.raw.sendMessage({
        chat_id: ctx.chat.id,
        text: lastChunk,
        parse_mode: 'Markdown',
        reply_markup: JSON.stringify({
          inline_keyboard: [[
            { text: 'تعديل ✏️', callback_data: 'edit_pdf_doc', style: 'success' }
          ]]
        }) as any
      });
    }
  }
}
