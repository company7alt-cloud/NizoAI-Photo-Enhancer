"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.User = void 0;
// src/database/models/User.ts
const mongoose_1 = require("mongoose");
const UserSchema = new mongoose_1.Schema({
    telegramId: {
        type: Number,
        required: true,
        unique: true,
        index: true,
    },
    username: {
        type: String,
        default: undefined,
    },
    firstName: {
        type: String,
        default: '',
    },
    language: {
        type: String,
        default: 'en',
    },
    dailyQuota: {
        type: Number,
        default: 5,
        min: 0,
    },
    lastQuotaReset: {
        type: Date,
        default: () => new Date(),
    },
    totalEnhancements: {
        type: Number,
        default: 0,
        min: 0,
    },
    referralCount: {
        type: Number,
        default: 0,
        min: 0,
    },
    referredBy: {
        type: Number,
        default: undefined,
    },
    referredUsers: {
        type: [Number],
        default: [],
    },
    isVip: {
        type: Boolean,
        default: false,
    },
    isBanned: {
        type: Boolean,
        default: false,
    },
    lastSeen: {
        type: Date,
        default: () => new Date(),
    },
    joinedAt: {
        type: Date,
        default: () => new Date(),
    },
    quotaDebt: {
        type: Number,
        default: 0,
        min: 0,
    },
    channelJoinDate: {
        type: Date,
        default: null,
    },
    channelRewardClaimed: {
        type: Boolean,
        default: false,
    },
}, {
    timestamps: false,
    versionKey: false,
});
UserSchema.statics.findByTelegramId = async function (telegramId) {
    return this.findOne({ telegramId });
};
UserSchema.statics.findOrCreate = async function (data) {
    const existing = (await this.findOne({ telegramId: data.telegramId }));
    if (existing) {
        return { user: existing, isNew: false };
    }
    const user = (await this.create(data));
    return { user, isNew: true };
};
exports.User = (0, mongoose_1.model)('User', UserSchema);
//# sourceMappingURL=User.js.map