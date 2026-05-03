import mongoose from 'mongoose';
export declare const BotSettings: mongoose.Model<{
    value: string;
    key: string;
}, {}, {}, {}, mongoose.Document<unknown, {}, {
    value: string;
    key: string;
}, {}, mongoose.DefaultSchemaOptions> & {
    value: string;
    key: string;
} & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}, mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, mongoose.DefaultSchemaOptions, {
    value: string;
    key: string;
}, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    value: string;
    key: string;
}>, {}, mongoose.DefaultSchemaOptions> & mongoose.FlatRecord<{
    value: string;
    key: string;
}> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>>;
