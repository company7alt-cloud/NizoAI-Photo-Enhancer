import mongoose, { Document } from 'mongoose';
export interface IGiveaway extends Document {
    channelId: string;
    messageId: number;
    maxWinners: number;
    currentWinners: number;
    minReward: number;
    maxReward: number;
    participants: string[];
    winners: string[];
    isActive: boolean;
    createdAt: Date;
}
export declare const Giveaway: mongoose.Model<IGiveaway, {}, {}, {}, mongoose.Document<unknown, {}, IGiveaway, {}, {}> & IGiveaway & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any>;
