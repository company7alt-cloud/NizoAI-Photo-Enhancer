import mongoose, { Document, Schema } from 'mongoose';

export interface ILockSettings extends Document {
  locks: {
    btn_2k: boolean;
    btn_4k: boolean;
    btn_8k: boolean;
    btn_4kai: boolean;
    btn_8kai: boolean;
    btn_nano: boolean;
  };
}

const LockSettingsSchema = new Schema<ILockSettings>({
  locks: {
    btn_2k:   { type: Boolean, default: false },
    btn_4k:   { type: Boolean, default: false },
    btn_8k:   { type: Boolean, default: true },
    btn_4kai: { type: Boolean, default: false },
    btn_8kai: { type: Boolean, default: true },
    btn_nano: { type: Boolean, default: false },
  }
}, { collection: 'lock_settings' });

export const LockSettings = mongoose.model<ILockSettings>('LockSettings', LockSettingsSchema);
