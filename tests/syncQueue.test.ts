import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/database/db';
import { syncQueueRepository } from '../src/repositories/SyncQueueRepository';
import { syncEngine } from '../src/sync/syncEngine';

describe('Offline Mutation Queue & Synchronization Engine', () => {
  beforeEach(async () => {
    await db.reset();
  });

  it('enqueues mutations and preserves FIFO order', async () => {
    const item1 = await syncQueueRepository.enqueue({
      id: 'mut-1',
      type: 'TOGGLE_SAVED',
      entityId: 'blr-palace',
      payload: { isSaved: true },
      idempotencyKey: 'idemp-1',
    });

    const item2 = await syncQueueRepository.enqueue({
      id: 'mut-2',
      type: 'ADD_ITINERARY_ITEM',
      entityId: 'item-100',
      payload: { itineraryId: 'itin-1', item: {} },
      idempotencyKey: 'idemp-2',
    });

    expect(item1.status).toBe('pending');
    expect(item2.status).toBe('pending');

    const pending = await syncQueueRepository.getPending();
    expect(pending.length).toBe(2);
    expect(pending[0].id).toBe('mut-1');
    expect(pending[1].id).toBe('mut-2');
  });

  it('calculates exponential backoff correctly', () => {
    // 0 retries: base 1000ms (+/- 20% jitter)
    const delay0 = syncEngine.calculateBackoffMs(0);
    expect(delay0).toBeGreaterThanOrEqual(800);
    expect(delay0).toBeLessThanOrEqual(1300);

    // 1 retry: 2000ms (+/- 20%)
    const delay1 = syncEngine.calculateBackoffMs(1);
    expect(delay1).toBeGreaterThanOrEqual(1600);
    expect(delay1).toBeLessThanOrEqual(2500);

    // 2 retries: 4000ms (+/- 20%)
    const delay2 = syncEngine.calculateBackoffMs(2);
    expect(delay2).toBeGreaterThanOrEqual(3200);
    expect(delay2).toBeLessThanOrEqual(5000);

    // High retries: capped at 30,000ms
    const delay10 = syncEngine.calculateBackoffMs(10);
    expect(delay10).toBeLessThanOrEqual(36000);
  });

  it('tracks failed retries and errors in queue', async () => {
    await syncQueueRepository.enqueue({
      id: 'mut-fail-1',
      type: 'CREATE_ITINERARY',
      entityId: 'itin-fail',
      payload: {},
      idempotencyKey: 'idemp-fail-1',
    });

    // Mark failed on network issue
    await syncQueueRepository.markFailed('mut-fail-1', 'Server unreachable 503');

    const pending = await syncQueueRepository.getPending();
    const failedItem = pending.find((i) => i.id === 'mut-fail-1');

    expect(failedItem).toBeDefined();
    expect(failedItem?.retryCount).toBe(1);
    expect(failedItem?.lastError).toBe('Server unreachable 503');
    expect(failedItem?.status).toBe('failed');

    // Second failure
    await syncQueueRepository.markFailed('mut-fail-1', 'Timeout on POST /sync');
    const pendingAgain = await syncQueueRepository.getPending();
    const failedItemAgain = pendingAgain.find((i) => i.id === 'mut-fail-1');
    expect(failedItemAgain?.retryCount).toBe(2);
    expect(failedItemAgain?.lastError).toBe('Timeout on POST /sync');
  });

  it('removes synchronized mutations from queue upon success', async () => {
    await syncQueueRepository.enqueue({
      id: 'mut-success-1',
      type: 'TOGGLE_SAVED',
      entityId: 'blr-cubbon-park',
      payload: { isSaved: true },
      idempotencyKey: 'idemp-success-1',
    });

    let pending = await syncQueueRepository.getPending();
    expect(pending.length).toBe(1);

    await syncQueueRepository.markCompleted('mut-success-1');

    pending = await syncQueueRepository.getPending();
    expect(pending.length).toBe(0);
  });
});
