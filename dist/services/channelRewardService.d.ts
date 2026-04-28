import { Api } from 'grammy';
import { IUser } from '../database/models/User';
export declare function checkAndReward(api: Api, userId: number): Promise<string>;
export declare function checkChannelMembership(api: Api): Promise<void>;
export declare function applyDebtOnQuotaAdd(user: IUser, amountToAdd: number): {
    finalAmount: number;
    debtPaid: number;
};
