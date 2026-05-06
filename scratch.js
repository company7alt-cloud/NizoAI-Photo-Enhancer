const fs = require('fs');
let code = fs.readFileSync('src/bot/handlers/callbackHandler.ts', 'utf8');

const kb1 = "[{ text: `${l.btn_eraser ? '🔴 مقفل' : '🟢 مفتوح'} — ✨ مُزيل العلامات المائية`, callback_data: 'atoggle_btn_eraser' }],";
const add1 = `
        [{ text: \`\${l.btn_doc_maker ? '🔴 مقفل' : '🟢 مفتوح'} — 📝 صانع المستندات\`, callback_data: 'atoggle_btn_doc_maker' }],
        [{ text: '🔑 سماح لشخص باستخدام الميزات المقفلة', callback_data: 'admin_grant_vip' }],`;

code = code.replace(kb1, kb1 + add1);
code = code.replace(kb1, kb1 + add1);

const vipLogic = `
  if (data === 'admin_grant_vip' && isAdminUser) {
    await ctx.answerCallbackQuery().catch(() => {});
    await User.findOneAndUpdate(
      { telegramId: ctx.from.id.toString() },
      { $set: { adminAwaitingInput: 'grant_vip_id', adminTargetUserId: null } }
    );
    await ctx.reply('🔑 <b>تجاوز أقفال الميزات</b>\\n\\nأرسل الـ ID الخاص بالمستخدم الذي تريد منحه صلاحية تجاوز الإغلاق:', { parse_mode: 'HTML' });
    return;
  }
`;

code = code.replace("  if (data.startsWith('atoggle_') && isAdminUser) {", vipLogic + "\n  if (data.startsWith('atoggle_') && isAdminUser) {");

fs.writeFileSync('src/bot/handlers/callbackHandler.ts', code);
