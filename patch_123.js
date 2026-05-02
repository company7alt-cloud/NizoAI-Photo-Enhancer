const fs = require('fs');

// 1. imageHandler.ts
const imgFile = 'src/bot/handlers/imageHandler.ts';
let imgCode = fs.readFileSync(imgFile, 'utf8');
const autoResetOld = `    if (
      !admin &&
      (!user.lastQuotaReset ||
        Date.now() - new Date(user.lastQuotaReset).getTime() > 24 * 60 * 60 * 1000)
    ) {
      user.dailyQuota += 5;
      if (user.dailyQuota > 5) user.dailyQuota = 5;
      user.lastQuotaReset = new Date();
      await user.save();
    }`;
if (imgCode.includes(autoResetOld)) {
  imgCode = imgCode.replace(autoResetOld, "");
  fs.writeFileSync(imgFile, imgCode);
  console.log("Fixed imageHandler.ts");
} else {
  console.log("Could not find auto-reset block in imageHandler.ts");
}

// 2. start.ts
const startFile = 'src/bot/commands/start.ts';
if (fs.existsSync(startFile)) {
  let startCode = fs.readFileSync(startFile, 'utf8');
  const notifyOld = `  if (isNew) {
    const notifyOnJoin = (await Settings.get('notify_on_join')) as boolean;
    const alertChannelRaw = process.env.ALERT_CHANNEL_ID?.trim();
    if (notifyOnJoin === true && !alertChannelRaw) {
      const adminIds = (process.env.ADMIN_IDS ?? '')
        .split(',')
        .map((id) => parseInt(id.trim(), 10))
        .filter((id) => !isNaN(id));
      const notif = \`👤 *عضو جديد!*\\nالاسم: \${firstName}\\nالآيدي: \\\`\${telegramId}\\\`\`;
      for (const aid of adminIds) {
        ctx.api.sendMessage(aid, notif, { parse_mode: 'Markdown' }).catch(() => {});
      }
    }
  }`;
  if (startCode.includes(notifyOld)) {
    startCode = startCode.replace(notifyOld, "");
    fs.writeFileSync(startFile, startCode);
    console.log("Fixed start.ts");
  } else {
    console.log("Could not find notifyOld in start.ts");
  }
}

// 3. User.ts
const userFile = 'src/database/models/User.ts';
let userCode = fs.readFileSync(userFile, 'utf8');
userCode = userCode.replace("  batchConversionFiles?: string[];\n", "");
userCode = userCode.replace("  awaitingBatchConversion?: boolean;\n", "");
userCode = userCode.replace("    batchConversionFiles: { type: [String], default: [] },\n", "");
userCode = userCode.replace("    awaitingBatchConversion: { type: Boolean, default: false },\n", "");
fs.writeFileSync(userFile, userCode);
console.log("Fixed User.ts");
