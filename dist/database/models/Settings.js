"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Settings = void 0;
// src/database/models/Settings.ts
const mongoose_1 = require("mongoose");
const SettingsSchema = new mongoose_1.Schema({
    key: { type: String, required: true, unique: true, index: true },
    value: { type: mongoose_1.Schema.Types.Mixed, required: true },
    updatedAt: { type: Date, default: Date.now },
});
SettingsSchema.statics.get = async function (key) {
    const s = await this.findOne({ key });
    return s ? s.value : null;
};
SettingsSchema.statics.set = async function (key, value) {
    await this.findOneAndUpdate({ key }, { value, updatedAt: new Date() }, { upsert: true });
};
SettingsSchema.statics.initDefaults = async function () {
    const defaults = [
        { key: 'welcome_message', value: '🌟 أهلاً بك في NizoAI Bot لتحسين جودة الصور!' },
        { key: 'bot_status', value: true },
        { key: 'notify_on_join', value: true },
        { key: 'auto_delete', value: false },
        { key: 'developerLink', value: '' },
        { key: 'channelLink', value: '' },
        { key: 'broadcastButtons', value: [] },
    ];
    for (const d of defaults) {
        const exists = await this.findOne({ key: d.key });
        if (!exists) {
            await this.create(d);
        }
    }
};
exports.Settings = (0, mongoose_1.model)('Settings', SettingsSchema);
//# sourceMappingURL=Settings.js.map