// src/database/models/Settings.ts
import { Schema, model, Document, Model } from 'mongoose';

export interface ISetting extends Document {
  key: string;
  value: Schema.Types.Mixed;
  updatedAt: Date;
}

export interface ISettingModel extends Model<ISetting> {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  initDefaults(): Promise<void>;
}

const SettingsSchema = new Schema<ISetting>({
  key: { type: String, required: true, unique: true, index: true },
  value: { type: Schema.Types.Mixed, required: true },
  updatedAt: { type: Date, default: Date.now },
});

SettingsSchema.statics.get = async function (key: string): Promise<unknown> {
  const s = await this.findOne({ key }) as ISetting | null;
  return s ? s.value : null;
};

SettingsSchema.statics.set = async function (key: string, value: unknown): Promise<void> {
  await this.findOneAndUpdate(
    { key },
    { value, updatedAt: new Date() },
    { upsert: true }
  );
};

SettingsSchema.statics.initDefaults = async function (): Promise<void> {
  const defaults = [
    { key: 'welcome_message', value: '🌟 أهلاً بك في NizoAI Bot لتحسين جودة الصور!' },
    { key: 'bot_status', value: true },
    { key: 'notify_on_join', value: true },
    { key: 'auto_delete', value: false },

    { key: 'developerLink', value: '' },
    { key: 'channelLink', value: '' },
    { key: 'broadcastButtons', value: [] as { label: string; url: string }[] },
  ];

  for (const d of defaults) {
    const exists = await this.findOne({ key: d.key });
    if (!exists) {
      await this.create(d);
    }
  }
};

export const Settings = model<ISetting, ISettingModel>('Settings', SettingsSchema);
