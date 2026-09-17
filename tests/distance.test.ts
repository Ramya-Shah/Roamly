import { describe, it, expect } from 'vitest';
import {
  calculateDistanceKm,
  formatDistance,
  estimateTravelTime,
  timeStringToMinutes,
  minutesToTimeString,
} from '../src/utils/distance';

describe('Distance & Travel Time Calculations', () => {
  it('accurately calculates Haversine distance between real coordinates', () => {
    // Bangalore Palace (12.9988, 77.5921) to Cubbon Park (12.9763, 77.5929)
    const dist = calculateDistanceKm(12.9988, 77.5921, 12.9763, 77.5929);
    expect(dist).toBeGreaterThan(2.0);
    expect(dist).toBeLessThan(3.0);
  });

  it('formats distance strings properly', () => {
    expect(formatDistance(0.45)).toBe('450 m');
    expect(formatDistance(3.24)).toBe('3.2 km');
    expect(formatDistance(12.0)).toBe('12.0 km');
    expect(formatDistance(undefined)).toBe('-- km');
  });

  it('estimates walk vs drive travel time intelligently', () => {
    // Short distance (<1.2km) defaults to walking
    const shortTrip = estimateTravelTime(0.6);
    expect(shortTrip.mode).toBe('walk');
    expect(shortTrip.minutes).toBeGreaterThanOrEqual(3);
    expect(shortTrip.label).toContain('🚶');

    // Long distance (>1.2km) defaults to driving with traffic cushion
    const longTrip = estimateTravelTime(6.0);
    expect(longTrip.mode).toBe('drive');
    expect(longTrip.minutes).toBeGreaterThan(15);
    expect(longTrip.label).toContain('🚗');
  });

  it('converts time strings to minutes and back without loss', () => {
    expect(timeStringToMinutes('10:00')).toBe(600);
    expect(timeStringToMinutes('14:30')).toBe(870);
    expect(minutesToTimeString(600)).toBe('10:00');
    expect(minutesToTimeString(870)).toBe('14:30');
    expect(minutesToTimeString(1445)).toBe('00:05');
  });
});
