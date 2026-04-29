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
    lastSeen: Date;
    joinedAt: Date;
    quotaDebt: number;
    channelJoinDate: Date | null;
    channelRewardClaimed: boolean;
    referralRewardClaimed: boolean;
    isProcessingClaim: boolean;
    isProcessingImage: boolean;
}
export interface IUserModel extends Model<IUser> {
    findByTelegramId(telegramId: number): Promise<IUser | null>;
    findOrCreate(data: Partial<IUser>): Promise<{
        user: IUser;
        isNew: boolean;
    }>;
}
export declare const User: IUserModel;
