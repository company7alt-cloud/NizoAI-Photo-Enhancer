"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkAndResetDailyFree = checkAndResetDailyFree;
const User_1 = require("../../database/models/User");
async function checkAndResetDailyFree(user) {
    const today = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'
    if (user.freePdfsLastResetDate !== today) {
        await User_1.User.updateOne({ _id: user._id }, { $set: { freePdfsGeneratedToday: 0, freePdfsLastResetDate: today } });
        user.freePdfsGeneratedToday = 0;
        user.freePdfsLastResetDate = today;
    }
}
//# sourceMappingURL=freeLimit.js.map