import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { X, Calendar, Clock, MapPin } from 'lucide-react-native';
import { useAtom } from 'jotai';
import { activeCityAtom, AVAILABLE_CITIES } from '../../src/atoms/cityAtom';
import { useItineraryMutations } from '../../src/features/itineraries/hooks/useItineraries';
import { City } from '../../src/types';

export default function CreateItineraryModal() {
  const [activeCity] = useAtom(activeCityAtom);
  const { createItinerary } = useItineraryMutations();

  const [title, setTitle] = useState(`Saturday in ${activeCity}`);
  const [city, setCity] = useState<City>(activeCity);
  const [startTime, setStartTime] = useState('10:00');
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) return;
    setIsSubmitting(true);
    try {
      const created = await createItinerary.mutateAsync({
        title: title.trim(),
        city,
        date,
        startTime,
      });
      router.back();
      router.push(`/itinerary/${created.id}`);
    } catch {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.title}>New Day Trip</Text>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <X size={22} color="#0F172A" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Title */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Trip / Day Name</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Saturday in Bengaluru"
            placeholderTextColor="#94A3B8"
          />
        </View>

        {/* City Selection */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Destination City</Text>
          <View style={styles.cityRow}>
            {AVAILABLE_CITIES.map((c) => (
              <TouchableOpacity
                key={c.name}
                style={[styles.cityChip, city === c.name && styles.cityChipActive]}
                onPress={() => setCity(c.name)}
              >
                <MapPin size={14} color={city === c.name ? '#FFFFFF' : '#64748B'} />
                <Text style={[styles.cityChipText, city === c.name && styles.cityChipTextActive]}>
                  {c.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Date and Start Time */}
        <View style={styles.row}>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.label}>Date</Text>
            <View style={styles.iconInput}>
              <Calendar size={16} color="#64748B" />
              <TextInput
                style={styles.fieldInput}
                value={date}
                onChangeText={setDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#94A3B8"
              />
            </View>
          </View>

          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.label}>Start Time</Text>
            <View style={styles.iconInput}>
              <Clock size={16} color="#64748B" />
              <TextInput
                style={styles.fieldInput}
                value={startTime}
                onChangeText={setStartTime}
                placeholder="10:00"
                placeholderTextColor="#94A3B8"
              />
            </View>
          </View>
        </View>

        {/* Submit */}
        <TouchableOpacity
          style={[styles.submitBtn, (!title.trim() || isSubmitting) && styles.submitBtnDisabled]}
          disabled={!title.trim() || isSubmitting}
          onPress={handleCreate}
        >
          <Text style={styles.submitBtnText}>
            {isSubmitting ? 'Creating...' : 'Create Itinerary'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
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
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
  },
  content: {
    padding: 20,
    gap: 16,
  },
  inputGroup: {
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  input: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#0F172A',
  },
  cityRow: {
    flexDirection: 'row',
    gap: 8,
  },
  cityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
  },
  cityChipActive: {
    backgroundColor: '#0F172A',
  },
  cityChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  cityChipTextActive: {
    color: '#FFFFFF',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  iconInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  fieldInput: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A',
    padding: 0,
  },
  submitBtn: {
    backgroundColor: '#0F172A',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
