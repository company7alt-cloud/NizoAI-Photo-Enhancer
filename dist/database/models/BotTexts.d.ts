import mongoose, { Document } from 'mongoose';
export interface IBotText extends Document {
    key: string;
    category: 'message' | 'button' | 'notification';
    value: string;
    defaultValue: string;
    description: string;
}
export declare const BotText: mongoose.Model<IBotText, {}, {}, {}, mongoose.Document<unknown, {}, IBotText, {}, {}> & IBotText & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any>;
