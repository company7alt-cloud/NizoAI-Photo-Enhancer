import { Document, Model } from 'mongoose';
export interface IFundCampaign extends Document {
    channelId: string;
    channelLink: string;
    targetMembers: number;
    createdBy: number;
    isActive: boolean;
    createdAt: Date;
    claimCounter: number;
    broadcastMessages: {
        userId: number;
        messageId: number;
        claimed: boolean;
    }[];
    claimedUsers: number[];
}
export interface IFundCampaignModel extends Model<IFundCampaign> {
}
export declare const FundCampaign: IFundCampaignModel;
