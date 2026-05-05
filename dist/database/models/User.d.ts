import { Document, Model } from 'mongoose';
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
    adminTargetUserId: string | null;
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
    successfulReferrals: number;
}
export interface IUserModel extends Model<IUser> {
    findByTelegramId(telegramId: number): Promise<IUser | null>;
    findOrCreate(data: Partial<IUser>): Promise<{
        user: IUser;
        isNew: boolean;
    }>;
}
export declare const User: IUserModel;
