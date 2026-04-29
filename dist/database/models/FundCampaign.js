"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FundCampaign = void 0;
// src/database/models/FundCampaign.ts
const mongoose_1 = require("mongoose");
const FundCampaignSchema = new mongoose_1.Schema({
    channelId: {
        type: String,
        required: true,
    },
    channelLink: {
        type: String,
        required: true,
    },
    targetMembers: {
        type: Number,
        required: true,
    },
    createdBy: {
        type: Number,
        required: true,
    },
    isActive: {
        type: Boolean,
        default: true,
    },
    createdAt: {
        type: Date,
        default: () => new Date(),
    },
    claimCounter: {
        type: Number,
        default: 0,
    },
    broadcastMessages: {
        type: [
            {
                userId: Number,
                messageId: Number,
                claimed: Boolean,
            },
        ],
        default: [],
    },
    claimedUsers: {
        type: [Number],
        default: [],
    },
}, {
    timestamps: false,
    versionKey: false,
});
exports.FundCampaign = (0, mongoose_1.model)('FundCampaign', FundCampaignSchema);
//# sourceMappingURL=FundCampaign.js.map