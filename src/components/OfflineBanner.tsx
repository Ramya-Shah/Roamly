import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { WifiOff, RefreshCw } from 'lucide-react-native';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

export function OfflineBanner() {
  const { isOffline, isSyncing, pendingCount } = useNetworkStatus();

  if (!isOffline && !isSyncing) return null;

  if (isSyncing) {
    return (
      <View style={[styles.banner, styles.syncingBanner]}>
        <RefreshCw size={14} color="#0369A1" />
        <Text style={[styles.text, styles.syncingText]}>
          Syncing changes with server...
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.banner, styles.offlineBanner]}>
      <WifiOff size={14} color="#92400E" />
      <Text style={[styles.text, styles.offlineText]}>
        You're offline · Changes will sync when you're back online
        {pendingCount > 0 ? ` (${pendingCount} pending)` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    gap: 8,
    justifyContent: 'center',
  },
  offlineBanner: {
    backgroundColor: '#FEF3C7',
    borderBottomWidth: 1,
    borderBottomColor: '#FDE68A',
  },
  syncingBanner: {
    backgroundColor: '#E0F2FE',
    borderBottomWidth: 1,
    borderBottomColor: '#BAE6FD',
  },
  text: {
    fontSize: 12,
    fontWeight: '500',
  },
  offlineText: {
    color: '#92400E',
  },
  syncingText: {
    color: '#0369A1',
  },
});
