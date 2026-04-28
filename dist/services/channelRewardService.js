"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkAndReward = checkAndReward;
exports.checkChannelMembership = checkChannelMembership;
exports.applyDebtOnQuotaAdd = applyDebtOnQuotaAdd;
const User_1 = require("../database/models/User");
const CHANNEL_ID = -1002052563302;
const REWARD_AMOUNT = 5;
const PENALTY_AMOUNT = 5;
const MIN_STAY_DAYS = 3;
// Replace with your actual channel invite link
const CHANNEL_LINK = 'https://t.me/+your_channel_link';
async function checkAndReward(api, userId) {
    const user = await User_1.User.findOne({ telegramId: userId });
    if (!user)
        return 'USER_NOT_FOUND';
    // Check if already claimed
    if (user.channelRewardClaimed) {
        return 'ALREADY_CLAIMED';
    }
    // Check if user is member of channel
    try {
        const member = await api.getChatMember(CHANNEL_ID, userId);
        const validStatuses = ['member', 'administrator', 'creator'];
        if (!validStatuses.includes(member.status)) {
            return 'NOT_MEMBER';
        }
        // User is member — give reward
        user.channelRewardClaimed = true;
        user.channelJoinDate = new Date();
        // Apply debt first if exists
        if (user.quotaDebt > 0) {
            const debtToPay = Math.min(user.quotaDebt, REWARD_AMOUNT);
            user.quotaDebt -= debtToPay;
            user.dailyQuota += (REWARD_AMOUNT - debtToPay);
        }
        else {
            user.dailyQuota += REWARD_AMOUNT;
        }
        await user.save();
        return 'REWARDED';
    }
    catch (err) {
        console.error(`[ChannelReward] getChatMember error for ${userId}:`, err);
        return 'NOT_MEMBER';
    }
}
async function checkChannelMembership(api) {
    const rewardedUsers = await User_1.User.find({
        channelRewardClaimed: true,
        channelJoinDate: { $ne: null },
    });
    for (const user of rewardedUsers) {
        try {
            const member = await api.getChatMember(CHANNEL_ID, user.telegramId);
            const leftStatuses = ['left', 'kicked'];
            if (leftStatuses.includes(member.status)) {
                const joinDate = new Date(user.channelJoinDate);
                const daysSinceJoin = (Date.now() - joinDate.getTime()) / (1000 * 60 * 60 * 24);
                if (daysSinceJoin < MIN_STAY_DAYS) {
                    const currentQuota = user.dailyQuota;
                    if (currentQuota >= PENALTY_AMOUNT) {
                        user.dailyQuota -= PENALTY_AMOUNT;
                        user.quotaDebt = 0;
                        user.channelRewardClaimed = false;
                        user.channelJoinDate = null;
                        await user.save();
                        await api.sendMessage(user.telegramId, `⚠️ تم خصم ${PENALTY_AMOUNT} محاولات من رصيدك 😔\n` +
                            `📊 رصيدك الحالي: ${user.dailyQuota} محاولة\n\n` +
                            `السبب: غادرت القناة قبل مرور 3 أيام على انضمامك 💔\n\n` +
                            `🔗 أعد الانضمام لاسترجاع محاولاتك:\n` +
                            `👉 ${CHANNEL_LINK}\n\n` +
                            `بعد الانضمام اضغط /verify لاسترجاع محاولاتك ✨`);
                    }
                    else {
                        const debt = PENALTY_AMOUNT - currentQuota;
                        user.quotaDebt = debt;
                        user.dailyQuota = 0;
                        user.channelRewardClaimed = false;
                        user.channelJoinDate = null;
                        await user.save();
                        await api.sendMessage(user.telegramId, `⚠️ تم خصم ${currentQuota} محاولة من رصيدك 😔\n` +
                            `📊 رصيدك الحالي: 0 محاولة\n` +
                            `💳 الرصيد المتبقي عليك: ${debt} محاولات\n\n` +
                            `السبب: غادرت القناة قبل مرور 3 أيام 💔\n` +
                            `بمجرد إضافة محاولات لك سيتم خصم ${debt} تلقائياً 🔒\n\n` +
                            `🔗 أعد الانضمام لاسترجاع الوضع الطبيعي:\n` +
                            `👉 ${CHANNEL_LINK}\n\n` +
                            `بعد الانضمام اضغط /verify ✨`);
                    }
                }
            }
        }
        catch (err) {
            console.error(`[ChannelReward] Error checking user ${user.telegramId}:`, err);
        }
    }
}
function applyDebtOnQuotaAdd(user, amountToAdd) {
    if (user.quotaDebt > 0) {
        if (amountToAdd >= user.quotaDebt) {
            const debtPaid = user.quotaDebt;
            const finalAmount = amountToAdd - debtPaid;
            user.quotaDebt = 0;
            user.dailyQuota += finalAmount;
            return { finalAmount, debtPaid };
        }
        else {
            user.quotaDebt -= amountToAdd;
            return { finalAmount: 0, debtPaid: amountToAdd };
        }
    }
    user.dailyQuota += amountToAdd;
    return { finalAmount: amountToAdd, debtPaid: 0 };
}
//# sourceMappingURL=channelRewardService.js.map