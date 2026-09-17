import React from 'react';
import { View, StyleSheet } from 'react-native';

interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: any;
}

export function SkeletonBox({
  width = '100%',
  height = 20,
  borderRadius = 8,
  style,
}: SkeletonProps) {
  return (
    <View
      style={[
        styles.skeleton,
        {
          width: width as any,
          height,
          borderRadius,
        },
        style,
      ]}
    />
  );
}

export function ExperienceCardSkeleton() {
  return (
    <View style={styles.cardSkeleton}>
      <SkeletonBox height={160} borderRadius={16} />
      <View style={styles.cardBody}>
        <SkeletonBox width="70%" height={18} borderRadius={6} />
        <View style={styles.row}>
          <SkeletonBox width="30%" height={14} borderRadius={4} />
          <SkeletonBox width="25%" height={14} borderRadius={4} />
        </View>
        <View style={styles.row}>
          <SkeletonBox width="40%" height={14} borderRadius={4} />
          <SkeletonBox width="20%" height={20} borderRadius={6} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: '#E2E8F0',
  },
  cardSkeleton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  cardBody: {
    marginTop: 12,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
