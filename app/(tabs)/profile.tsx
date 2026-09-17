import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Database,
  RefreshCw,
  MapPin,
  CheckCircle,
  Wifi,
  Trash2,
  ExternalLink,
  Shield,
  Compass,
} from 'lucide-react-native';
import { useAtom } from 'jotai';
import { activeCityAtom } from '../../src/atoms/cityAtom';
import { useNetworkStatus } from '../../src/hooks/useNetworkStatus';
import { syncQueueRepository } from '../../src/repositories/SyncQueueRepository';
import { db } from '../../src/database/db';
import { CityPickerModal } from '../../src/components/CityPickerModal';

export default function ProfileScreen() {
  const [activeCity] = useAtom(activeCityAtom);
  const { status, pendingCount, isSyncing, forceSync } = useNetworkStatus();
  const [queueStats, setQueueStats] = useState({ pendingCount: 0, failedCount: 0 });
  const [showCityModal, setShowCityModal] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const loadStats = async () => {
    try {
      const stats = await syncQueueRepository.getQueueStats();
      setQueueStats(stats);
    } catch {}
  };

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleManualSync = async () => {
    try {
      await forceSync();
      await loadStats();
      Alert.alert('Sync Finished', 'Offline queue has been synchronized with the server.');
    } catch (err: any) {
      Alert.alert('Sync Error', err.message || 'Failed to sync mutations');
    }
  };

  const handleResetData = () => {
    Alert.alert(
      'Reset Local Data',
      'This will clear local SQLite modifications and restore fresh seed experiences for Bengaluru, Mumbai, and London.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset Database',
          style: 'destructive',
          onPress: async () => {
            setIsResetting(true);
            await db.reset();
            await loadStats();
            setIsResetting(false);
            Alert.alert('Reset Complete', 'Local SQLite tables and seed data have been reinitialized.');
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Account & System</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* User Card */}
        <View style={styles.userCard}>
          <View style={styles.avatarCircle}>
            <Compass size={28} color="#FFFFFF" />
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userName}>Roamly Traveler</Text>
            <Text style={styles.userEmail}>explorer@roamly.app</Text>
          </View>
        </View>

        {/* Active Destination Preference */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Current Exploration City</Text>
          <TouchableOpacity
            style={styles.cityRow}
            activeOpacity={0.7}
            onPress={() => setShowCityModal(true)}
          >
            <View style={styles.cityLeft}>
              <MapPin size={20} color="#0284C7" />
              <View>
                <Text style={styles.cityName}>{activeCity}</Text>
                <Text style={styles.cityDesc}>Tap to switch city context</Text>
              </View>
            </View>
            <Text style={styles.changeText}>Change</Text>
          </TouchableOpacity>
        </View>

        {/* Offline Engine Diagnostics */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderTitleRow}>
              <Database size={18} color="#0F172A" />
              <Text style={styles.cardTitle}>Offline Engine & SQLite Storage</Text>
            </View>
            <View style={styles.statusPill}>
              <Text style={styles.statusPillText}>{status}</Text>
            </View>
          </View>

          <View style={styles.diagGrid}>
            <View style={styles.diagItem}>
              <Text style={styles.diagValue}>{queueStats.pendingCount}</Text>
              <Text style={styles.diagLabel}>Pending Sync</Text>
            </View>
            <View style={styles.diagItem}>
              <Text style={styles.diagValue}>{queueStats.failedCount}</Text>
              <Text style={styles.diagLabel}>Retry Queue</Text>
            </View>
            <View style={styles.diagItem}>
              <Text style={styles.diagValue}>30+</Text>
              <Text style={styles.diagLabel}>Cached Spots</Text>
            </View>
          </View>

          <TouchableOpacity
            activeOpacity={0.8}
            style={[styles.syncButton, isSyncing && styles.syncButtonDisabled]}
            disabled={isSyncing}
            onPress={handleManualSync}
          >
            {isSyncing ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <RefreshCw size={16} color="#FFFFFF" />
                <Text style={styles.syncButtonText}>Sync Queue with Server</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Reset & Storage Actions */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Storage Administration</Text>
          <TouchableOpacity
            activeOpacity={0.7}
            style={styles.actionRow}
            onPress={handleResetData}
            disabled={isResetting}
          >
            <Trash2 size={18} color="#EF4444" />
            <View style={styles.actionTextCol}>
              <Text style={styles.actionTitleDestructive}>
                {isResetting ? 'Resetting Database...' : 'Reset Local SQLite Database'}
              </Text>
              <Text style={styles.actionDesc}>
                Clears queue and restores baseline seed experiences
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Architecture Specs */}
        <View style={styles.card}>
          <View style={styles.cardHeaderTitleRow}>
            <Shield size={18} color="#0F172A" />
            <Text style={styles.cardTitle}>Architecture Specifications</Text>
          </View>
          <Text style={styles.specText}>• Storage: SQLite via expo-sqlite (WAL mode)</Text>
          <Text style={styles.specText}>• Client State: Jotai atomic stores</Text>
          <Text style={styles.specText}>• Server Cache: TanStack Query v5</Text>
          <Text style={styles.specText}>• Backend: Fastify + Prisma ORM + PostgreSQL</Text>
          <Text style={styles.specText}>• Sync Protocol: Idempotent FIFO mutation queue with exponential backoff</Text>
          <Text style={styles.specText}>• Native Shortcut: 'Explore Nearby' quick action</Text>
        </View>
      </ScrollView>

      <CityPickerModal
        visible={showCityModal}
        onClose={() => setShowCityModal(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
  },
  content: {
    padding: 20,
    gap: 16,
    paddingBottom: 32,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 20,
    padding: 16,
    gap: 14,
  },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  userEmail: {
    color: '#94A3B8',
    fontSize: 13,
    marginTop: 2,
  },
  card: {
    backgroundColor: '#F8FAFC',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardHeaderTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 10,
  },
  statusPill: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  cityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  cityLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cityName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  cityDesc: {
    fontSize: 12,
    color: '#64748B',
  },
  changeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0284C7',
  },
  diagGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14,
  },
  diagItem: {
    alignItems: 'center',
    flex: 1,
  },
  diagValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  diagLabel: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  syncButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F172A',
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  syncButtonDisabled: {
    opacity: 0.6,
  },
  syncButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FEE2E2',
  },
  actionTextCol: {
    flex: 1,
  },
  actionTitleDestructive: {
    fontSize: 14,
    fontWeight: '700',
    color: '#EF4444',
  },
  actionDesc: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  specText: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 20,
  },
});
