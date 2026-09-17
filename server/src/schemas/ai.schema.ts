import { z } from 'zod';

export const CitySchema = z.string().min(1);
export const CityEnum = CitySchema;

export const PlanRequestSchema = z.object({
  city: CitySchema,
  location: z.object({
    latitude: z.number(),
    longitude: z.number(),
    address: z.string().optional(),
  }),
  availableMinutes: z.number().min(30).max(1440),
  budget: z.number().min(0),
  interests: z.array(z.string()),
  preferences: z.array(z.string()),
});

export type PlanRequestInput = z.infer<typeof PlanRequestSchema>;

export const PlanStopSchema = z.object({
  experienceId: z.string(),
  startTime: z.string(),
  durationMinutes: z.number().min(15),
  reason: z.string(),
  experience: z.any().optional(),
});

export type PlanStopInput = z.infer<typeof PlanStopSchema>;

export const GeneratedPlanSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  city: CitySchema,
  stops: z.array(PlanStopSchema),
  estimatedCost: z.number(),
  estimatedTravelMinutes: z.number(),
  createdAt: z.string(),
  requestParams: PlanRequestSchema.optional(),
});

export type GeneratedPlanOutput = z.infer<typeof GeneratedPlanSchema>;

export const PlanModifierEnum = z.enum([
  'more_relaxed',
  'more_adventurous',
  'cheaper',
  'more_food',
  'less_walking',
  'more_cultural',
]);

export const RegenerateRequestSchema = z.object({
  currentPlan: GeneratedPlanSchema,
  modifier: PlanModifierEnum,
  city: CitySchema,
  location: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
    })
    .optional(),
});

export type RegenerateRequestInput = z.infer<typeof RegenerateRequestSchema>;
