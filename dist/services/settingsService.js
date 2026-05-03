"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSettings = getSettings;
exports.toggleLock = toggleLock;
const LockSettings_1 = require("../database/models/LockSettings");
async function getSettings() {
    let settings = await LockSettings_1.LockSettings.findOne();
    if (!settings) {
        settings = await LockSettings_1.LockSettings.create({});
    }
    return settings;
}
async function toggleLock(field) {
    const settings = await getSettings();
    const currentValue = settings.locks[field];
    await LockSettings_1.LockSettings.findOneAndUpdate({}, { $set: { [`locks.${field}`]: !currentValue } }, { upsert: true });
    return await getSettings();
}
//# sourceMappingURL=settingsService.js.map