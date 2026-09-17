import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/database/db';
import { itineraryRepository } from '../src/repositories/ItineraryRepository';
import { recalculateTimeline } from '../src/utils/distance';
import { ItineraryItem } from '../src/types';

describe('Itinerary Management & Timeline Calculation', () => {
  beforeEach(async () => {
    await db.reset();
  });

  it('creates an itinerary and enqueues a sync mutation', async () => {
    const itin = await itineraryRepository.createItinerary(
      'Saturday in Bengaluru Test',
      'Bengaluru',
      '2026-09-19',
      '10:00'
    );

    expect(itin).toBeDefined();
    expect(itin.title).toBe('Saturday in Bengaluru Test');
    expect(itin.city).toBe('Bengaluru');
    expect(itin.startTime).toBe('10:00');

    // Verify it exists in database
    const fetched = await itineraryRepository.getById(itin.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.title).toBe('Saturday in Bengaluru Test');

    // Verify mutation was queued
    const pendingMutations = await db.getPendingMutations();
    const createMutation = pendingMutations.find((m) => m.type === 'CREATE_ITINERARY');
    expect(createMutation).toBeDefined();
    expect(createMutation?.entityId).toBe(itin.id);
  });

  it('adds items to an itinerary and recalculates timeline start times', async () => {
    const itin = await itineraryRepository.createItinerary(
      'Full Day Tour',
      'Bengaluru',
      '2026-09-19',
      '10:00'
    );

    // Add Stop 1: Bangalore Palace (duration: 120 mins)
    const afterFirst = await itineraryRepository.addItem(
      itin.id,
      'blr-palace',
      'Bangalore Palace',
      120
    );
    expect(afterFirst.items.length).toBe(1);
    expect(afterFirst.items[0].startTime).toBe('10:00');

    // Add Stop 2: Lunch at Vidyarthi Bhavan (duration: 60 mins)
    const afterSecond = await itineraryRepository.addItem(
      itin.id,
      'blr-vidyarthi-bhavan',
      'Lunch at Vidyarthi Bhavan',
      60
    );
    expect(afterSecond.items.length).toBe(2);

    // Stop 1 starts at 10:00. Ends after 120m (12:00) + travel time (~15-20m).
    // So Stop 2 starts around 12:15 - 12:20!
    expect(afterSecond.items[1].startTime).toMatch(/^12:/);
    expect(afterSecond.totalDurationMinutes).toBeGreaterThan(180);
    expect(afterSecond.items[0].travelTimeMinutes).toBeGreaterThan(0);
    expect(afterSecond.items[0].travelDistanceKm).toBeGreaterThan(0);
  });

  it('removes an item from an itinerary and updates timeline', async () => {
    const itin = await itineraryRepository.createItinerary(
      'Day Tour',
      'Bengaluru',
      '2026-09-19',
      '10:00'
    );

    await itineraryRepository.addItem(itin.id, 'blr-palace', 'Palace', 120);
    const withTwo = await itineraryRepository.addItem(itin.id, 'blr-cubbon-park', 'Park', 90);
    expect(withTwo.items.length).toBe(2);

    const firstItemId = withTwo.items[0].id;
    const afterRemoval = await itineraryRepository.removeItem(itin.id, firstItemId);
    expect(afterRemoval.items.length).toBe(1);
    expect(afterRemoval.items[0].experienceId).toBe('blr-cubbon-park');
    // First item now starts at initial itinerary start time: 10:00
    expect(afterRemoval.items[0].startTime).toBe('10:00');
  });

  it('reorders itinerary items and adjusts start times properly', async () => {
    const itin = await itineraryRepository.createItinerary(
      'Reorder Tour',
      'Bengaluru',
      '2026-09-19',
      '10:00'
    );

    const withOne = await itineraryRepository.addItem(itin.id, 'blr-palace', 'Palace', 60);
    const withTwo = await itineraryRepository.addItem(itin.id, 'blr-visvesvaraya', 'Museum', 120);

    const id1 = withTwo.items[0].id;
    const id2 = withTwo.items[1].id;

    // Swap order
    const reordered = await itineraryRepository.reorderItems(itin.id, [id2, id1]);
    expect(reordered.items[0].id).toBe(id2);
    expect(reordered.items[1].id).toBe(id1);
    expect(reordered.items[0].startTime).toBe('10:00');
  });

  it('recalculates timeline accurately across realistic coordinates', () => {
    const rawItems: ItineraryItem[] = [
      {
        id: '1',
        itineraryId: 'test',
        startTime: '10:00',
        durationMinutes: 120, // 10:00 to 12:00
        sortOrder: 0,
        travelTimeMinutes: 0,
        travelDistanceKm: 0,
        experience: {
          id: 'blr-palace',
          title: 'Bangalore Palace',
          description: '',
          category: 'Attractions',
          city: 'Bengaluru',
          latitude: 12.9988,
          longitude: 77.5921,
          address: '',
          rating: 4.6,
          reviewCount: 100,
          priceTier: '$$',
          priceAmount: 250,
          durationMinutes: 120,
          openingHours: '',
          imageUrl: '',
          tags: [],
          isFeatured: true,
        },
      },
      {
        id: '2',
        itineraryId: 'test',
        startTime: '',
        durationMinutes: 60,
        sortOrder: 1,
        travelTimeMinutes: 0,
        travelDistanceKm: 0,
        experience: {
          id: 'blr-cubbon-park',
          title: 'Cubbon Park',
          description: '',
          category: 'Parks',
          city: 'Bengaluru',
          latitude: 12.9763,
          longitude: 77.5929,
          address: '',
          rating: 4.8,
          reviewCount: 500,
          priceTier: 'Free',
          priceAmount: 0,
          durationMinutes: 60,
          openingHours: '',
          imageUrl: '',
          tags: [],
          isFeatured: true,
        },
      },
    ];

    const result = recalculateTimeline('10:00', rawItems);
    expect(result.items[0].startTime).toBe('10:00');
    expect(result.items[0].travelTimeMinutes).toBeGreaterThan(0);
    expect(result.items[0].travelDistanceKm).toBeGreaterThan(2); // Palace to Cubbon Park is ~2.5km
    expect(result.items[1].startTime).toMatch(/^12:/);
    expect(result.totalDurationMinutes).toBeGreaterThan(180);
  });
});
