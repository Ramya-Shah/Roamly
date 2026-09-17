import { apiClient } from './client';
import { Category, City, Experience } from '../types';

export async function fetchRemoteExperiences(city?: City, category?: string, search?: string): Promise<Experience[]> {
  const queryParams = new URLSearchParams();
  if (city) queryParams.append('city', city);
  if (category && category !== 'All') queryParams.append('category', category);
  if (search) queryParams.append('search', search);

  const qs = queryParams.toString();
  const endpoint = `/experiences${qs ? `?${qs}` : ''}`;
  const response = await apiClient<{ experiences: Experience[] }>(endpoint);

  if (response.data?.experiences) {
    return response.data.experiences;
  }
  return [];
}

export async function fetchRemoteExperienceById(id: string): Promise<Experience | null> {
  const response = await apiClient<{ experience: Experience }>(`/experiences/${id}`);
  return response.data?.experience || null;
}

export async function fetchRemoteCategories(): Promise<Category[]> {
  const response = await apiClient<{ categories: Category[] }>('/categories');
  return response.data?.categories || [];
}

export async function fetchRemoteNearby(lat: number, lng: number, radiusKm: number = 25): Promise<Experience[]> {
  const response = await apiClient<{ experiences: Experience[] }>(
    `/experiences/nearby?lat=${lat}&lng=${lng}&radiusKm=${radiusKm}`
  );
  return response.data?.experiences || [];
}
