"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.showDynamicLoading = showDynamicLoading;
async function showDynamicLoading(ctx, baseText) {
    let msgId = null;
    let iid = null;
    let n = 1;
    // stop() is idempotent — safe to call multiple times
    const stop = async () => {
        if (iid) {
            clearInterval(iid);
            iid = null;
        }
        if (msgId && ctx.chat) {
            await ctx.api.deleteMessage(ctx.chat.id, msgId).catch(() => { });
            msgId = null;
        }
    };
    try {
        const m = await ctx.reply(`${baseText} .`);
        msgId = m.message_id;
        if (ctx.chat) {
            const chatId = ctx.chat.id;
            ctx.api.sendChatAction(chatId, 'upload_document').catch(() => { });
            iid = setInterval(() => {
                n = (n % 3) + 1;
                ctx.api
                    .editMessageText(chatId, msgId, `${baseText} ${'.'.repeat(n)}`)
                    .catch(() => { });
            }, 800);
        }
    }
    catch {
        // If initial reply fails, clear any partial state and return no-op
        if (iid) {
            clearInterval(iid);
            iid = null;
        }
        return { stop: async () => { } };
    }
    return { stop };
}
//# sourceMappingURL=loading.js.map