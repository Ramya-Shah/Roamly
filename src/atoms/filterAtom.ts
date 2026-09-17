import { atom } from 'jotai';
import { PriceTier } from '../types';

export interface FilterState {
  category: string;
  search: string;
  priceTier: PriceTier | 'All';
  minRating: number;
  sortBy: 'popular' | 'rating' | 'distance';
}

export const initialFilterState: FilterState = {
  category: 'All',
  search: '',
  priceTier: 'All',
  minRating: 0,
  sortBy: 'popular',
};

export const filterAtom = atom<FilterState>(initialFilterState);
