// src/services/queueService.ts
export type Resolution = '2K' | '4K' | '8K';

export interface QueueItem {
  userId: number;
  chatId: number;
  messageId: number;
  fileId: string;
  fileUrl: string;
  resolution: Resolution;
}

class QueueService {
  private activeCount: number = 0;
  private maxConcurrent: number = 10;
  private processorFn: ((item: QueueItem) => Promise<void>) | null = null;

  public setProcessor(fn: (item: QueueItem) => Promise<void>): void {
    this.processorFn = fn;
  }

  public addItem(item: QueueItem): { queued: boolean; full?: boolean } {
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

  private async processItem(item: QueueItem): Promise<void> {
    if (!this.processorFn) {
      this.activeCount--;
      return;
    }

    try {
      await this.processorFn(item);
    } catch (err: unknown) {
      console.error('[QueueService] Error processing item:', err);
    } finally {
      this.activeCount--;
    }
  }

  public getStats(): { activeJobs: number; maxConcurrent: number } {
    return {
      activeJobs: this.activeCount,
      maxConcurrent: this.maxConcurrent,
    };
  }
}

export const queueService = new QueueService();
