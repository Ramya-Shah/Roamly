import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Clock, Navigation, Plus } from 'lucide-react-native';
import {
  useItineraryDetails,
  useItineraryMutations,
} from '../../src/features/itineraries/hooks/useItineraries';
import { ItineraryItem } from '../../src/components/ItineraryItem';
import { EmptyState } from '../../src/components/EmptyState';

export default function ItineraryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: itinerary, isLoading } = useItineraryDetails(id);
  const { removeItem, reorderItems, updateItemDuration } = useItineraryMutations();

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0F172A" />
      </View>
    );
  }

  if (!itinerary) {
    return (
      <SafeAreaView style={styles.notFoundContainer}>
        <Text style={styles.notFoundText}>Itinerary not found</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const handleMoveUp = (index: number) => {
    if (index <= 0) return;
    const newItems = [...itinerary.items];
    const temp = newItems[index];
    newItems[index] = newItems[index - 1];
    newItems[index - 1] = temp;
    reorderItems.mutate({
      itineraryId: itinerary.id,
      itemIds: newItems.map((i) => i.id),
    });
  };

  const handleMoveDown = (index: number) => {
    if (index >= itinerary.items.length - 1) return;
    const newItems = [...itinerary.items];
    const temp = newItems[index];
    newItems[index] = newItems[index + 1];
    newItems[index + 1] = temp;
    reorderItems.mutate({
      itineraryId: itinerary.id,
      itemIds: newItems.map((i) => i.id),
    });
  };

  const formatTotalTime = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtnCircle}
          onPress={() => router.back()}
          hitSlop={8}
        >
          <ArrowLeft size={20} color="#0F172A" />
        </TouchableOpacity>
        <View style={styles.headerTitleCol}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {itinerary.title}
          </Text>
          <Text style={styles.headerSubtitle}>
            {itinerary.city} · {itinerary.date}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Stats Row */}
        <View style={styles.statsCard}>
          <View style={styles.statBox}>
            <Clock size={16} color="#0F172A" />
            <Text style={styles.statVal}>{formatTotalTime(itinerary.totalDurationMinutes)}</Text>
            <Text style={styles.statLbl}>Total Time</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Navigation size={16} color="#0284C7" />
            <Text style={styles.statVal}>{itinerary.totalDistanceKm} km</Text>
            <Text style={styles.statLbl}>Est. Travel</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={styles.statValBig}>{itinerary.items.length}</Text>
            <Text style={styles.statLbl}>Stops</Text>
          </View>
        </View>

        {/* Timeline */}
        <View style={styles.timelineSection}>
          <View style={styles.timelineHeader}>
            <Text style={styles.timelineTitle}>Day Itinerary Stops</Text>
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => router.push('/(tabs)/explore')}
            >
              <Plus size={14} color="#0284C7" />
              <Text style={styles.addBtnText}>Add Place</Text>
            </TouchableOpacity>
          </View>

          {itinerary.items.length === 0 ? (
            <EmptyState
              title="No places in this day trip"
              description="Explore attractions and add them to this itinerary."
              actionLabel="Find Places"
              onAction={() => router.push('/(tabs)/explore')}
            />
          ) : (
            itinerary.items.map((item, index) => (
              <ItineraryItem
                key={item.id}
                item={item}
                index={index}
                totalItems={itinerary.items.length}
                onMoveUp={() => handleMoveUp(index)}
                onMoveDown={() => handleMoveDown(index)}
                onRemove={() =>
                  removeItem.mutate({
                    itineraryId: itinerary.id,
                    itemId: item.id,
                  })
                }
                onUpdateDuration={(newDur) =>
                  updateItemDuration.mutate({
                    itineraryId: itinerary.id,
                    itemId: item.id,
                    durationMinutes: newDur,
                  })
                }
              />
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notFoundContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  notFoundText: {
    fontSize: 16,
    color: '#64748B',
  },
  backBtn: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  backBtnText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
    gap: 12,
  },
  backBtnCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleCol: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#64748B',
  },
  content: {
    padding: 20,
    paddingBottom: 32,
  },
  statsCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 20,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  statVal: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  statValBig: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  statLbl: {
    fontSize: 11,
    color: '#64748B',
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: '#CBD5E1',
  },
  timelineSection: {
    marginTop: 8,
  },
  timelineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  timelineTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0284C7',
  },
});
