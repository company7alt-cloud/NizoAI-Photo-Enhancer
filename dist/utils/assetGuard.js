"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeReplyWithPhoto = safeReplyWithPhoto;
const grammy_1 = require("grammy");
async function safeReplyWithPhoto(ctx, imagePath, options) {
    try {
        await ctx.replyWithPhoto(new grammy_1.InputFile(imagePath), options);
    }
    catch (imgError) {
        console.warn(`[AssetGuard] Missing asset: ${imagePath} — falling back to text.`, imgError);
        const { caption, ...replyOptions } = options;
        await ctx.reply(caption, replyOptions);
    }
}
//# sourceMappingURL=assetGuard.js.map