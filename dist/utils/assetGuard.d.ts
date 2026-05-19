import { type Context } from 'grammy';
type ReplyWithPhotoOptions = NonNullable<Parameters<Context['replyWithPhoto']>[1]>;
export type SafeReplyWithPhotoOptions = ReplyWithPhotoOptions & {
    caption: string;
};
export declare function safeReplyWithPhoto(ctx: Context, imagePath: string, options: SafeReplyWithPhotoOptions): Promise<void>;
export {};
