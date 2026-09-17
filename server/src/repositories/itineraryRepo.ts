import { prisma, memoryStore } from '../db/client';

export class ServerItineraryRepository {
  async getById(id: string) {
    try {
      if (process.env.DATABASE_URL) {
        return await prisma.itinerary.findUnique({
          where: { id },
          include: {
            items: {
              include: { experience: true },
              orderBy: { sortOrder: 'asc' },
            },
          },
        });
      }
    } catch {}
    return memoryStore.itineraries.get(id) || null;
  }

  async create(data: {
    id?: string;
    title: string;
    city: string;
    date: string;
    startTime?: string;
  }) {
    const id = data.id || `itin-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const itinerary = {
      id,
      title: data.title,
      city: data.city,
      date: data.date,
      startTime: data.startTime || '09:00',
      totalDurationMinutes: 0,
      totalDistanceKm: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [],
    };

    try {
      if (process.env.DATABASE_URL) {
        return await prisma.itinerary.create({
          data: {
            id,
            title: data.title,
            city: data.city,
            date: data.date,
            startTime: data.startTime || '09:00',
          },
          include: { items: true },
        });
      }
    } catch {}

    memoryStore.itineraries.set(id, itinerary);
    return itinerary;
  }

  async addItem(
    itineraryId: string,
    data: {
      id?: string;
      experienceId?: string | null;
      customTitle?: string | null;
      startTime: string;
      durationMinutes?: number;
      sortOrder?: number;
      notes?: string | null;
    }
  ) {
    const itemId = data.id || `item-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    try {
      if (process.env.DATABASE_URL) {
        return await prisma.itineraryItem.create({
          data: {
            id: itemId,
            itineraryId,
            experienceId: data.experienceId || null,
            customTitle: data.customTitle || null,
            startTime: data.startTime,
            durationMinutes: data.durationMinutes || 90,
            sortOrder: data.sortOrder || 0,
            notes: data.notes || null,
          },
        });
      }
    } catch {}

    const itin = memoryStore.itineraries.get(itineraryId);
    if (itin) {
      const exp = data.experienceId ? memoryStore.experiences.get(data.experienceId) : null;
      const newItem = {
        id: itemId,
        itineraryId,
        experienceId: data.experienceId || null,
        customTitle: data.customTitle || null,
        startTime: data.startTime,
        durationMinutes: data.durationMinutes || 90,
        sortOrder: data.sortOrder ?? itin.items.length,
        notes: data.notes || null,
        experience: exp,
      };
      itin.items.push(newItem);
      itin.totalDurationMinutes += newItem.durationMinutes;
      return newItem;
    }
    return null;
  }

  async removeItem(itineraryId: string, itemId: string) {
    try {
      if (process.env.DATABASE_URL) {
        return await prisma.itineraryItem.delete({
          where: { id: itemId },
        });
      }
    } catch {}

    const itin = memoryStore.itineraries.get(itineraryId);
    if (itin) {
      itin.items = itin.items.filter((i: any) => i.id !== itemId);
      return true;
    }
    return false;
  }
}

export const serverItineraryRepo = new ServerItineraryRepository();
