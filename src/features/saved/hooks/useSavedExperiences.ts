import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { savedExperienceRepository } from '../../../repositories/SavedExperienceRepository';

export function useSavedExperiences() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['saved-experiences'],
    queryFn: async () => {
      return savedExperienceRepository.getSavedExperiences();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({
      experienceId,
      isSaved,
    }: {
      experienceId: string;
      isSaved: boolean;
    }) => {
      return savedExperienceRepository.toggleSaved(experienceId, isSaved);
    },
    onMutate: async ({ experienceId, isSaved }) => {
      // Cancel outgoing queries for optimistic update
      await queryClient.cancelQueries({ queryKey: ['saved-experiences'] });
      await queryClient.cancelQueries({ queryKey: ['experiences'] });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-experiences'] });
      queryClient.invalidateQueries({ queryKey: ['experiences'] });
    },
  });

  return {
    savedList: query.data || [],
    isLoading: query.isLoading,
    toggleSaved: (experienceId: string, isSaved: boolean) =>
      toggleMutation.mutate({ experienceId, isSaved }),
  };
}
