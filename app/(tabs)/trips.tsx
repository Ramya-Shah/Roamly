import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  Calendar,
  Clock,
  Plus,
  Navigation,
  CheckCircle,
  MapPin,
  Sparkles,
  ArrowRight,
  Bookmark,
  Trash2,
} from 'lucide-react-native';
import { useAtom } from 'jotai';
import { activeCityAtom } from '../../src/atoms/cityAtom';
import { currentGeneratedPlanAtom } from '../../src/atoms/planAtom';
import {
  useItineraries,
  useItineraryMutations,
} from '../../src/features/itineraries/hooks/useItineraries';
import { generatedPlanRepository } from '../../src/repositories/GeneratedPlanRepository';
import { ItineraryItem } from '../../src/components/ItineraryItem';
import { EmptyState } from '../../src/components/EmptyState';
import { SyncIndicator } from '../../src/components/SyncIndicator';
import { CityPickerModal } from '../../src/components/CityPickerModal';
import { Itinerary, GeneratedPlan } from '../../src/types';

export default function TripsScreen() {
  const [activeCity] = useAtom(activeCityAtom);
  const [, setCurrentPlan] = useAtom(currentGeneratedPlanAtom);
  const { data: itineraries = [], isLoading } = useItineraries(activeCity);
  const {
    createItinerary,
    removeItem,
    reorderItems,
    updateItemDuration,
    deleteItinerary,
  } = useItineraryMutations();

  const [activeSegment, setActiveSegment] = useState<'upcoming' | 'past' | 'ai_plans'>('upcoming');
  const [aiPlans, setAiPlans] = useState<GeneratedPlan[]>([]);
  const [selectedItinId, setSelectedItinId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newStartTime, setNewStartTime] = useState('10:00');
  const [showCityModal, setShowCityModal] = useState(false);

  const loadAiPlans = async () => {
    try {
      const plans = await generatedPlanRepository.getPlans(activeCity);
      setAiPlans(plans);
    } catch {}
  };

  useEffect(() => {
    loadAiPlans();
  }, [activeCity]);

  // Split itineraries by date
  const todayStr = new Date().toISOString().split('T')[0];
  const upcomingItineraries = itineraries.filter((i) => i.date >= todayStr);
  const pastItineraries = itineraries.filter((i) => i.date < todayStr);

  const displayedItineraries =
    activeSegment === 'past' ? pastItineraries : upcomingItineraries;

  // Default to first itinerary if available
  const activeItinerary: Itinerary | undefined =
    displayedItineraries.find((i) => i.id === selectedItinId) || displayedItineraries[0];

  const handleCreateTrip = async () => {
    if (!newTitle.trim()) return;
    const today = new Date().toISOString().split('T')[0];
    const created = await createItinerary.mutateAsync({
      title: newTitle.trim(),
      city: activeCity,
      date: today,
      startTime: newStartTime || '10:00',
    });
    setSelectedItinId(created.id);
    setNewTitle('');
    setShowCreateModal(false);
  };

  const handleMoveUp = (index: number) => {
    if (!activeItinerary || index <= 0) return;
    const newItems = [...activeItinerary.items];
    const temp = newItems[index];
    newItems[index] = newItems[index - 1];
    newItems[index - 1] = temp;
    reorderItems.mutate({
      itineraryId: activeItinerary.id,
      itemIds: newItems.map((i) => i.id),
    });
  };

  const handleMoveDown = (index: number) => {
    if (!activeItinerary || index >= activeItinerary.items.length - 1) return;
    const newItems = [...activeItinerary.items];
    const temp = newItems[index];
    newItems[index] = newItems[index + 1];
    newItems[index + 1] = temp;
    reorderItems.mutate({
      itineraryId: activeItinerary.id,
      itemIds: newItems.map((i) => i.id),
    });
  };

  const handleOpenAiPlan = (plan: GeneratedPlan) => {
    setCurrentPlan(plan);
    router.push('/plan/result' as any);
  };

  const handleConvertAiPlan = async (plan: GeneratedPlan) => {
    try {
      await generatedPlanRepository.convertToItinerary(plan);
      Alert.alert('Converted! 🎉', `"${plan.title}" is now an active trip itinerary.`);
      setActiveSegment('upcoming');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to convert plan');
    }
  };

  const handleDeleteAiPlan = async (id: string) => {
    try {
      await generatedPlanRepository.deletePlan(id);
      await loadAiPlans();
    } catch {}
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
        <View>
          <Text style={styles.headerTitle}>Trips & Itineraries</Text>
          <TouchableOpacity
            onPress={() => setShowCityModal(true)}
            style={styles.cityPill}
          >
            <MapPin size={13} color="#4F46E5" />
            <Text style={styles.cityPillText}>{activeCity} ▾</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.headerRight}>
          <SyncIndicator />
          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.newTripBtn}
            onPress={() => setShowCreateModal(true)}
          >
            <Plus size={16} color="#FFFFFF" />
            <Text style={styles.newTripBtnText}>New Trip</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Segmented Control */}
      <View style={styles.segmentedContainer}>
        <TouchableOpacity
          style={[
            styles.segmentBtn,
            activeSegment === 'upcoming' && styles.segmentBtnActive,
          ]}
          onPress={() => setActiveSegment('upcoming')}
        >
          <Text
            style={[
              styles.segmentText,
              activeSegment === 'upcoming' && styles.segmentTextActive,
            ]}
          >
            Upcoming ({upcomingItineraries.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.segmentBtn,
            activeSegment === 'past' && styles.segmentBtnActive,
          ]}
          onPress={() => setActiveSegment('past')}
        >
          <Text
            style={[
              styles.segmentText,
              activeSegment === 'past' && styles.segmentTextActive,
            ]}
          >
            Past ({pastItineraries.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.segmentBtn,
            activeSegment === 'ai_plans' && styles.segmentBtnActive,
          ]}
          onPress={() => setActiveSegment('ai_plans')}
        >
          <Sparkles
            size={13}
            color={activeSegment === 'ai_plans' ? '#4F46E5' : '#64748B'}
            style={{ marginRight: 4 }}
          />
          <Text
            style={[
              styles.segmentText,
              activeSegment === 'ai_plans' && styles.segmentTextActive,
            ]}
          >
            AI Plans ({aiPlans.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* AI Plans View */}
      {activeSegment === 'ai_plans' ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollBody}
        >
          {aiPlans.length === 0 ? (
            <EmptyState
              title="No AI Plans Yet"
              description={`Let Roamly AI curate a personalized day route based on your time and budget.`}
              actionLabel="Plan My Day ✨"
              onAction={() => router.push('/(tabs)/plan' as any)}
            />
          ) : (
            <View style={styles.aiPlansList}>
              {aiPlans.map((plan) => (
                <View key={plan.id} style={styles.aiPlanCard}>
                  <View style={styles.aiPlanCardHeader}>
                    <View style={styles.aiPlanBadge}>
                      <Sparkles size={12} color="#4F46E5" />
                      <Text style={styles.aiPlanBadgeText}>AI Plan</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => handleDeleteAiPlan(plan.id)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Trash2 size={16} color="#94A3B8" />
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.aiPlanTitle}>{plan.title}</Text>
                  <Text style={styles.aiPlanSummary} numberOfLines={2}>
                    {plan.summary}
                  </Text>

                  <View style={styles.aiPlanMetaRow}>
                    <Text style={styles.aiPlanMeta}>
                      {plan.stops.length} stops
                    </Text>
                    <Text style={styles.metaDot}>•</Text>
                    <Text style={styles.aiPlanMeta}>
                      ~{Math.round(plan.stops.reduce((acc, s) => acc + s.durationMinutes, 0) / 60)}h
                    </Text>
                    <Text style={styles.metaDot}>•</Text>
                    <Text style={styles.aiPlanMeta}>
                      {plan.estimatedCost === 0 ? 'Free' : `Cost: ${plan.estimatedCost}`}
                    </Text>
                  </View>

                  <View style={styles.aiPlanActions}>
                    <TouchableOpacity
                      style={styles.openAiPlanBtn}
                      onPress={() => handleOpenAiPlan(plan)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.openAiPlanText}>Open Plan</Text>
                      <ArrowRight size={14} color="#FFFFFF" />
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.convertAiPlanBtn}
                      onPress={() => handleConvertAiPlan(plan)}
                      activeOpacity={0.8}
                    >
                      <Bookmark size={14} color="#4F46E5" />
                      <Text style={styles.convertAiPlanText}>Save to Trips</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      ) : (
        /* Regular Itineraries View (Upcoming / Past) */
        <>
          {/* Trips Horizontal Tabs */}
          {displayedItineraries.length > 0 && (
            <View style={styles.tripTabsContainer}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.tripTabsScroll}
              >
                {displayedItineraries.map((itin) => {
                  const isSelected = activeItinerary?.id === itin.id;
                  return (
                    <TouchableOpacity
                      key={itin.id}
                      style={[styles.tripTab, isSelected && styles.tripTabSelected]}
                      onPress={() => setSelectedItinId(itin.id)}
                    >
                      <Calendar
                        size={14}
                        color={isSelected ? '#FFFFFF' : '#64748B'}
                      />
                      <Text
                        style={[
                          styles.tripTabText,
                          isSelected && styles.tripTabTextSelected,
                        ]}
                      >
                        {itin.title}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* Create New Trip In-Line Form */}
          {showCreateModal && (
            <View style={styles.createBox}>
              <Text style={styles.createTitle}>Create Day Plan</Text>
              <TextInput
                style={styles.createInput}
                placeholder="e.g. Saturday in Bengaluru"
                value={newTitle}
                onChangeText={setNewTitle}
                placeholderTextColor="#94A3B8"
              />
              <View style={styles.createRow}>
                <View style={styles.timeInputBox}>
                  <Clock size={16} color="#64748B" />
                  <TextInput
                    style={styles.timeInput}
                    placeholder="10:00"
                    value={newStartTime}
                    onChangeText={setNewStartTime}
                    placeholderTextColor="#94A3B8"
                  />
                </View>
                <TouchableOpacity
                  style={styles.createConfirmBtn}
                  onPress={handleCreateTrip}
                >
                  <Text style={styles.createConfirmText}>Create</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.createCancelBtn}
                  onPress={() => setShowCreateModal(false)}
                >
                  <Text style={styles.createCancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollBody}
          >
            {displayedItineraries.length === 0 ? (
              <EmptyState
                title={
                  activeSegment === 'past'
                    ? 'No Past Trips'
                    : 'No Upcoming Itineraries'
                }
                description={
                  activeSegment === 'past'
                    ? 'Completed trips will be displayed here.'
                    : `Plan your perfect day in ${activeCity}. Create a trip or let AI generate one.`
                }
                actionLabel="Create Trip"
                onAction={() => {
                  setNewTitle(`Saturday in ${activeCity}`);
                  setShowCreateModal(true);
                }}
              />
            ) : activeItinerary ? (
              <View>
                {/* Itinerary Summary Card */}
                <View style={styles.summaryCard}>
                  <View style={styles.summaryRow}>
                    <View>
                      <Text style={styles.summaryTitle}>
                        {activeItinerary.title}
                      </Text>
                      <Text style={styles.summarySubtitle}>
                        {activeItinerary.city} · {activeItinerary.date}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => {
                        Alert.alert(
                          'Delete Itinerary',
                          `Are you sure you want to delete "${activeItinerary.title}"?`,
                          [
                            { text: 'Cancel', style: 'cancel' },
                            {
                              text: 'Delete',
                              style: 'destructive',
                              onPress: () =>
                                deleteItinerary.mutate(activeItinerary.id),
                            },
                          ]
                        );
                      }}
                      hitSlop={8}
                    >
                      <Text style={styles.deleteItinText}>Delete Trip</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Summary Stats Row */}
                  <View style={styles.statsRow}>
                    <View style={styles.statItem}>
                      <Clock size={16} color="#4F46E5" />
                      <View>
                        <Text style={styles.statLabel}>Total Time</Text>
                        <Text style={styles.statValue}>
                          {formatTotalTime(
                            activeItinerary.totalDurationMinutes || 0
                          )}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.statDivider} />

                    <View style={styles.statItem}>
                      <Navigation size={16} color="#10B981" />
                      <View>
                        <Text style={styles.statLabel}>Distance</Text>
                        <Text style={styles.statValue}>
                          {activeItinerary.totalDistanceKm || 0} km
                        </Text>
                      </View>
                    </View>

                    <View style={styles.statDivider} />

                    <View style={styles.statItem}>
                      <CheckCircle size={16} color="#F59E0B" />
                      <View>
                        <Text style={styles.statLabel}>Stops</Text>
                        <Text style={styles.statValue}>
                          {activeItinerary.items?.length || 0}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>

                {/* Timeline Items */}
                <View style={styles.timelineSection}>
                  <View style={styles.timelineHeader}>
                    <Text style={styles.timelineTitle}>Day Schedule</Text>
                    <TouchableOpacity
                      style={styles.addStopLink}
                      onPress={() => router.push('/(tabs)/explore')}
                    >
                      <Plus size={14} color="#4F46E5" />
                      <Text style={styles.addStopText}>Add from Explore</Text>
                    </TouchableOpacity>
                  </View>

                  {activeItinerary.items && activeItinerary.items.length > 0 ? (
                    activeItinerary.items.map((item, index) => (
                      <ItineraryItem
                        key={item.id}
                        item={item}
                        index={index}
                        totalItems={activeItinerary.items.length}
                        onRemove={() =>
                          removeItem.mutate({
                            itineraryId: activeItinerary.id,
                            itemId: item.id,
                          })
                        }
                        onMoveUp={() => handleMoveUp(index)}
                        onMoveDown={() => handleMoveDown(index)}
                        onUpdateDuration={(newDuration: number) =>
                          updateItemDuration.mutate({
                            itineraryId: activeItinerary.id,
                            itemId: item.id,
                            durationMinutes: Math.max(15, newDuration),
                          })
                        }
                      />
                    ))
                  ) : (
                    <EmptyState
                      title="No stops added"
                      description="Explore experiences in the city and tap 'Add to Trip' to build your schedule."
                      actionLabel="Explore Places"
                      onAction={() => router.push('/(tabs)/explore')}
                    />
                  )}
                </View>
              </View>
            ) : null}
          </ScrollView>
        </>
      )}

      {/* City Switcher Modal */}
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
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
  },
  cityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  cityPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4F46E5',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  newTripBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#0F172A',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  newTripBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  segmentedContainer: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
  },
  segmentBtnActive: {
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  segmentText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  segmentTextActive: {
    color: '#4F46E5',
    fontWeight: '700',
  },
  tripTabsContainer: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingVertical: 10,
  },
  tripTabsScroll: {
    paddingHorizontal: 20,
    gap: 8,
  },
  tripTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
  },
  tripTabSelected: {
    backgroundColor: '#0F172A',
  },
  tripTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  tripTabTextSelected: {
    color: '#FFFFFF',
  },
  createBox: {
    backgroundColor: '#FFFFFF',
    margin: 16,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 10,
  },
  createTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  createInput: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: '#0F172A',
  },
  createRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  timeInputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flex: 1,
  },
  timeInput: {
    fontSize: 14,
    color: '#0F172A',
    flex: 1,
  },
  createConfirmBtn: {
    backgroundColor: '#4F46E5',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
  },
  createConfirmText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  createCancelBtn: {
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  createCancelText: {
    color: '#64748B',
    fontWeight: '600',
    fontSize: 13,
  },
  scrollBody: {
    padding: 16,
    paddingBottom: 40,
  },
  aiPlansList: {
    gap: 14,
  },
  aiPlanCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  aiPlanCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  aiPlanBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  aiPlanBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4F46E5',
  },
  aiPlanTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
  },
  aiPlanSummary: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
  },
  aiPlanMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  aiPlanMeta: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  metaDot: {
    fontSize: 12,
    color: '#CBD5E1',
  },
  aiPlanActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  openAiPlanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#4F46E5',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  openAiPlanText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  convertAiPlanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  convertAiPlanText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4F46E5',
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  summaryTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  summarySubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
  },
  deleteItinText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#EF4444',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statLabel: {
    fontSize: 10,
    color: '#64748B',
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  statValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#E2E8F0',
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
  addStopLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addStopText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4F46E5',
  },
});
