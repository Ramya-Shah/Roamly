import { PrismaClient } from '@prisma/client';
import { SEED_CATEGORIES, SEED_EXPERIENCES } from './seedData';

export const prisma = new PrismaClient();

// In-memory fallback data store for offline dev or automated test runners
export class MemoryDataStore {
  public experiences: Map<string, any> = new Map();
  public categories: Map<string, any> = new Map();
  public itineraries: Map<string, any> = new Map();
  public saved: Set<string> = new Set();
  public processedIdempotencyKeys: Set<string> = new Set();
  public generatedPlans: Map<string, any> = new Map();

  constructor() {
    this.seed();
  }

  private seed() {
    for (const c of SEED_CATEGORIES) {
      this.categories.set(c.id, c);
    }

    for (const exp of SEED_EXPERIENCES) {
      this.experiences.set(exp.id, exp);
    }
  }
}

export const memoryStore = new MemoryDataStore();
