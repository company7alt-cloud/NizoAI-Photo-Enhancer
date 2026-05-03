// src/database/models/User.ts
import { Schema, model, Document, Model } from 'mongoose';

export interface IUser extends Document {
  telegramId: number;
  username?: string;
  firstName: string;
  language: string;
  dailyQuota: number;
  lastQuotaReset: Date;
  totalEnhancements: number;
  referralCount: number;
  referredBy?: number;
  referredUsers: number[];
  fundedChannels: string[];
  isVip: boolean;
  isBanned: boolean;
  isRestricted: boolean;
  lastRewardDate: Date | null;
  lastSeen: Date;
  joinedAt: Date;
  quotaDebt: number;
  channelJoinDate: Date | null;
  channelRewardClaimed: boolean;
  referralRewardClaimed: boolean;
  isProcessingClaim: boolean;
  isProcessingImage: boolean;
  awaitingReport: boolean;
  supportSessionActive: boolean;
  supportSessionAdminId: string | null;
  adminAwaitingInput: string | null;
  isBlocked: boolean;
  lastSeenAt: Date | null;
  awaitingNanoBananaImage: boolean;
  awaitingEraserImage?: boolean;
  awaitingEraserOriginal?: boolean;
  eraserCoords?: {
    minX: number | null;
    minY: number | null;
    width: number | null;
    height: number | null;
  };
  awaitingFormatConversion?: boolean;
  pendingConversionFiles?: string[];
  conversionUpscale?: boolean;
  batchConversionFormat?: string | null;
  proEnhanceSettings?: {
    quality: string | null;
    scale: string | null;
    imageType: string | null;
    isAwaitingImage?: boolean;
  };
  forceSubMessageId?: number | null;
  forceSubChatId?: number | null;
  lastEraserResultUrl?: string | null;
  lastEraserResultBuffer?: string;
  lastEraserResultMsgId?: number;
  awaitingAutoEraserImage?: boolean;
  vipSizeBypass: boolean;
}

export interface IUserModel extends Model<IUser> {
  findByTelegramId(telegramId: number): Promise<IUser | null>;
  findOrCreate(data: Partial<IUser>): Promise<{ user: IUser; isNew: boolean }>;
}

const UserSchema = new Schema<IUser>(
  {
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
    isBlocked: { type: Boolean, default: false },
    lastSeenAt: { type: Date, default: null },
    awaitingNanoBananaImage: { type: Boolean, default: false },
    awaitingEraserImage: { type: Boolean, default: false },
    awaitingEraserOriginal: { type: Boolean, default: false },
    eraserCoords: {
      type: {
        minX:   { type: Number, default: null },
        minY:   { type: Number, default: null },
        width:  { type: Number, default: null },
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
    vipSizeBypass: { type: Boolean, default: false },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

UserSchema.statics.findByTelegramId = async function (
  telegramId: number
): Promise<IUser | null> {
  return this.findOne({ telegramId }) as Promise<IUser | null>;
};

UserSchema.statics.findOrCreate = async function (
  data: Partial<IUser>
): Promise<{ user: IUser; isNew: boolean }> {
  const existing = (await this.findOne({ telegramId: data.telegramId })) as IUser | null;
  if (existing) {
    return { user: existing, isNew: false };
  }
  const user = (await this.create(data)) as IUser;
  return { user, isNew: true };
};

export const User = model<IUser, IUserModel>('User', UserSchema);
