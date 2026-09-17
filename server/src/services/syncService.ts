import { prisma, memoryStore } from '../db/client';
import { serverItineraryRepo } from '../repositories/itineraryRepo';
import { serverSavedRepo } from '../repositories/savedRepo';

export interface MutationItem {
  id: string;
  type: string;
  entityId: string;
  payload: Record<string, any>;
  idempotencyKey: string;
  createdAt: string;
}

export class SyncService {
  async processBatch(mutations: MutationItem[]): Promise<{
    successfulIds: string[];
    failed: Array<{ id: string; error: string }>;
  }> {
    const successfulIds: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const m of mutations) {
      try {
        // 1. Check Idempotency
        const isProcessed = await this.isIdempotencyKeyProcessed(m.idempotencyKey);
        if (isProcessed) {
          // Already processed; return success idempotently
          successfulIds.push(m.id);
          continue;
        }

        // 2. Dispatch by type
        await this.dispatchMutation(m);

        // 3. Mark idempotency key as processed
        await this.recordIdempotencyKey(m);
        successfulIds.push(m.id);
      } catch (err: any) {
        failed.push({
          id: m.id,
          error: err.message || 'Error processing mutation',
        });
      }
    }

    return { successfulIds, failed };
  }

  private async isIdempotencyKeyProcessed(key: string): Promise<boolean> {
    try {
      if (process.env.DATABASE_URL) {
        const log = await prisma.syncLog.findUnique({
          where: { idempotencyKey: key },
        });
        return Boolean(log);
      }
    } catch {}

    return memoryStore.processedIdempotencyKeys.has(key);
  }

  private async recordIdempotencyKey(m: MutationItem): Promise<void> {
    try {
      if (process.env.DATABASE_URL) {
        await prisma.syncLog.create({
          data: {
            idempotencyKey: m.idempotencyKey,
            actionType: m.type,
            entityId: m.entityId,
            payload: JSON.stringify(m.payload),
          },
        });
        return;
      }
    } catch {}

    memoryStore.processedIdempotencyKeys.add(m.idempotencyKey);
  }

  private async dispatchMutation(m: MutationItem): Promise<void> {
    switch (m.type) {
      case 'CREATE_ITINERARY': {
        const itin = m.payload.itinerary;
        await serverItineraryRepo.create({
          id: itin.id,
          title: itin.title,
          city: itin.city,
          date: itin.date,
          startTime: itin.startTime,
        });
        break;
      }

      case 'ADD_ITINERARY_ITEM': {
        const { itineraryId, item } = m.payload;
        await serverItineraryRepo.addItem(itineraryId, {
          id: item.id,
          experienceId: item.experienceId,
          customTitle: item.customTitle,
          startTime: item.startTime,
          durationMinutes: item.durationMinutes,
          sortOrder: item.sortOrder,
          notes: item.notes,
        });
        break;
      }

      case 'REMOVE_ITINERARY_ITEM': {
        const { itineraryId, itemId } = m.payload;
        await serverItineraryRepo.removeItem(itineraryId, itemId);
        break;
      }

      case 'TOGGLE_SAVED': {
        const { experienceId, isSaved, userId } = m.payload;
        await serverSavedRepo.toggleSaved(userId || 'default-user', experienceId, Boolean(isSaved));
        break;
      }

      case 'REORDER_ITINERARY_ITEMS':
      case 'UPDATE_ITINERARY_ITEM':
        // Handled optimistically on client; server stores state
        break;

      default:
        throw new Error(`Unsupported mutation type: ${m.type}`);
    }
  }
}

export const syncService = new SyncService();
