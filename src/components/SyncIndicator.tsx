import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Wifi, WifiOff, RefreshCw, AlertCircle } from 'lucide-react-native';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

export function SyncIndicator() {
  const { status, pendingCount, isOnline, isOffline, isSyncing, hasError, forceSync } = useNetworkStatus();

  const renderBadge = () => {
    if (isSyncing) {
      return (
        <View style={[styles.badge, styles.syncingBadge]}>
          <RefreshCw size={12} color="#0284C7" />
          <Text style={[styles.text, styles.syncingText]}>Syncing...</Text>
        </View>
      );
    }

    if (isOffline) {
      return (
        <View style={[styles.badge, styles.offlineBadge]}>
          <WifiOff size={12} color="#D97706" />
          <Text style={[styles.text, styles.offlineText]}>
            Offline{pendingCount > 0 ? ` (${pendingCount})` : ''}
          </Text>
        </View>
      );
    }

    if (hasError) {
      return (
        <TouchableOpacity activeOpacity={0.7} onPress={forceSync} style={[styles.badge, styles.errorBadge]}>
          <AlertCircle size={12} color="#DC2626" />
          <Text style={[styles.text, styles.errorText]}>Sync Failed · Retry</Text>
        </TouchableOpacity>
      );
    }

    return (
      <View style={[styles.badge, styles.onlineBadge]}>
        <View style={styles.onlineDot} />
        <Text style={[styles.text, styles.onlineText]}>Synced</Text>
      </View>
    );
  };

  return <View style={styles.container}>{renderBadge()}</View>;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  onlineBadge: {
    backgroundColor: '#F0FDF4',
  },
  offlineBadge: {
    backgroundColor: '#FFFBEB',
  },
  syncingBadge: {
    backgroundColor: '#F0F9FF',
  },
  errorBadge: {
    backgroundColor: '#FEF2F2',
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
  },
  onlineText: {
    color: '#16A34A',
  },
  offlineText: {
    color: '#D97706',
  },
  syncingText: {
    color: '#0284C7',
  },
  errorText: {
    color: '#DC2626',
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#16A34A',
  },
});
