import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/database/db';
import { GeneratedPlanRepository } from '../src/repositories/GeneratedPlanRepository';
import { GeneratedPlan } from '../src/types';

describe('AI Plan Local Persistence & Offline Retrieval', () => {
  const repo = new GeneratedPlanRepository();

  const testPlan: GeneratedPlan = {
    id: 'test-ai-plan-001',
    title: 'Saturday Cultural Trail',
    summary: 'A 3-stop exploration of Bengaluru museums and heritage.',
    city: 'Bengaluru',
    stops: [
      {
        experienceId: 'blr-palace',
        startTime: '10:00',
        durationMinutes: 120,
        reason: 'Iconic royal heritage site.',
      },
      {
        experienceId: 'blr-visvesvaraya',
        startTime: '12:30',
        durationMinutes: 120,
        reason: 'Hands-on technological wonderland.',
      },
    ],
    estimatedCost: 335,
    estimatedTravelMinutes: 25,
    createdAt: new Date().toISOString(),
  };

  beforeEach(async () => {
    await db.init();
    await repo.deletePlan(testPlan.id);
  });

  it('persists AI generated plan to local storage engine', async () => {
    await repo.savePlan(testPlan);

    const retrieved = await repo.getById(testPlan.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(testPlan.id);
    expect(retrieved?.title).toBe(testPlan.title);
    expect(retrieved?.stops.length).toBe(2);

    // Verify stop hydration
    expect(retrieved?.stops[0].experience).toBeDefined();
    expect(retrieved?.stops[0].experience?.title).toBe('Bangalore Palace');
  });

  it('filters plans by city', async () => {
    await repo.savePlan(testPlan);

    const blrPlans = await repo.getPlans('Bengaluru');
    expect(blrPlans.some((p) => p.id === testPlan.id)).toBe(true);

    const lonPlans = await repo.getPlans('London');
    expect(lonPlans.some((p) => p.id === testPlan.id)).toBe(false);
  });

  it('converts an AI plan into an Itinerary with sync mutation enqueued', async () => {
    await repo.savePlan(testPlan);

    const itinerary = await repo.convertToItinerary(
      testPlan,
      'My Custom Saturday Tour',
      '2026-09-20'
    );

    expect(itinerary).toBeDefined();
    expect(itinerary.title).toBe('My Custom Saturday Tour');
    expect(itinerary.city).toBe('Bengaluru');
    expect(itinerary.date).toBe('2026-09-20');
    expect(itinerary.items.length).toBe(2);
    expect(itinerary.items[0].experienceId).toBe('blr-palace');
    expect(itinerary.items[1].experienceId).toBe('blr-visvesvaraya');

    // Verify that sync queue recorded this offline mutation
    const queue = await db.getPendingMutations();
    const itinMutation = queue.find((q) => q.entityId === itinerary.id);
    expect(itinMutation).toBeDefined();
    expect(itinMutation?.type).toBe('CREATE_ITINERARY');
  });

  it('deletes a generated plan cleanly', async () => {
    await repo.savePlan(testPlan);
    expect(await repo.getById(testPlan.id)).not.toBeNull();

    await repo.deletePlan(testPlan.id);
    expect(await repo.getById(testPlan.id)).toBeNull();
  });
});
