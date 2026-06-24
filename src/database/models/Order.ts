// src/database/models/Order.ts
import { Schema, model, Document } from 'mongoose';

export interface IOrder extends Document {
  userId: string;
  orderId: string;
  serviceName: string;
  status: 'pending' | 'processing' | 'completed' | 'cancelled' | 'cancel_requested';
  progressStage: number;
  createdAt: Date;
}

const OrderSchema = new Schema<IOrder>(
  {
    userId:       { type: String, required: true, index: true },
    orderId:      { type: String, required: true, unique: true },
    serviceName:  { type: String, required: true },
    status:       {
      type: String,
      enum: ['pending', 'processing', 'completed', 'cancelled', 'cancel_requested'],
      default: 'pending',
    },
    progressStage: { type: Number, default: 0, min: 0, max: 5 },
    createdAt:    { type: Date, default: () => new Date(), expires: 86400 }, // TTL 24h
  },
  { versionKey: false }
);

export const Order = model<IOrder>('Order', OrderSchema);
