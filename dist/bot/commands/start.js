"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startCommand = startCommand;
exports.verifyCommand = verifyCommand;
// src/bot/commands/start.ts
const User_1 = require("../../database/models/User");
const Settings_1 = require("../../database/models/Settings");
const grammy_1 = require("grammy");
const validators_1 = require("../../utils/validators");
const channelRewardService_1 = require("../../services/channelRewardService");
async function startCommand(ctx) {
    const telegramId = ctx.from.id;
    const firstName = ctx.from.first_name ?? 'User';
    const username = ctx.from.username;
    const language = ctx.from.language_code ?? 'en';
    const payload = ctx.match;
    try {
        // 1. Identify Referrer
        const referrerId = (0, validators_1.parseStartPayload)(payload);
        // 2. Check if user is 100% NEW (not in DB)
        const existingUser = await User_1.User.findOne({ telegramId });
        const isActuallyNew = !existingUser;
        // 3. Find or Create User
        const { user, isNew } = await User_1.User.findOrCreate({
            telegramId,
            firstName,
            username,
            language,
            dailyQuota: isActuallyNew ? 5 : existingUser.dailyQuota,
            lastQuotaReset: isActuallyNew ? new Date() : existingUser.lastQuotaReset,
        });
        // 4. Handle Referral Reward (The Law)
        if (isActuallyNew && referrerId && referrerId !== telegramId) {
            const referrer = await User_1.User.findOne({ telegramId: referrerId });
            if (referrer && !referrer.isBanned && !referrer.referredUsers.includes(telegramId)) {
                referrer.referralCount += 1;
                referrer.referredUsers.push(telegramId);
                await referrer.save();
                try {
                    await ctx.api.sendMessage(referrerId, `🎉 *مبروك!* انضم صديق جديد عبر رابطك!`, { parse_mode: 'Markdown' });
                }
                catch (e) { }
            }
        }
        // 5. Admin notification for join
        if (isNew) {
            const notifyOnJoin = (await Settings_1.Settings.get('notify_on_join'));
            if (notifyOnJoin === true) {
                const adminIdsStr = process.env.ADMIN_IDS || '';
                const adminIds = adminIdsStr
                    .split(',')
                    .map((id) => parseInt(id.trim(), 10))
                    .filter((id) => !isNaN(id));
                const notif = `👤 *عضو جديد!*\nالاسم: ${firstName}\nالآيدي: \`${telegramId}\``;
                for (const aid of adminIds) {
                    ctx.api.sendMessage(aid, notif, { parse_mode: 'Markdown' }).catch(() => { });
                }
            }
        }
        // 6. Render Greeting
        const botUsername = ctx.me.username;
        const userId = ctx.from.id;
        const greeting = `- مرحباً ( ${firstName} ) 🎃\n\n• هل ترغب في تحسين جودة الصور القديمة الى . 2k - 4k - 8k ؟\n\n• من خلال بوت رفع جودة الصور يمكنك تحقيق ذالك بكل سهولة وتحسين جودة الصورة بذكاء الاصطناعي دون الحاجة لتطبيق او موقع 🙂🤍\n\n👇👇👇\n\n► فقط قم بإرسال الصورة واترك الباقي علينا 🤍 ◄\n\n🔗 رابط الإحالة الخاص بك:\nhttps://t.me/${botUsername}?start=ref_${userId}\n\n🎁 محاولاتك اليومية: ${user.dailyQuota}`;
        // Fetch developerLink and channelLink
        const devLink = (await Settings_1.Settings.get('developerLink'));
        const chanLink = (await Settings_1.Settings.get('channelLink'));
        const keyboard = new grammy_1.InlineKeyboard();
        if (devLink || chanLink) {
            if (devLink)
                keyboard.url('المطور', devLink);
            if (chanLink)
                keyboard.url('القناة', chanLink);
        }
        await ctx.reply(greeting, {
            parse_mode: undefined,
            reply_markup: (devLink || chanLink) ? keyboard : undefined,
        });
    }
    catch (err) {
        console.error('[Start] Error:', err);
        await ctx.reply('❌ حدث خطأ أثناء بدء البوت.');
    }
}
async function verifyCommand(ctx) {
    const userId = ctx.from.id;
    try {
        const result = await (0, channelRewardService_1.checkAndReward)(ctx.api, userId);
        if (result === 'REWARDED') {
            const user = await User_1.User.findOne({ telegramId: userId });
            await ctx.reply(`🎉 تهانيات! تم التحقق بنجاح ✅\n` +
                `🎁 تم إضافة 5 محاولات مجانية لرصيدك!\n` +
                `⚡ رصيدك الحالي: ${user?.dailyQuota} محاولة\n\n` +
                `استمتع بتحسين صورك بجودة احترافية 🌟`);
        }
        else if (result === 'ALREADY_CLAIMED') {
            await ctx.reply(`✅ لقد تم إضافة مكافأتك مسبقاً 💙\n\n` +
                `⏳ انتظر المهمة القادمة للحصول على مزيد من المحاولات 🍯`);
        }
        else if (result === 'NOT_MEMBER') {
            await ctx.reply(`❌ لم يتم التحقق 😔\n\n` +
                `يبدو أنك لم تنضم للقناة بعد!\n` +
                `🔗 انضم أولاً ثم اضغط /verify:\n` +
                `👉 قناة البوت`);
        }
        else {
            await ctx.reply(`❌ حدث خطأ، أرسل /start أولاً`);
        }
    }
    catch (err) {
        console.error('[Verify] Error:', err);
        await ctx.reply('❌ حدث خطأ غير متوقع. حاول مرة أخرى.');
    }
}
//# sourceMappingURL=start.js.map