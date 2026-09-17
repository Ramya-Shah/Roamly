import { ItineraryItem } from '../types';

/**
 * Calculates great-circle distance between two geographic coordinates using Haversine formula.
 * @returns distance in kilometers
 */
export function calculateDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10; // rounded to 1 decimal place
}

/**
 * Formats distance nicely for display (e.g. "450 m" or "3.2 km").
 */
export function formatDistance(distanceKm: number | undefined | null): string {
  if (distanceKm === undefined || distanceKm === null || isNaN(distanceKm)) {
    return '-- km';
  }
  if (distanceKm < 1) {
    return `${Math.round(distanceKm * 1000)} m`;
  }
  return `${distanceKm.toFixed(1)} km`;
}

export interface TravelEstimate {
  minutes: number;
  mode: 'walk' | 'drive';
  label: string;
}

/**
 * Estimates travel time between two locations based on distance.
 * Urban average walking: ~4.5 km/h (if < 1.2 km).
 * Urban average driving/cab: ~22 km/h + 3 min traffic buffer.
 */
export function estimateTravelTime(
  distanceKm: number,
  preferredMode: 'auto' | 'walk' | 'drive' = 'auto'
): TravelEstimate {
  if (distanceKm <= 0.05) {
    return { minutes: 2, mode: 'walk', label: '2 min walk (<100m)' };
  }

  const isWalk =
    preferredMode === 'walk' || (preferredMode === 'auto' && distanceKm <= 1.2);

  if (isWalk) {
    // 4.5 km/h -> ~13.3 minutes per km
    const minutes = Math.max(3, Math.round((distanceKm / 4.5) * 60));
    return {
      minutes,
      mode: 'walk',
      label: `🚶 ~${minutes} min (${formatDistance(distanceKm)})`,
    };
  } else {
    // 22 km/h in dense city traffic + 3 min traffic/stoplight cushion
    const minutes = Math.max(5, Math.round((distanceKm / 22) * 60 + 3));
    return {
      minutes,
      mode: 'drive',
      label: `🚗 ~${minutes} min (${formatDistance(distanceKm)})`,
    };
  }
}

/**
 * Converts a "HH:MM" string to minutes from midnight.
 */
export function timeStringToMinutes(timeStr: string): number {
  const parts = timeStr.split(':');
  const hours = parseInt(parts[0] || '0', 10);
  const minutes = parseInt(parts[1] || '0', 10);
  return hours * 60 + minutes;
}

/**
 * Converts minutes from midnight back to "HH:MM" 24-hour string.
 */
export function minutesToTimeString(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

/**
 * Calculates start times and travel durations across all items in an itinerary timeline.
 */
export function recalculateTimeline(
  initialStartTime: string,
  items: ItineraryItem[]
): {
  items: ItineraryItem[];
  totalDurationMinutes: number;
  totalDistanceKm: number;
} {
  let currentMinutes = timeStringToMinutes(initialStartTime);
  let totalDistance = 0;
  const updatedItems: ItineraryItem[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = { ...items[i], sortOrder: i };
    item.startTime = minutesToTimeString(currentMinutes);

    // Add activity duration
    currentMinutes += item.durationMinutes;

    // Calculate travel time and distance to next item if both have coordinates
    if (i < items.length - 1) {
      const nextItem = items[i + 1];
      let dist = 0;
      let travelMins = 0;

      if (
        item.experience?.latitude &&
        item.experience?.longitude &&
        nextItem.experience?.latitude &&
        nextItem.experience?.longitude
      ) {
        dist = calculateDistanceKm(
          item.experience.latitude,
          item.experience.longitude,
          nextItem.experience.latitude,
          nextItem.experience.longitude
        );
        const estimate = estimateTravelTime(dist);
        travelMins = estimate.minutes;
      } else {
        // Fallback estimated urban transfer time if no coords
        dist = 3.0;
        travelMins = 15;
      }

      item.travelDistanceKm = dist;
      item.travelTimeMinutes = travelMins;
      totalDistance += dist;
      currentMinutes += travelMins;
    } else {
      item.travelDistanceKm = 0;
      item.travelTimeMinutes = 0;
    }

    updatedItems.push(item);
  }

  const startMins = timeStringToMinutes(initialStartTime);
  const totalDurationMinutes = Math.max(0, currentMinutes - startMins);

  return {
    items: updatedItems,
    totalDurationMinutes,
    totalDistanceKm: Math.round(totalDistance * 10) / 10,
  };
}
