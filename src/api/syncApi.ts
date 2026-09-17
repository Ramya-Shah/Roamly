import { apiClient } from './client';
import { SyncQueueItem, SyncResult } from '../types';

export async function sendSyncBatch(mutations: SyncQueueItem[]): Promise<SyncResult> {
  const response = await apiClient<SyncResult>('/sync', {
    method: 'POST',
    body: JSON.stringify({ mutations }),
  });

  if (response.data) {
    return response.data;
  }

  throw new Error(response.error || 'Failed to sync mutations with server');
}
