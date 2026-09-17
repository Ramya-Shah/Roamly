import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import {
  ChevronUp,
  ChevronDown,
  Trash2,
  Clock,
  Navigation,
  PlusCircle,
  MinusCircle,
} from 'lucide-react-native';
import { ItineraryItem as ItineraryItemType } from '../types';
import { formatDistance } from '../utils/distance';

interface ItineraryItemProps {
  item: ItineraryItemType;
  index: number;
  totalItems: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onUpdateDuration: (newDuration: number) => void;
}

export function ItineraryItem({
  item,
  index,
  totalItems,
  onMoveUp,
  onMoveDown,
  onRemove,
  onUpdateDuration,
}: ItineraryItemProps) {
  const isFirst = index === 0;
  const isLast = index === totalItems - 1;

  const displayTitle = item.customTitle || item.experience?.title || 'Stop';

  const formatDuration = (mins: number) => {
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  return (
    <View style={styles.container}>
      {/* Timeline Left Column */}
      <View style={styles.timelineCol}>
        <View style={styles.timePill}>
          <Text style={styles.timeText}>{item.startTime}</Text>
        </View>
        {!isLast && (
          <View style={styles.connectorLine}>
            <View style={styles.dashedLine} />
          </View>
        )}
      </View>

      {/* Main Card */}
      <View style={styles.cardWrapper}>
        <View style={styles.card}>
          <View style={styles.topRow}>
            {item.experience?.imageUrl && (
              <Image
                source={{ uri: item.experience.imageUrl }}
                style={styles.thumbnail}
                contentFit="cover"
              />
            )}
            <View style={styles.infoCol}>
              {item.experience?.category && (
                <Text style={styles.category}>{item.experience.category}</Text>
              )}
              <Text style={styles.title} numberOfLines={2}>
                {displayTitle}
              </Text>

              {/* Duration adjuster */}
              <View style={styles.durationRow}>
                <Clock size={12} color="#64748B" />
                <Text style={styles.durationText}>{formatDuration(item.durationMinutes)}</Text>
                <View style={styles.durationControls}>
                  <TouchableOpacity
                    hitSlop={6}
                    disabled={item.durationMinutes <= 15}
                    onPress={() => onUpdateDuration(Math.max(15, item.durationMinutes - 15))}
                  >
                    <MinusCircle
                      size={16}
                      color={item.durationMinutes <= 15 ? '#CBD5E1' : '#64748B'}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    hitSlop={6}
                    onPress={() => onUpdateDuration(item.durationMinutes + 15)}
                  >
                    <PlusCircle size={16} color="#64748B" />
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {/* Actions: Reorder and Delete */}
            <View style={styles.actionsCol}>
              <TouchableOpacity
                onPress={onMoveUp}
                disabled={isFirst}
                hitSlop={6}
                style={[styles.iconBtn, isFirst && styles.iconBtnDisabled]}
              >
                <ChevronUp size={16} color={isFirst ? '#CBD5E1' : '#475569'} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onMoveDown}
                disabled={isLast}
                hitSlop={6}
                style={[styles.iconBtn, isLast && styles.iconBtnDisabled]}
              >
                <ChevronDown size={16} color={isLast ? '#CBD5E1' : '#475569'} />
              </TouchableOpacity>
              <TouchableOpacity onPress={onRemove} hitSlop={6} style={styles.deleteBtn}>
                <Trash2 size={15} color="#EF4444" />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Travel Time between stops connector indicator */}
        {!isLast && item.travelTimeMinutes > 0 && (
          <View style={styles.travelBadge}>
            <Navigation size={12} color="#0284C7" />
            <Text style={styles.travelText}>
              ~{item.travelTimeMinutes} min travel ({formatDistance(item.travelDistanceKm)})
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  timelineCol: {
    alignItems: 'center',
    width: 60,
    marginRight: 10,
  },
  timePill: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  timeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  connectorLine: {
    flex: 1,
    width: 2,
    backgroundColor: '#E2E8F0',
    marginVertical: 4,
  },
  dashedLine: {
    flex: 1,
  },
  cardWrapper: {
    flex: 1,
    paddingBottom: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  thumbnail: {
    width: 60,
    height: 60,
    borderRadius: 10,
    marginRight: 12,
    backgroundColor: '#F1F5F9',
  },
  infoCol: {
    flex: 1,
  },
  category: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0284C7',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
  },
  durationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  durationText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  durationControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 6,
  },
  actionsCol: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 8,
  },
  iconBtn: {
    padding: 4,
    borderRadius: 4,
    backgroundColor: '#F8FAFC',
  },
  iconBtnDisabled: {
    opacity: 0.4,
  },
  deleteBtn: {
    padding: 4,
    borderRadius: 4,
    backgroundColor: '#FEF2F2',
  },
  travelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F0F9FF',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 8,
    marginLeft: 4,
  },
  travelText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#0369A1',
  },
});
