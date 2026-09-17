import { useQuery } from '@tanstack/react-query';
import { experienceRepository } from '../../../repositories/ExperienceRepository';
import { fetchRemoteNearby } from '../../../api/experienceApi';
import { City } from '../../../types';

export function useNearbyExperiences(
  latitude: number,
  longitude: number,
  radiusKm: number = 25,
  city?: City
) {
  return useQuery({
    queryKey: ['nearby-experiences', latitude, longitude, radiusKm, city],
    queryFn: async () => {
      // 1. Compute locally from SQLite coordinates
      const localNearby = await experienceRepository.getNearbyExperiences(
        latitude,
        longitude,
        radiusKm,
        city
      );

      // 2. Try remote API fetch in background
      try {
        const remote = await fetchRemoteNearby(latitude, longitude, radiusKm);
        if (remote && remote.length > 0) {
          await experienceRepository.cacheExperiences(remote);
          return await experienceRepository.getNearbyExperiences(latitude, longitude, radiusKm, city);
        }
      } catch {
        // Offline mode: return local SQLite calculation
      }

      return localNearby;
    },
    enabled: Boolean(latitude && longitude),
    staleTime: 1000 * 60 * 3,
  });
}
