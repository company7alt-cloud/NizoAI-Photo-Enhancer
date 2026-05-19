import { InputFile, type Context } from 'grammy';

type ReplyWithPhotoOptions = NonNullable<Parameters<Context['replyWithPhoto']>[1]>;
type ReplyOptions = NonNullable<Parameters<Context['reply']>[1]>;

export type SafeReplyWithPhotoOptions = ReplyWithPhotoOptions & { caption: string };

export async function safeReplyWithPhoto(
  ctx: Context,
  imagePath: string,
  options: SafeReplyWithPhotoOptions
): Promise<void> {
  try {
    await ctx.replyWithPhoto(new InputFile(imagePath), options);
  } catch (imgError: unknown) {
    console.warn(`[AssetGuard] Missing asset: ${imagePath} — falling back to text.`, imgError);
    const { caption, ...replyOptions } = options;
    await ctx.reply(caption, replyOptions as ReplyOptions);
  }
}
