import { Experience, AIPlanRequest } from '../types';

export interface ScoredCandidate {
  experience: Experience;
  score: number;
  distanceKm: number;
  breakdown: {
    interestMatch: number;
    distanceScore: number;
    ratingScore: number;
    budgetMatch: number;
    durationFit: number;
  };
}

export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in km
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

export function calculateCandidateScore(
  exp: Experience,
  request: AIPlanRequest
): ScoredCandidate {
  // 1. Distance Calculation & Score (20%)
  const distanceKm = haversineDistance(
    request.location.latitude,
    request.location.longitude,
    exp.latitude,
    exp.longitude
  );
  // Linear decay up to 25 km
  const distanceScore = Math.max(0, Math.min(1, 1 - distanceKm / 25));

  // 2. Interest Match Score (35%)
  let interestMatch = 0.3; // baseline
  if (request.interests.length > 0) {
    let matchedCount = 0;
    const catLower = exp.category.toLowerCase();
    const tagsLower = (exp.tags || []).map((t) => t.toLowerCase());

    for (const interest of request.interests) {
      const iLower = interest.toLowerCase();
      if (catLower.includes(iLower) || iLower.includes(catLower)) {
        matchedCount += 1.5;
      } else if (tagsLower.some((t) => t.includes(iLower) || iLower.includes(t))) {
        matchedCount += 1.0;
      }
    }

    // Preferences bonus (indoor / outdoor / family / relaxed)
    if (request.preferences && request.preferences.length > 0) {
      for (const pref of request.preferences) {
        const pLower = pref.toLowerCase();
        if (tagsLower.some((t) => t.includes(pLower))) {
          matchedCount += 0.5;
        }
      }
    }

    interestMatch = Math.min(1.0, matchedCount / Math.max(1, request.interests.length));
  }

  // 3. Rating Score (15%)
  const ratingScore = Math.max(0, Math.min(1.0, (exp.rating || 4.0) / 5.0));

  // 4. Budget Match Score (15%)
  let budgetMatch = 1.0;
  if (request.budget === 0) {
    if (exp.priceTier === 'Free' || exp.priceAmount === 0) {
      budgetMatch = 1.0;
    } else if (exp.priceTier === '$') {
      budgetMatch = 0.3;
    } else {
      budgetMatch = 0.05;
    }
  } else {
    if (exp.priceAmount <= request.budget) {
      budgetMatch = 1.0;
    } else {
      const overspendRatio = (exp.priceAmount - request.budget) / request.budget;
      budgetMatch = Math.max(0, 1 - overspendRatio);
    }
  }

  // 5. Duration Fit Score (15%)
  let durationFit = 0.5;
  if (exp.durationMinutes > request.availableMinutes) {
    durationFit = 0.0;
  } else {
    // Ideally takes between 20% and 60% of total available time
    const ratio = exp.durationMinutes / request.availableMinutes;
    if (ratio <= 0.6) {
      durationFit = 1.0;
    } else {
      durationFit = Math.max(0.2, 1.0 - (ratio - 0.6));
    }
  }

  // Total weighted score
  const score =
    0.35 * interestMatch +
    0.2 * distanceScore +
    0.15 * ratingScore +
    0.15 * budgetMatch +
    0.15 * durationFit;

  return {
    experience: {
      ...exp,
      distanceKm,
    },
    score: Math.round(score * 1000) / 1000,
    distanceKm,
    breakdown: {
      interestMatch: Math.round(interestMatch * 100) / 100,
      distanceScore: Math.round(distanceScore * 100) / 100,
      ratingScore: Math.round(ratingScore * 100) / 100,
      budgetMatch: Math.round(budgetMatch * 100) / 100,
      durationFit: Math.round(durationFit * 100) / 100,
    },
  };
}

export function rankCandidates(
  allExperiences: Experience[],
  request: AIPlanRequest,
  limit: number = 10
): ScoredCandidate[] {
  // Filter by city first
  const cityExperiences = allExperiences.filter(
    (e) => e.city.toLowerCase() === request.city.toLowerCase()
  );

  const scored = cityExperiences.map((exp) =>
    calculateCandidateScore(exp, request)
  );

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
}
