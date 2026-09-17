import { AIPlanRequest, PlanModifier } from '../../types';
import { ScoredCandidate } from '../../services/candidateRanker';

export function buildPlannerSystemPrompt(): string {
  return `You are Roamly AI, an intelligent city experience curator.
Your task is to craft a cohesive, personalized, and time-realistic city itinerary answering: "What should I do right now?"

CRITICAL CONSTRAINTS:
1. You MUST select experiences ONLY from the provided candidate list. Never invent or hallucinate experience IDs or places.
2. The total time of the plan (stops + estimated travel) must not exceed the user's available time.
3. Order the stops in a geographically logical sequence to minimize travel.
4. If available time is 1-2 hours: choose 1-2 stops.
   If available time is 3-5 hours: choose 2-3 stops.
   If available time is 6+ hours: choose 3-5 stops.
5. Provide a specific, engaging 'reason' for each stop explaining why it matches the user's vibe and interests.
6. Return ONLY a valid JSON object matching this exact schema:
{
  "title": "Short catchy title for the plan (e.g. 'Cubbon Greenery & Heritage Stroll')",
  "summary": "2-3 sentences explaining the theme and narrative flow of the day.",
  "stops": [
    {
      "experienceId": "exact id from candidate list",
      "startTime": "HH:MM (24-hour format, e.g. 09:30)",
      "durationMinutes": 60,
      "reason": "Clear explanation of why this was chosen for the user's prompt"
    }
  ],
  "estimatedCost": 250,
  "estimatedTravelMinutes": 35
}`;
}

export function buildPlannerUserPrompt(
  request: AIPlanRequest,
  candidates: ScoredCandidate[]
): string {
  const candidatesJson = candidates.map((c) => ({
    id: c.experience.id,
    title: c.experience.title,
    category: c.experience.category,
    rating: c.experience.rating,
    priceTier: c.experience.priceTier,
    priceAmount: c.experience.priceAmount,
    durationMinutes: c.experience.durationMinutes,
    distanceKm: c.distanceKm,
    tags: c.experience.tags,
    address: c.experience.address,
    score: c.score,
  }));

  return `User Request:
- City: ${request.city}
- Available Time: ${request.availableMinutes} minutes (~${(request.availableMinutes / 60).toFixed(1)} hours)
- Budget: ${request.budget === 0 ? 'Free experiences preferred' : `Up to ${request.budget}`}
- Interests: ${request.interests.join(', ') || 'General exploration'}
- Preferences: ${request.preferences.join(', ') || 'Standard'}
- Starting coordinates: ${request.location.latitude}, ${request.location.longitude}

Top Candidate Experiences to pick from (DO NOT use any IDs not in this list):
${JSON.stringify(candidatesJson, null, 2)}

Create an optimal itinerary using ONLY candidates from the list above.`;
}

export function buildRegenerateUserPrompt(
  currentPlanTitle: string,
  currentStopIds: string[],
  modifier: PlanModifier,
  request: AIPlanRequest,
  candidates: ScoredCandidate[]
): string {
  const modifierDescriptions: Record<PlanModifier, string> = {
    more_relaxed:
      'Make the itinerary more relaxed: reduce the number of stops, allow longer leisurely time at each stop, and prefer scenic or calm locations.',
    more_adventurous:
      'Make the itinerary more adventurous: swap in more active, high-energy, or thrilling experiences.',
    cheaper:
      'Make the itinerary cheaper: prioritize free or budget-friendly options to minimize overall cost.',
    more_food:
      'Add more food/culinary focus: prioritize artisan eateries, iconic food markets, and cafes.',
    less_walking:
      'Minimize travel time and walking: pick stops geographically clustered tightly together.',
    more_cultural:
      'Add more cultural and historic depth: prioritize museums, heritage landmarks, and architecture.',
  };

  const candidatesJson = candidates.map((c) => ({
    id: c.experience.id,
    title: c.experience.title,
    category: c.experience.category,
    priceTier: c.experience.priceTier,
    priceAmount: c.experience.priceAmount,
    durationMinutes: c.experience.durationMinutes,
    distanceKm: c.distanceKm,
    tags: c.experience.tags,
  }));

  return `Current Plan: "${currentPlanTitle}"
Currently included stop IDs: ${JSON.stringify(currentStopIds)}

Modifier Requested: ${modifier}
Guidance: ${modifierDescriptions[modifier]}

User Context:
- City: ${request.city}
- Available Time: ${request.availableMinutes} minutes
- Budget: ${request.budget === 0 ? 'Free' : request.budget}
- Interests: ${request.interests.join(', ')}

Available Candidates to pick from:
${JSON.stringify(candidatesJson, null, 2)}

CRITICAL DIVERSIFICATION RULES:
1. You MUST replace at least 1-2 stops from the currently included stops with DIFFERENT candidate experiences from the list above that best match "${modifier}".
2. Do NOT simply return the identical set of places. The user explicitly requested an adjustment and expects to see fresh, distinct venues reflecting "${modifier}".
3. Ensure the selected stops fit logically within the ${request.availableMinutes} minutes time window.

Re-generate the plan applying the requested modifier. Return ONLY the JSON schema.`;
}

