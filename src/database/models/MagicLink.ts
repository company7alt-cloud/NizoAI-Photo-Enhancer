import mongoose, { Document, Schema } from 'mongoose';

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

const MagicLinkSchema = new Schema<IMagicLink>({
  code:         { type: String, required: true, unique: true },
  reward:       { type: Number, required: true },
  maxUses:      { type: Number, required: true },
  currentUses:  { type: Number, default: 0 },
  usedBy:       [{ type: String }],
  isActive:     { type: Boolean, default: true },
  expiresAt:    { type: Date, required: true },
  createdAt:    { type: Date, default: Date.now }
});

export const MagicLink = mongoose.model<IMagicLink>('MagicLink', MagicLinkSchema);
