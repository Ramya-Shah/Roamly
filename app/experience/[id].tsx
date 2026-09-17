import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Share,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Heart,
  Share2,
  Clock,
  MapPin,
  Calendar,
  Sparkles,
  Plus,
} from 'lucide-react-native';
import { useExperienceDetails } from '../../src/features/experiences/hooks/useExperiences';
import { useSavedExperiences } from '../../src/features/saved/hooks/useSavedExperiences';
import { useLocation } from '../../src/hooks/useLocation';
import { Rating } from '../../src/components/Rating';
import { PriceLabel } from '../../src/components/PriceLabel';
import { AddToTripModal } from '../../src/components/AddToTripModal';
import { formatDistance, calculateDistanceKm } from '../../src/utils/distance';

export default function ExperienceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: experience, isLoading } = useExperienceDetails(id || '');
  const { toggleSaved } = useSavedExperiences();
  const { effectiveCoords } = useLocation();

  const [showAddToTrip, setShowAddToTrip] = useState(false);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0F172A" />
      </View>
    );
  }

  if (!experience) {
    return (
      <SafeAreaView style={styles.notFoundContainer}>
        <Text style={styles.notFoundText}>Experience not found</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const distanceKm =
    effectiveCoords && experience.latitude && experience.longitude
      ? calculateDistanceKm(
          effectiveCoords.latitude,
          effectiveCoords.longitude,
          experience.latitude,
          experience.longitude
        )
      : undefined;

  const isSaved = Boolean(experience.isSaved);

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Check out ${experience.title} in ${experience.city} on Roamly!`,
      });
    } catch {}
  };

  const formatDuration = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Hero Image */}
        <View style={styles.heroContainer}>
          <Image
            source={{ uri: experience.imageUrl }}
            style={styles.heroImage}
            contentFit="cover"
            transition={300}
          />
          <View style={styles.imageOverlay} />

          {/* Top Bar Floating Controls */}
          <SafeAreaView edges={['top']} style={styles.floatingTopBar}>
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.iconCircle}
              onPress={() => router.back()}
            >
              <ArrowLeft size={20} color="#0F172A" />
            </TouchableOpacity>

            <View style={styles.topRightActions}>
              <TouchableOpacity
                activeOpacity={0.8}
                style={styles.iconCircle}
                onPress={handleShare}
              >
                <Share2 size={18} color="#0F172A" />
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.8}
                style={styles.iconCircle}
                onPress={() => toggleSaved(experience.id, !isSaved)}
              >
                <Heart
                  size={19}
                  color={isSaved ? '#EF4444' : '#0F172A'}
                  fill={isSaved ? '#EF4444' : 'transparent'}
                />
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </View>

        {/* Content Body */}
        <View style={styles.body}>
          {/* Category & Featured Badge */}
          <View style={styles.badgeRow}>
            <View style={styles.categoryPill}>
              <Text style={styles.categoryText}>{experience.category}</Text>
            </View>
            {experience.isFeatured && (
              <View style={styles.featuredPill}>
                <Sparkles size={12} color="#D97706" />
                <Text style={styles.featuredText}>Featured Experience</Text>
              </View>
            )}
          </View>

          {/* Title */}
          <Text style={styles.title}>{experience.title}</Text>

          {/* Rating and Distance */}
          <View style={styles.metaRow}>
            <Rating
              score={experience.rating}
              reviewCount={experience.reviewCount}
              size={16}
            />
            {distanceKm !== undefined && (
              <View style={styles.distanceBadge}>
                <MapPin size={14} color="#0284C7" />
                <Text style={styles.distanceText}>
                  {formatDistance(distanceKm)} away
                </Text>
              </View>
            )}
          </View>

          {/* Key Facts Grid */}
          <View style={styles.factsGrid}>
            <View style={styles.factItem}>
              <Text style={styles.factLabel}>Price</Text>
              <PriceLabel
                priceTier={experience.priceTier}
                amount={experience.priceAmount}
              />
            </View>

            <View style={styles.factDivider} />

            <View style={styles.factItem}>
              <Text style={styles.factLabel}>Duration</Text>
              <View style={styles.factRow}>
                <Clock size={14} color="#0F172A" />
                <Text style={styles.factValue}>
                  {formatDuration(experience.durationMinutes)}
                </Text>
              </View>
            </View>

            <View style={styles.factDivider} />

            <View style={styles.factItem}>
              <Text style={styles.factLabel}>City</Text>
              <Text style={styles.factValue}>{experience.city}</Text>
            </View>
          </View>

          {/* Description */}
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>About this experience</Text>
            <Text style={styles.descriptionText}>{experience.description}</Text>
          </View>

          {/* Hours & Location */}
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Hours & Location</Text>

            <View style={styles.detailRow}>
              <Clock size={16} color="#64748B" />
              <View style={styles.detailTextCol}>
                <Text style={styles.detailTitle}>Opening Hours</Text>
                <Text style={styles.detailValue}>{experience.openingHours}</Text>
              </View>
            </View>

            <View style={styles.detailRow}>
              <MapPin size={16} color="#64748B" />
              <View style={styles.detailTextCol}>
                <Text style={styles.detailTitle}>Address</Text>
                <Text style={styles.detailValue}>{experience.address}</Text>
              </View>
            </View>
          </View>

          {/* Tags */}
          {experience.tags && experience.tags.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionHeading}>Highlights & Tags</Text>
              <View style={styles.tagsWrapper}>
                {experience.tags.map((tag) => (
                  <View key={tag} style={styles.tagPill}>
                    <Text style={styles.tagText}>#{tag}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Floating Bottom CTA Bar */}
      <SafeAreaView edges={['bottom']} style={styles.bottomBar}>
        <View style={styles.bottomBarLeft}>
          <Text style={styles.bottomPriceLabel}>Est. Cost</Text>
          <Text style={styles.bottomPriceValue}>
            {experience.priceTier === 'Free' ? 'Free Admission' : `From ${experience.priceTier}`}
          </Text>
        </View>

        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.addToTripCTA}
          onPress={() => setShowAddToTrip(true)}
        >
          <Plus size={18} color="#FFFFFF" />
          <Text style={styles.addToTripCTAText}>Add to Itinerary</Text>
        </TouchableOpacity>
      </SafeAreaView>

      {/* Add To Trip Modal */}
      <AddToTripModal
        visible={showAddToTrip}
        experience={experience}
        onClose={() => setShowAddToTrip(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  notFoundContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
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
  scrollContent: {
    paddingBottom: 110,
  },
  heroContainer: {
    width: '100%',
    height: 320,
    position: 'relative',
    backgroundColor: '#E2E8F0',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  imageOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  floatingTopBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  topRightActions: {
    flexDirection: 'row',
    gap: 10,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  categoryPill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  categoryText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0284C7',
    textTransform: 'uppercase',
  },
  featuredPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  featuredText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#B45309',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
    lineHeight: 30,
    marginBottom: 10,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 16,
  },
  distanceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F0F9FF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  distanceText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0369A1',
  },
  factsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 20,
  },
  factItem: {
    flex: 1,
    alignItems: 'center',
  },
  factLabel: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 4,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  factRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  factValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  factDivider: {
    width: 1,
    height: 30,
    backgroundColor: '#E2E8F0',
  },
  section: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  sectionHeading: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 10,
  },
  descriptionText: {
    fontSize: 14,
    color: '#475569',
    lineHeight: 22,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  detailTextCol: {
    flex: 1,
  },
  detailTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 13,
    color: '#0F172A',
    fontWeight: '500',
    lineHeight: 18,
  },
  tagsWrapper: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tagPill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  bottomBarLeft: {
    gap: 2,
  },
  bottomPriceLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  bottomPriceValue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  addToTripCTA: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
    gap: 6,
  },
  addToTripCTAText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
