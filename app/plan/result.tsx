import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAtom } from 'jotai';
import { router } from 'expo-router';
import {
  ArrowLeft,
  Sparkles,
  Clock,
  Wallet,
  Car,
  Bookmark,
  Check,
  Edit3,
  RefreshCw,
  MapPin,
  Star,
  ChevronDown,
  X,
} from 'lucide-react-native';
import { currentGeneratedPlanAtom } from '../../src/atoms/planAtom';
import { activeCityAtom, AVAILABLE_CITIES } from '../../src/atoms/cityAtom';
import { generatedPlanRepository } from '../../src/repositories/GeneratedPlanRepository';
import { experienceRepository } from '../../src/repositories/ExperienceRepository';
import { regenerateAIPlan } from '../../src/api/aiApi';
import { Experience, PlanModifier, RegeneratePlanRequest } from '../../src/types';

const MODIFIERS: Array<{ id: PlanModifier; label: string; icon: string; desc: string }> = [
  { id: 'more_relaxed', label: 'More Relaxed', icon: '🌿', desc: 'Fewer stops, more leisure time' },
  { id: 'more_adventurous', label: 'More Adventurous', icon: '⚡', desc: 'Higher energy, active experiences' },
  { id: 'cheaper', label: 'Cheaper', icon: '💰', desc: 'Prioritize free & budget stops' },
  { id: 'more_food', label: 'More Food Focus', icon: '🍜', desc: 'Artisan bites, food tours & cafes' },
  { id: 'less_walking', label: 'Less Walking', icon: '🚶', desc: 'Tight geographic cluster' },
  { id: 'more_cultural', label: 'More Cultural', icon: '🏛️', desc: 'Museums, heritage & history' },
];

