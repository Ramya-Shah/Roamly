import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Heart } from 'lucide-react-native';
import { useSavedExperiences } from '../../src/features/saved/hooks/useSavedExperiences';
import { ExperienceCard } from '../../src/components/ExperienceCard';
import { EmptyState } from '../../src/components/EmptyState';
import { SyncIndicator } from '../../src/components/SyncIndicator';
import { AddToTripModal } from '../../src/components/AddToTripModal';
import { Experience } from '../../src/types';

export default function SavedScreen() {
  const { savedList, isLoading } = useSavedExperiences();
  const [selectedExpForTrip, setSelectedExpForTrip] = useState<Experience | null>(null);

  const savedExperiences = savedList
    .map((s) => s.experience)
    .filter(Boolean) as Experience[];

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.title}>Saved Experiences</Text>
          <Text style={styles.subtitle}>
            {savedExperiences.length} {savedExperiences.length === 1 ? 'place' : 'places'} saved offline
          </Text>
        </View>
        <SyncIndicator />
      </View>

      {/* Saved List */}
      <FlatList
        data={savedExperiences}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <ExperienceCard
            experience={item}
            onAddToTrip={(exp) => setSelectedExpForTrip(exp)}
          />
        )}
        ListEmptyComponent={() => (
          <EmptyState
            title="No saved places yet"
            description="Tap the heart icon on any experience to keep it saved offline for quick access during your travels."
            actionLabel="Discover Experiences"
            onAction={() => router.push('/(tabs)/explore')}
            icon={<Heart size={32} color="#EF4444" />}
          />
        )}
      />

      {/* Add To Trip Modal */}
      <AddToTripModal
        visible={Boolean(selectedExpForTrip)}
        experience={selectedExpForTrip}
        onClose={() => setSelectedExpForTrip(null)}
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  headerLeft: {
    gap: 2,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
  },
  subtitle: {
    fontSize: 13,
    color: '#64748B',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
  },
});
