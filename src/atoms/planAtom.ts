import { atom } from 'jotai';
import { GeneratedPlan } from '../types';

export interface PlanWizardState {
  step: number; // 1 to 5
  availableMinutes: number; // 60, 120, 180, 240, 360, 720
  budget: number; // 0, 500, 1000, 2500, 5000
  interests: string[];
  preferences: string[];
  useCurrentLocation: boolean;
}

export const initialWizardState: PlanWizardState = {
  step: 1,
  availableMinutes: 240, // 4 hours
  budget: 1000,
  interests: ['Culture', 'Food'],
  preferences: ['Relaxed', 'Outdoor'],
  useCurrentLocation: true,
};

export const planWizardStateAtom = atom<PlanWizardState>(initialWizardState);

export const currentGeneratedPlanAtom = atom<GeneratedPlan | null>(null);

export const isGeneratingPlanAtom = atom<boolean>(false);

export const planErrorAtom = atom<string | null>(null);
