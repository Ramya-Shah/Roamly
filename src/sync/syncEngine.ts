import { db } from '../database/db';
import { NetworkStatus, SyncQueueItem } from '../types';
import { sendSyncBatch } from '../api/syncApi';

type StatusListener = (status: NetworkStatus, pendingCount: number) => void;

class SyncEngine {
  private isProcessing = false;
  private currentStatus: NetworkStatus = 'ONLINE';
  private listeners: Set<StatusListener> = new Set();
  private netInfoUnsubscribe: (() => void) | null = null;
  private backoffTimeouts: Map<string, any> = new Map();

  constructor() {
    this.setupNetworkListener();
  }

  private async setupNetworkListener(): Promise<void> {
    const isReactNative =
      typeof navigator !== 'undefined' && (navigator as any).product === 'ReactNative';

    if (!isReactNative) return;

    try {
      const NetInfoModule = await import('@react-native-community/netinfo');
      const NetInfo = NetInfoModule.default || NetInfoModule;
      if (NetInfo && NetInfo.addEventListener) {
        this.netInfoUnsubscribe = NetInfo.addEventListener((state: any) => {
          const isConnected = Boolean(state.isConnected && state.isInternetReachable !== false);
          if (isConnected) {
            if (this.currentStatus === 'OFFLINE') {
              this.setStatus('ONLINE');
            }
            this.processQueue().catch(() => {});
          } else {
            this.setStatus('OFFLINE');
          }
        });
      }
    } catch {
      // NetInfo gracefully ignored in test/unsupported environments
    }
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    // Send immediate initial state
    db.getPendingMutations().then((items) => {
      listener(this.currentStatus, items.length);
    }).catch(() => {
      listener(this.currentStatus, 0);
    });

    return () => {
      this.listeners.delete(listener);
    };
  }

  private async setStatus(status: NetworkStatus): Promise<void> {
    this.currentStatus = status;
    const items = await db.getPendingMutations();
    this.notify(status, items.length);
  }

  private notify(status: NetworkStatus, pendingCount: number): void {
    for (const listener of this.listeners) {
      try {
        listener(status, pendingCount);
      } catch {}
    }
  }

  getStatus(): NetworkStatus {
    return this.currentStatus;
  }

  /**
   * Calculates exponential backoff delay based on retry count.
   * e.g., 0 retries = 1s, 1 retry = 2s, 2 retries = 4s, 3 retries = 8s, max 30s
   */
  calculateBackoffMs(retryCount: number): number {
    const baseMs = 1000;
    const maxMs = 30000;
    const delay = Math.min(baseMs * Math.pow(2, retryCount), maxMs);
    // Add small jitter (+/- 20%) to avoid thunderous herd
    const jitter = delay * 0.2 * (Math.random() - 0.5);
    return Math.round(delay + jitter);
  }

  /**
   * Processes all pending mutations sequentially in FIFO order.
   * Ensures idempotency using the idempotencyKey.
   */
  async processQueue(): Promise<{ processed: number; failed: number }> {
    if (this.isProcessing) {
      const items = await db.getPendingMutations();
      return { processed: 0, failed: items.filter((i) => i.status === 'failed').length };
    }

    const pending = await db.getPendingMutations();
    if (pending.length === 0) {
      if (this.currentStatus === 'SYNCING') {
        await this.setStatus('ONLINE');
      }
      return { processed: 0, failed: 0 };
    }

    this.isProcessing = true;
    await this.setStatus('SYNCING');

    let processedCount = 0;
    let failedCount = 0;

    for (const item of pending) {
      try {
        await db.updateMutationStatus(item.id, 'processing');

        // Send batch containing this mutation to server
        const result = await sendSyncBatch([item]);

        if (result.successfulIds.includes(item.id)) {
          await db.deleteMutation(item.id);
          processedCount++;
        } else {
          const fail = result.failed.find((f) => f.id === item.id);
          const errorMsg = fail ? fail.error : 'Unknown synchronization failure';
          await db.incrementMutationRetry(item.id, errorMsg);
          failedCount++;
        }
      } catch (err: any) {
        const errorMsg = err?.message || 'Network connection failed during sync';
        await db.incrementMutationRetry(item.id, errorMsg);
        failedCount++;

        // If network failed entirely, stop processing remaining queue and mark offline
        await this.setStatus('OFFLINE');
        break;
      }
    }

    this.isProcessing = false;

    const remaining = await db.getPendingMutations();
    if (remaining.length === 0) {
      await this.setStatus('ONLINE');
    } else if (this.currentStatus !== 'OFFLINE') {
      await this.setStatus('ERROR');
    }

    return { processed: processedCount, failed: failedCount };
  }

  /**
   * Manual force sync trigger (e.g. from UI sync indicator tap or pull-to-refresh).
   */
  async forceSync(): Promise<void> {
    await this.processQueue();
  }

  destroy(): void {
    if (this.netInfoUnsubscribe) {
      this.netInfoUnsubscribe();
      this.netInfoUnsubscribe = null;
    }
    this.backoffTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.backoffTimeouts.clear();
    this.listeners.clear();
  }
}

export const syncEngine = new SyncEngine();
