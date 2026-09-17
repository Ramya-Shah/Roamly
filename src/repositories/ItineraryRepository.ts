import { db } from '../database/db';
import { City, Itinerary, ItineraryItem } from '../types';
import { recalculateTimeline } from '../utils/distance';

export class ItineraryRepository {
  async getItineraries(city?: City): Promise<Itinerary[]> {
    return db.getItineraries(city);
  }

  async getById(id: string): Promise<Itinerary | null> {
    return db.getItineraryById(id);
  }

  async createItinerary(
    title: string,
    city: City,
    date: string,
    startTime: string = '09:00'
  ): Promise<Itinerary> {
    const id = `itin-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const newItinerary: Itinerary = {
      id,
      title,
      city,
      date,
      startTime,
      totalDurationMinutes: 0,
      totalDistanceKm: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: [],
    };

    await db.saveItinerary(newItinerary);

    // Enqueue mutation for sync
    await db.enqueueMutation({
      id: `mut-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      type: 'CREATE_ITINERARY',
      entityId: id,
      payload: { itinerary: newItinerary },
      idempotencyKey: `create-itin-${id}`,
    });

    return newItinerary;
  }

  async addItem(
    itineraryId: string,
    experienceId?: string | null,
    customTitle?: string | null,
    durationMinutes: number = 120,
    notes?: string | null
  ): Promise<Itinerary> {
    const itin = await db.getItineraryById(itineraryId);
    if (!itin) throw new Error(`Itinerary ${itineraryId} not found`);

    let experience = undefined;
    if (experienceId) {
      const exp = await db.getExperienceById(experienceId);
      if (exp) experience = exp;
    }

    const newItemId = `item-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const rawItem: ItineraryItem = {
      id: newItemId,
      itineraryId,
      experienceId: experienceId || null,
      customTitle: customTitle || (experience ? experience.title : 'Custom Stop'),
      startTime: itin.startTime,
      durationMinutes: durationMinutes || (experience ? experience.durationMinutes : 90),
      sortOrder: itin.items.length,
      travelTimeMinutes: 0,
      travelDistanceKm: 0,
      notes: notes || null,
      experience,
    };

    const combined = [...itin.items, rawItem];
    const recalculated = recalculateTimeline(itin.startTime, combined);

    itin.items = recalculated.items;
    itin.totalDurationMinutes = recalculated.totalDurationMinutes;
    itin.totalDistanceKm = recalculated.totalDistanceKm;
    itin.updatedAt = new Date().toISOString();

    await db.saveItinerary(itin);

    // Enqueue mutation
    await db.enqueueMutation({
      id: `mut-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      type: 'ADD_ITINERARY_ITEM',
      entityId: newItemId,
      payload: {
        itineraryId,
        item: rawItem,
      },
      idempotencyKey: `add-item-${newItemId}`,
    });

    return itin;
  }

  async removeItem(itineraryId: string, itemId: string): Promise<Itinerary> {
    const itin = await db.getItineraryById(itineraryId);
    if (!itin) throw new Error(`Itinerary ${itineraryId} not found`);

    const filtered = itin.items.filter((i) => i.id !== itemId);
    const recalculated = recalculateTimeline(itin.startTime, filtered);

    itin.items = recalculated.items;
    itin.totalDurationMinutes = recalculated.totalDurationMinutes;
    itin.totalDistanceKm = recalculated.totalDistanceKm;
    itin.updatedAt = new Date().toISOString();

    await db.saveItinerary(itin);

    // Enqueue mutation
    await db.enqueueMutation({
      id: `mut-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      type: 'REMOVE_ITINERARY_ITEM',
      entityId: itemId,
      payload: { itineraryId, itemId },
      idempotencyKey: `remove-item-${itemId}`,
    });

    return itin;
  }

  async reorderItems(itineraryId: string, itemIds: string[]): Promise<Itinerary> {
    const itin = await db.getItineraryById(itineraryId);
    if (!itin) throw new Error(`Itinerary ${itineraryId} not found`);

    const itemMap = new Map(itin.items.map((i) => [i.id, i]));
    const reordered: ItineraryItem[] = [];

    for (const id of itemIds) {
      const item = itemMap.get(id);
      if (item) reordered.push(item);
    }

    const recalculated = recalculateTimeline(itin.startTime, reordered);
    itin.items = recalculated.items;
    itin.totalDurationMinutes = recalculated.totalDurationMinutes;
    itin.totalDistanceKm = recalculated.totalDistanceKm;
    itin.updatedAt = new Date().toISOString();

    await db.saveItinerary(itin);

    // Enqueue mutation
    await db.enqueueMutation({
      id: `mut-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      type: 'REORDER_ITINERARY_ITEMS',
      entityId: itineraryId,
      payload: { itineraryId, itemIds },
      idempotencyKey: `reorder-${itineraryId}-${Date.now()}`,
    });

    return itin;
  }

  async updateItemDuration(
    itineraryId: string,
    itemId: string,
    newDurationMinutes: number
  ): Promise<Itinerary> {
    const itin = await db.getItineraryById(itineraryId);
    if (!itin) throw new Error(`Itinerary ${itineraryId} not found`);

    const item = itin.items.find((i) => i.id === itemId);
    if (item) {
      item.durationMinutes = newDurationMinutes;
      const recalculated = recalculateTimeline(itin.startTime, itin.items);
      itin.items = recalculated.items;
      itin.totalDurationMinutes = recalculated.totalDurationMinutes;
      itin.totalDistanceKm = recalculated.totalDistanceKm;
      itin.updatedAt = new Date().toISOString();

      await db.saveItinerary(itin);

      await db.enqueueMutation({
        id: `mut-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        type: 'UPDATE_ITINERARY_ITEM',
        entityId: itemId,
        payload: { itineraryId, itemId, durationMinutes: newDurationMinutes },
        idempotencyKey: `update-item-${itemId}-${Date.now()}`,
      });
    }

    return itin;
  }

  async deleteItinerary(id: string): Promise<void> {
    await db.deleteItinerary(id);
  }
}

export const itineraryRepository = new ItineraryRepository();
