export interface AppShortcut {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  icon?: string;
  params?: {
    href?: string;
    [key: string]: string | number | boolean | null | undefined;
  };
}

export const EXPLORE_NEARBY_SHORTCUT: AppShortcut = {
  id: 'citypulse_explore_nearby',
  type: 'citypulse.explore_nearby',
  title: 'Explore Nearby',
  subtitle: 'Find attractions near your current spot',
  icon: 'location',
  params: {
    href: '/nearby',
  },
};

export const PLAN_MY_DAY_SHORTCUT: AppShortcut = {
  id: 'citypulse_plan_day',
  type: 'citypulse.plan_day',
  title: 'Plan My Day',
  subtitle: 'AI-curated experience planner',
  icon: 'compass',
  params: {
    href: '/(tabs)/plan',
  },
};
