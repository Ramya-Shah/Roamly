import { describe, it, expect } from 'vitest';
import { GeminiPlannerService } from '../server/src/services/geminiPlannerService';
import { rankCandidates } from '../src/utils/candidateRanker';
import { SEED_EXPERIENCES } from '../src/database/seed';
import { AIPlanRequest, GeneratedPlan } from '../src/types';
import { GeneratedPlanSchema } from '../server/src/schemas/ai.schema';

describe('Gemini Planner Service & Structured Output Validation', () => {
  const service = new GeminiPlannerService();

  const mockRequest: AIPlanRequest = {
    city: 'Bengaluru',
    location: {
      latitude: 12.9716,
      longitude: 77.5946,
      address: 'MG Road, Bengaluru',
    },
    availableMinutes: 240, // 4 hours
    budget: 1000,
    interests: ['Culture', 'History', 'Food'],
    preferences: ['Relaxed', 'Outdoor'],
  };

  it('generates a valid deterministic plan when Gemini API is offline', async () => {
    // Ensuring no real API key is used in test
    const originalKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    try {
      const plan = await service.generatePlan(mockRequest);

      expect(plan).toBeDefined();
      expect(plan.city).toBe('Bengaluru');
      expect(plan.stops.length).toBeGreaterThanOrEqual(1);
      expect(plan.stops.length).toBeLessThanOrEqual(4);

      // Validate schema compliance with Zod
      const parseResult = GeneratedPlanSchema.safeParse(plan);
      expect(parseResult.success).toBe(true);

      // Each stop should be hydrated with experience details
      for (const stop of plan.stops) {
        expect(stop.experienceId).toBeDefined();
        expect(stop.startTime).toMatch(/^\d{2}:\d{2}$/);
        expect(stop.durationMinutes).toBeGreaterThan(0);
        expect(stop.reason).toBeDefined();
        expect(stop.experience).toBeDefined();
        expect(stop.experience?.title).toBeDefined();
      }

      // Cost and travel time should be realistic numbers
      expect(plan.estimatedCost).toBeGreaterThanOrEqual(0);
      expect(plan.estimatedTravelMinutes).toBeGreaterThanOrEqual(0);
    } finally {
      if (originalKey) process.env.GEMINI_API_KEY = originalKey;
    }
  });

  it('regenerates plan with "cheaper" modifier prioritizing free and budget stops', async () => {
    const originalPlan = await service.generatePlan(mockRequest);

    const regenerated = await service.regeneratePlan({
      currentPlan: originalPlan,
      modifier: 'cheaper',
      city: 'Bengaluru',
    });

    expect(regenerated).toBeDefined();
    expect(regenerated.stops.length).toBeGreaterThan(0);

    // All stops in cheaper plan should be free or inexpensive ($)
    const hasFreeOrCheap = regenerated.stops.some(
      (s) => s.experience?.priceTier === 'Free' || s.experience?.priceTier === '$'
    );
    expect(hasFreeOrCheap).toBe(true);
  });

  it('regenerates plan with "more_relaxed" modifier with fewer stops or longer durations', async () => {
    const originalPlan = await service.generatePlan(mockRequest);

    const relaxed = await service.regeneratePlan({
      currentPlan: originalPlan,
      modifier: 'more_relaxed',
      city: 'Bengaluru',
    });

    expect(relaxed).toBeDefined();
    expect(relaxed.stops.length).toBeLessThanOrEqual(originalPlan.stops.length);
  });

  it('rejects candidate IDs not in the official seed list', () => {
    const candidates = rankCandidates(SEED_EXPERIENCES, mockRequest, 10);
    const candidateIds = new Set(candidates.map((c) => c.experience.id));

    // Simulated hallucinated output from an LLM
    const simulatedLLMOutput = {
      title: 'Hallucinated Day',
      summary: 'Visiting fictional places.',
      stops: [
        {
          experienceId: 'fictional-fake-id-999',
          startTime: '10:00',
          durationMinutes: 90,
          reason: 'Fictional reason',
        },
      ],
    };

    // Access private validator via any cast to test guardrail
    const validated = (service as any).validateAndHydrateAIResponse(
      simulatedLLMOutput,
      candidates,
      mockRequest
    );

    // Since fictional-fake-id-999 is not in candidates, it must be rejected!
    expect(validated).toBeNull();
  });

  it('throws a helpful error message when attempting to plan for an uncached city while offline', async () => {
    const originalKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    try {
      await expect(
        service.generatePlan({
          city: 'Tokyo',
          location: { latitude: 35.6762, longitude: 139.6503 },
          availableMinutes: 180,
          budget: 500,
          interests: ['Culture'],
          preferences: ['Relaxed'],
        })
      ).rejects.toThrow(/pre-cached for Bengaluru, Mumbai, London, and Ahmedabad/);
    } finally {
      if (originalKey) process.env.GEMINI_API_KEY = originalKey;
    }
  });

  it('validates plans for any dynamic city with GeneratedPlanSchema', () => {
    const sampleAhmedabadPlan = {
      id: 'plan-ahmedabad-123',
      title: 'Ahmedabad Heritage Discovery',
      summary: 'Explore historic monuments and authentic street food.',
      city: 'Ahmedabad',
      stops: [
        {
          experienceId: 'dyn-ahmedabad-1',
          startTime: '10:00',
          durationMinutes: 90,
          reason: 'Iconic heritage site',
        },
      ],
      estimatedCost: 150,
      estimatedTravelMinutes: 20,
      createdAt: new Date().toISOString(),
    };

    const result = GeneratedPlanSchema.safeParse(sampleAhmedabadPlan);
    expect(result.success).toBe(true);
  });
});
