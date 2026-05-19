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
        // No min — negative values represent debt from channel-fund penalties
    },
    docPageLimit: {
        type: Number,
        default: 5,
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
    fundedChannels: {
        type: [String],
        default: [],
    },
    isVip: {
        type: Boolean,
        default: false,
    },
    lastRewardDate: { type: Date, default: null },
    isBanned: { type: Boolean, default: false },
    isRestricted: { type: Boolean, default: false },
    isPermBanned: { type: Boolean, default: false },
    isAppealing: { type: Boolean, default: false },
    adminActionState: { type: String, default: '' },
    adminTargetId: { type: String, default: '' },
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
    referralRewardClaimed: {
        type: Boolean,
        default: false,
    },
    isProcessingClaim: {
        type: Boolean,
        default: false,
    },
    isProcessingImage: {
        type: Boolean,
        default: false,
    },
    awaitingReport: {
        type: Boolean,
        default: false,
    },
    supportSessionActive: { type: Boolean, default: false },
    supportSessionAdminId: { type: String, default: null },
    adminAwaitingInput: { type: String, default: null },
    adminTargetUserId: { type: String, default: null },
    isBlocked: { type: Boolean, default: false },
    lastSeenAt: { type: Date, default: null },
    awaitingNanoBananaImage: { type: Boolean, default: false },
    awaitingEraserImage: { type: Boolean, default: false },
    awaitingEraserOriginal: { type: Boolean, default: false },
    awaitingCustomEraserImage: { type: Boolean, default: false },
    awaitingCustomEraserZone: { type: Boolean, default: false },
    customEraserFileId: { type: String, default: '' },
    customEraserSelectedCells: { type: [Number], default: [] },
    customEraserBtnMsgId: { type: Number, default: null },
    customEraserGridBuffer: { type: String, default: '' },
    customEraserGridSize: { type: Number, default: 0 },
    eraserCoords: {
        type: {
            minX: { type: Number, default: null },
            minY: { type: Number, default: null },
            width: { type: Number, default: null },
            height: { type: Number, default: null },
        },
        default: () => ({ minX: null, minY: null, width: null, height: null }),
    },
    awaitingFormatConversion: { type: Boolean, default: false },
    pendingConversionFiles: { type: [String], default: [] },
    conversionUpscale: { type: Boolean, default: false },
    batchConversionFormat: { type: String, default: null },
    proEnhanceSettings: {
        type: {
            quality: { type: String, default: null },
            scale: { type: String, default: null },
            imageType: { type: String, default: null },
            isAwaitingImage: { type: Boolean, default: false },
        },
        default: () => ({ quality: null, scale: null, imageType: null, isAwaitingImage: false }),
    },
    forceSubMessageId: { type: Number, default: null },
    forceSubChatId: { type: Number, default: null },
    lastEraserResultUrl: { type: String, default: null },
    lastEraserResultBuffer: { type: String, default: null },
    lastEraserResultMsgId: { type: Number, default: null },
    awaitingAutoEraserImage: { type: Boolean, default: false },
    awaitingFilterImage: { type: Boolean, default: false },
    selectedFilterType: { type: String, default: '' },
    vipSizeBypass: { type: Boolean, default: false },
    successfulReferrals: { type: Number, default: 0 },
    canBypassLocks: { type: Boolean, default: false },
    // Document Maker (session data)
    isInDocMaker: { type: Boolean, default: false },
    tempLine: { type: String, default: null },
    documentLines: {
        type: [{
                text: { type: String, required: true },
                align: { type: String, enum: ['right', 'center', 'left'], default: 'right' },
                bold: { type: Boolean, default: false },
                italic: { type: Boolean, default: false },
                underline: { type: Boolean, default: false },
                size: { type: String, enum: ['small', 'normal', 'large'], default: 'normal' },
                style: { type: String, enum: ['normal', 'quote', 'divider', 'highlight'], default: 'normal' },
            }],
        default: []
    },
    docWizard: {
        type: {
            step: { type: Number, default: 0 },
            docType: { type: String, default: null },
            pageSize: { type: String, default: null },
            customSize: {
                type: { width: { type: Number }, height: { type: Number } },
                default: null,
            },
            templateId: { type: Number, default: null },
            currentPageIndex: { type: Number, default: 0 },
            currentLineIndex: { type: Number, default: 0 },
            lineCapacity: { type: Number, default: 10 },
            awaitingCustomSize: { type: Boolean, default: false },
            awaitingLineText: { type: Boolean, default: false },
            awaitingAlignment: { type: Boolean, default: false },
            tempLine: { type: String, default: null },
            awaitingImagePhoto: { type: Boolean, default: false },
            awaitingOverlayText: { type: Boolean, default: false },
            awaitingCaptionText: { type: Boolean, default: false },
            pendingLongText: { type: String, default: null },
            pages: {
                type: [{
                        type: { type: String },
                        lines: {
                            type: [{
                                    text: { type: String },
                                    align: { type: String, default: 'right' },
                                }],
                            default: [],
                        },
                        imageBuffer: { type: mongoose_1.Schema.Types.Mixed, default: null },
                        overlayText: { type: String, default: null },
                        captionText: { type: String, default: null },
                    }],
                default: [],
            },
        },
        default: null,
    },
    // Giveaway setup state (admin only)
    giveawaySetup: {
        type: {
            step: { type: String, default: null },
            maxWinners: { type: Number, default: 0 },
            minReward: { type: Number, default: 0 },
            maxReward: { type: Number, default: 0 },
            channelId: { type: String, default: '' },
        },
        default: () => ({ step: null, maxWinners: 0, minReward: 0, maxReward: 0, channelId: '' }),
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