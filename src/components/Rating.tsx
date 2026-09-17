import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Star } from 'lucide-react-native';

interface RatingProps {
  score: number;
  reviewCount?: number;
  size?: number;
  showCount?: boolean;
}

export function Rating({ score, reviewCount, size = 14, showCount = true }: RatingProps) {
  return (
    <View style={styles.container}>
      <Star size={size} color="#F59E0B" fill="#F59E0B" />
      <Text style={[styles.score, { fontSize: size + 1 }]}>{score.toFixed(1)}</Text>
      {showCount && reviewCount !== undefined && reviewCount > 0 && (
        <Text style={[styles.count, { fontSize: size }]}>({reviewCount > 999 ? `${(reviewCount / 1000).toFixed(1)}k` : reviewCount})</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  score: {
    fontWeight: '700',
    color: '#0F172A',
  },
  count: {
    color: '#64748B',
    fontWeight: '500',
  },
});
