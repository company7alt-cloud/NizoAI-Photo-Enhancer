// src/database/models/Giveaway.ts
import mongoose, { Document, Schema } from 'mongoose';

export interface IGiveaway extends Document {
  channelId: string;
  messageId: number;
  maxWinners: number;
  currentWinners: number;
  minReward: number;
  maxReward: number;
  participants: string[];
  winners: string[];
  isActive: boolean;
  createdAt: Date;
}

const giveawaySchema = new Schema<IGiveaway>({
  channelId:      { type: String, required: true },
  messageId:      { type: Number, required: true },
  maxWinners:     { type: Number, required: true },
  currentWinners: { type: Number, default: 0 },
  minReward:      { type: Number, required: true },
  maxReward:      { type: Number, required: true },
  participants:   { type: [String], default: [] },
  winners:        { type: [String], default: [] },
  isActive:       { type: Boolean, default: true },
  createdAt:      { type: Date, default: Date.now },
});

export const Giveaway =
  (mongoose.models.Giveaway as mongoose.Model<IGiveaway>) ||
  mongoose.model<IGiveaway>('Giveaway', giveawaySchema);
