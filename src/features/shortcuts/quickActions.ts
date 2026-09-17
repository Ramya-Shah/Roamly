import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { getAndroidShortcuts } from './shortcuts.android';
import { getIosShortcuts } from './shortcuts.ios';

/**
 * Initializes native quick actions on the platform and listens for shortcut events.
 * Directly routes to Expo Router's /nearby destination when "Explore Nearby" is tapped.
 */
export async function setupQuickActions(): Promise<(() => void) | undefined> {
  // Only supported on native iOS & Android
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return;
  }

  try {
    const QuickActions = await import('expo-quick-actions');
    if (!QuickActions || !QuickActions.setItems) {
      return;
    }

    const shortcuts = Platform.OS === 'android' ? getAndroidShortcuts() : getIosShortcuts();

    // Set dynamic quick actions on home screen
    await QuickActions.setItems(
      shortcuts.map((s) => ({
        id: s.id,
        type: s.type,
        title: s.title,
        subtitle: s.subtitle,
        icon: s.icon,
        params: s.params,
      }))
    );

    // If app launched from cold start via quick action
    if (QuickActions.initial) {
      handleQuickAction(QuickActions.initial);
    }

    // Listen for warm/hot quick action taps
    const subscription = QuickActions.addListener((action: any) => {
      handleQuickAction(action);
    });

    // Handle deep link fallbacks: roamly://plan, roamly://nearby
    const initialUrl = await Linking.getInitialURL();
    if (initialUrl) {
      if (initialUrl.includes('plan')) {
        router.push('/(tabs)/plan' as any);
      } else if (initialUrl.includes('nearby')) {
        router.push('/nearby');
      }
    }

    const linkingSub = Linking.addEventListener('url', ({ url }) => {
      if (url) {
        if (url.includes('plan')) {
          router.push('/(tabs)/plan' as any);
        } else if (url.includes('nearby')) {
          router.push('/nearby');
        }
      }
    });

    return () => {
      subscription.remove();
      linkingSub.remove();
    };
  } catch {
    // Quick actions fallback silently on non-supported environments
    return undefined;
  }
}

function handleQuickAction(action: any): void {
  const type = action?.type || '';
  const id = action?.id || '';

  if (type.includes('plan') || id.includes('plan')) {
    router.push('/(tabs)/plan' as any);
  } else if (type.includes('nearby') || id.includes('nearby')) {
    router.push('/nearby');
  }
}
