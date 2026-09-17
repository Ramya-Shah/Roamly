import { atom } from 'jotai';
import { City } from '../types';

export const activeCityAtom = atom<City>('Bengaluru');

export const AVAILABLE_CITIES: Array<{
  name: City;
  country: string;
  currency: string;
  defaultCoords: { latitude: number; longitude: number };
}> = [
  {
    name: 'Ahmedabad',
    country: 'India',
    currency: '₹',
    defaultCoords: { latitude: 23.0225, longitude: 72.5714 },
  },
  {
    name: 'Bengaluru',
    country: 'India',
    currency: '₹',
    defaultCoords: { latitude: 12.9716, longitude: 77.5946 },
  },
  {
    name: 'Mumbai',
    country: 'India',
    currency: '₹',
    defaultCoords: { latitude: 18.9220, longitude: 72.8347 },
  },
  {
    name: 'London',
    country: 'United Kingdom',
    currency: '£',
    defaultCoords: { latitude: 51.5074, longitude: -0.1278 },
  },
];

export function getCityConfig(city: string) {
  const found = AVAILABLE_CITIES.find(
    (c) => c.name.toLowerCase() === city.toLowerCase()
  );
  if (found) return found;

  return {
    name: city,
    country: 'Global',
    currency: '₹',
    defaultCoords: { latitude: 23.0225, longitude: 72.5714 },
  };
}

