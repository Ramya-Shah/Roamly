import { describe, it, expect } from 'vitest';
import {
  calculateCandidateScore,
  rankCandidates,
  haversineDistance,
} from '../src/utils/candidateRanker';
import { Experience, AIPlanRequest } from '../src/types';

describe('Candidate Ranker Scoring Formula', () => {
  const sampleExperiences: Experience[] = [
    {
      id: 'exp-blr-1',
      title: 'Cubbon Park Nature Stroll',
      description: 'Lush park with shaded paths and botanical gardens.',
      category: 'Parks',
      city: 'Bengaluru',
      latitude: 12.9763,
      longitude: 77.5929,
      address: 'Kasturba Road, Bengaluru',
      rating: 4.8,
      reviewCount: 9200,
      priceTier: 'Free',
      priceAmount: 0,
      durationMinutes: 90,
      openingHours: '06:00 - 18:00',
      imageUrl: 'https://images.unsplash.com/photo-1',
      tags: ['Nature', 'Walking Track', 'Serene'],
      isFeatured: true,
    },
    {
      id: 'exp-blr-2',
      title: 'Bangalore Palace Royal Tour',
      description: 'Grand historic estate built by Mysore royalty.',
      category: 'Attractions',
      city: 'Bengaluru',
      latitude: 12.9988,
      longitude: 77.5921,
      address: 'Vasanth Nagar, Bengaluru',
      rating: 4.6,
      reviewCount: 4820,
      priceTier: '$$',
      priceAmount: 250,
      durationMinutes: 120,
      openingHours: '10:00 - 17:30',
      imageUrl: 'https://images.unsplash.com/photo-2',
      tags: ['Historic', 'Royal Heritage', 'Architecture'],
      isFeatured: true,
    },
    {
      id: 'exp-blr-3',
      title: 'Faraway Waterpark Extreme',
      description: 'Waterpark on the outskirts with massive slides.',
      category: 'Adventure',
      city: 'Bengaluru',
      latitude: 12.75, // 25+ km away
      longitude: 77.45,
      address: 'Bidadi Highway, Bengaluru',
      rating: 3.9,
      reviewCount: 1100,
      priceTier: '$$$',
      priceAmount: 1200,
      durationMinutes: 300,
      openingHours: '10:00 - 18:00',
      imageUrl: 'https://images.unsplash.com/photo-3',
      tags: ['Adventure', 'Theme Park'],
      isFeatured: false,
    },
    {
      id: 'exp-lon-1',
      title: 'Tower of London',
      description: 'Historic castle on the north bank of the Thames.',
      category: 'Attractions',
      city: 'London',
      latitude: 51.5081,
      longitude: -0.0759,
      address: 'London EC3N 4AB',
      rating: 4.7,
      reviewCount: 31000,
      priceTier: '$$$',
      priceAmount: 34,
      durationMinutes: 180,
      openingHours: '09:00 - 17:30',
      imageUrl: 'https://images.unsplash.com/photo-4',
      tags: ['Royal History', 'Crown Jewels'],
      isFeatured: true,
    },
  ];

  const standardRequest: AIPlanRequest = {
    city: 'Bengaluru',
    location: {
      latitude: 12.975,
      longitude: 77.595, // Near central Bengaluru
    },
    availableMinutes: 240, // 4 hours
    budget: 500,
    interests: ['Nature', 'Parks'],
    preferences: ['Relaxed', 'Outdoor'],
  };

  it('calculates accurate Haversine distance', () => {
    // Distance between Cubbon Park and Bangalore Palace is ~2.5 km
    const dist = haversineDistance(12.9763, 77.5929, 12.9988, 77.5921);
    expect(dist).toBeGreaterThan(2.0);
    expect(dist).toBeLessThan(3.0);
  });

  it('calculates score breakdown matching the 5 weighted factors', () => {
    const scored = calculateCandidateScore(sampleExperiences[0], standardRequest);

    // Score in [0, 1]
    expect(scored.score).toBeGreaterThan(0.5);
    expect(scored.score).toBeLessThanOrEqual(1.0);

    // Breakdown keys exist
    expect(scored.breakdown).toHaveProperty('interestMatch');
    expect(scored.breakdown).toHaveProperty('distanceScore');
    expect(scored.breakdown).toHaveProperty('ratingScore');
    expect(scored.breakdown).toHaveProperty('budgetMatch');
    expect(scored.breakdown).toHaveProperty('durationFit');

    // Cubbon Park matches 'Parks' interest directly, so interestMatch should be high
    expect(scored.breakdown.interestMatch).toBeGreaterThanOrEqual(0.7);
    // Free matches budget of 500
    expect(scored.breakdown.budgetMatch).toBe(1.0);
  });

  it('ranks nearby and matching interest experiences higher than distant/unrelated ones', () => {
    const ranked = rankCandidates(sampleExperiences, standardRequest, 10);

    // Only Bengaluru experiences returned
    expect(ranked.every((r) => r.experience.city === 'Bengaluru')).toBe(true);

    // First place should be Cubbon Park (close, free, parks match)
    expect(ranked[0].experience.id).toBe('exp-blr-1');

    // Last place among Bengaluru should be the Faraway Waterpark
    expect(ranked[ranked.length - 1].experience.id).toBe('exp-blr-3');
    expect(ranked[0].score).toBeGreaterThan(ranked[ranked.length - 1].score);
  });

  it('penalizes experiences exceeding available duration', () => {
    const tightTimeRequest: AIPlanRequest = {
      ...standardRequest,
      availableMinutes: 60, // Only 1 hour available
    };

    // Experience 2 is 120 min, Experience 3 is 300 min
    const scoredExp2 = calculateCandidateScore(sampleExperiences[1], tightTimeRequest);
    expect(scoredExp2.breakdown.durationFit).toBe(0.0);
  });

  it('rewards free experiences when user budget is 0', () => {
    const freeRequest: AIPlanRequest = {
      ...standardRequest,
      budget: 0,
    };

    const freeScored = calculateCandidateScore(sampleExperiences[0], freeRequest);
    const paidScored = calculateCandidateScore(sampleExperiences[1], freeRequest);

    expect(freeScored.breakdown.budgetMatch).toBe(1.0);
    expect(paidScored.breakdown.budgetMatch).toBeLessThan(0.5);
  });
});
