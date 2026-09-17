import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { itineraryRepository } from '../../../repositories/ItineraryRepository';
import { City } from '../../../types';

export function useItineraries(city?: City) {
  return useQuery({
    queryKey: ['itineraries', city],
    queryFn: async () => {
      return itineraryRepository.getItineraries(city);
    },
  });
}

export function useItineraryDetails(id: string | undefined) {
  return useQuery({
    queryKey: ['itinerary-detail', id],
    queryFn: async () => {
      if (!id) return null;
      return itineraryRepository.getById(id);
    },
    enabled: Boolean(id),
  });
}

export function useItineraryMutations() {
  const queryClient = useQueryClient();

  const createItinerary = useMutation({
    mutationFn: async ({
      title,
      city,
      date,
      startTime,
    }: {
      title: string;
      city: City;
      date: string;
      startTime?: string;
    }) => {
      return itineraryRepository.createItinerary(title, city, date, startTime);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['itineraries'] });
    },
  });

  const addItem = useMutation({
    mutationFn: async ({
      itineraryId,
      experienceId,
      customTitle,
      durationMinutes,
      notes,
    }: {
      itineraryId: string;
      experienceId?: string | null;
      customTitle?: string | null;
      durationMinutes?: number;
      notes?: string | null;
    }) => {
      return itineraryRepository.addItem(
        itineraryId,
        experienceId,
        customTitle,
        durationMinutes,
        notes
      );
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['itineraries'] });
      queryClient.invalidateQueries({ queryKey: ['itinerary-detail', variables.itineraryId] });
    },
  });

  const removeItem = useMutation({
    mutationFn: async ({
      itineraryId,
      itemId,
    }: {
      itineraryId: string;
      itemId: string;
    }) => {
      return itineraryRepository.removeItem(itineraryId, itemId);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['itineraries'] });
      queryClient.invalidateQueries({ queryKey: ['itinerary-detail', variables.itineraryId] });
    },
  });

  const reorderItems = useMutation({
    mutationFn: async ({
      itineraryId,
      itemIds,
    }: {
      itineraryId: string;
      itemIds: string[];
    }) => {
      return itineraryRepository.reorderItems(itineraryId, itemIds);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['itineraries'] });
      queryClient.invalidateQueries({ queryKey: ['itinerary-detail', variables.itineraryId] });
    },
  });

  const updateItemDuration = useMutation({
    mutationFn: async ({
      itineraryId,
      itemId,
      durationMinutes,
    }: {
      itineraryId: string;
      itemId: string;
      durationMinutes: number;
    }) => {
      return itineraryRepository.updateItemDuration(itineraryId, itemId, durationMinutes);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['itineraries'] });
      queryClient.invalidateQueries({ queryKey: ['itinerary-detail', variables.itineraryId] });
    },
  });

  const deleteItinerary = useMutation({
    mutationFn: async (id: string) => {
      return itineraryRepository.deleteItinerary(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['itineraries'] });
    },
  });

  return {
    createItinerary,
    addItem,
    removeItem,
    reorderItems,
    updateItemDuration,
    deleteItinerary,
  };
}
