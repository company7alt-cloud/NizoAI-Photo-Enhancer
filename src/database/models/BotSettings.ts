import mongoose from 'mongoose';

const BotSettingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: String, required: true },
});

export const BotSettings = mongoose.model('BotSettings', BotSettingsSchema);

// Default settings keys:
// 'welcome_message' — main welcome text
// 'daily_reward_amount' — number of daily attempts (default: '5')
// 'low_attempts_warning' — warning message when attempts < 2
// 'maintenance_mode' — 'true' or 'false'
