"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BotSettings = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const BotSettingsSchema = new mongoose_1.default.Schema({
    key: { type: String, required: true, unique: true },
    value: { type: String, required: true },
});
exports.BotSettings = mongoose_1.default.model('BotSettings', BotSettingsSchema);
// Default settings keys:
// 'welcome_message' — main welcome text
// 'daily_reward_amount' — number of daily attempts (default: '5')
// 'low_attempts_warning' — warning message when attempts < 2
// 'maintenance_mode' — 'true' or 'false'
//# sourceMappingURL=BotSettings.js.map