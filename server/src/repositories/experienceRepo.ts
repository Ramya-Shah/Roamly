import { prisma, memoryStore } from '../db/client';

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

export class ServerExperienceRepository {
  async getExperiences(filters: {
    city?: string;
    category?: string;
    search?: string;
    priceTier?: string;
    minRating?: number;
  }) {
    // Check if Postgres Prisma is available
    try {
      if (process.env.DATABASE_URL) {
        const where: any = {};
        if (filters.city) where.city = { equals: filters.city, mode: 'insensitive' };
        if (filters.category && filters.category !== 'All') where.category = filters.category;
        if (filters.priceTier && filters.priceTier !== 'All') where.priceTier = filters.priceTier;
        if (filters.minRating) where.rating = { gte: filters.minRating };
        if (filters.search) {
          where.OR = [
            { title: { contains: filters.search, mode: 'insensitive' } },
            { description: { contains: filters.search, mode: 'insensitive' } },
          ];
        }
        return await prisma.experience.findMany({
          where,
          orderBy: [{ isFeatured: 'desc' }, { rating: 'desc' }],
        });
      }
    } catch {}

    // In-memory fallback
    let list = Array.from(memoryStore.experiences.values());
    if (filters.city) list = list.filter((e) => e.city.toLowerCase() === filters.city!.toLowerCase());
    if (filters.category && filters.category !== 'All') list = list.filter((e) => e.category === filters.category);
    if (filters.priceTier && filters.priceTier !== 'All') list = list.filter((e) => e.priceTier === filters.priceTier);
    if (filters.minRating) list = list.filter((e) => e.rating >= filters.minRating!);
    if (filters.search) {
      const s = filters.search.toLowerCase();
      list = list.filter(
        (e) =>
          e.title.toLowerCase().includes(s) ||
          e.description.toLowerCase().includes(s) ||
          (e.tags && e.tags.some((t: string) => t.toLowerCase().includes(s)))
      );
    }
    return list;
  }

  async getById(id: string) {
    try {
      if (process.env.DATABASE_URL) {
        return await prisma.experience.findUnique({ where: { id } });
      }
    } catch {}
    return memoryStore.experiences.get(id) || null;
  }

  async getNearby(lat: number, lng: number, radiusKm: number = 25, city?: string) {
    const experiences = await this.getExperiences({ city });
    return experiences
      .map((exp) => {
        const dist = haversineDistance(lat, lng, exp.latitude, exp.longitude);
        return { ...exp, distanceKm: dist };
      })
      .filter((exp) => exp.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }

  async getCategories() {
    try {
      if (process.env.DATABASE_URL) {
        return await prisma.category.findMany({ orderBy: { sortOrder: 'asc' } });
      }
    } catch {}
    return Array.from(memoryStore.categories.values()).sort((a, b) => a.sortOrder - b.sortOrder);
  }
}

export const serverExperienceRepo = new ServerExperienceRepository();
