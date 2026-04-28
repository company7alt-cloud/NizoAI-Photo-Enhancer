export type Resolution = '2K' | '4K' | '8K';
export interface QueueItem {
    userId: number;
    chatId: number;
    messageId: number;
    fileId: string;
    fileUrl: string;
    resolution: Resolution;
}
declare class QueueService {
    private activeCount;
    private maxConcurrent;
    private processorFn;
    setProcessor(fn: (item: QueueItem) => Promise<void>): void;
    addItem(item: QueueItem): {
        queued: boolean;
        full?: boolean;
    };
    private processItem;
    getStats(): {
        activeJobs: number;
        maxConcurrent: number;
    };
}
export declare const queueService: QueueService;
export {};
