import {
  AppShortcut,
  EXPLORE_NEARBY_SHORTCUT,
  PLAN_MY_DAY_SHORTCUT,
} from './shortcuts.types';

/**
 * Android Native Shortcut Implementation Details:
 *
 * Architecture:
 * 1. Android uses ShortcutManager (API 25+) to publish dynamic shortcuts.
 * 2. In Expo, expo-quick-actions communicates with Android's ShortcutManager
 *    and registers ShortcutInfoCompat objects with target Intent roamly://nearby or roamly://plan.
 * 3. When the user long-presses the app icon on Android Launcher, "Explore Nearby" and "Plan My Day" appear.
 * 4. Tapping launches MainActivity with the intent action android.intent.action.VIEW,
 *    which Expo Router picks up and routes directly to the requested screen.
 */
export function getAndroidShortcuts(): AppShortcut[] {
  return [
    {
      ...PLAN_MY_DAY_SHORTCUT,
      icon: 'ic_menu_agenda',
    },
    {
      ...EXPLORE_NEARBY_SHORTCUT,
      icon: 'ic_menu_mylocation',
    },
  ];
}
