const fs = require('fs');

const file = 'src/services/channelFundService.ts';
let code = fs.readFileSync(file, 'utf8');

// STEP A
const oldClaimGuard = "    // Duplicate-claim guard for legacy records\n    if (user.fundedChannels.includes(channelId)) return 'ALREADY_CLAIMED';";
const newClaimGuard = `    // Duplicate-claim guard for legacy records
    if (user.fundedChannels.includes(channelId)) {
      try {
        const { InlineKeyboard } = await import('grammy');
        const campaignDoc = await FundCampaign.findOne({ channelId, isActive: true });
        const channelLink = campaignDoc?.channelLink || '#';
        const keyboard = new InlineKeyboard().url('📢 القناة', channelLink);
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
code = code.replace(oldClaimGuard, newClaimGuard);

// STEP B
const oldBroadcastLoop = `  for (const u of users) {
    try {
      const msg = await api.sendMessage(u.telegramId, message, {`;

const newBroadcastLoop = `  for (const u of users) {
    // Check if this user already claimed this channel before
    const existingClaim = await User.findOne({
      telegramId: u.telegramId,
      fundedChannels: campaign.channelId
    });

    if (existingClaim) {
      try {
        await api.sendMessage(
          u.telegramId,
          \`🌹 <b>عزيزي المستخدم</b>\\n\\n\` +
          \`في المرة السابقة استلمت نقاطاً مقابل انضمامك لهذه القناة.\\n\` +
          \`نعتذر منك، لا يمكن الحصول على المكافأة مرة أخرى 💙\`,
          { parse_mode: 'HTML' }
        );
      } catch {}
      failed++;
      continue;
    }

    try {
      const msg = await api.sendMessage(u.telegramId, message, {`;

code = code.replace(oldBroadcastLoop, newBroadcastLoop);

// STEP C
const oldDeletionBlock = `      const remaining = updatedCampaign.broadcastMessages.filter(m => !m.claimed);
      let autoDeleted = 0;
      let autoFailed = 0;
      for (const { userId: uid, messageId } of remaining) {
        try {
          await api.deleteMessage(uid, messageId);
          autoDeleted++;
        } catch (e) {
          autoFailed++;
        }
        // Rate limit: 100 messages per 10 seconds
        if ((autoDeleted + autoFailed) % 100 === 0) {
          await new Promise((r) => setTimeout(r, 10000));
        }
      }
      await FundCampaign.findByIdAndUpdate(campaignId, { isActive: false });`;

const newDeletionBlock = `      // First: disable campaign link immediately
      await FundCampaign.findByIdAndUpdate(campaignId, { isActive: false });

      // Then: delete messages gradually 3 per second
      const remaining = updatedCampaign.broadcastMessages.filter(m => !m.claimed);
      let deleteCount = 0;
      for (const { userId: uid, messageId } of remaining) {
        try {
          await api.deleteMessage(uid, messageId);
          deleteCount++;
        } catch (e) {}
        // Rate limit: 3 deletions per second
        if (deleteCount % 3 === 0) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }`;

code = code.replace(oldDeletionBlock, newDeletionBlock);

// STEP D
const handleMemberLeftStart = "export async function handleMemberLeft(";
const indexOfHandleMemberLeft = code.indexOf(handleMemberLeftStart);
if (indexOfHandleMemberLeft !== -1) {
  // Find the next helper function to replace just this function
  const extractChannelIdentifierIdx = code.indexOf("function extractChannelIdentifier(", indexOfHandleMemberLeft);
  
  const endSliceIdx = extractChannelIdentifierIdx !== -1 
      ? code.lastIndexOf("// ─── Internal Helpers", extractChannelIdentifierIdx) 
      : code.length;
      
  const newHandleMemberLeft = `export async function handleMemberLeft(
  userId: number,
  channelId: string,
  api: Api
): Promise<void> {
  const user = await User.findOne({ telegramId: userId });
  if (!user) return;

  // Only penalise if they had claimed this channel's reward
  if (!user.fundedChannels.includes(channelId)) return;

  // Atomic deduction — allows negative balance
  const updatedUser = await User.findOneAndUpdate(
    { telegramId: userId },
    {
      $inc: { dailyQuota: -5 },
      $pull: { fundedChannels: channelId },
      $set: { channelRewardClaimed: false }
    },
    { new: true }
  );

  if (!updatedUser) return;

  // Update campaign record
  const campaign = await FundCampaign.findOne({ channelId });
  if (campaign) {
    await FundCampaign.findOneAndUpdate(
      { _id: campaign._id },
      { $pull: { claimedUsers: userId } }
    );
  }

  const channelLink = campaign?.channelLink || '#';

  const { InlineKeyboard } = await import('grammy');
  const keyboard = new InlineKeyboard()
    .url('📢 انضم للقناة الآن', channelLink)
    .row()
    .text('🎁 تحقق واسترجع محاولاتي', \`claim_reward_\${channelId}\`);

  try {
    await api.sendMessage(
      userId,
      \`⚠️ <b>تنبيه هام</b>\\n\\n\` +
      \`لاحظنا أنك غادرت القناة التي حصلت من خلالها على مكافأة 🎁\\n\\n\` +
      \`تم خصم <b>5 محاولات</b> من رصيدك تلقائياً.\\n\` +
      \`رصيدك الحالي: <b>\${updatedUser.dailyQuota}</b>\\n\\n\` +
      \`للاسترداد: انضم للقناة مجدداً واضغط زر التحقق 👇\`,
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  } catch {}
}

`;
  
  code = code.slice(0, indexOfHandleMemberLeft) + newHandleMemberLeft + code.slice(endSliceIdx);
}

fs.writeFileSync(file, code);
console.log('Fixed channelFundService.ts');
