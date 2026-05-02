const fs = require('fs');
const file = 'src/services/channelFundService.ts';
let code = fs.readFileSync(file, 'utf8');

// STEP A: claimChannelReward
const oldClaimCheck = "  if (user.fundedChannels.includes(channelId)) return 'ALREADY_CLAIMED';";
const newClaimCheck = `  // Check if user previously claimed this channel reward
  if (user.fundedChannels.includes(channelId)) {
    // Send a polite notification to user
    try {
      const { InlineKeyboard } = await import('grammy');
      const campaign = await FundCampaign.findOne({ channelId, isActive: true });
      const channelLink = campaign?.channelLink || '#';
      const keyboard = new InlineKeyboard()
        .url('📢 القناة', channelLink);
      await (api as any).sendMessage(
        userId,
        \`🌹 <b>عزيزي المستخدم</b>\\n\\n\` +
        \`لقد استلمت مكافأتك مسبقاً عند انضمامك لهذه القناة.\\n\` +
        \`نعتذر منك، لا يمكن استلام المكافأة مرة أخرى 💙\`,
        { parse_mode: 'HTML', reply_markup: keyboard }
      );
    } catch {}
    return 'ALREADY_CLAIMED';
  }`;
code = code.replace(oldClaimCheck, newClaimCheck);

// STEP B: broadcastFundCampaign (existing claim check)
// Find the loop where users are notified.
// usually it looks like `for (const u of activeUsers) { ... try { await api.sendMessage(...)`
// I need to find the right place to insert this.
// Let me look for the exact loop by reading the file.
