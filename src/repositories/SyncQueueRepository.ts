import { db } from '../database/db';
import { SyncQueueItem } from '../types';

export class SyncQueueRepository {
  async getPending(): Promise<SyncQueueItem[]> {
    return db.getPendingMutations();
  }

  async enqueue(
    mutation: Omit<SyncQueueItem, 'status' | 'retryCount' | 'createdAt'>
  ): Promise<SyncQueueItem> {
    return db.enqueueMutation(mutation);
  }

  async markProcessing(id: string): Promise<void> {
    await db.updateMutationStatus(id, 'processing');
  }

  async markCompleted(id: string): Promise<void> {
    await db.deleteMutation(id);
  }

  async markFailed(id: string, error: string): Promise<void> {
    await db.incrementMutationRetry(id, error);
  }

  async delete(id: string): Promise<void> {
    await db.deleteMutation(id);
  }

  async getQueueStats(): Promise<{ pendingCount: number; failedCount: number }> {
    const items = await db.getPendingMutations();
    const pendingCount = items.filter((i) => i.status === 'pending').length;
    const failedCount = items.filter((i) => i.status === 'failed').length;
    return { pendingCount, failedCount };
  }
}

export const syncQueueRepository = new SyncQueueRepository();
