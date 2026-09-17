export type City = 'Bengaluru' | 'Mumbai' | 'London' | 'Ahmedabad' | (string & {});

export type PriceTier = 'Free' | '$' | '$$' | '$$$';

export interface Category {
  id: string;
  name: string;
  slug: string;
  icon: string;
  sortOrder: number;
}

export interface Experience {
  id: string;
  title: string;
  description: string;
  category: string;
  city: City;
  latitude: number;
  longitude: number;
  address: string;
  rating: number;
  reviewCount: number;
  priceTier: PriceTier;
  priceAmount: number;
  durationMinutes: number;
  openingHours: string;
  imageUrl: string;
  tags: string[];
  isFeatured: boolean;
  createdAt?: string;
  updatedAt?: string;
  // Dynamic client/computed fields:
  isSaved?: boolean;
  distanceKm?: number;
}

export interface ItineraryItem {
  id: string;
  itineraryId: string;
  experienceId?: string | null;
  customTitle?: string | null;
  startTime: string; // "10:00"
  durationMinutes: number;
  sortOrder: number;
  travelTimeMinutes: number;
  travelDistanceKm: number;
  notes?: string | null;
  experience?: Experience;
}

export interface Itinerary {
  id: string;
  title: string;
  city: City;
  date: string; // "2026-09-19"
  startTime: string; // "09:00"
  totalDurationMinutes: number;
  totalDistanceKm: number;
  createdAt: string;
  updatedAt: string;
  items: ItineraryItem[];
}

export interface SavedExperience {
  id: string;
  userId: string;
  experienceId: string;
  savedAt: string;
  experience?: Experience;
}

export type MutationType =
  | 'CREATE_ITINERARY'
  | 'ADD_ITINERARY_ITEM'
  | 'REMOVE_ITINERARY_ITEM'
  | 'REORDER_ITINERARY_ITEMS'
  | 'UPDATE_ITINERARY_ITEM'
  | 'TOGGLE_SAVED';

export type SyncQueueStatus = 'pending' | 'processing' | 'failed' | 'completed';

export interface SyncQueueItem {
  id: string;
  type: MutationType;
  entityId: string;
  payload: Record<string, unknown>;
  status: SyncQueueStatus;
  retryCount: number;
  lastError?: string | null;
  idempotencyKey: string;
  createdAt: string;
}

export type NetworkStatus = 'ONLINE' | 'OFFLINE' | 'SYNCING' | 'ERROR';

export interface LocationCoords {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
}

export type LocationPermissionStatus =
  | 'idle'
  | 'requesting'
  | 'granted'
  | 'denied'
  | 'unavailable';

export interface LocationState {
  coords: LocationCoords | null;
  status: LocationPermissionStatus;
  error?: string | null;
}

export interface ExperienceFilter {
  city: City;
  category?: string;
  search?: string;
  priceTier?: PriceTier;
  minRating?: number;
  sortBy?: 'distance' | 'rating' | 'popular';
}

export interface SyncResult {
  successfulIds: string[];
  failed: Array<{ id: string; error: string }>;
}

// AI Planning Types
export interface AIPlanRequest {
  city: City;
  location: {
    latitude: number;
    longitude: number;
    address?: string;
  };
  availableMinutes: number; // e.g. 60, 120, 180, 360, 720
  budget: number; // e.g. 0, 500, 1000, 2500, 5000
  interests: string[]; // ['food', 'culture', 'history', 'art', 'nature', 'adventure', 'shopping', 'nightlife', 'music', 'sports']
  preferences: string[]; // ['indoor', 'outdoor', 'relaxed', 'packed', 'family', 'solo', 'couple', 'friends']
}

export interface AIPlanStop {
  experienceId: string;
  startTime: string;
  durationMinutes: number;
  reason: string;
  experience?: Experience;
}

export interface GeneratedPlan {
  id: string;
  title: string;
  summary: string;
  city: City;
  stops: AIPlanStop[];
  estimatedCost: number;
  estimatedTravelMinutes: number;
  createdAt: string;
  requestParams?: AIPlanRequest;
}

export type PlanModifier =
  | 'more_relaxed'
  | 'more_adventurous'
  | 'cheaper'
  | 'more_food'
  | 'less_walking'
  | 'more_cultural';

export interface RegeneratePlanRequest {
  currentPlan: GeneratedPlan;
  modifier: PlanModifier;
  city: City;
  location?: {
    latitude: number;
    longitude: number;
  };
}