export default function PlanResultScreen() {
  const [currentPlan, setCurrentPlan] = useAtom(currentGeneratedPlanAtom);
  const [city] = useAtom(activeCityAtom);
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [modifierModalVisible, setModifierModalVisible] = useState(false);

  const currentCityConfig =
    AVAILABLE_CITIES.find((c) => c.name === (currentPlan?.city || city)) ||
    AVAILABLE_CITIES[0];

  if (!currentPlan) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyContainer}>
          <Sparkles size={48} color="#94A3B8" />
          <Text style={styles.emptyTitle}>No Plan Generated Yet</Text>
          <Text style={styles.emptySubtitle}>
            Answer a few questions to get your personalized itinerary.
          </Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => router.replace('/(tabs)/plan' as any)}
          >
            <Text style={styles.primaryButtonText}>Create Plan</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const handleSaveToTrips = async () => {
    if (isSaved || isSaving) return;
    setIsSaving(true);

    try {
      await generatedPlanRepository.convertToItinerary(currentPlan);
      setIsSaved(true);
      Alert.alert(
        'Saved to Trips! 🎉',
        'Your AI plan has been added to your Trips tab. You can view, reorder, or edit stops anytime offline.',
        [
          { text: 'Stay Here', style: 'cancel' },
          {
            text: 'View in Trips',
            onPress: () => router.push('/(tabs)/trips'),
          },
        ]
      );
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save itinerary');
    } finally {
      setIsSaving(false);
    }
  };

  const handleApplyModifier = async (modifier: PlanModifier) => {
    setModifierModalVisible(false);
    setIsRegenerating(true);

    try {
      const req: RegeneratePlanRequest = {
        currentPlan,
        modifier,
        city: currentPlan.city,
      };

      const res = await regenerateAIPlan(req);
      if (res.success && res.plan) {
        const expToCache = res.plan.stops
          .map((s) => s.experience)
          .filter((e): e is Experience => !!e);
        if (expToCache.length > 0) {
          await experienceRepository.cacheExperiences(expToCache);
        }
        await generatedPlanRepository.savePlan(res.plan);
        setCurrentPlan(res.plan);
        setIsSaved(false); // Reset saved status for new version
      } else {
        Alert.alert('Notice', 'Could not apply adjustment. Kept existing plan.');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to regenerate');
    } finally {
      setIsRegenerating(false);
    }
  };

  const totalDurationHours = Math.round(
    currentPlan.stops.reduce((acc, s) => acc + s.durationMinutes, 0) / 60
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <ArrowLeft size={22} color="#0F172A" />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {currentPlan.title}
          </Text>
          <Text style={styles.headerSubtitle}>{currentPlan.city}</Text>
        </View>
        <TouchableOpacity
          style={styles.actionIconButton}
          onPress={() => router.push('/plan/edit' as any)}
        >
          <Edit3 size={20} color="#0F172A" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollContent}
        contentContainerStyle={styles.scrollInner}
        showsVerticalScrollIndicator={false}
      >
        {/* Plan Hero Card */}
        <View style={styles.heroCard}>
          <View style={styles.aiBadge}>
            <Sparkles size={14} color="#4F46E5" />
            <Text style={styles.aiBadgeText}>Curated by Roamly AI</Text>
          </View>
          <Text style={styles.planTitle}>{currentPlan.title}</Text>
          <Text style={styles.planSummary}>{currentPlan.summary}</Text>

          {/* Stats Row */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Clock size={16} color="#4F46E5" />
              <Text style={styles.statValue}>~{totalDurationHours}h</Text>
              <Text style={styles.statLabel}>Duration</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Wallet size={16} color="#10B981" />
              <Text style={styles.statValue}>
                {currentPlan.estimatedCost === 0
                  ? 'Free'
                  : `${currentCityConfig.currency}${currentPlan.estimatedCost}`}
              </Text>
              <Text style={styles.statLabel}>Est. Cost</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Car size={16} color="#F59E0B" />
              <Text style={styles.statValue}>
                {currentPlan.estimatedTravelMinutes}m
              </Text>
              <Text style={styles.statLabel}>Travel Time</Text>
            </View>
          </View>
        </View>

        {/* Quick Actions Row */}
        <View style={styles.actionButtonsRow}>
          <TouchableOpacity
            style={[styles.saveTripButton, isSaved && styles.savedTripButton]}
            onPress={handleSaveToTrips}
            disabled={isSaving}
            activeOpacity={0.8}
          >
            {isSaved ? (
              <>
                <Check size={18} color="#FFFFFF" />
                <Text style={styles.saveTripButtonText}>Saved to Trips</Text>
              </>
            ) : (
              <>
                <Bookmark size={18} color="#FFFFFF" />
                <Text style={styles.saveTripButtonText}>
                  {isSaving ? 'Saving...' : 'Save to Trips'}
                </Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.regenerateButton}
            onPress={() => setModifierModalVisible(true)}
            activeOpacity={0.8}
          >
            <RefreshCw size={17} color="#4F46E5" />
            <Text style={styles.regenerateButtonText}>Adjust Plan</Text>
            <ChevronDown size={15} color="#4F46E5" />
          </TouchableOpacity>
        </View>

        {/* Timeline Section */}
        <View style={styles.timelineSection}>
          <Text style={styles.sectionHeading}>Planned Timeline</Text>

          {currentPlan.stops.map((stop, idx) => {
            const exp = stop.experience;
            const isLast = idx === currentPlan.stops.length - 1;

            return (
              <View key={stop.experienceId || idx} style={styles.timelineItem}>
                {/* Time & Indicator Column */}
                <View style={styles.timelineColumn}>
                  <View style={styles.timeBubble}>
                    <Text style={styles.timeText}>{stop.startTime}</Text>
                  </View>
                  {!isLast && <View style={styles.timelineLine} />}
                </View>

                {/* Stop Content Card */}
                <View style={styles.stopCard}>
                  {exp?.imageUrl ? (
                    <Image
                      source={{ uri: exp.imageUrl }}
                      style={styles.stopImage}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={styles.stopImagePlaceholder}>
                      <MapPin size={24} color="#94A3B8" />
                    </View>
                  )}

                  <View style={styles.stopDetails}>
                    <View style={styles.stopHeaderRow}>
                      <Text style={styles.stopTitle} numberOfLines={1}>
                        {exp?.title || 'Experience'}
                      </Text>
                      {exp?.rating ? (
                        <View style={styles.ratingBadge}>
                          <Star size={11} color="#D97706" fill="#D97706" />
                          <Text style={styles.ratingText}>{exp.rating}</Text>
                        </View>
                      ) : null}
                    </View>

                    <View style={styles.stopMetaRow}>
                      <Text style={styles.stopCategory}>
                        {exp?.category || 'Activity'}
                      </Text>
                      <Text style={styles.metaDot}>•</Text>
                      <Text style={styles.stopDuration}>
                        {stop.durationMinutes} mins
                      </Text>
                      <Text style={styles.metaDot}>•</Text>
                      <Text style={styles.stopPrice}>
                        {exp?.priceTier || 'Free'}
                      </Text>
                    </View>

                    {/* Gemini AI Reason Card */}
                    <View style={styles.aiReasonBox}>
                      <Sparkles size={13} color="#4F46E5" style={{ marginTop: 2 }} />
                      <Text style={styles.aiReasonText}>{stop.reason}</Text>
                    </View>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* Regenerate / Modifier Modal */}
      <Modal
        visible={modifierModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModifierModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Adjust This Plan</Text>
                <Text style={styles.modalSubtitle}>
                  Choose how you want to tweak your day
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setModifierModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <X size={22} color="#64748B" />
              </TouchableOpacity>
            </View>

            <View style={styles.modifierList}>
              {MODIFIERS.map((m) => (
                <TouchableOpacity
                  key={m.id}
                  style={styles.modifierOption}
                  onPress={() => handleApplyModifier(m.id)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.modifierIcon}>{m.icon}</Text>
                  <View style={styles.modifierTextWrap}>
                    <Text style={styles.modifierLabel}>{m.label}</Text>
                    <Text style={styles.modifierDesc}>{m.desc}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>

      {/* Loading Modal */}
      {isRegenerating && (
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color="#4F46E5" />
            <Text style={styles.loadingCardTitle}>Adjusting Itinerary...</Text>
            <Text style={styles.loadingCardSubtitle}>
              Applying your modifier and re-calculating routes
            </Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  backButton: {
    padding: 6,
  },
  headerTitleWrap: {
    flex: 1,
    marginHorizontal: 12,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#64748B',
  },
  actionIconButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  scrollContent: {
    flex: 1,
  },
  scrollInner: {
    padding: 16,
    paddingBottom: 40,
  },
  heroCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
    marginBottom: 16,
  },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    marginBottom: 10,
  },
  aiBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4F46E5',
  },
  planTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    lineHeight: 28,
  },
  planSummary: {
    fontSize: 14,
    color: '#475569',
    lineHeight: 20,
    marginTop: 8,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 16,
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
    gap: 4,
  },
  statValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  statLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#E2E8F0',
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  saveTripButton: {
    flex: 1.2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#0F172A',
    paddingVertical: 14,
    borderRadius: 14,
  },
  savedTripButton: {
    backgroundColor: '#10B981',
  },
  saveTripButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  regenerateButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#EEF2FF',
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  regenerateButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#4F46E5',
  },
  timelineSection: {
    marginTop: 4,
  },
  sectionHeading: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 16,
  },
  timelineItem: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  timelineColumn: {
    width: 60,
    alignItems: 'center',
  },
  timeBubble: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  timeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  timelineLine: {
    flex: 1,
    width: 2,
    backgroundColor: '#CBD5E1',
    marginTop: 6,
    marginBottom: -6,
  },
  stopCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginLeft: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  stopImage: {
    width: '100%',
    height: 120,
  },
  stopImagePlaceholder: {
    width: '100%',
    height: 90,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopDetails: {
    padding: 14,
    gap: 6,
  },
  stopHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stopTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    flex: 1,
    marginRight: 8,
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  ratingText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#B45309',
  },
  stopMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stopCategory: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4F46E5',
  },
  metaDot: {
    fontSize: 12,
    color: '#CBD5E1',
  },
  stopDuration: {
    fontSize: 12,
    color: '#64748B',
  },
  stopPrice: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0F172A',
  },
  aiReasonBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: '#F5F3FF',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E0E7FF',
    marginTop: 4,
  },
  aiReasonText: {
    fontSize: 12,
    color: '#4338CA',
    lineHeight: 17,
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
  },
  primaryButton: {
    backgroundColor: '#4F46E5',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    gap: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
  },
  modifierList: {
    gap: 10,
    marginTop: 8,
  },
  modifierOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#F8FAFC',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  modifierIcon: {
    fontSize: 24,
  },
  modifierTextWrap: {
    flex: 1,
  },
  modifierLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  modifierDesc: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  loadingCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    gap: 10,
    width: '80%',
  },
  loadingCardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
  },
  loadingCardSubtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
  },
});
