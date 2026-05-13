"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startFakeCounterEngine = startFakeCounterEngine;
exports.stopFakeCounterEngine = stopFakeCounterEngine;
const GlobalStat_1 = require("../database/models/GlobalStat");
let fakeCounterTimer = null;
let isEngineRunning = false;
async function startFakeCounterEngine() {
    if (isEngineRunning)
        return;
    isEngineRunning = true;
    const runLoop = async () => {
        try {
            // 1. Fetch config to check if active
            const config = await GlobalStat_1.GlobalStat.findOne({ key: 'total_processed' });
            if (config && config.isFakeCounterActive) {
                // 2. Increment the ACTUAL global total counter field by 1 safely
                await GlobalStat_1.GlobalStat.updateOne({ key: 'total_processed' }, { $inc: { count: 1 } });
            }
        }
        catch (error) {
            console.error('[Fake Counter Engine Error]:', error);
        }
        finally {
            // 3. Schedule next run organically (between 20,000ms and 52,000ms)
            const nextInterval = Math.floor(Math.random() * (52000 - 20000 + 1)) + 20000;
            fakeCounterTimer = setTimeout(runLoop, nextInterval);
        }
    };
    runLoop();
}
function stopFakeCounterEngine() {
    if (fakeCounterTimer) {
        clearTimeout(fakeCounterTimer);
        fakeCounterTimer = null;
    }
    isEngineRunning = false;
}
//# sourceMappingURL=fakeCounterService.js.map