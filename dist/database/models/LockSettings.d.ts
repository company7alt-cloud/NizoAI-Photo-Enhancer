import mongoose, { Document } from 'mongoose';
export interface ILockSettings extends Document {
    locks: {
        btn_2k: boolean;
        btn_4k: boolean;
        btn_8k: boolean;
        btn_4kai: boolean;
        btn_8kai: boolean;
        btn_nano: boolean;
        btn_eraser: boolean;
        btn_doc_maker: boolean;
    };
}
export declare const LockSettings: mongoose.Model<ILockSettings, {}, {}, {}, mongoose.Document<unknown, {}, ILockSettings, {}, {}> & ILockSettings & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any>;
