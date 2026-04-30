// src/services/channelFundService.ts
import { Api } from 'grammy';
import { User } from '../database/models/User';
import { FundCampaign } from '../database/models/FundCampaign';
import { isAdmin } from '../utils/validators';

// ─── Core Debt-Aware Wallet Function ──────────────────────────────────────────
// This is the ONLY function allowed to modify user.dailyQuota for reward/penalty
// operations. It allows the balance to go negative (debt state).

export async function addAttemptsWithDebtCheck(
  userId: number,
  amount: number
): Promise<number> {
  const user = await User.findOne({ telegramId: userId });
  if (!user) throw new Error(`[ChannelFund] User ${userId} not found`);

  const newBalance = user.dailyQuota + amount;
  user.dailyQuota = newBalance;
  await user.save();
  return newBalance;
}

// ─── Campaign Setup Flow State Machine ────────────────────────────────────────

type FundStep = 'awaiting_link' | 'awaiting_target';

interface FundState {
  step: FundStep;
  channelId?: string;
  channelLink?: string;
}

const fundState = new Map<number, FundState>();

export function isFundCampaignPending(adminId: number): boolean {
  return fundState.has(adminId);
}

export function startFundCampaignSetup(adminId: number): void {
  fundState.set(adminId, { step: 'awaiting_link' });
}

export async function handleFundCampaignInput(
  adminId: number,
  text: string,
  api: Api
): Promise<
  | { status: 'ask_target'; channelId: string }
  | { status: 'not_admin_in_channel' }
  | { status: 'done'; campaign: InstanceType<typeof FundCampaign> }
  | { status: 'invalid_target' }
> {
  const state = fundState.get(adminId);
  if (!state) return { status: 'invalid_target' };

  if (state.step === 'awaiting_link') {
    const channelIdentifier = extractChannelIdentifier(text.trim());

    // Verify bot is admin in this channel
    let channelId: string;
    try {
      const chat = await api.getChat(channelIdentifier);
      channelId = String(chat.id);
      const me = await api.getMe();
      const botMember = await api.getChatMember(chat.id, me.id);
      const adminStatuses = ['administrator', 'creator'];
      if (!adminStatuses.includes(botMember.status)) {
        fundState.delete(adminId);
        return { status: 'not_admin_in_channel' };
      }
    } catch {
      fundState.delete(adminId);
      return { status: 'not_admin_in_channel' };
    }

    fundState.set(adminId, {
      step: 'awaiting_target',
      channelId,
      channelLink: formatChannelUrl(text),
    });
    return { status: 'ask_target', channelId };
  }

  if (state.step === 'awaiting_target' && state.channelId && state.channelLink) {
    const target = parseInt(text.trim(), 10);
    if (isNaN(target) || target <= 0) {
      return { status: 'invalid_target' };
    }

    fundState.delete(adminId);

    const campaign = await FundCampaign.create({
      channelId: state.channelId,
      channelLink: state.channelLink,
      targetMembers: target,
      createdBy: adminId,
      isActive: true,
      createdAt: new Date(),
    });

    return { status: 'done', campaign };
  }

  return { status: 'invalid_target' };
}

export function clearFundCampaignState(adminId: number): void {
  fundState.delete(adminId);
}

// ─── Broadcast Campaign to All Non-Banned Users ───────────────────────────────

