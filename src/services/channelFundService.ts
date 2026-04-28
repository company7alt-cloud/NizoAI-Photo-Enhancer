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
      channelLink: text.trim(),
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
  const keyboard = new InlineKeyboard().text(
    '🎁 احصل على مكافأتي',
    `claim_reward_${campaign.channelId}`
  );

  for (const u of users) {
    try {
      await api.sendMessage(u.telegramId, message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      sent++;
    } catch {
      failed++;
    }
    // Rate-limit: 25 messages per second ceiling
    if ((sent + failed) % 25 === 0) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  return { sent, failed };
}

// ─── User Reward Claim ────────────────────────────────────────────────────────

export async function claimChannelReward(
  userId: number,
  channelId: string,
  api: Api
): Promise<'REWARDED' | 'ALREADY_CLAIMED' | 'NOT_MEMBER' | 'ADMIN_BLOCKED' | 'NO_CAMPAIGN'> {
  // Admin cannot claim their own campaign
  if (isAdmin(userId)) return 'ADMIN_BLOCKED';

  const campaign = await FundCampaign.findOne({ channelId, isActive: true });
  if (!campaign) return 'NO_CAMPAIGN';

  const user = await User.findOne({ telegramId: userId });
  if (!user) return 'NOT_MEMBER';

  // Duplicate-claim guard
  if (user.fundedChannels.includes(channelId)) return 'ALREADY_CLAIMED';

  // Verify membership via Telegram API
  try {
    const member = await api.getChatMember(channelId, userId);
    const validStatuses = ['member', 'administrator', 'creator'];
    if (!validStatuses.includes(member.status)) return 'NOT_MEMBER';
  } catch {
    return 'NOT_MEMBER';
  }

  // Add 5 attempts (debt-aware) and mark channel as claimed
  await addAttemptsWithDebtCheck(userId, 5);
  user.fundedChannels.push(channelId);
  await user.save();

  return 'REWARDED';
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

  // Deduct 5 via the shared wallet function (balance can go negative)
  const newBalance = await addAttemptsWithDebtCheck(userId, -5);

  // Remove channel from claimed list so they can reclaim if they rejoin
  user.fundedChannels = user.fundedChannels.filter((id) => id !== channelId);
  await user.save();

  try {
    if (newBalance >= 0) {
      await api.sendMessage(
        userId,
        `⚠️ تم خصم 5 محاولات بسبب مغادرتك القناة.\n` +
          `📊 رصيدك الحالي: ${newBalance} محاولة\n\n` +
          `انضم مجدداً لاستردادها 🔄`
      );
    } else {
      await api.sendMessage(
        userId,
        `⚠️ رصيدك الحالي: ${newBalance} (دين متراكم).\n` +
          `سيتم خصم الدين من مكافآتك القادمة تلقائياً 🔒`
      );
    }
  } catch {
    // Silent — never disrupt the user's pending interactions
  }
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function extractChannelIdentifier(input: string): string {
  // https://t.me/channelname  → @channelname
  if (input.startsWith('https://t.me/') && !input.includes('+')) {
    return '@' + input.replace('https://t.me/', '').split('/')[0];
  }
  // @channelname or numeric ID — pass through
  return input;
}
