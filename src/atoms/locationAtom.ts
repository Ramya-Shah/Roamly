import { atom } from 'jotai';
import { LocationState } from '../types';

export const locationAtom = atom<LocationState>({
  coords: null,
  status: 'idle',
  error: null,
});
