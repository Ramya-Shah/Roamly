import { db } from '../database/db';
import { City, GeneratedPlan, Itinerary } from '../types';
import { ItineraryRepository } from './ItineraryRepository';

export class GeneratedPlanRepository {
  private itineraryRepo = new ItineraryRepository();

  async getPlans(city?: City): Promise<GeneratedPlan[]> {
    return db.getGeneratedPlans(city);
  }

  async getById(id: string): Promise<GeneratedPlan | null> {
    return db.getGeneratedPlanById(id);
  }

  async savePlan(plan: GeneratedPlan): Promise<void> {
    await db.saveGeneratedPlan(plan);
  }

  async deletePlan(id: string): Promise<void> {
    await db.deleteGeneratedPlan(id);
  }

  /**
   * Seamlessly converts an AI Generated Plan into a full Trip Itinerary
   * with calculated timeline, travel intervals, and offline sync queue item.
   */
  async convertToItinerary(
    plan: GeneratedPlan,
    customTitle?: string,
    targetDate?: string
  ): Promise<Itinerary> {
    const today = targetDate || new Date().toISOString().split('T')[0];
    const initialStartTime = plan.stops[0]?.startTime || '09:00';

    const itinerary = await this.itineraryRepo.createItinerary(
      customTitle || plan.title,
      plan.city,
      today,
      initialStartTime
    );

    let currentItinerary = itinerary;

    for (const stop of plan.stops) {
      currentItinerary = await this.itineraryRepo.addItem(
        currentItinerary.id,
        stop.experienceId,
        stop.experience?.title || undefined,
        stop.durationMinutes,
        stop.reason
      );
    }

    return currentItinerary;
  }
}

export const generatedPlanRepository = new GeneratedPlanRepository();
