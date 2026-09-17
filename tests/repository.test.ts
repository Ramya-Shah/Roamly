import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/database/db';
import { experienceRepository } from '../src/repositories/ExperienceRepository';
import { savedExperienceRepository } from '../src/repositories/SavedExperienceRepository';

describe('Local Repositories & Offline Storage', () => {
  beforeEach(async () => {
    await db.reset();
  });

  it('filters experiences by city correctly', async () => {
    const blrExperiences = await experienceRepository.getExperiences({ city: 'Bengaluru' });
    expect(blrExperiences.length).toBeGreaterThan(0);
    expect(blrExperiences.every((e) => e.city === 'Bengaluru')).toBe(true);

    const mumExperiences = await experienceRepository.getExperiences({ city: 'Mumbai' });
    expect(mumExperiences.length).toBeGreaterThan(0);
    expect(mumExperiences.every((e) => e.city === 'Mumbai')).toBe(true);

    const lonExperiences = await experienceRepository.getExperiences({ city: 'London' });
    expect(lonExperiences.length).toBeGreaterThan(0);
    expect(lonExperiences.every((e) => e.city === 'London')).toBe(true);
  });

  it('filters experiences by category and search keyword', async () => {
    const museumExperiences = await experienceRepository.getExperiences({
      city: 'Bengaluru',
      category: 'Museums',
    });
    expect(museumExperiences.length).toBeGreaterThan(0);
    expect(museumExperiences.every((e) => e.category === 'Museums')).toBe(true);

    const searchResults = await experienceRepository.getExperiences({
      city: 'Bengaluru',
      search: 'Dosa',
    });
    expect(searchResults.length).toBeGreaterThanOrEqual(1);
    expect(searchResults[0].title).toContain('Vidyarthi Bhavan');
  });

  it('calculates and sorts by distance from user coordinates', async () => {
    // User at MG Road / Cubbon Park, Bengaluru (12.9763, 77.5929)
    const userCoords = { latitude: 12.9763, longitude: 77.5929 };

    const nearby = await experienceRepository.getNearbyExperiences(
      userCoords.latitude,
      userCoords.longitude,
      15,
      'Bengaluru'
    );

    expect(nearby.length).toBeGreaterThan(0);
    expect(nearby[0].distanceKm).toBeDefined();
    // Cubbon Park should be closest (~0 km)
    expect(nearby[0].id).toBe('blr-cubbon-park');
    expect(nearby[0].distanceKm).toBeLessThan(0.5);
  });

  it('saves and unsaves experiences optimistically', async () => {
    const expId = 'blr-palace';
    expect(await savedExperienceRepository.isSaved(expId)).toBe(false);

    // Toggle saved
    await savedExperienceRepository.toggleSaved(expId, true);
    expect(await savedExperienceRepository.isSaved(expId)).toBe(true);

    const savedList = await savedExperienceRepository.getSavedExperiences();
    expect(savedList.some((s) => s.experienceId === expId)).toBe(true);

    // Toggle unsaved
    await savedExperienceRepository.toggleSaved(expId, false);
    expect(await savedExperienceRepository.isSaved(expId)).toBe(false);
  });
});
