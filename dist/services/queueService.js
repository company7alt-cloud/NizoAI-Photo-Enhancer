"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queueService = void 0;
class QueueService {
    activeCount = 0;
    maxConcurrent = 10;
    processorFn = null;
    setProcessor(fn) {
        this.processorFn = fn;
    }
    addItem(item) {
        if (this.activeCount >= this.maxConcurrent) {
            return { queued: false, full: true };
        }
        this.activeCount++;
        // Process async and non-blocking
        setTimeout(() => {
            this.processItem(item);
        }, 0);
        return { queued: true };
    }
    async processItem(item) {
        if (!this.processorFn) {
            this.activeCount--;
            return;
        }
        try {
            await this.processorFn(item);
        }
        catch (err) {
            console.error('[QueueService] Error processing item:', err);
        }
        finally {
            this.activeCount--;
        }
    }
    getStats() {
        return {
            activeJobs: this.activeCount,
            maxConcurrent: this.maxConcurrent,
        };
    }
}
exports.queueService = new QueueService();
//# sourceMappingURL=queueService.js.map