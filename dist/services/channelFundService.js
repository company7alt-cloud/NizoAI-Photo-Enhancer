"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.addAttemptsWithDebtCheck = addAttemptsWithDebtCheck;
exports.isFundCampaignPending = isFundCampaignPending;
exports.startFundCampaignSetup = startFundCampaignSetup;
exports.handleFundCampaignInput = handleFundCampaignInput;
exports.clearFundCampaignState = clearFundCampaignState;
exports.broadcastFundCampaign = broadcastFundCampaign;
exports.claimChannelReward = claimChannelReward;
exports.handleMemberLeft = handleMemberLeft;
const User_1 = require("../database/models/User");
const FundCampaign_1 = require("../database/models/FundCampaign");
const validators_1 = require("../utils/validators");
// ─── Core Debt-Aware Wallet Function ──────────────────────────────────────────
// This is the ONLY function allowed to modify user.dailyQuota for reward/penalty
// operations. It allows the balance to go negative (debt state).
async function addAttemptsWithDebtCheck(userId, amount) {
    const user = await User_1.User.findOne({ telegramId: userId });
    if (!user)
        throw new Error(`[ChannelFund] User ${userId} not found`);
    const newBalance = user.dailyQuota + amount;
    user.dailyQuota = newBalance;
    await user.save();
    return newBalance;
}
const fundState = new Map();
function isFundCampaignPending(adminId) {
    return fundState.has(adminId);
}
function startFundCampaignSetup(adminId) {
    fundState.set(adminId, { step: 'awaiting_link' });
}
async function handleFundCampaignInput(adminId, text, api) {
    const state = fundState.get(adminId);
    if (!state)
        return { status: 'invalid_target' };
    if (state.step === 'awaiting_link') {
        const channelIdentifier = extractChannelIdentifier(text.trim());
        // Verify bot is admin in this channel
        let channelId;
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
        }
        catch {
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
        const campaign = await FundCampaign_1.FundCampaign.create({
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
function clearFundCampaignState(adminId) {
    fundState.delete(adminId);
}
// ─── Broadcast Campaign to All Non-Banned Users ───────────────────────────────
async function broadcastFundCampaign(api, campaign) {
    const users = await User_1.User.find({ isBanned: false }).select('telegramId').lean();
    let sent = 0;
    let failed = 0;
    const message = `🎁 *عرض حصري من NizoAI Bot!*\n\n` +
        `انضم إلى القناة التالية واحصل على *5 محاولات مجانية* لتحسين الصور:\n\n` +
        `📢 ${campaign.channelLink}\n\n` +
        `بعد الانضمام اضغط الزر أدناه للحصول على مكافأتك ✨`;
    const { InlineKeyboard } = await Promise.resolve().then(() => __importStar(require('grammy')));
    const keyboard = new InlineKeyboard()
        .url('📢 انضم للقناة الآن', campaign.channelLink)
        .row()
        .text('🎁 تحقق واحصل على مكافأتي', `claim_reward_${campaign.channelId}`);
    const broadcastMessages = [];
    for (const u of users) {
        try {
            const msg = await api.sendMessage(u.telegramId, message, {
                parse_mode: 'Markdown',
                reply_markup: keyboard,
            });
            broadcastMessages.push({ userId: u.telegramId, messageId: msg.message_id, claimed: false });
            sent++;
        }
        catch {
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
async function claimChannelReward(userId, channelId, api) {
    // Admin cannot claim their own campaign
    if ((0, validators_1.isAdmin)(userId))
        return 'ADMIN_BLOCKED';
    // STEP 1 — Acquire lock atomically. If already processing, reject immediately:
    const locked = await User_1.User.findOneAndUpdate({ telegramId: userId, isProcessingClaim: { $ne: true } }, { $set: { isProcessingClaim: true } }, { new: true });
    if (!locked) {
        return 'PROCESSING';
    }
    try {
        // Verify membership via Telegram API
        try {
            const member = await api.getChatMember(channelId, userId);
            const validStatuses = ['member', 'administrator', 'creator'];
            if (!validStatuses.includes(member.status))
                return 'NOT_MEMBER';
        }
        catch {
            return 'NOT_MEMBER';
        }
        const campaign = await FundCampaign_1.FundCampaign.findOne({ channelId, isActive: true });
        if (!campaign)
            return 'NO_CAMPAIGN';
        const user = await User_1.User.findOne({ telegramId: userId });
        if (!user)
            return 'NOT_MEMBER';
        // Duplicate-claim guard for legacy records
        if (user.fundedChannels.includes(channelId))
            return 'ALREADY_CLAIMED';
        // ATOMIC CAMPAIGN UPDATE (Scarcity + Anti-Spam)
        const campaignId = campaign._id;
        const maxTarget = campaign.targetMembers;
        const updatedCampaign = await FundCampaign_1.FundCampaign.findOneAndUpdate({
            _id: campaignId,
            claimCounter: { $lt: maxTarget },
            claimedUsers: { $ne: userId },
            isActive: true
        }, {
            $inc: { claimCounter: 1 },
            $push: { claimedUsers: userId },
            $set: { "broadcastMessages.$[elem].claimed": true }
        }, {
            arrayFilters: [{ "elem.userId": userId }],
            new: true
        });
        if (!updatedCampaign) {
            const checkCampaign = await FundCampaign_1.FundCampaign.findById(campaignId);
            if (checkCampaign?.claimedUsers.includes(userId))
                return 'ALREADY_CLAIMED';
            return 'NO_CAMPAIGN';
        }
        // Grant reward to user
        await User_1.User.findOneAndUpdate({ telegramId: userId }, {
            $inc: { dailyQuota: 5 },
            $push: { fundedChannels: channelId },
            $set: { channelRewardClaimed: true }
        });
        // After successful claim, check if campaign is now full
        if (updatedCampaign.claimCounter >= updatedCampaign.targetMembers) {
            const remaining = updatedCampaign.broadcastMessages.filter(m => !m.claimed);
            for (const { userId: uid, messageId } of remaining) {
                try {
                    await api.deleteMessage(uid, messageId);
                }
                catch (e) {
                    // Ignore: user blocked bot or deleted the chat
                }
            }
            await FundCampaign_1.FundCampaign.findByIdAndUpdate(campaignId, { isActive: false });
        }
        return 'REWARDED';
    }
    finally {
        // ALWAYS release the lock, even if an error occurred
        await User_1.User.findOneAndUpdate({ telegramId: userId }, { $set: { isProcessingClaim: false } });
    }
}
// ─── Leave / Kick Penalty ─────────────────────────────────────────────────────
async function handleMemberLeft(userId, channelId, api) {
    const user = await User_1.User.findOne({ telegramId: userId });
    if (!user)
        return;
    // Only penalise if they had claimed this channel's reward
    if (!user.fundedChannels.includes(channelId))
        return;
    // Deduct 5 atomically, allowing negative balances. Also reset claim tracking.
    const updatedUser = await User_1.User.findOneAndUpdate({ telegramId: userId }, {
        $inc: { dailyQuota: -5 },
        $pull: { fundedChannels: channelId },
        $set: { channelRewardClaimed: false }
    }, { new: true });
    if (!updatedUser)
        return;
    const campaign = await FundCampaign_1.FundCampaign.findOne({ channelId });
    if (campaign) {
        await FundCampaign_1.FundCampaign.findOneAndUpdate({ _id: campaign._id }, { $pull: { claimedUsers: userId } });
    }
    const channelLink = campaign?.channelLink || '#';
    const { InlineKeyboard } = await Promise.resolve().then(() => __importStar(require('grammy')));
    const keyboard = new InlineKeyboard()
        .url('📢 انضم للقناة الآن', channelLink)
        .row()
        .text('🎁 تحقق واسترجع محاولاتي', `claim_reward_${channelId}`);
    try {
        await api.sendMessage(userId, "⚠️ تم خصم 5 محاولات بسبب مغادرتك القناة. رصيدك الحالي انخفض.\n\nللتعويض واسترجاع محاولاتك، انضم للقناة مجدداً من الزر أدناه ثم اضغط على زر التحقق 👇", { reply_markup: keyboard });
    }
    catch {
        // Silent — never disrupt the user's pending interactions
    }
}
// ─── Internal Helpers ─────────────────────────────────────────────────────────
function extractChannelIdentifier(input) {
    // https://t.me/channelname  → @channelname
    if (input.startsWith('https://t.me/') && !input.includes('+')) {
        return '@' + input.replace('https://t.me/', '').split('/')[0];
    }
    // @channelname or numeric ID — pass through
    return input;
}
//# sourceMappingURL=channelFundService.js.map