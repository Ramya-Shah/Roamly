import { db } from '../database/db';
import { SavedExperience } from '../types';

export class SavedExperienceRepository {
  async getSavedExperiences(): Promise<SavedExperience[]> {
    return db.getSavedExperiences();
  }

  async isSaved(experienceId: string): Promise<boolean> {
    return db.isExperienceSaved(experienceId);
  }

  async toggleSaved(experienceId: string, isSaved: boolean): Promise<boolean> {
    // 1. Apply local SQLite update immediately
    await db.toggleSavedExperience(experienceId, isSaved);

    // 2. Enqueue mutation for offline sync
    await db.enqueueMutation({
      id: `mut-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      type: 'TOGGLE_SAVED',
      entityId: experienceId,
      payload: { experienceId, isSaved },
      idempotencyKey: `saved-${experienceId}-${Date.now()}`,
    });

    return isSaved;
  }
}

export const savedExperienceRepository = new SavedExperienceRepository();
