import mongoose, { Document } from 'mongoose';
export interface IForceSubChannel extends Document {
    channelId: string;
    channelUrl: string;
    channelName: string;
    order: number;
    createdAt: Date;
}
export declare const ForceSubChannel: mongoose.Model<IForceSubChannel, {}, {}, {}, mongoose.Document<unknown, {}, IForceSubChannel, {}, {}> & IForceSubChannel & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any>;
