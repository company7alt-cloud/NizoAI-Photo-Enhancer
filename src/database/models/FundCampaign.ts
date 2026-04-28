// src/database/models/FundCampaign.ts
import { Schema, model, Document, Model } from 'mongoose';

export interface IFundCampaign extends Document {
  channelId: string;
  channelLink: string;
  targetMembers: number;
  createdBy: number;
  isActive: boolean;
  createdAt: Date;
  claimCounter: number;
  broadcastMessages: { userId: number; messageId: number; claimed: boolean }[];
  claimedUsers: number[];
}

export interface IFundCampaignModel extends Model<IFundCampaign> {}

const FundCampaignSchema = new Schema<IFundCampaign>(
  {
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
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

export const FundCampaign = model<IFundCampaign, IFundCampaignModel>(
  'FundCampaign',
  FundCampaignSchema
);
