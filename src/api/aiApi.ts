import { apiClient } from './client';
import {
  AIPlanRequest,
  GeneratedPlan,
  RegeneratePlanRequest,
} from '../types';

export async function generateAIPlan(
  request: AIPlanRequest
): Promise<{ success: boolean; plan: GeneratedPlan | null; error: string | null }> {
  console.log(`🚀 [Mobile App] Requesting AI plan for ${request.city} (${request.availableMinutes} mins, budget: ${request.budget})...`);
  const res = await apiClient<{ success: boolean; plan: GeneratedPlan }>(
    '/ai/plan',
    {
      method: 'POST',
      body: JSON.stringify(request),
      timeoutMs: 40000, // 25s timeout for AI generation
    }
  );

  if (res.data?.success && res.data.plan) {
    console.log(`✨ [Mobile App] AI Plan received successfully: "${res.data.plan.title}" with ${res.data.plan.stops.length} stops!`);
    return { success: true, plan: res.data.plan, error: null };
  }

  console.warn(`⚠️ [Mobile App] AI Plan request returned:`, res.error);
  return {
    success: false,
    plan: null,
    error: res.error || 'Failed to generate plan',
  };
}

export async function regenerateAIPlan(
  request: RegeneratePlanRequest
): Promise<{ success: boolean; plan: GeneratedPlan | null; error: string | null }> {
  const res = await apiClient<{ success: boolean; plan: GeneratedPlan }>(
    '/ai/regenerate',
    {
      method: 'POST',
      body: JSON.stringify(request),
      timeoutMs: 40000,
    }
  );

  if (res.data?.success && res.data.plan) {
    return { success: true, plan: res.data.plan, error: null };
  }

  return {
    success: false,
    plan: null,
    error: res.error || 'Failed to regenerate plan',
  };
}
