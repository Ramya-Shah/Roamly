import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAtom } from 'jotai';
import { router } from 'expo-router';
import {
  Sparkles,
  Clock,
  Wallet,
  Compass,
  Sliders,
  MapPin,
  ArrowRight,
  ArrowLeft,
  Check,
  Zap,
  Info,
} from 'lucide-react-native';
import { activeCityAtom, AVAILABLE_CITIES } from '../../src/atoms/cityAtom';
import { networkStateAtom } from '../../src/atoms/networkAtom';
import {
  planWizardStateAtom,
  currentGeneratedPlanAtom,
  isGeneratingPlanAtom,
} from '../../src/atoms/planAtom';
import { useLocation } from '../../src/hooks/useLocation';
import { generateAIPlan } from '../../src/api/aiApi';
import { generatedPlanRepository } from '../../src/repositories/GeneratedPlanRepository';
import { ExperienceRepository } from '../../src/repositories/ExperienceRepository';
import { AIPlanRequest, GeneratedPlan, Experience } from '../../src/types';

const TIME_OPTIONS = [
  { minutes: 60, label: '1 Hour', subtitle: 'Quick coffee & sight' },
  { minutes: 120, label: '2 Hours', subtitle: 'Short leisurely outing' },
  { minutes: 180, label: '3 Hours', subtitle: 'Afternoon adventure' },
  { minutes: 240, label: '4 Hours', subtitle: 'Half day (Recommended)' },
  { minutes: 360, label: '6 Hours', subtitle: 'Extended discovery' },
  { minutes: 480, label: 'Full Day', subtitle: '8+ hours deep immersion' },
];

const BUDGET_OPTIONS = [
  { value: 0, label: 'Free only', subtitle: 'Parks, plazas & free galleries' },
  { value: 500, label: 'Budget friendly', subtitle: 'Low-cost entry & street eats' },
  { value: 1000, label: 'Moderate', subtitle: 'Standard admissions & cafes' },
  { value: 2500, label: 'Splurge', subtitle: 'Top museums & dining' },
  { value: 5000, label: 'Premium', subtitle: 'Royal estates & fine tours' },
];

const INTEREST_OPTIONS = [
  'Culture',
  'Food',
  'History',
  'Parks',
  'Science',
  'Architecture',
  'Nightlife',
  'Art',
  'Live Music',
  'Shopping',
];

const PREFERENCE_OPTIONS = [
  'Relaxed',
  'Packed',
  'Outdoor',
  'Indoor',
  'Solo',
  'Couple',
  'Friends',
  'Family',
];

