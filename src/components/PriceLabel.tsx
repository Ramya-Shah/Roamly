import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { PriceTier } from '../types';

interface PriceLabelProps {
  priceTier: PriceTier;
  amount?: number;
  currency?: string;
  size?: 'sm' | 'md';
}

export function PriceLabel({ priceTier, amount, currency = '₹', size = 'md' }: PriceLabelProps) {
  const isFree = priceTier === 'Free' || amount === 0;

  return (
    <View style={[styles.badge, isFree ? styles.freeBadge : styles.tierBadge]}>
      <Text style={[styles.text, isFree ? styles.freeText : styles.tierText, size === 'sm' && styles.textSm]}>
        {isFree ? 'Free' : amount ? `${currency}${amount}` : priceTier}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  freeBadge: {
    backgroundColor: '#ECFDF5',
  },
  tierBadge: {
    backgroundColor: '#F1F5F9',
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
  },
  textSm: {
    fontSize: 11,
  },
  freeText: {
    color: '#059669',
  },
  tierText: {
    color: '#334155',
  },
});
