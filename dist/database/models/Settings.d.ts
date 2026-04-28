import { Schema, Document, Model } from 'mongoose';
export interface ISetting extends Document {
    key: string;
    value: Schema.Types.Mixed;
    updatedAt: Date;
}
export interface ISettingModel extends Model<ISetting> {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    initDefaults(): Promise<void>;
}
export declare const Settings: ISettingModel;
