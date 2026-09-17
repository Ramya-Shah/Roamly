import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import {
  Compass,
  Landmark,
  UtensilsCrossed,
  Trees,
  Moon,
  Mountain,
  Calendar,
  Sparkles,
} from 'lucide-react-native';

interface CategoryChipProps {
  label: string;
  isSelected: boolean;
  onPress: () => void;
}

export function CategoryChip({ label, isSelected, onPress }: CategoryChipProps) {
  const getIcon = () => {
    const size = 16;
    const color = isSelected ? '#FFFFFF' : '#475569';

    switch (label.toLowerCase()) {
      case 'attractions':
        return <Compass size={size} color={color} />;
      case 'museums':
        return <Landmark size={size} color={color} />;
      case 'food':
        return <UtensilsCrossed size={size} color={color} />;
      case 'parks':
        return <Trees size={size} color={color} />;
      case 'nightlife':
        return <Moon size={size} color={color} />;
      case 'adventure':
        return <Mountain size={size} color={color} />;
      case 'events':
        return <Calendar size={size} color={color} />;
      default:
        return <Sparkles size={size} color={color} />;
    }
  };

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      style={[styles.chip, isSelected ? styles.chipSelected : styles.chipUnselected]}
      onPress={onPress}
    >
      {getIcon()}
      <Text style={[styles.text, isSelected ? styles.textSelected : styles.textUnselected]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    gap: 6,
  },
  chipSelected: {
    backgroundColor: '#0F172A',
  },
  chipUnselected: {
    backgroundColor: '#F1F5F9',
  },
  text: {
    fontSize: 13,
    fontWeight: '600',
  },
  textSelected: {
    color: '#FFFFFF',
  },
  textUnselected: {
    color: '#334155',
  },
});
