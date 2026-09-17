import {
  AppShortcut,
  EXPLORE_NEARBY_SHORTCUT,
  PLAN_MY_DAY_SHORTCUT,
} from './shortcuts.types';

/**
 * iOS Native Quick Action Implementation Details:
 *
 * Architecture:
 * 1. iOS uses UIApplicationShortcutItem (iOS 9.0+) for 3D Touch / Haptic Touch quick actions.
 * 2. In Expo, expo-quick-actions sets dynamic shortcut items via:
 *    UIApplication.shared.shortcutItems = [UIApplicationShortcutItem(...)]
 * 3. When the user long-presses CityPulse on the iOS Home Screen, "Plan My Day" and "Explore Nearby" appear.
 * 4. Tapping dispatches performActionForShortcutItem, which expo-quick-actions captures,
 *    triggering the JavaScript QuickActions listener and pushing the route in Expo Router.
 */
export function getIosShortcuts(): AppShortcut[] {
  return [
    {
      ...PLAN_MY_DAY_SHORTCUT,
      icon: 'compose', // maps to UIApplicationShortcutIconTypeCompose
    },
    {
      ...EXPLORE_NEARBY_SHORTCUT,
      icon: 'location', // maps to UIApplicationShortcutIconTypeLocation
    },
  ];
}
