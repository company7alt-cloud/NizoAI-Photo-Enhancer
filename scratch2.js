const fs = require('fs');
let code = fs.readFileSync('src/index.ts', 'utf8');

const vipLogic = `
    if (inputType === 'grant_vip_id') {
      const targetUser = await User.findOne({ telegramId: inputText.trim() });
      if (!targetUser) {
        await ctx.reply('❌ لم يتم العثور على مستخدم بهذا الـ ID.');
        return;
      }
      await User.findOneAndUpdate({ telegramId: targetUser.telegramId }, { $set: { canBypassLocks: true } });
      await ctx.reply(\`✅ <b>تم التفعيل!</b>\\nالمستخدم (<code>\${targetUser.telegramId}</code>) يستطيع الآن استخدام صانع المستندات وجميع الميزات المقفلة 🌟\`, { parse_mode: 'HTML' });
      try {
        await ctx.api.sendMessage(targetUser.telegramId, '🌟 <b>تم ترقية حسابك (VIP)</b>\\n\\nتم فتح جميع الميزات المقفلة لك بما فيها صانع المستندات! 😎', { parse_mode: 'HTML' });
      } catch (e) {}
      return;
    }
  }
`;

code = code.replace("    if (inputType === 'vip_size_bypass') {", vipLogic.trim() + "\n    if (inputType === 'vip_size_bypass') {");

fs.writeFileSync('src/index.ts', code);
