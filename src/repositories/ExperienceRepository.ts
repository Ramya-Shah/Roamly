import { db } from '../database/db';
import { City, Experience, ExperienceFilter } from '../types';
import { calculateDistanceKm } from '../utils/distance';

export class ExperienceRepository {
  async getExperiences(filter: ExperienceFilter, userCoords?: { latitude: number; longitude: number } | null): Promise<Experience[]> {
    const list = await db.getExperiences(filter.city, filter.category, filter.search);

    // Compute distance if user coordinates are available
    let enriched = list.map((exp) => {
      if (userCoords && exp.latitude && exp.longitude) {
        const dist = calculateDistanceKm(userCoords.latitude, userCoords.longitude, exp.latitude, exp.longitude);
        return { ...exp, distanceKm: dist };
      }
      return exp;
    });

    // Apply price tier filtering if specified
    if (filter.priceTier) {
      enriched = enriched.filter((e) => e.priceTier === filter.priceTier);
    }

    // Apply minimum rating filtering if specified
    if (filter.minRating) {
      enriched = enriched.filter((e) => e.rating >= filter.minRating!);
    }

    // Apply sorting
    if (filter.sortBy === 'distance' && userCoords) {
      enriched.sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999));
    } else if (filter.sortBy === 'rating') {
      enriched.sort((a, b) => b.rating - a.rating);
    } else if (filter.sortBy === 'popular') {
      enriched.sort((a, b) => b.reviewCount - a.reviewCount);
    }

    return enriched;
  }

  async getFeaturedExperiences(city: City): Promise<Experience[]> {
    const all = await db.getExperiences(city);
    return all.filter((e) => e.isFeatured);
  }

  async getNearbyExperiences(
    latitude: number,
    longitude: number,
    radiusKm: number = 25,
    city?: City
  ): Promise<Experience[]> {
    const all = await db.getExperiences(city);
    const nearby = all
      .map((exp) => {
        const dist = calculateDistanceKm(latitude, longitude, exp.latitude, exp.longitude);
        return { ...exp, distanceKm: dist };
      })
      .filter((exp) => (exp.distanceKm ?? 999) <= radiusKm)
      .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));

    return nearby;
  }

  async getById(id: string): Promise<Experience | null> {
    return db.getExperienceById(id);
  }

  async cacheExperiences(experiences: Experience[]): Promise<void> {
    await db.upsertExperiences(experiences);
  }

  async getCategories() {
    return db.getCategories();
  }
}

export const experienceRepository = new ExperienceRepository();