export function buildDynamicCitySystemPrompt(): string {
  return `You are Roamly AI, an expert city travel curator with encyclopedic knowledge of cities across India and the world.
Your task is to craft a cohesive, personalized, authentic, and time-realistic city itinerary for ANY requested city, answering: "What should I do right now?"

CRITICAL REQUIREMENTS:
1. Generate real, renowned venues, cultural heritage landmarks, famous eateries, parks, or attractions that genuinely exist in the requested city (e.g. for Ahmedabad: Sabarmati Ashram, Adalaj Stepwell, Manek Chowk, Law Garden, Sidi Saiyyed Mosque, etc.).
2. The total time (durations + realistic travel between stops) must strictly fit within the user's available time.
3. Order the stops in a geographically logical route to minimize travel time within the city.
4. If available time is 1-2 hours: choose 1-2 stops.
   If available time is 3-5 hours: choose 2-3 stops.
   If available time is 6+ hours: choose 3-5 stops.
5. Provide accurate coordinates (latitude, longitude) for the venues in that city.
6. Return ONLY a valid JSON object matching this exact schema:
{
  "title": "Catchy title for the day itinerary (e.g. 'Ahmedabad Heritage & Flavors')",
  "summary": "2-3 sentences explaining the theme and narrative flow of the day.",
  "stops": [
    {
      "experience": {
        "title": "Real Place Name",
        "description": "Engaging description of the venue or activity",
        "category": "Attractions",
        "latitude": 23.0225,
        "longitude": 72.5714,
        "address": "Street or Neighborhood, City",
        "rating": 4.6,
        "reviewCount": 1250,
        "priceTier": "Free",
        "priceAmount": 0,
        "durationMinutes": 60,
        "openingHours": "09:00 - 18:00",
        "tags": ["Heritage", "Culture"]
      },
      "startTime": "10:00",
      "durationMinutes": 60,
      "reason": "Clear explanation of why this was chosen for the user's prompt"
    }
  ],
  "estimatedCost": 200,
  "estimatedTravelMinutes": 30
}`;
}

export function buildDynamicCityUserPrompt(request: AIPlanRequest): string {
  return `User Request for City: ${request.city}
- Available Time: ${request.availableMinutes} minutes (~${(request.availableMinutes / 60).toFixed(1)} hours)
- Budget: ${request.budget === 0 ? 'Free experiences only ($0)' : `Up to ${request.budget}`}
- Interests: ${request.interests.join(', ') || 'Culture, Food, Top Sights'}
- Preferences: ${request.preferences.join(', ') || 'Standard exploration'}
- Starting coordinates (if available): ${request.location.latitude}, ${request.location.longitude}

Please generate an authentic, well-paced day itinerary of top real venues in ${request.city} customized for these parameters. Return ONLY the JSON object.`;
}

export function buildDynamicCityRegenerateUserPrompt(
  currentPlanTitle: string,
  currentStopTitles: string[],
  modifier: PlanModifier,
  request: AIPlanRequest
): string {
  const modifierDescriptions: Record<PlanModifier, string> = {
    more_relaxed:
      'Make the itinerary more relaxed: reduce pace, allow longer leisurely time, and select calm or scenic spots.',
    more_adventurous:
      'Make the itinerary more adventurous: discover active, high-energy, exciting, or outdoor adventure venues.',
    cheaper:
      'Make the itinerary cheaper: prioritize free entry parks, iconic open plazas, or low-cost authentic street gems.',
    more_food:
      'Add more culinary focus: swap in renowned local food markets, celebrated historic eateries, and artisan cafes.',
    less_walking:
      'Minimize travel: cluster stops geographically close together in the same neighborhood.',
    more_cultural:
      'Deepen cultural exploration: prioritize museums, heritage landmarks, art galleries, and historic architecture.',
  };

  return `Current Plan: "${currentPlanTitle}"
City: ${request.city}
Currently included places: ${JSON.stringify(currentStopTitles)}

Adjustment Requested: ${modifier.toUpperCase()}
Guidance: ${modifierDescriptions[modifier]}

User Context:
- Available Time: ${request.availableMinutes} minutes (~${(request.availableMinutes / 60).toFixed(1)} hours)
- Budget: ${request.budget === 0 ? 'Free' : request.budget}
- Interests: ${request.interests.join(', ')}

CRITICAL DIVERSITY INSTRUCTION:
1. Search across ALL real places in ${request.city} and discover NEW, ALTERNATIVE venues that strongly embody the "${modifier}" vibe.
2. You MUST replace at least 1-2 places from the current itinerary with fresh, different real venues in ${request.city}.
3. Do NOT simply return the identical places. Return ONLY the JSON object.`;
}

