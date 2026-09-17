import { useQuery, useQueryClient } from '@tanstack/react-query';
import { experienceRepository } from '../../../repositories/ExperienceRepository';
import { fetchRemoteExperiences } from '../../../api/experienceApi';
import { ExperienceFilter } from '../../../types';

export function useExperiences(
  filter: ExperienceFilter,
  userCoords?: { latitude: number; longitude: number } | null
) {
  const queryClient = useQueryClient();

  const queryKey = [
    'experiences',
    filter.city,
    filter.category,
    filter.search,
    filter.priceTier,
    filter.minRating,
    filter.sortBy,
    userCoords?.latitude,
    userCoords?.longitude,
  ];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      // 1. Fetch from SQLite repository
      const localData = await experienceRepository.getExperiences(filter, userCoords);

      // 2. Try background refresh from remote API (non-blocking)
      try {
        const remote = await fetchRemoteExperiences(filter.city, filter.category, filter.search);
        if (remote && remote.length > 0) {
          await experienceRepository.cacheExperiences(remote);
          // Return fresh combined data
          return await experienceRepository.getExperiences(filter, userCoords);
        }
      } catch {
        // Network unavailable or server down: seamless offline fallback
      }

      return localData;
    },
    staleTime: 1000 * 60 * 2, // 2 minutes
  });

  const refresh = async () => {
    return queryClient.invalidateQueries({ queryKey: ['experiences'] });
  };

  return {
    experiences: query.data || [],
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    error: query.error,
    refresh,
  };
}

export function useFeaturedExperiences(city: ExperienceFilter['city']) {
  return useQuery({
    queryKey: ['featured-experiences', city],
    queryFn: async () => {
      return experienceRepository.getFeaturedExperiences(city);
    },
    staleTime: 1000 * 60 * 5,
  });
}

export function useExperienceDetails(id: string) {
  return useQuery({
    queryKey: ['experience-detail', id],
    queryFn: async () => {
      return experienceRepository.getById(id);
    },
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      return experienceRepository.getCategories();
    },
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}
