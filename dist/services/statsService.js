"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.incrementGlobalCounter = incrementGlobalCounter;
exports.getGlobalCounter = getGlobalCounter;
const GlobalStat_1 = require("../database/models/GlobalStat");
async function incrementGlobalCounter() {
    try {
        const stat = await GlobalStat_1.GlobalStat.findOne({ key: 'total_processed' });
        if (!stat) {
            await GlobalStat_1.GlobalStat.create({ key: 'total_processed', count: 5001 });
        }
        else {
            // If due to a previous bug the count is less than 5000, fix it immediately
            if (stat.count < 5000) {
                stat.count = 5000 + stat.count + 1;
                await stat.save();
            }
            else {
                await GlobalStat_1.GlobalStat.updateOne({ key: 'total_processed' }, { $inc: { count: 1 } });
            }
        }
    }
    catch (error) {
        console.error('[StatsService] Increment error:', error);
    }
}
async function getGlobalCounter() {
    try {
        const stat = await GlobalStat_1.GlobalStat.findOne({ key: 'total_processed' });
        if (!stat)
            return 5000;
        if (stat.count < 5000) {
            stat.count = 5000 + stat.count;
            await stat.save();
        }
        return stat.count;
    }
    catch {
        return 5000;
    }
}
//# sourceMappingURL=statsService.js.map