export default function PlanScreen() {
  const [city] = useAtom(activeCityAtom);
  const [network] = useAtom(networkStateAtom);
  const [wizardState, setWizardState] = useAtom(planWizardStateAtom);
  const [, setCurrentPlan] = useAtom(currentGeneratedPlanAtom);
  const [isGenerating, setIsGenerating] = useAtom(isGeneratingPlanAtom);
  const [generationStepText, setGenerationStepText] = useState('Analyzing city candidates...');

  const { coords, requestLocation } = useLocation();

  const currentCityConfig =
    AVAILABLE_CITIES.find((c) => c.name === city) || AVAILABLE_CITIES[0];

  const handleNext = () => {
    if (wizardState.step < 5) {
      setWizardState((prev) => ({ ...prev, step: prev.step + 1 }));
    }
  };

  const handleBack = () => {
    if (wizardState.step > 1) {
      setWizardState((prev) => ({ ...prev, step: prev.step - 1 }));
    }
  };

  const toggleInterest = (interest: string) => {
    setWizardState((prev) => {
      const exists = prev.interests.includes(interest);
      const updated = exists
        ? prev.interests.filter((i) => i !== interest)
        : [...prev.interests, interest];
      return { ...prev, interests: updated.length > 0 ? updated : [interest] };
    });
  };

  const togglePreference = (pref: string) => {
    setWizardState((prev) => {
      const exists = prev.preferences.includes(pref);
      const updated = exists
        ? prev.preferences.filter((p) => p !== pref)
        : [...prev.preferences, pref];
      return { ...prev, preferences: updated.length > 0 ? updated : [pref] };
    });
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setGenerationStepText('Selecting top experiences...');

    try {
      // Determine starting location
      let startCoords = currentCityConfig.defaultCoords;
      if (wizardState.useCurrentLocation) {
        if (coords) {
          startCoords = coords;
        } else {
          const fresh = await requestLocation();
          if (fresh) startCoords = fresh;
        }
      }

      const planRequest: AIPlanRequest = {
        city,
        location: {
          latitude: startCoords.latitude,
          longitude: startCoords.longitude,
          address: `${city} Central`,
        },
        availableMinutes: wizardState.availableMinutes,
        budget: wizardState.budget,
        interests: wizardState.interests,
        preferences: wizardState.preferences,
      };

      setGenerationStepText('Curating with Gemini AI...');

      let plan: GeneratedPlan | null = null;

      // Try backend AI generation if online
      if (network.status !== 'OFFLINE') {
        const response = await generateAIPlan(planRequest);
        if (response.success && response.plan) {
          plan = response.plan;
        }
      }

      // Offline fallback: generate plan locally from SQLite experiences
      if (!plan) {
        setGenerationStepText('Optimizing local itinerary...');
        const expRepo = new ExperienceRepository();
        const experiences = await expRepo.getExperiences({ city });

        if (experiences.length === 0) {
          throw new Error(
            `No offline cached experiences found for "${city}". Please connect to the internet to generate a dynamic itinerary with Roamly Gemini AI.`
          );
        }

        // Simple local deterministic curation
        const matched = experiences
          .filter((e) => {
            if (wizardState.budget === 0) return e.priceTier === 'Free';
            return e.priceAmount <= (wizardState.budget || 2000);
          })
          .slice(0, 3);

        const pool = matched.length >= 2 ? matched : experiences.slice(0, 3);

        const stops = pool.map((exp, idx) => ({
          experienceId: exp.id,
          startTime: `${10 + idx * 2}:00`,
          durationMinutes: exp.durationMinutes,
          reason: `High rating in ${exp.category} matching your preferences in ${city}.`,
          experience: exp,
        }));

        plan = {
          id: `plan-offline-${Date.now()}`,
          title: `${city} Highlights (${Math.round(wizardState.availableMinutes / 60)}h)`,
          summary: `An offline-optimized route crafted for your available ${Math.round(
            wizardState.availableMinutes / 60
          )} hours in ${city}.`,
          city,
          stops,
          estimatedCost: stops.reduce((sum, s) => sum + (s.experience?.priceAmount || 0), 0),
          estimatedTravelMinutes: 30,
          createdAt: new Date().toISOString(),
          requestParams: planRequest,
        };
      }

      // Cache dynamic experiences locally into SQLite catalog
      const expToCache = plan.stops
        .map((s) => s.experience)
        .filter((e): e is Experience => !!e);
      if (expToCache.length > 0) {
        const expRepo = new ExperienceRepository();
        await expRepo.cacheExperiences(expToCache);
      }

      // Save locally to SQLite
      await generatedPlanRepository.savePlan(plan);
      setCurrentPlan(plan);

      // Navigate to result screen
      router.push('/plan/result' as any);
    } catch (err: any) {
      Alert.alert('Planning Error', err.message || 'Could not generate plan. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.titleRow}>
            <Sparkles size={22} color="#4F46E5" />
            <Text style={styles.headerTitle}>AI Experience Planner</Text>
          </View>
          <Text style={styles.headerSubtitle}>
            What should I do right now in {city}?
          </Text>
        </View>
        <View style={styles.stepBadge}>
          <Text style={styles.stepBadgeText}>
            {wizardState.step} / 5
          </Text>
        </View>
      </View>

      {/* Progress Bar */}
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressBar,
            { width: `${(wizardState.step / 5) * 100}%` },
          ]}
        />
      </View>

      {/* Offline Alert Banner */}
      {network.status === 'OFFLINE' && (
        <View style={styles.offlineNotice}>
          <Info size={16} color="#B45309" />
          <Text style={styles.offlineNoticeText}>
            Offline Mode: Plan will be curated using local SQLite experiences.
          </Text>
        </View>
      )}

      {/* Wizard Content */}
      <ScrollView
        style={styles.scrollContent}
        contentContainerStyle={styles.scrollInner}
        showsVerticalScrollIndicator={false}
      >
        {wizardState.step === 1 && (
          <View style={styles.stepSection}>
            <View style={styles.stepHeader}>
              <Clock size={20} color="#0F172A" />
              <Text style={styles.stepTitle}>How much time do you have?</Text>
            </View>
            <Text style={styles.stepDescription}>
              Gemini will optimize travel routes and durations so you never rush.
            </Text>

            <View style={styles.optionsGrid}>
              {TIME_OPTIONS.map((opt) => {
                const isSelected = wizardState.availableMinutes === opt.minutes;
                return (
                  <TouchableOpacity
                    key={opt.minutes}
                    style={[
                      styles.cardOption,
                      isSelected && styles.cardOptionSelected,
                    ]}
                    onPress={() =>
                      setWizardState((prev) => ({
                        ...prev,
                        availableMinutes: opt.minutes,
                      }))
                    }
                    activeOpacity={0.7}
                  >
                    <View style={styles.optionHeader}>
                      <Text
                        style={[
                          styles.optionTitle,
                          isSelected && styles.optionTitleSelected,
                        ]}
                      >
                        {opt.label}
                      </Text>
                      {isSelected && (
                        <View style={styles.checkCircle}>
                          <Check size={14} color="#FFFFFF" />
                        </View>
                      )}
                    </View>
                    <Text
                      style={[
                        styles.optionSubtitle,
                        isSelected && styles.optionSubtitleSelected,
                      ]}
                    >
                      {opt.subtitle}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {wizardState.step === 2 && (
          <View style={styles.stepSection}>
            <View style={styles.stepHeader}>
              <Wallet size={20} color="#0F172A" />
              <Text style={styles.stepTitle}>What is your budget?</Text>
            </View>
            <Text style={styles.stepDescription}>
              Approximate budget per person for experiences and admissions.
            </Text>

            <View style={styles.optionsGrid}>
              {BUDGET_OPTIONS.map((opt) => {
                const isSelected = wizardState.budget === opt.value;
                const formatted =
                  opt.value === 0
                    ? 'Free ($0)'
                    : `${currentCityConfig.currency}${opt.value.toLocaleString()}`;

                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      styles.cardOption,
                      isSelected && styles.cardOptionSelected,
                    ]}
                    onPress={() =>
                      setWizardState((prev) => ({
                        ...prev,
                        budget: opt.value,
                      }))
                    }
                    activeOpacity={0.7}
                  >
                    <View style={styles.optionHeader}>
                      <Text
                        style={[
                          styles.optionTitle,
                          isSelected && styles.optionTitleSelected,
                        ]}
                      >
                        {opt.label} ({formatted})
                      </Text>
                      {isSelected && (
                        <View style={styles.checkCircle}>
                          <Check size={14} color="#FFFFFF" />
                        </View>
                      )}
                    </View>
                    <Text
                      style={[
                        styles.optionSubtitle,
                        isSelected && styles.optionSubtitleSelected,
                      ]}
                    >
                      {opt.subtitle}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {wizardState.step === 3 && (
          <View style={styles.stepSection}>
            <View style={styles.stepHeader}>
              <Compass size={20} color="#0F172A" />
              <Text style={styles.stepTitle}>What are your interests?</Text>
            </View>
            <Text style={styles.stepDescription}>
              Select all themes you want included in your custom route.
            </Text>

            <View style={styles.chipsWrap}>
              {INTEREST_OPTIONS.map((interest) => {
                const isSelected = wizardState.interests.includes(interest);
                return (
                  <TouchableOpacity
                    key={interest}
                    style={[
                      styles.chip,
                      isSelected && styles.chipSelected,
                    ]}
                    onPress={() => toggleInterest(interest)}
                    activeOpacity={0.7}
                  >
                    {isSelected && (
                      <Check size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
                    )}
                    <Text
                      style={[
                        styles.chipText,
                        isSelected && styles.chipTextSelected,
                      ]}
                    >
                      {interest}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {wizardState.step === 4 && (
          <View style={styles.stepSection}>
            <View style={styles.stepHeader}>
              <Sliders size={20} color="#0F172A" />
              <Text style={styles.stepTitle}>Preferences & Vibe</Text>
            </View>
            <Text style={styles.stepDescription}>
              Tell us the vibe of your party and desired walking pace.
            </Text>

            <View style={styles.chipsWrap}>
              {PREFERENCE_OPTIONS.map((pref) => {
                const isSelected = wizardState.preferences.includes(pref);
                return (
                  <TouchableOpacity
                    key={pref}
                    style={[
                      styles.chip,
                      isSelected && styles.chipSelected,
                    ]}
                    onPress={() => togglePreference(pref)}
                    activeOpacity={0.7}
                  >
                    {isSelected && (
                      <Check size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
                    )}
                    <Text
                      style={[
                        styles.chipText,
                        isSelected && styles.chipTextSelected,
                      ]}
                    >
                      {pref}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {wizardState.step === 5 && (
          <View style={styles.stepSection}>
            <View style={styles.stepHeader}>
              <MapPin size={20} color="#0F172A" />
              <Text style={styles.stepTitle}>Starting Location & Review</Text>
            </View>
            <Text style={styles.stepDescription}>
              Choose where your itinerary should begin from.
            </Text>

            <View style={styles.locationSelector}>
              <TouchableOpacity
                style={[
                  styles.cardOption,
                  wizardState.useCurrentLocation && styles.cardOptionSelected,
                ]}
                onPress={() =>
                  setWizardState((prev) => ({
                    ...prev,
                    useCurrentLocation: true,
                  }))
                }
                activeOpacity={0.7}
              >
                <View style={styles.optionHeader}>
                  <Text
                    style={[
                      styles.optionTitle,
                      wizardState.useCurrentLocation && styles.optionTitleSelected,
                    ]}
                  >
                    📍 Current GPS Location
                  </Text>
                  {wizardState.useCurrentLocation && (
                    <View style={styles.checkCircle}>
                      <Check size={14} color="#FFFFFF" />
                    </View>
                  )}
                </View>
                <Text
                  style={[
                    styles.optionSubtitle,
                    wizardState.useCurrentLocation && styles.optionSubtitleSelected,
                  ]}
                >
                  {coords
                    ? `Lat: ${coords.latitude.toFixed(3)}, Lng: ${coords.longitude.toFixed(3)}`
                    : 'Use device location coordinates'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.cardOption,
                  !wizardState.useCurrentLocation && styles.cardOptionSelected,
                ]}
                onPress={() =>
                  setWizardState((prev) => ({
                    ...prev,
                    useCurrentLocation: false,
                  }))
                }
                activeOpacity={0.7}
              >
                <View style={styles.optionHeader}>
                  <Text
                    style={[
                      styles.optionTitle,
                      !wizardState.useCurrentLocation && styles.optionTitleSelected,
                    ]}
                  >
                    🏛️ City Center ({city})
                  </Text>
                  {!wizardState.useCurrentLocation && (
                    <View style={styles.checkCircle}>
                      <Check size={14} color="#FFFFFF" />
                    </View>
                  )}
                </View>
                <Text
                  style={[
                    styles.optionSubtitle,
                    !wizardState.useCurrentLocation && styles.optionSubtitleSelected,
                  ]}
                >
                  Start from central hub of {city}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Summary Card */}
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>Plan Overview</Text>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>City:</Text>
                <Text style={styles.summaryValue}>{city}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Time Available:</Text>
                <Text style={styles.summaryValue}>
                  {wizardState.availableMinutes / 60} hours
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Budget:</Text>
                <Text style={styles.summaryValue}>
                  {wizardState.budget === 0
                    ? 'Free ($0)'
                    : `${currentCityConfig.currency}${wizardState.budget.toLocaleString()}`}
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Interests:</Text>
                <Text style={styles.summaryValue}>
                  {wizardState.interests.join(', ')}
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Vibe:</Text>
                <Text style={styles.summaryValue}>
                  {wizardState.preferences.join(', ')}
                </Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Loading Overlay */}
      {isGenerating && (
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#4F46E5" />
            <Text style={styles.loadingTitle}>Curating with Roamly AI</Text>
            <Text style={styles.loadingStatus}>{generationStepText}</Text>
          </View>
        </View>
      )}

      {/* Bottom Action Footer */}
      <View style={styles.footer}>
        {wizardState.step > 1 ? (
          <TouchableOpacity
            style={styles.backButton}
            onPress={handleBack}
            activeOpacity={0.7}
          >
            <ArrowLeft size={18} color="#64748B" />
            <Text style={styles.backButtonText}>Back</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 80 }} />
        )}

        {wizardState.step < 5 ? (
          <TouchableOpacity
            style={styles.nextButton}
            onPress={handleNext}
            activeOpacity={0.8}
          >
            <Text style={styles.nextButtonText}>Next</Text>
            <ArrowRight size={18} color="#FFFFFF" />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.generateButton}
            onPress={handleGenerate}
            disabled={isGenerating}
            activeOpacity={0.8}
          >
            <Zap size={18} color="#FFFFFF" />
            <Text style={styles.generateButtonText}>Generate My Plan ✨</Text>
          </TouchableOpacity>
        )}
      </View>
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
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: '#FFFFFF',
  },
  headerLeft: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
  },
  stepBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#EEF2FF',
  },
  stepBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4F46E5',
  },
  progressTrack: {
    height: 3,
    backgroundColor: '#E2E8F0',
    width: '100%',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#4F46E5',
  },
  offlineNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  offlineNoticeText: {
    fontSize: 12,
    color: '#92400E',
    fontWeight: '500',
  },
  scrollContent: {
    flex: 1,
  },
  scrollInner: {
    padding: 20,
    paddingBottom: 40,
  },
  stepSection: {
    gap: 12,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  stepDescription: {
    fontSize: 14,
    color: '#64748B',
    lineHeight: 20,
    marginBottom: 8,
  },
  optionsGrid: {
    gap: 10,
  },
  cardOption: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  cardOptionSelected: {
    borderColor: '#4F46E5',
    backgroundColor: '#F5F7FF',
  },
  optionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  optionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E293B',
  },
  optionTitleSelected: {
    color: '#4F46E5',
  },
  optionSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 4,
  },
  optionSubtitleSelected: {
    color: '#4338CA',
  },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#4F46E5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 30,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
  },
  chipSelected: {
    backgroundColor: '#4F46E5',
    borderColor: '#4F46E5',
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
  },
  chipTextSelected: {
    color: '#FFFFFF',
  },
  locationSelector: {
    gap: 10,
    marginBottom: 16,
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 10,
  },
  summaryTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 13,
    color: '#64748B',
  },
  summaryValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F172A',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  backButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#64748B',
  },
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0F172A',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  nextButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  generateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#4F46E5',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    shadowColor: '#4F46E5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  generateButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  loadingBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    gap: 12,
    width: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  loadingTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
  },
  loadingStatus: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
  },
});
