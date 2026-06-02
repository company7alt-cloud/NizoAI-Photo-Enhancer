"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitSafe = splitSafe;
exports.sendTextChunksWithEditButton = sendTextChunksWithEditButton;
function splitSafe(text, limit = 4096) {
    const chunks = [];
    const paras = text.split(/\n\n+/);
    let cur = '';
    for (const p of paras) {
        const next = cur ? cur + '\n\n' + p : p;
        if (next.length > limit) {
            if (cur)
                chunks.push(cur.trim());
            // Single paragraph longer than limit: hard-split only as last resort
            if (p.length > limit) {
                for (let i = 0; i < p.length; i += limit) {
                    chunks.push(p.slice(i, i + limit));
                }
                cur = '';
            }
            else {
                cur = p;
            }
        }
        else {
            cur = next;
        }
    }
    if (cur)
        chunks.push(cur.trim());
    return chunks;
}
async function sendTextChunksWithEditButton(ctx, generatedText) {
    if (!generatedText?.trim())
        return;
    // ── Fix Edit Amnesia: always persist latest text before sending ──
    ctx.session.lastAiGeneratedText = generatedText;
    if (ctx.session.lastGeneratedDoc) {
        ctx.session.lastGeneratedDoc.text = generatedText;
    }
    const headerMsg = '📄 <b>تم تجهيز نص المستند بالكامل!</b>\n\n' +
        '👇 <i>اضغط على الزر الأزرق لنسخ النص كاملاً، أو الأخضر لتعديله.</i>';
    // Telegram allows up to ~4096 chars per copy_text button. Safe slice just in case.
    const safeTextToCopy = generatedText.length > 4000 ? generatedText.slice(0, 4000) : generatedText;
    await ctx.reply(headerMsg, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [
                    // @ts-ignore - Using standard Telegram copy_text API feature
                    { text: '📋 نسخ النص بالكامل', copy_text: { text: safeTextToCopy }, style: 'primary' }
                ],
                [
                    // @ts-ignore
                    { text: 'تعديل ✏️', callback_data: 'edit_pdf_doc', style: 'success' }
                ]
            ]
        }
    });
}
//# sourceMappingURL=textOutput.js.map