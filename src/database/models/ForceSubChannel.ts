// src/database/models/ForceSubChannel.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface IForceSubChannel extends Document {
  channelId:   string;
  channelUrl:  string;
  channelName: string;
  order:       number;
  createdAt:   Date;
}

const ForceSubChannelSchema = new Schema<IForceSubChannel>({
  channelId:   { type: String, required: true, unique: true },
  channelUrl:  { type: String, required: true },
  channelName: { type: String, required: true },
  order:       { type: Number, default: 0 },
  createdAt:   { type: Date,   default: Date.now },
});

export const ForceSubChannel = mongoose.model<IForceSubChannel>(
  'ForceSubChannel',
  ForceSubChannelSchema
);
