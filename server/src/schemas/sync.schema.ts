import { z } from 'zod';

export const MutationSchema = z.object({
  id: z.string(),
  type: z.enum([
    'CREATE_ITINERARY',
    'ADD_ITINERARY_ITEM',
    'REMOVE_ITINERARY_ITEM',
    'REORDER_ITINERARY_ITEMS',
    'UPDATE_ITINERARY_ITEM',
    'TOGGLE_SAVED',
  ]),
  entityId: z.string(),
  payload: z.record(z.any()),
  idempotencyKey: z.string(),
  createdAt: z.string(),
});

export const SyncBatchBodySchema = z.object({
  mutations: z.array(MutationSchema),
});

export const SavedExperienceBodySchema = z.object({
  experienceId: z.string(),
  isSaved: z.boolean(),
});
