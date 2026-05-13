import mongoose, { Document } from 'mongoose';
export interface IGlobalStat extends Document {
    key: string;
    count: number;
    isFakeCounterActive: boolean;
}
export declare const GlobalStat: mongoose.Model<any, {}, {}, {}, any, any>;
