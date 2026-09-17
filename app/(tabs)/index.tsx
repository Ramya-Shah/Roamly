import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  MapPin,
  ChevronDown,
  Search,
  Sparkles,
  Navigation,
  User,
  Calendar,
  ArrowRight,
  Clock,
} from 'lucide-react-native';
import { useAtom } from 'jotai';
import { activeCityAtom } from '../../src/atoms/cityAtom';
import {
  useExperiences,
  useFeaturedExperiences,
  useCategories,
} from '../../src/features/experiences/hooks/useExperiences';
import { useNearbyExperiences } from '../../src/features/experiences/hooks/useNearbyExperiences';
import { useSavedExperiences } from '../../src/features/saved/hooks/useSavedExperiences';
import { useItineraries } from '../../src/features/itineraries/hooks/useItineraries';
import { useLocation } from '../../src/hooks/useLocation';
import { ExperienceCard } from '../../src/components/ExperienceCard';
import { CategoryChip } from '../../src/components/CategoryChip';
import { SyncIndicator } from '../../src/components/SyncIndicator';
import { ExperienceCardSkeleton } from '../../src/components/LoadingSkeleton';
import { EmptyState } from '../../src/components/EmptyState';
import { ErrorState } from '../../src/components/ErrorState';
import { CityPickerModal } from '../../src/components/CityPickerModal';
import { AddToTripModal } from '../../src/components/AddToTripModal';
import { Experience } from '../../src/types';

