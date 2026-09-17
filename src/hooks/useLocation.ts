import { useCallback } from 'react';
import { useAtom } from 'jotai';
import * as Location from 'expo-location';
import { locationAtom } from '../atoms/locationAtom';
import { activeCityAtom, AVAILABLE_CITIES } from '../atoms/cityAtom';

// Cache threshold: 5 minutes
const LOCATION_CACHE_MS = 5 * 60 * 1000;
let lastFetchTimestamp = 0;

export function useLocation() {
  const [locationState, setLocationState] = useAtom(locationAtom);
  const [activeCity] = useAtom(activeCityAtom);

  const requestLocation = useCallback(async (forceRefresh = false) => {
    const now = Date.now();
    if (!forceRefresh && locationState.coords && now - lastFetchTimestamp < LOCATION_CACHE_MS) {
      return locationState.coords;
    }

    try {
      setLocationState((prev) => ({ ...prev, status: 'requesting', error: null }));

      // Check current permission status
      const { status: existingStatus } = await Location.getForegroundPermissionsAsync();

      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
        const { status: newStatus } = await Location.requestForegroundPermissionsAsync();
        finalStatus = newStatus;
      }

      if (finalStatus !== 'granted') {
        // Permission denied by user
        setLocationState({
          coords: null,
          status: 'denied',
          error: 'Location permission was denied. Showing city center coordinates.',
        });
        return null;
      }

      // 1. First get last known location immediately (instant, zero battery consumption)
      const lastKnown = await Location.getLastKnownPositionAsync({
        maxAge: LOCATION_CACHE_MS,
      });

      if (lastKnown) {
        lastFetchTimestamp = now;
        const coords = {
          latitude: lastKnown.coords.latitude,
          longitude: lastKnown.coords.longitude,
          accuracy: lastKnown.coords.accuracy,
        };
        setLocationState({ coords, status: 'granted', error: null });
      }

      // 2. Refresh with balanced accuracy (doesn't fire power-hungry high-res GPS indefinitely)
      const freshLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      lastFetchTimestamp = Date.now();
      const coords = {
        latitude: freshLocation.coords.latitude,
        longitude: freshLocation.coords.longitude,
        accuracy: freshLocation.coords.accuracy,
      };

      setLocationState({ coords, status: 'granted', error: null });
      return coords;
    } catch (err: any) {
      setLocationState({
        coords: null,
        status: 'unavailable',
        error: err.message || 'Location services are unavailable.',
      });
      return null;
    }
  }, [locationState.coords, setLocationState]);

  // Fallback coordinates: City center coordinates if GPS permission is denied
  const cityConfig = AVAILABLE_CITIES.find((c) => c.name === activeCity) || AVAILABLE_CITIES[0];
  const effectiveCoords = locationState.coords || cityConfig.defaultCoords;

  return {
    coords: locationState.coords,
    effectiveCoords,
    status: locationState.status,
    error: locationState.error,
    isGranted: locationState.status === 'granted',
    isDenied: locationState.status === 'denied',
    isUnavailable: locationState.status === 'unavailable',
    requestLocation,
  };
}
