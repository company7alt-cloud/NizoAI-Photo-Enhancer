import mongoose, { Document, Schema, Model } from 'mongoose';

export interface IGhostAccount extends Document {
  phoneNumber: string;
  sessionString: string;
  isActive: boolean;
  isLocked: boolean;
  lockedAt: Date | null;
  dailyUsed: number;
  lastResetDate: Date;
  addedBy: number;
  addedAt: Date;
  totalProcessed: number;
  failureCount: number;
  lastError: string | null;
}

interface IGhostAccountModel extends Model<IGhostAccount> {
  getAvailableAccount(): Promise<IGhostAccount | null>;
  resetDailyCounters(): Promise<void>;
  forceUnlockStaleAccounts(): Promise<number>;
}

const GhostAccountSchema = new Schema<IGhostAccount>({
  phoneNumber: { 
    type: String, 
    required: true, 
    unique: true,
    trim: true 
  },
  sessionString: { 
    type: String, 
    required: true 
  },
  isActive: { 
    type: Boolean, 
    default: true 
  },
  isLocked: { 
    type: Boolean, 
    default: false 
  },
  lockedAt: { 
    type: Date, 
    default: null 
  },
  dailyUsed: { 
    type: Number, 
    default: 0,
    min: 0 
  },
  lastResetDate: { 
    type: Date, 
    default: Date.now 
  },
  addedBy: { 
    type: Number, 
    required: true 
  },
  addedAt: { 
    type: Date, 
    default: Date.now 
  },
  totalProcessed: { 
    type: Number, 
    default: 0 
  },
  failureCount: { 
    type: Number, 
    default: 0 
  },
  lastError: { 
    type: String, 
    default: null 
  }
});

// ═══════════════════════════════════════════════════════
// ATOMIC: Get one available account and lock it instantly
// Uses findOneAndUpdate to prevent race conditions 100%
// ═══════════════════════════════════════════════════════
GhostAccountSchema.statics.getAvailableAccount = async function(): Promise<IGhostAccount | null> {
  const now = new Date();
  
  // Force unlock accounts locked more than 5 minutes (stuck accounts)
  await this.updateMany(
    { 
      isLocked: true, 
      lockedAt: { $lt: new Date(now.getTime() - 5 * 60 * 1000) }
    },
    { 
      $set: { isLocked: false, lockedAt: null }
    }
  );

  // Atomic: find + lock in one operation = zero race condition
  return this.findOneAndUpdate(
    {
      isActive: true,
      isLocked: false,
      dailyUsed: { $lt: 10 }
    },
    {
      $set: { 
        isLocked: true, 
        lockedAt: now
      }
    },
    { 
      new: true,
      sort: { dailyUsed: 1 } // Use account with lowest usage first
    }
  );
};

// ═══════════════════════════════════════════════════════
// Reset all daily counters at midnight
// ═══════════════════════════════════════════════════════
GhostAccountSchema.statics.resetDailyCounters = async function(): Promise<void> {
  await this.updateMany(
    {},
    {
      $set: {
        dailyUsed: 0,
        isLocked: false,
        lockedAt: null,
        lastResetDate: new Date()
      }
    }
  );
};

// ═══════════════════════════════════════════════════════
// Force unlock all accounts stuck more than X minutes
// Returns count of unlocked accounts
// ═══════════════════════════════════════════════════════
GhostAccountSchema.statics.forceUnlockStaleAccounts = async function(): Promise<number> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const result = await this.updateMany(
    {
      isLocked: true,
      lockedAt: { $lt: fiveMinutesAgo }
    },
    {
      $set: { isLocked: false, lockedAt: null }
    }
  );
  return result.modifiedCount;
};

export const GhostAccount = mongoose.model<IGhostAccount, IGhostAccountModel>(
  'GhostAccount', 
  GhostAccountSchema
);
