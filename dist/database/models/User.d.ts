import { Document, Model } from 'mongoose';
export interface IUser extends Document {
    telegramId: number;
    username?: string;
    firstName: string;
    language: string;
    dailyQuota: number;
    docPageLimit: number;
    lastQuotaReset: Date;
    totalEnhancements: number;
    referralCount: number;
    referredBy?: number;
    referredUsers: number[];
    fundedChannels: string[];
    isVip: boolean;
    isBanned: boolean;
    isRestricted: boolean;
    isPermBanned: boolean;
    isAppealing: boolean;
    adminActionState: string;
    adminTargetId: string;
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
    awaitingCustomEraserImage?: boolean;
    awaitingCustomEraserZone?: boolean;
    customEraserFileId?: string;
    customEraserSelectedCells?: number[];
    customEraserBtnMsgId?: number | null;
    customEraserGridBuffer?: string;
    customEraserGridSize?: number;
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
    awaitingFilterImage?: boolean;
    selectedFilterType?: string;
    vipSizeBypass: boolean;
    successfulReferrals: number;
    canBypassLocks: boolean;
    isInDocMaker?: boolean;
    tempLine?: string | null;
    documentLines?: {
        text: string;
        align: 'right' | 'center' | 'left';
        bold?: boolean;
        italic?: boolean;
        underline?: boolean;
        size?: 'small' | 'normal' | 'large';
        style?: 'normal' | 'quote' | 'divider' | 'highlight';
    }[];
    docWizard: {
        step: number;
        docType: 'text' | 'image' | null;
        pageSize: string | null;
        customSize: {
            width: number;
            height: number;
        } | null;
        templateId: 1 | 2 | 3 | 4 | 5 | null;
        currentPageIndex: number;
        currentLineIndex: number;
        lineCapacity: number;
        awaitingCustomSize: boolean;
        awaitingLineText: boolean;
        awaitingAlignment: boolean;
        tempLine: string | null;
        awaitingImagePhoto: boolean;
        awaitingOverlayText: boolean;
        awaitingCaptionText: boolean;
        pendingLongText: string | null;
        pages: Array<{
            type: 'text' | 'image';
            lines?: {
                text: string;
                align: 'right' | 'center' | 'left';
            }[];
            imageBuffer?: Buffer | string;
            overlayText?: string;
            captionText?: string;
        }>;
    } | null;
    giveawaySetup?: {
        step: string | null;
        maxWinners: number;
        minReward: number;
        maxReward: number;
        channelId: string;
    };
}
export interface IUserModel extends Model<IUser> {
    findByTelegramId(telegramId: number): Promise<IUser | null>;
    findOrCreate(data: Partial<IUser>): Promise<{
        user: IUser;
        isNew: boolean;
    }>;
}
export declare const User: IUserModel;