export async function broadcastFundCampaign(
  api: Api,
  campaign: InstanceType<typeof FundCampaign>
): Promise<{ sent: number; failed: number }> {
  const users = await User.find({ isBanned: false }).select('telegramId').lean();
  let sent = 0;
  let failed = 0;

  const message =
    `🎁 *عرض حصري من NizoAI Bot!*\n\n` +
    `انضم إلى القناة التالية واحصل على *5 محاولات مجانية* لتحسين الصور:\n\n` +
    `📢 ${campaign.channelLink}\n\n` +
    `بعد الانضمام اضغط الزر أدناه للحصول على مكافأتك ✨`;

  const { InlineKeyboard } = await import('grammy');
  const keyboard = new InlineKeyboard()
    .url('📢 انضم للقناة الآن', campaign.channelLink)
    .row()
    .text('🎁 تحقق واحصل على مكافأتي', `claim_reward_${campaign.channelId}`);

  const broadcastMessages: { userId: number; messageId: number; claimed: boolean }[] = [];

  for (const u of users) {
    try {
      const msg = await api.sendMessage(u.telegramId, message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      broadcastMessages.push({ userId: u.telegramId, messageId: msg.message_id, claimed: false });
      sent++;
    } catch {
      failed++;
    }
    // Rate-limit: 25 messages per second ceiling
    if ((sent + failed) % 25 === 0) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  campaign.broadcastMessages = broadcastMessages;
  await campaign.save();

  return { sent, failed };
}

// ─── User Reward Claim ────────────────────────────────────────────────────────

export async function claimChannelReward(
  userId: number,
  channelId: string,
  api: Api
): Promise<'REWARDED' | 'ALREADY_CLAIMED' | 'NOT_MEMBER' | 'ADMIN_BLOCKED' | 'NO_CAMPAIGN' | 'PROCESSING'> {
  // Admin cannot claim their own campaign
  if (isAdmin(userId)) return 'ADMIN_BLOCKED';

  // STEP 1 — Acquire lock atomically. If already processing, reject immediately:
  const locked = await User.findOneAndUpdate(
    { telegramId: userId, isProcessingClaim: { $ne: true } },
    { $set: { isProcessingClaim: true } },
    { new: true }
  );

  if (!locked) {
    return 'PROCESSING';
  }

  try {
    // Verify membership via Telegram API
    try {
      const member = await api.getChatMember(channelId, userId);
      const validStatuses = ['member', 'administrator', 'creator'];
      if (!validStatuses.includes(member.status)) return 'NOT_MEMBER';
    } catch {
      return 'NOT_MEMBER';
    }

    const campaign = await FundCampaign.findOne({ channelId, isActive: true });
    if (!campaign) return 'NO_CAMPAIGN';

    const user = await User.findOne({ telegramId: userId });
    if (!user) return 'NOT_MEMBER';

    // Duplicate-claim guard for legacy records
    if (user.fundedChannels.includes(channelId)) return 'ALREADY_CLAIMED';

    // ATOMIC CAMPAIGN UPDATE (Scarcity + Anti-Spam)
    const campaignId = campaign._id;
    const maxTarget = campaign.targetMembers;

    const updatedCampaign = await FundCampaign.findOneAndUpdate(
      {
        _id: campaignId,
        claimCounter: { $lt: maxTarget },
        claimedUsers: { $ne: userId },
        isActive: true
      },
      {
        $inc: { claimCounter: 1 },
        $push: { claimedUsers: userId },
        $set: { "broadcastMessages.$[elem].claimed": true }
      },
      {
        arrayFilters: [{ "elem.userId": userId }],
        new: true
      }
    );

    if (!updatedCampaign) {
      const checkCampaign = await FundCampaign.findById(campaignId);
      if (checkCampaign?.claimedUsers.includes(userId)) return 'ALREADY_CLAIMED';
      return 'NO_CAMPAIGN';
    }

    // Grant reward to user
    await User.findOneAndUpdate(
      { telegramId: userId },
      {
        $inc: { dailyQuota: 5 },
        $push: { fundedChannels: channelId },
        $set: { channelRewardClaimed: true }
      }
    );

    // After successful claim, check if campaign is now full
    if (updatedCampaign.claimCounter >= updatedCampaign.targetMembers) {
      const remaining = updatedCampaign.broadcastMessages.filter(m => !m.claimed);
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
      await FundCampaign.findByIdAndUpdate(campaignId, { isActive: false });
    }

    return 'REWARDED';

  } finally {
    // ALWAYS release the lock, even if an error occurred
    await User.findOneAndUpdate(
      { telegramId: userId },
      { $set: { isProcessingClaim: false } }
    );
  }
}

// ─── Leave / Kick Penalty ─────────────────────────────────────────────────────

export async function handleMemberLeft(
  userId: number,
  channelId: string,
  api: Api
): Promise<void> {
  const user = await User.findOne({ telegramId: userId });
  if (!user) return;

  // Only penalise if they had claimed this channel's reward
  if (!user.fundedChannels.includes(channelId)) return;

  // Deduct 5 atomically, allowing negative balances. Also reset claim tracking.
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
    .text('🎁 تحقق واسترجع محاولاتي', `claim_reward_${channelId}`);

  try {
    await api.sendMessage(
      userId,
      "⚠️ تم خصم 5 محاولات بسبب مغادرتك القناة. رصيدك الحالي انخفض.\n\nللتعويض واسترجاع محاولاتك، انضم للقناة مجدداً من الزر أدناه ثم اضغط على زر التحقق 👇",
      { reply_markup: keyboard }
    );
  } catch {
    // Silent — never disrupt the user's pending interactions
  }
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function extractChannelIdentifier(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith('https://t.me/') && !trimmed.includes('+')) {
    return '@' + trimmed.replace('https://t.me/', '').split('/')[0];
  }
  if (trimmed.startsWith('t.me/') && !trimmed.includes('+')) {
    return '@' + trimmed.replace('t.me/', '').split('/')[0];
  }
  return trimmed;
}

function formatChannelUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith('@')) {
    return `https://t.me/${trimmed.substring(1)}`;
  }
  if (!trimmed.startsWith('http')) {
    return `https://t.me/${trimmed}`;
  }
  return trimmed;
}