export default function HomeScreen() {
  const [activeCity] = useAtom(activeCityAtom);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [showCityModal, setShowCityModal] = useState(false);
  const [selectedExpForTrip, setSelectedExpForTrip] = useState<Experience | null>(null);

  const { effectiveCoords, requestLocation } = useLocation();

  // Load Experiences
  const {
    experiences,
    isLoading,
    isRefetching,
    error,
    refresh,
  } = useExperiences(
    { city: activeCity, category: selectedCategory },
    effectiveCoords
  );

  // Load Featured
  const { data: featured = [] } = useFeaturedExperiences(activeCity);

  // Load Categories
  const { data: categories = [] } = useCategories();

  // Load Nearby
  const { data: nearby = [] } = useNearbyExperiences(
    effectiveCoords.latitude,
    effectiveCoords.longitude,
    30,
    activeCity
  );

  // Load Saved
  const { savedList } = useSavedExperiences();

  // Load Itineraries Preview
  const { data: itineraries = [] } = useItineraries(activeCity);

  const handleRefresh = async () => {
    await refresh();
    await requestLocation(true);
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.appTitle}>Roamly</Text>
          <TouchableOpacity
            activeOpacity={0.7}
            style={styles.citySelector}
            onPress={() => setShowCityModal(true)}
          >
            <MapPin size={15} color="#4F46E5" />
            <Text style={styles.cityName}>{activeCity}</Text>
            <ChevronDown size={14} color="#64748B" />
          </TouchableOpacity>
        </View>

        <View style={styles.headerRight}>
          <SyncIndicator />
          <TouchableOpacity
            style={styles.profileButton}
            onPress={() => router.push('/profile')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <User size={18} color="#0F172A" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={handleRefresh}
            tintColor="#4F46E5"
          />
        }
      >
        {/* Greeting & Headline */}
        <View style={styles.greetingSection}>
          <Text style={styles.greetingText}>{getGreeting()}, explorer 👋</Text>
          <Text style={styles.headlineText}>What's the plan for today?</Text>
        </View>

        {/* AI Planner Hero CTA Card */}
        <View style={styles.aiHeroContainer}>
          <View style={styles.aiHeroCard}>
            <View style={styles.aiHeroBadge}>
              <Sparkles size={14} color="#FFFFFF" />
              <Text style={styles.aiHeroBadgeText}>AI-POWERED</Text>
            </View>
            <Text style={styles.aiHeroTitle}>Plan My Day</Text>
            <Text style={styles.aiHeroSubtitle}>
              Curate a time-optimized itinerary in seconds tailored to your budget, vibe, and location.
            </Text>

            <View style={styles.aiHeroButtonRow}>
              <TouchableOpacity
                style={styles.aiPlanButton}
                onPress={() => router.push('/(tabs)/plan' as any)}
                activeOpacity={0.85}
              >
                <Text style={styles.aiPlanButtonText}>Start Planning</Text>
                <ArrowRight size={16} color="#4F46E5" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.exploreNearbyPill}
                onPress={() => router.push('/nearby')}
                activeOpacity={0.8}
              >
                <Navigation size={14} color="#FFFFFF" />
                <Text style={styles.exploreNearbyText}>Near Me</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Search Bar Trigger */}
        <View style={styles.searchSection}>
          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.searchBar}
            onPress={() => router.push('/(tabs)/explore')}
          >
            <Search size={18} color="#94A3B8" />
            <Text style={styles.searchPlaceholder}>
              Search attractions, cafes, museums in {activeCity}...
            </Text>
          </TouchableOpacity>
        </View>

        {/* Categories Bar */}
        <View style={styles.categoriesSection}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoriesScroll}
          >
            <CategoryChip
              label="All"
              isSelected={selectedCategory === 'All'}
              onPress={() => setSelectedCategory('All')}
            />
            {categories.map((cat) => (
              <CategoryChip
                key={cat.id}
                label={cat.name}
                isSelected={selectedCategory === cat.name}
                onPress={() => setSelectedCategory(cat.name)}
              />
            ))}
          </ScrollView>
        </View>

        {/* Nearby Experiences Carousel */}
        {nearby.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Navigation size={18} color="#4F46E5" />
                <Text style={styles.sectionTitle}>Near You</Text>
              </View>
              <TouchableOpacity
                onPress={() => router.push('/nearby')}
                hitSlop={8}
              >
                <Text style={styles.seeAllText}>See map & all</Text>
              </TouchableOpacity>
            </View>

            <FlatList
              horizontal
              data={nearby}
              keyExtractor={(item) => item.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
              renderItem={({ item }) => (
                <ExperienceCard
                  experience={item}
                  layout="horizontal"
                  onAddToTrip={(exp) => setSelectedExpForTrip(exp)}
                />
              )}
            />
          </View>
        )}

        {/* Popular / Featured Experiences Carousel */}
        {featured.length > 0 && selectedCategory === 'All' && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Sparkles size={18} color="#0F172A" />
                <Text style={styles.sectionTitle}>Popular in {activeCity}</Text>
              </View>
            </View>

            <FlatList
              horizontal
              data={featured}
              keyExtractor={(item) => item.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
              renderItem={({ item }) => (
                <ExperienceCard
                  experience={item}
                  layout="horizontal"
                  onAddToTrip={(exp) => setSelectedExpForTrip(exp)}
                />
              )}
            />
          </View>
        )}

        {/* Your Trips / Itineraries Preview */}
        {itineraries.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Calendar size={18} color="#0F172A" />
                <Text style={styles.sectionTitle}>Your Trips</Text>
              </View>
              <TouchableOpacity
                onPress={() => router.push('/(tabs)/trips')}
                hitSlop={8}
              >
                <Text style={styles.seeAllText}>View All ({itineraries.length})</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
            >
              {itineraries.slice(0, 4).map((itin) => (
                <TouchableOpacity
                  key={itin.id}
                  style={styles.tripCard}
                  onPress={() => router.push(`/itinerary/${itin.id}` as any)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.tripTitle} numberOfLines={1}>
                    {itin.title}
                  </Text>
                  <View style={styles.tripMetaRow}>
                    <Clock size={13} color="#64748B" />
                    <Text style={styles.tripMetaText}>
                      {itin.items?.length || 0} stops • {Math.round((itin.totalDurationMinutes || 0) / 60)}h
                    </Text>
                  </View>
                  <Text style={styles.tripDate}>{itin.date}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* All / Filtered Experiences Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              {selectedCategory === 'All' ? `Top Experiences in ${activeCity}` : selectedCategory}
            </Text>
            <Text style={styles.resultCountText}>{experiences.length} spots</Text>
          </View>

          <View style={styles.verticalList}>
            {isLoading ? (
              <>
                <ExperienceCardSkeleton />
                <ExperienceCardSkeleton />
              </>
            ) : error ? (
              <ErrorState onRetry={refresh} />
            ) : experiences.length === 0 ? (
              <EmptyState
                title="No experiences found"
                description={`Try selecting another category or check back later.`}
                onAction={() => setSelectedCategory('All')}
                actionLabel="View All"
              />
            ) : (
              experiences.map((exp) => (
                <ExperienceCard
                  key={exp.id}
                  experience={exp}
                  layout="vertical"
                  onAddToTrip={(e) => setSelectedExpForTrip(e)}
                />
              ))
            )}
          </View>
        </View>
      </ScrollView>

      {/* City Switcher Modal */}
      <CityPickerModal
        visible={showCityModal}
        onClose={() => setShowCityModal(false)}
      />

      {/* Add To Trip Modal */}
      {selectedExpForTrip && (
        <AddToTripModal
          visible={Boolean(selectedExpForTrip)}
          experience={selectedExpForTrip}
          onClose={() => setSelectedExpForTrip(null)}
        />
      )}
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
    flexDirection: 'column',
    gap: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  appTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.5,
  },
  citySelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  cityName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
  },
  profileButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  greetingSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 4,
  },
  greetingText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B',
  },
  headlineText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
    letterSpacing: -0.3,
  },
  aiHeroContainer: {
    paddingHorizontal: 20,
    marginTop: 14,
  },
  aiHeroCard: {
    backgroundColor: '#1E1B4B',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#4338CA',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  aiHeroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 10,
  },
  aiHeroBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  aiHeroTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  aiHeroSubtitle: {
    fontSize: 13,
    color: '#C7D2FE',
    marginTop: 4,
    lineHeight: 18,
  },
  aiHeroButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
  },
  aiPlanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
  },
  aiPlanButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#4F46E5',
  },
  exploreNearbyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  exploreNearbyText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  searchSection: {
    paddingHorizontal: 20,
    marginTop: 16,
    marginBottom: 6,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    gap: 10,
  },
  searchPlaceholder: {
    color: '#94A3B8',
    fontSize: 14,
    flex: 1,
  },
  categoriesSection: {
    marginVertical: 10,
  },
  categoriesScroll: {
    paddingHorizontal: 20,
  },
  section: {
    marginTop: 18,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  seeAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4F46E5',
  },
  resultCountText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#64748B',
  },
  horizontalList: {
    paddingHorizontal: 20,
    paddingBottom: 4,
    gap: 12,
  },
  tripCard: {
    width: 170,
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 6,
  },
  tripTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  tripMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tripMetaText: {
    fontSize: 12,
    color: '#64748B',
  },
  tripDate: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },
  verticalList: {
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
});
