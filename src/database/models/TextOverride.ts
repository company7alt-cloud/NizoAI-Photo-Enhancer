import mongoose, { Schema, Document } from 'mongoose';

export interface ITextOverride extends Document {
  originalText: string;
  newText: string;
  updatedBy: number;
  updatedAt: Date;
}

const TextOverrideSchema = new Schema<ITextOverride>({
  originalText: { type: String, required: true, unique: true, index: true },
  newText:      { type: String, required: true },
  updatedBy:    { type: Number, required: true },
  updatedAt:    { type: Date, default: Date.now },
});

export const TextOverride = mongoose.model<ITextOverride>('TextOverride', TextOverrideSchema);
