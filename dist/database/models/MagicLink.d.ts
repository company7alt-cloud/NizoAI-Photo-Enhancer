import mongoose, { Document } from 'mongoose';
export interface IMagicLink extends Document {
    code: string;
    reward: number;
    maxUses: number;
    currentUses: number;
    usedBy: string[];
    isActive: boolean;
    expiresAt: Date;
    createdAt: Date;
}
export declare const MagicLink: mongoose.Model<IMagicLink, {}, {}, {}, mongoose.Document<unknown, {}, IMagicLink, {}, {}> & IMagicLink & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any>;
