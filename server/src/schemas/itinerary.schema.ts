import { z } from 'zod';

export const CreateItineraryBodySchema = z.object({
  title: z.string().min(1),
  city: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  startTime: z.string().default('09:00'),
});

export const AddItineraryItemBodySchema = z.object({
  experienceId: z.string().nullable().optional(),
  customTitle: z.string().nullable().optional(),
  startTime: z.string().default('09:00'),
  durationMinutes: z.number().int().positive().default(90),
  sortOrder: z.number().int().nonnegative().optional(),
  notes: z.string().nullable().optional(),
});

export const ItineraryParamSchema = z.object({
  id: z.string(),
});

export const ItineraryItemParamSchema = z.object({
  id: z.string(),
  itemId: z.string(),
});
