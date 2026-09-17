import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Heart, Clock, MapPin, Plus } from 'lucide-react-native';
import { Experience } from '../types';
import { Rating } from './Rating';
import { PriceLabel } from './PriceLabel';
import { formatDistance } from '../utils/distance';
import { useSavedExperiences } from '../features/saved/hooks/useSavedExperiences';

interface ExperienceCardProps {
  experience: Experience;
  onAddToTrip?: (experience: Experience) => void;
  layout?: 'vertical' | 'horizontal';
}

export function ExperienceCard({
  experience,
  onAddToTrip,
  layout = 'vertical',
}: ExperienceCardProps) {
  const { toggleSaved } = useSavedExperiences();
  const isSaved = Boolean(experience.isSaved);

  const handleCardPress = () => {
    router.push(`/experience/${experience.id}`);
  };

  const handleHeartPress = (e: any) => {
    e.stopPropagation?.();
    toggleSaved(experience.id, !isSaved);
  };

  const handleAddPress = (e: any) => {
    e.stopPropagation?.();
    if (onAddToTrip) {
      onAddToTrip(experience);
    } else {
      router.push(`/experience/${experience.id}`);
    }
  };

  const formatDuration = (mins: number) => {
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    const remainder = mins % 60;
    return remainder > 0 ? `${hours}h ${remainder}m` : `${hours}h`;
  };

  if (layout === 'horizontal') {
    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={handleCardPress}
        style={styles.horizontalCard}
      >
        <Image
          source={{ uri: experience.imageUrl }}
          style={styles.horizontalImage}
          contentFit="cover"
          transition={200}
        />
        <View style={styles.horizontalBody}>
          <View style={styles.headerRow}>
            <Text style={styles.categoryBadge}>{experience.category}</Text>
            <TouchableOpacity onPress={handleHeartPress} hitSlop={10}>
              <Heart
                size={18}
                color={isSaved ? '#EF4444' : '#94A3B8'}
                fill={isSaved ? '#EF4444' : 'transparent'}
              />
            </TouchableOpacity>
          </View>
          <Text style={styles.horizontalTitle} numberOfLines={1}>
            {experience.title}
          </Text>
          <View style={styles.metaRow}>
            <Rating score={experience.rating} reviewCount={experience.reviewCount} size={12} />
            {experience.distanceKm !== undefined && (
              <View style={styles.distanceBadge}>
                <MapPin size={11} color="#64748B" />
                <Text style={styles.distanceText}>{formatDistance(experience.distanceKm)}</Text>
              </View>
            )}
          </View>
          <View style={styles.footerRow}>
            <PriceLabel priceTier={experience.priceTier} amount={experience.priceAmount} size="sm" />
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.addMiniBtn}
              onPress={handleAddPress}
            >
              <Plus size={14} color="#0F172A" />
              <Text style={styles.addMiniText}>Trip</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      activeOpacity={0.95}
      onPress={handleCardPress}
      style={styles.card}
    >
      <View style={styles.imageContainer}>
        <Image
          source={{ uri: experience.imageUrl }}
          style={styles.image}
          contentFit="cover"
          transition={300}
        />
        <TouchableOpacity
          style={styles.heartButton}
          onPress={handleHeartPress}
          activeOpacity={0.8}
          hitSlop={10}
        >
          <Heart
            size={20}
            color={isSaved ? '#EF4444' : '#FFFFFF'}
            fill={isSaved ? '#EF4444' : 'rgba(0,0,0,0.3)'}
          />
        </TouchableOpacity>

        <View style={styles.imageCategoryBadge}>
          <Text style={styles.imageCategoryText}>{experience.category}</Text>
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.row}>
          <Rating score={experience.rating} reviewCount={experience.reviewCount} />
          {experience.distanceKm !== undefined && (
            <View style={styles.distanceBadge}>
              <MapPin size={13} color="#64748B" />
              <Text style={styles.distanceText}>{formatDistance(experience.distanceKm)}</Text>
            </View>
          )}
        </View>

        <Text style={styles.title} numberOfLines={2}>
          {experience.title}
        </Text>

        <Text style={styles.description} numberOfLines={2}>
          {experience.description}
        </Text>

        <View style={styles.footer}>
          <View style={styles.footerDetails}>
            <PriceLabel
              priceTier={experience.priceTier}
              amount={experience.priceAmount}
            />
            <View style={styles.durationBadge}>
              <Clock size={13} color="#64748B" />
              <Text style={styles.durationText}>
                {formatDuration(experience.durationMinutes)}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.addButton}
            onPress={handleAddPress}
          >
            <Plus size={16} color="#FFFFFF" />
            <Text style={styles.addButtonText}>Add to Trip</Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    marginBottom: 20,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    overflow: 'hidden',
  },
  imageContainer: {
    width: '100%',
    height: 190,
    position: 'relative',
    backgroundColor: '#E2E8F0',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  heartButton: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageCategoryBadge: {
    position: 'absolute',
    bottom: 12,
    left: 14,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  imageCategoryText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  content: {
    padding: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  distanceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  distanceText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '600',
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 6,
    lineHeight: 22,
  },
  description: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
    marginBottom: 14,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 12,
  },
  footerDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  durationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  durationText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 4,
  },
  addButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },

  // Horizontal Card (for carousels)
  horizontalCard: {
    width: 250,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginRight: 14,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    overflow: 'hidden',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  horizontalImage: {
    width: '100%',
    height: 120,
    backgroundColor: '#E2E8F0',
  },
  horizontalBody: {
    padding: 12,
    gap: 6,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  categoryBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0284C7',
    textTransform: 'uppercase',
  },
  horizontalTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F8FAFC',
  },
  addMiniBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 2,
  },
  addMiniText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0F172A',
  },
});
