import mongoose, { Document, Schema, Model } from 'mongoose';

export interface IFreeEnhance extends Document {
  userId: number;
  dailyUsed: number;
  lastResetDate: Date;
  totalUsed: number;
  lastUsedAt: Date | null;
}

interface IFreeEnhanceModel extends Model<IFreeEnhance> {
  canUse(userId: number): Promise<{ allowed: boolean; remaining: number; resetInMs: number }>;
  incrementUsage(userId: number): Promise<void>;
  getRemainingTime(userId: number): Promise<number>;
}

const FreeEnhanceSchema = new Schema<IFreeEnhance>({
  userId: { 
    type: Number, 
    required: true, 
    unique: true,
    index: true
  },
  dailyUsed: { 
    type: Number, 
    default: 0,
    min: 0,
    max: 3
  },
  lastResetDate: { 
    type: Date, 
    default: Date.now 
  },
  totalUsed: { 
    type: Number, 
    default: 0 
  },
  lastUsedAt: { 
    type: Date, 
    default: null 
  }
});

FreeEnhanceSchema.statics.canUse = async function(
  userId: number
): Promise<{ allowed: boolean; remaining: number; resetInMs: number }> {
  
  let record = await this.findOne({ userId });
  
  if (!record) {
    // New user → create record → allowed
    await this.create({ userId, dailyUsed: 0, lastResetDate: new Date() });
    return { allowed: true, remaining: 3, resetInMs: 0 };
  }

  // Check if 24 hours passed since last reset → reset counter
  const hoursSinceReset = (Date.now() - record.lastResetDate.getTime()) / (1000 * 60 * 60);
  
  if (hoursSinceReset >= 24) {
    await this.updateOne(
      { userId },
      { $set: { dailyUsed: 0, lastResetDate: new Date() } }
    );
    return { allowed: true, remaining: 3, resetInMs: 0 };
  }

  if (record.dailyUsed >= 3) {
    // Calculate ms until reset
    const resetAt = new Date(record.lastResetDate.getTime() + 24 * 60 * 60 * 1000);
    const resetInMs = resetAt.getTime() - Date.now();
    return { allowed: false, remaining: 0, resetInMs: Math.max(0, resetInMs) };
  }

  const resetAt = new Date(record.lastResetDate.getTime() + 24 * 60 * 60 * 1000);
  const resetInMs = resetAt.getTime() - Date.now();
  
  return { 
    allowed: true, 
    remaining: 3 - record.dailyUsed,
    resetInMs 
  };
};

FreeEnhanceSchema.statics.incrementUsage = async function(userId: number): Promise<void> {
  await this.findOneAndUpdate(
    { userId },
    {
      $inc: { dailyUsed: 1, totalUsed: 1 },
      $set: { lastUsedAt: new Date() }
    },
    { upsert: true }
  );
};

FreeEnhanceSchema.statics.getRemainingTime = async function(userId: number): Promise<number> {
  const record = await this.findOne({ userId });
  if (!record) return 0;
  const resetAt = new Date(record.lastResetDate.getTime() + 24 * 60 * 60 * 1000);
  return Math.max(0, resetAt.getTime() - Date.now());
};

export const FreeEnhance = mongoose.model<IFreeEnhance, IFreeEnhanceModel>(
  'FreeEnhance',
  FreeEnhanceSchema
);
