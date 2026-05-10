import mongoose, { Document } from 'mongoose';

export interface IGlobalStat extends Document {
  key: string;
  count: number;
  isFakeCounterActive: boolean;
}

const globalStatSchema = new mongoose.Schema<IGlobalStat>({
  key: { type: String, required: true, unique: true },
  count: { type: Number, default: 5000 },
  isFakeCounterActive: { type: Boolean, default: false }
});

export const GlobalStat = mongoose.models.GlobalStat || mongoose.model<IGlobalStat>('GlobalStat', globalStatSchema);
