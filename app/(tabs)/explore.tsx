import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  FlatList,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  Search,
  X,
  SlidersHorizontal,
  Map,
  List,
  MapPin,
  Star,
  Navigation,
  Sparkles,
} from 'lucide-react-native';
import { useAtom } from 'jotai';
import { activeCityAtom, AVAILABLE_CITIES } from '../../src/atoms/cityAtom';
import { filterAtom } from '../../src/atoms/filterAtom';
import {
  useExperiences,
  useCategories,
} from '../../src/features/experiences/hooks/useExperiences';
import { useLocation } from '../../src/hooks/useLocation';
import { ExperienceCard } from '../../src/components/ExperienceCard';
import { CategoryChip } from '../../src/components/CategoryChip';
import { ExperienceCardSkeleton } from '../../src/components/LoadingSkeleton';
import { EmptyState } from '../../src/components/EmptyState';
import { AddToTripModal } from '../../src/components/AddToTripModal';
import { CityPickerModal } from '../../src/components/CityPickerModal';
import { Experience, PriceTier } from '../../src/types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function ExploreScreen() {
  const [activeCity] = useAtom(activeCityAtom);
  const [filter, setFilter] = useAtom(filterAtom);
  const { effectiveCoords } = useLocation();

  const [searchInput, setSearchInput] = useState(filter.search);
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [selectedPinExp, setSelectedPinExp] = useState<Experience | null>(null);
  const [selectedExpForTrip, setSelectedExpForTrip] = useState<Experience | null>(null);
  const [showCityModal, setShowCityModal] = useState(false);

  const currentCityConfig =
    AVAILABLE_CITIES.find((c) => c.name === activeCity) || AVAILABLE_CITIES[0];

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilter((prev) => ({ ...prev, search: searchInput }));
    }, 280);
    return () => clearTimeout(timer);
  }, [searchInput, setFilter]);

  const { data: categories = [] } = useCategories();

  const {
    experiences,
    isLoading,
    refresh,
  } = useExperiences(
    {
      city: activeCity,
      category: filter.category,
      search: filter.search,
      priceTier: filter.priceTier === 'All' ? undefined : (filter.priceTier as PriceTier),
      minRating: filter.minRating > 0 ? filter.minRating : undefined,
      sortBy: filter.sortBy,
    },
    effectiveCoords
  );

  const clearFilters = () => {
    setSearchInput('');
    setFilter({
      category: 'All',
      search: '',
      priceTier: 'All',
      minRating: 0,
      sortBy: 'popular',
    });
  };

  const hasActiveFilters =
    filter.category !== 'All' ||
    filter.priceTier !== 'All' ||
    filter.minRating > 0 ||
    filter.sortBy !== 'popular';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Search & Mode Header */}
      <View style={styles.header}>
        <View style={styles.searchBar}>
          <Search size={18} color="#64748B" />
          <TextInput
            style={styles.input}
            placeholder={`Search ${activeCity}...`}
            value={searchInput}
            onChangeText={setSearchInput}
            placeholderTextColor="#94A3B8"
            returnKeyType="search"
          />
          {searchInput.length > 0 && (
            <TouchableOpacity onPress={() => setSearchInput('')} hitSlop={8}>
              <X size={18} color="#64748B" />
            </TouchableOpacity>
          )}
        </View>

        {/* View Mode Toggle Button */}
        <TouchableOpacity
          style={[styles.iconBtn, viewMode === 'map' && styles.iconBtnActive]}
          onPress={() => setViewMode(viewMode === 'list' ? 'map' : 'list')}
          activeOpacity={0.7}
        >
          {viewMode === 'list' ? (
            <Map size={18} color="#0F172A" />
          ) : (
            <List size={18} color="#4F46E5" />
          )}
        </TouchableOpacity>

        {/* Filter Toggle Button */}
        <TouchableOpacity
          activeOpacity={0.7}
          style={[
            styles.iconBtn,
            (showFilters || hasActiveFilters) && styles.iconBtnFilterActive,
          ]}
          onPress={() => setShowFilters(!showFilters)}
        >
          <SlidersHorizontal
            size={18}
            color={showFilters || hasActiveFilters ? '#FFFFFF' : '#0F172A'}
          />
        </TouchableOpacity>
      </View>

      {/* Quick Filter Chips */}
      <View style={styles.quickFilterBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.quickFilterScroll}
        >
          <TouchableOpacity
            style={[
              styles.quickChip,
              filter.sortBy === 'distance' && styles.quickChipActive,
            ]}
            onPress={() =>
              setFilter((p) => ({
                ...p,
                sortBy: p.sortBy === 'distance' ? 'popular' : 'distance',
              }))
            }
          >
            <Navigation
              size={12}
              color={filter.sortBy === 'distance' ? '#FFFFFF' : '#4F46E5'}
            />
            <Text
              style={[
                styles.quickChipText,
                filter.sortBy === 'distance' && styles.quickChipTextActive,
              ]}
            >
              Near Me
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.quickChip,
              filter.priceTier === 'Free' && styles.quickChipActive,
            ]}
            onPress={() =>
              setFilter((p) => ({
                ...p,
                priceTier: p.priceTier === 'Free' ? 'All' : 'Free',
              }))
            }
          >
            <Text
              style={[
                styles.quickChipText,
                filter.priceTier === 'Free' && styles.quickChipTextActive,
              ]}
            >
              Free
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.quickChip,
              filter.minRating === 4.5 && styles.quickChipActive,
            ]}
            onPress={() =>
              setFilter((p) => ({
                ...p,
                minRating: p.minRating === 4.5 ? 0 : 4.5,
              }))
            }
          >
            <Star
              size={12}
              color={filter.minRating === 4.5 ? '#FFFFFF' : '#F59E0B'}
              fill={filter.minRating === 4.5 ? '#FFFFFF' : '#F59E0B'}
            />
            <Text
              style={[
                styles.quickChipText,
                filter.minRating === 4.5 && styles.quickChipTextActive,
              ]}
            >
              Top Rated
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.quickChip,
              filter.category === 'Food' && styles.quickChipActive,
            ]}
            onPress={() =>
              setFilter((p) => ({
                ...p,
                category: p.category === 'Food' ? 'All' : 'Food',
              }))
            }
          >
            <Text
              style={[
                styles.quickChipText,
                filter.category === 'Food' && styles.quickChipTextActive,
              ]}
            >
              Food
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.quickChip,
              filter.category === 'Attractions' && styles.quickChipActive,
            ]}
            onPress={() =>
              setFilter((p) => ({
                ...p,
                category: p.category === 'Attractions' ? 'All' : 'Attractions',
              }))
            }
          >
            <Text
              style={[
                styles.quickChipText,
                filter.category === 'Attractions' && styles.quickChipTextActive,
              ]}
            >
              Attractions
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* Expanded Filter Drawer */}
      {showFilters && (
        <View style={styles.filterPanel}>
          {/* Price Tier */}
          <View style={styles.filterRow}>
            <Text style={styles.filterLabel}>Price:</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterChips}
            >
              {(['All', 'Free', '$', '$$', '$$$'] as const).map((tier) => (
                <TouchableOpacity
                  key={tier}
                  style={[
                    styles.pill,
                    filter.priceTier === tier && styles.pillSelected,
                  ]}
                  onPress={() => setFilter((p) => ({ ...p, priceTier: tier }))}
                >
                  <Text
                    style={[
                      styles.pillText,
                      filter.priceTier === tier && styles.pillTextSelected,
                    ]}
                  >
                    {tier}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Sort Option */}
          <View style={styles.filterRow}>
            <Text style={styles.filterLabel}>Sort:</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterChips}
            >
              {[
                { label: 'Popular', value: 'popular' },
                { label: 'Distance', value: 'distance' },
                { label: 'Rating', value: 'rating' },
              ].map((s) => (
                <TouchableOpacity
                  key={s.value}
                  style={[
                    styles.pill,
                    filter.sortBy === s.value && styles.pillSelected,
                  ]}
                  onPress={() =>
                    setFilter((p) => ({ ...p, sortBy: s.value as any }))
                  }
                >
                  <Text
                    style={[
                      styles.pillText,
                      filter.sortBy === s.value && styles.pillTextSelected,
                    ]}
                  >
                    {s.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      )}

      {/* Categories Bar */}
      <View style={styles.categoriesBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoriesScroll}
        >
          <CategoryChip
            label="All"
            isSelected={filter.category === 'All'}
            onPress={() => setFilter((p) => ({ ...p, category: 'All' }))}
          />
          {categories.map((cat) => (
            <CategoryChip
              key={cat.id}
              label={cat.name}
              isSelected={filter.category === cat.name}
              onPress={() => setFilter((p) => ({ ...p, category: cat.name }))}
            />
          ))}
        </ScrollView>
      </View>

      {/* Results Header */}
      <View style={styles.resultMeta}>
        <Text style={styles.resultsCount}>
          {isLoading
            ? 'Searching...'
            : `${experiences.length} experiences in ${activeCity}`}
        </Text>
        <TouchableOpacity
          onPress={() => setShowCityModal(true)}
          style={styles.cityPill}
        >
          <Text style={styles.cityPillText}>{activeCity} ▾</Text>
        </TouchableOpacity>
      </View>

      {/* Content: Map View or List View */}
      {viewMode === 'map' ? (
        <View style={styles.mapContainer}>
          {/* Lightweight Spatial Radar Map */}
          <View style={styles.spatialCanvas}>
            {/* Concentric distance rings */}
            <View style={[styles.rangeRing, { width: 280, height: 280 }]} />
            <View style={[styles.rangeRing, { width: 190, height: 190 }]} />
            <View style={[styles.rangeRing, { width: 100, height: 100 }]} />

            {/* Center user/city pin */}
            <View style={styles.centerMarker}>
              <View style={styles.centerDot} />
              <Text style={styles.centerLabel}>{activeCity} Center</Text>
            </View>

            {/* Experience Pin Markers */}
            {experiences.slice(0, 15).map((exp, idx) => {
              // Plot coordinates relative to city center
              const centerLat = currentCityConfig.defaultCoords.latitude;
              const centerLng = currentCityConfig.defaultCoords.longitude;
              const latDiff = exp.latitude - centerLat;
              const lngDiff = exp.longitude - centerLng;

              // Scale to canvas (clamp inside canvas width)
              const maxOffset = 130;
              const posX = Math.max(
                -maxOffset,
                Math.min(maxOffset, lngDiff * 1800)
              );
              const posY = Math.max(
                -maxOffset,
                Math.min(maxOffset, -latDiff * 1800)
              );

              const isSelected = selectedPinExp?.id === exp.id;

              return (
                <TouchableOpacity
                  key={exp.id}
                  style={[
                    styles.pinMarker,
                    {
                      transform: [
                        { translateX: posX },
                        { translateY: posY },
                      ],
                    },
                    isSelected && styles.pinMarkerActive,
                  ]}
                  onPress={() => setSelectedPinExp(exp)}
                  activeOpacity={0.8}
                >
                  <MapPin
                    size={isSelected ? 22 : 16}
                    color={isSelected ? '#4F46E5' : '#0F172A'}
                    fill={isSelected ? '#4F46E5' : '#FFFFFF'}
                  />
                  <Text
                    style={[
                      styles.pinLabel,
                      isSelected && styles.pinLabelActive,
                    ]}
                    numberOfLines={1}
                  >
                    {exp.title.split(' ')[0]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Selected Pin Preview Card */}
          {selectedPinExp ? (
            <View style={styles.mapPreviewCard}>
              <ExperienceCard
                experience={selectedPinExp}
                layout="horizontal"
                onAddToTrip={(exp) => setSelectedExpForTrip(exp)}
              />
            </View>
          ) : (
            <View style={styles.mapHelperBox}>
              <Text style={styles.mapHelperText}>
                Tap any pin on the map to view details
              </Text>
            </View>
          )}
        </View>
      ) : (
        /* List View */
        <FlatList
          data={experiences}
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
                title="No matching experiences"
                description="Try adjusting your keywords, price filters, or category to find great spots."
                actionLabel="Clear Filters"
                onAction={clearFilters}
              />
            )
          }
        />
      )}

      {/* Add To Trip Modal */}
      {selectedExpForTrip && (
        <AddToTripModal
          visible={Boolean(selectedExpForTrip)}
          experience={selectedExpForTrip}
          onClose={() => setSelectedExpForTrip(null)}
        />
      )}

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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 10,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  input: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A',
    padding: 0,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnActive: {
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  iconBtnFilterActive: {
    backgroundColor: '#4F46E5',
  },
  quickFilterBar: {
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  quickFilterScroll: {
    paddingHorizontal: 20,
    gap: 8,
  },
  quickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  quickChipActive: {
    backgroundColor: '#4F46E5',
    borderColor: '#4F46E5',
  },
  quickChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  quickChipTextActive: {
    color: '#FFFFFF',
  },
  filterPanel: {
    backgroundColor: '#F8FAFC',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 10,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    width: 50,
  },
  filterChips: {
    gap: 6,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  pillSelected: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  pillText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  pillTextSelected: {
    color: '#FFFFFF',
  },
  categoriesBar: {
    marginVertical: 6,
  },
  categoriesScroll: {
    paddingHorizontal: 20,
  },
  resultMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  resultsCount: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  cityPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
  },
  cityPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4F46E5',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  mapContainer: {
    flex: 1,
    justifyContent: 'space-between',
  },
  spatialCanvas: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    minHeight: 320,
    backgroundColor: '#F8FAFC',
    margin: 16,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  rangeRing: {
    position: 'absolute',
    borderRadius: 200,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderStyle: 'dashed',
  },
  centerMarker: {
    position: 'absolute',
    alignItems: 'center',
    gap: 4,
  },
  centerDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#4F46E5',
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  centerLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4F46E5',
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  pinMarker: {
    position: 'absolute',
    alignItems: 'center',
    gap: 2,
    padding: 4,
  },
  pinMarkerActive: {
    zIndex: 10,
    transform: [{ scale: 1.2 }],
  },
  pinLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#334155',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 0.5,
    borderColor: '#CBD5E1',
  },
  pinLabelActive: {
    color: '#4F46E5',
    borderColor: '#4F46E5',
    fontWeight: '800',
  },
  mapPreviewCard: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  mapHelperBox: {
    padding: 16,
    alignItems: 'center',
  },
  mapHelperText: {
    fontSize: 12,
    color: '#94A3B8',
    fontStyle: 'italic',
  },
});
