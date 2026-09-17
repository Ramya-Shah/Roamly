import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  ArrowLeft,
  Navigation,
  RefreshCw,
  AlertCircle,
  MapPin,
} from 'lucide-react-native';
import { useAtom } from 'jotai';
import { activeCityAtom } from '../../src/atoms/cityAtom';
import { useLocation } from '../../src/hooks/useLocation';
import { useNearbyExperiences } from '../../src/features/experiences/hooks/useNearbyExperiences';
import { ExperienceCard } from '../../src/components/ExperienceCard';
import { ExperienceCardSkeleton } from '../../src/components/LoadingSkeleton';
import { EmptyState } from '../../src/components/EmptyState';
import { AddToTripModal } from '../../src/components/AddToTripModal';
import { Experience } from '../../src/types';

export default function NearbyScreen() {
  const [activeCity] = useAtom(activeCityAtom);
  const {
    coords,
    effectiveCoords,
    status: locationStatus,
    error: locationError,
    isGranted,
    isDenied,
    isUnavailable,
    requestLocation,
  } = useLocation();

  const [radiusKm, setRadiusKm] = useState<number>(25);
  const [selectedExpForTrip, setSelectedExpForTrip] = useState<Experience | null>(null);

  useEffect(() => {
    // Request location immediately upon entering the Nearby screen
    requestLocation();
  }, [requestLocation]);

  const {
    data: nearbyExperiences = [],
    isLoading,
    refetch,
  } = useNearbyExperiences(
    effectiveCoords.latitude,
    effectiveCoords.longitude,
    radiusKm,
    activeCity
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            hitSlop={8}
          >
            <ArrowLeft size={20} color="#0F172A" />
          </TouchableOpacity>
          <View>
            <Text style={styles.title}>Explore Nearby</Text>
            <Text style={styles.subtitle}>
              {isGranted
                ? `GPS Active · Experiences near your location`
                : `Showing spots around ${activeCity} center`}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          activeOpacity={0.7}
          style={styles.refreshBtn}
          onPress={() => {
            requestLocation(true);
            refetch();
          }}
        >
          <RefreshCw size={18} color="#0F172A" />
        </TouchableOpacity>
      </View>

      {/* Permission Warning / Prompt Banner */}
      {(isDenied || isUnavailable) && (
        <View style={styles.permissionWarning}>
          <AlertCircle size={18} color="#B45309" />
          <View style={styles.permTextCol}>
            <Text style={styles.permTitle}>
              {isDenied ? 'Location Permission Denied' : 'Location Unavailable'}
            </Text>
            <Text style={styles.permDesc}>
              {locationError ||
                `Using standard coordinates for ${activeCity}. Grant GPS permission for precision distance sorting.`}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.enableBtn}
            onPress={() => requestLocation(true)}
          >
            <Text style={styles.enableBtnText}>Enable</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Radius Filters */}
      <View style={styles.radiusBar}>
        <Text style={styles.radiusLabel}>Radius:</Text>
        {[5, 15, 25, 40].map((r) => (
          <TouchableOpacity
            key={r}
            style={[styles.radiusPill, radiusKm === r && styles.radiusPillActive]}
            onPress={() => setRadiusKm(r)}
          >
            <Text
              style={[
                styles.radiusPillText,
                radiusKm === r && styles.radiusPillTextActive,
              ]}
            >
              Within {r} km
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Nearby List */}
      <FlatList
        data={nearbyExperiences}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <ExperienceCard
            experience={item}
            onAddToTrip={(exp) => setSelectedExpForTrip(exp)}
          />
        )}
        ListEmptyComponent={() =>
          isLoading ? (
            <>
              <ExperienceCardSkeleton />
              <ExperienceCardSkeleton />
            </>
          ) : (
            <EmptyState
              title="No spots within this radius"
              description={`We didn't find experiences within ${radiusKm} km of your coordinates. Try expanding your search radius.`}
              actionLabel="Expand to 40 km"
              onAction={() => setRadiusKm(40)}
              icon={<Navigation size={32} color="#0284C7" />}
            />
          )
        }
      />

      {/* Add To Trip Modal */}
      <AddToTripModal
        visible={Boolean(selectedExpForTrip)}
        experience={selectedExpForTrip}
        onClose={() => setSelectedExpForTrip(null)}
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
  },
  subtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  refreshBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  permissionWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 20,
    marginTop: 12,
    borderRadius: 12,
    gap: 10,
  },
  permTextCol: {
    flex: 1,
  },
  permTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#92400E',
  },
  permDesc: {
    fontSize: 11,
    color: '#B45309',
    marginTop: 1,
  },
  enableBtn: {
    backgroundColor: '#92400E',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  enableBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  radiusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 8,
  },
  radiusLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
  },
  radiusPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
  },
  radiusPillActive: {
    backgroundColor: '#0F172A',
  },
  radiusPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  radiusPillTextActive: {
    color: '#FFFFFF',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
});
