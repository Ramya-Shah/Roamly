import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { Calendar, Plus, X, Clock, Check } from 'lucide-react-native';
import { useAtom } from 'jotai';
import { activeCityAtom } from '../atoms/cityAtom';
import { useItineraries, useItineraryMutations } from '../features/itineraries/hooks/useItineraries';
import { Experience } from '../types';

interface AddToTripModalProps {
  visible: boolean;
  experience: Experience | null;
  onClose: () => void;
}

export function AddToTripModal({ visible, experience, onClose }: AddToTripModalProps) {
  const [activeCity] = useAtom(activeCityAtom);
  const { data: itineraries = [], isLoading } = useItineraries(activeCity);
  const { addItem, createItinerary } = useItineraryMutations();

  const [selectedItinId, setSelectedItinId] = useState<string | null>(null);
  const [durationMinutes, setDurationMinutes] = useState<number>(
    experience?.durationMinutes || 90
  );
  const [showCreateTrip, setShowCreateTrip] = useState(false);
  const [newTripTitle, setNewTripTitle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // Update default duration when experience changes
  React.useEffect(() => {
    if (experience) {
      setDurationMinutes(experience.durationMinutes || 90);
      setSelectedItinId(itineraries[0]?.id || null);
    }
  }, [experience, itineraries]);

  const handleConfirm = async () => {
    if (!experience) return;
    setIsSubmitting(true);

    try {
      let targetId = selectedItinId;

      if (showCreateTrip && newTripTitle.trim()) {
        const today = new Date().toISOString().split('T')[0];
        const newItin = await createItinerary.mutateAsync({
          title: newTripTitle.trim(),
          city: experience.city,
          date: today,
          startTime: '09:00',
        });
        targetId = newItin.id;
      }

      if (!targetId && itineraries.length > 0) {
        targetId = itineraries[0].id;
      }

      if (targetId) {
        await addItem.mutateAsync({
          itineraryId: targetId,
          experienceId: experience.id,
          customTitle: experience.title,
          durationMinutes,
        });

        setSuccess(true);
        setTimeout(() => {
          setSuccess(false);
          onClose();
        }, 800);
      }
    } catch {
      // Handled
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!experience) return null;

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={styles.content}>
              {/* Header */}
              <View style={styles.header}>
                <View>
                  <Text style={styles.title}>Add to Itinerary</Text>
                  <Text style={styles.expTitle} numberOfLines={1}>
                    {experience.title}
                  </Text>
                </View>
                <TouchableOpacity onPress={onClose} hitSlop={10}>
                  <X size={20} color="#64748B" />
                </TouchableOpacity>
              </View>

              {success ? (
                <View style={styles.successBox}>
                  <View style={styles.successCheck}>
                    <Check size={28} color="#FFFFFF" />
                  </View>
                  <Text style={styles.successText}>Added to Itinerary!</Text>
                </View>
              ) : (
                <ScrollView showsVerticalScrollIndicator={false}>
                  {/* Select Itinerary */}
                  <Text style={styles.sectionLabel}>Choose Day / Trip</Text>
                  {isLoading ? (
                    <ActivityIndicator size="small" color="#0F172A" />
                  ) : itineraries.length === 0 || showCreateTrip ? (
                    <View style={styles.createTripBox}>
                      <Text style={styles.createTripLabel}>Create New Day Itinerary</Text>
                      <TextInput
                        style={styles.textInput}
                        placeholder={`e.g. Saturday in ${experience.city}`}
                        value={newTripTitle}
                        onChangeText={setNewTripTitle}
                        placeholderTextColor="#94A3B8"
                      />
                      {itineraries.length > 0 && (
                        <TouchableOpacity
                          onPress={() => setShowCreateTrip(false)}
                          style={styles.cancelCreateLink}
                        >
                          <Text style={styles.cancelCreateText}>Or select existing trip</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ) : (
                    <View style={styles.itinList}>
                      {itineraries.map((itin) => {
                        const isSelected = selectedItinId === itin.id;
                        return (
                          <TouchableOpacity
                            key={itin.id}
                            activeOpacity={0.7}
                            style={[
                              styles.itinOption,
                              isSelected && styles.itinOptionSelected,
                            ]}
                            onPress={() => setSelectedItinId(itin.id)}
                          >
                            <Calendar
                              size={18}
                              color={isSelected ? '#0F172A' : '#64748B'}
                            />
                            <View style={styles.itinTextCol}>
                              <Text
                                style={[
                                  styles.itinTitle,
                                  isSelected && styles.itinTitleSelected,
                                ]}
                              >
                                {itin.title}
                              </Text>
                              <Text style={styles.itinMeta}>
                                {itin.items.length} stops · {itin.date}
                              </Text>
                            </View>
                            {isSelected && (
                              <View style={styles.itinRadioActive}>
                                <View style={styles.itinRadioDot} />
                              </View>
                            )}
                          </TouchableOpacity>
                        );
                      })}

                      <TouchableOpacity
                        activeOpacity={0.7}
                        style={styles.newTripBtn}
                        onPress={() => setShowCreateTrip(true)}
                      >
                        <Plus size={16} color="#0F172A" />
                        <Text style={styles.newTripText}>Create another day trip</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Planned Duration */}
                  <View style={styles.durationSection}>
                    <Text style={styles.sectionLabel}>Estimated Duration</Text>
                    <View style={styles.durationChips}>
                      {[30, 60, 90, 120, 180].map((mins) => {
                        const isSelected = durationMinutes === mins;
                        return (
                          <TouchableOpacity
                            key={mins}
                            onPress={() => setDurationMinutes(mins)}
                            style={[
                              styles.durationChip,
                              isSelected && styles.durationChipSelected,
                            ]}
                          >
                            <Clock
                              size={12}
                              color={isSelected ? '#FFFFFF' : '#64748B'}
                            />
                            <Text
                              style={[
                                styles.durationChipText,
                                isSelected && styles.durationChipTextSelected,
                              ]}
                            >
                              {mins >= 60 ? `${mins / 60}h` : `${mins}m`}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>

                  {/* Submit Button */}
                  <TouchableOpacity
                    activeOpacity={0.8}
                    disabled={
                      isSubmitting ||
                      (showCreateTrip && !newTripTitle.trim()) ||
                      (!showCreateTrip && !selectedItinId && itineraries.length === 0)
                    }
                    style={[
                      styles.confirmBtn,
                      isSubmitting && styles.confirmBtnDisabled,
                    ]}
                    onPress={handleConfirm}
                  >
                    {isSubmitting ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.confirmBtnText}>Confirm Add to Itinerary</Text>
                    )}
                  </TouchableOpacity>
                </ScrollView>
              )}
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'flex-end',
  },
  content: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
  },
  expTitle: {
    fontSize: 14,
    color: '#64748B',
    marginTop: 2,
    maxWidth: 280,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
    marginTop: 10,
  },
  itinList: {
    gap: 10,
  },
  itinOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    gap: 12,
  },
  itinOptionSelected: {
    borderColor: '#0F172A',
    backgroundColor: '#F1F5F9',
  },
  itinTextCol: {
    flex: 1,
  },
  itinTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E293B',
  },
  itinTitleSelected: {
    color: '#0F172A',
  },
  itinMeta: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  itinRadioActive: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itinRadioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#0F172A',
  },
  newTripBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderStyle: 'dashed',
    gap: 6,
    marginTop: 4,
  },
  newTripText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F172A',
  },
  createTripBox: {
    padding: 16,
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  createTripLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A',
  },
  cancelCreateLink: {
    marginTop: 10,
    alignSelf: 'flex-start',
  },
  cancelCreateText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0284C7',
  },
  durationSection: {
    marginTop: 16,
  },
  durationChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  durationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
  },
  durationChipSelected: {
    backgroundColor: '#0F172A',
  },
  durationChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  durationChipTextSelected: {
    color: '#FFFFFF',
  },
  confirmBtn: {
    backgroundColor: '#0F172A',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
    marginBottom: 10,
  },
  confirmBtnDisabled: {
    opacity: 0.5,
  },
  confirmBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  successBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  successCheck: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  successText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
});
