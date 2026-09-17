import { z } from 'zod';

export const GetExperiencesQuerySchema = z.object({
  city: z.string().optional(),
  category: z.string().optional(),
  search: z.string().optional(),
  priceTier: z.enum(['Free', '$', '$$', '$$$']).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
});

export const GetNearbyQuerySchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  radiusKm: z.coerce.number().default(25),
  city: z.string().optional(),
});

export const ExperienceParamSchema = z.object({
  id: z.string(),
});
