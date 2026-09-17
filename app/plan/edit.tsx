import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAtom } from 'jotai';
import { router } from 'expo-router';
import {
  ArrowLeft,
  Trash2,
  ChevronUp,
  ChevronDown,
  Plus,
  Minus,
  Check,
  MapPin,
} from 'lucide-react-native';
import { currentGeneratedPlanAtom } from '../../src/atoms/planAtom';
import { generatedPlanRepository } from '../../src/repositories/GeneratedPlanRepository';
import { AIPlanStop, GeneratedPlan } from '../../src/types';

export default function EditPlanScreen() {
  const [currentPlan, setCurrentPlan] = useAtom(currentGeneratedPlanAtom);
  const [stops, setStops] = useState<AIPlanStop[]>(currentPlan?.stops || []);

  if (!currentPlan) {
    router.replace('/(tabs)/plan' as any);
    return null;
  }

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const updated = [...stops];
    const temp = updated[index];
    updated[index] = updated[index - 1];
    updated[index - 1] = temp;
    recalculateTimeline(updated);
  };

  const handleMoveDown = (index: number) => {
    if (index === stops.length - 1) return;
    const updated = [...stops];
    const temp = updated[index];
    updated[index] = updated[index + 1];
    updated[index + 1] = temp;
    recalculateTimeline(updated);
  };

  const handleRemove = (index: number) => {
    if (stops.length <= 1) {
      Alert.alert('Cannot Remove', 'Your plan must have at least one stop.');
      return;
    }
    const updated = stops.filter((_, i) => i !== index);
    recalculateTimeline(updated);
  };

  const handleAdjustDuration = (index: number, deltaMinutes: number) => {
    const updated = [...stops];
    const currentDur = updated[index].durationMinutes;
    const nextDur = Math.max(15, Math.min(360, currentDur + deltaMinutes));
    updated[index] = { ...updated[index], durationMinutes: nextDur };
    recalculateTimeline(updated);
  };

  const recalculateTimeline = (newStops: AIPlanStop[]) => {
    let currentHour = 10;
    let currentMin = 0;

    const recalculated = newStops.map((stop) => {
      const timeString = `${String(currentHour).padStart(2, '0')}:${String(
        currentMin
      ).padStart(2, '0')}`;

      const totalAdvance = stop.durationMinutes + 20; // 20m travel buffer
      const totalMinutes = currentHour * 60 + currentMin + totalAdvance;
      currentHour = Math.floor(totalMinutes / 60);
      currentMin = totalMinutes % 60;

      return {
        ...stop,
        startTime: timeString,
      };
    });

    setStops(recalculated);
  };

  const handleSave = async () => {
    const totalCost = stops.reduce(
      (sum, s) => sum + (s.experience?.priceAmount || 0),
      0
    );

    const updatedPlan: GeneratedPlan = {
      ...currentPlan,
      stops,
      estimatedCost: totalCost,
    };

    await generatedPlanRepository.savePlan(updatedPlan);
    setCurrentPlan(updatedPlan);
    router.back();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <ArrowLeft size={22} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Customize Stops</Text>
        <TouchableOpacity style={styles.saveHeaderButton} onPress={handleSave}>
          <Check size={18} color="#FFFFFF" />
          <Text style={styles.saveHeaderText}>Done</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollInner}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.instructionText}>
          Reorder stops, adjust durations, or remove places without extra AI calls.
        </Text>

        <View style={styles.stopsList}>
          {stops.map((stop, index) => {
            const exp = stop.experience;
            const isFirst = index === 0;
            const isLast = index === stops.length - 1;

            return (
              <View key={stop.experienceId || index} style={styles.stopCard}>
                <View style={styles.stopTopRow}>
                  <View style={styles.timeTag}>
                    <Text style={styles.timeTagText}>{stop.startTime}</Text>
                  </View>
                  <Text style={styles.stopTitle} numberOfLines={1}>
                    {exp?.title || 'Custom Stop'}
                  </Text>
                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => handleRemove(index)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Trash2 size={18} color="#EF4444" />
                  </TouchableOpacity>
                </View>

                {/* Duration Controls */}
                <View style={styles.controlsRow}>
                  <View style={styles.durationControl}>
                    <Text style={styles.controlLabel}>Stay Duration:</Text>
                    <View style={styles.counterWrap}>
                      <TouchableOpacity
                        style={styles.counterBtn}
                        onPress={() => handleAdjustDuration(index, -15)}
                      >
                        <Minus size={14} color="#0F172A" />
                      </TouchableOpacity>
                      <Text style={styles.counterText}>
                        {stop.durationMinutes}m
                      </Text>
                      <TouchableOpacity
                        style={styles.counterBtn}
                        onPress={() => handleAdjustDuration(index, 15)}
                      >
                        <Plus size={14} color="#0F172A" />
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Reorder Buttons */}
                  <View style={styles.reorderButtons}>
                    <TouchableOpacity
                      style={[
                        styles.reorderBtn,
                        isFirst && styles.reorderBtnDisabled,
                      ]}
                      onPress={() => handleMoveUp(index)}
                      disabled={isFirst}
                    >
                      <ChevronUp
                        size={18}
                        color={isFirst ? '#CBD5E1' : '#0F172A'}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.reorderBtn,
                        isLast && styles.reorderBtnDisabled,
                      ]}
                      onPress={() => handleMoveDown(index)}
                      disabled={isLast}
                    >
                      <ChevronDown
                        size={18}
                        color={isLast ? '#CBD5E1' : '#0F172A'}
                      />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* Footer Save */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.footerSaveBtn} onPress={handleSave}>
          <Check size={18} color="#FFFFFF" />
          <Text style={styles.footerSaveBtnText}>Save Itinerary Changes</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  backButton: {
    padding: 6,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
  },
  saveHeaderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#0F172A',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  saveHeaderText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  scroll: {
    flex: 1,
  },
  scrollInner: {
    padding: 16,
    paddingBottom: 40,
  },
  instructionText: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 16,
    lineHeight: 18,
  },
  stopsList: {
    gap: 12,
  },
  stopCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  stopTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  timeTag: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  timeTagText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4F46E5',
  },
  stopTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    flex: 1,
  },
  deleteButton: {
    padding: 4,
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: 12,
  },
  durationControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  controlLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  counterWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  counterBtn: {
    padding: 6,
  },
  counterText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
    paddingHorizontal: 6,
  },
  reorderButtons: {
    flexDirection: 'row',
    gap: 6,
  },
  reorderBtn: {
    backgroundColor: '#FFFFFF',
    padding: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  reorderBtnDisabled: {
    opacity: 0.4,
  },
  footer: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  footerSaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#4F46E5',
    paddingVertical: 14,
    borderRadius: 14,
  },
  footerSaveBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
