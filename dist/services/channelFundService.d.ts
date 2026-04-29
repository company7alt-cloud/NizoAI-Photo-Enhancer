import { Api } from 'grammy';
import { FundCampaign } from '../database/models/FundCampaign';
export declare function addAttemptsWithDebtCheck(userId: number, amount: number): Promise<number>;
export declare function isFundCampaignPending(adminId: number): boolean;
export declare function startFundCampaignSetup(adminId: number): void;
export declare function handleFundCampaignInput(adminId: number, text: string, api: Api): Promise<{
    status: 'ask_target';
    channelId: string;
} | {
    status: 'not_admin_in_channel';
} | {
    status: 'done';
    campaign: InstanceType<typeof FundCampaign>;
} | {
    status: 'invalid_target';
}>;
export declare function clearFundCampaignState(adminId: number): void;
export declare function broadcastFundCampaign(api: Api, campaign: InstanceType<typeof FundCampaign>): Promise<{
    sent: number;
    failed: number;
}>;
export declare function claimChannelReward(userId: number, channelId: string, api: Api): Promise<'REWARDED' | 'ALREADY_CLAIMED' | 'NOT_MEMBER' | 'ADMIN_BLOCKED' | 'NO_CAMPAIGN' | 'PROCESSING'>;
export declare function handleMemberLeft(userId: number, channelId: string, api: Api): Promise<void>;
