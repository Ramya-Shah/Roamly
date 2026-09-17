import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  TextInput,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { MapPin, Check, X, Compass, Search, Navigation } from 'lucide-react-native';
import { useAtom } from 'jotai';
import * as Location from 'expo-location';
import { activeCityAtom, AVAILABLE_CITIES } from '../atoms/cityAtom';
import { City } from '../types';

interface CityPickerModalProps {
  visible: boolean;
  onClose: () => void;
}

export function CityPickerModal({ visible, onClose }: CityPickerModalProps) {
  const [activeCity, setActiveCity] = useAtom(activeCityAtom);
  const [customCityText, setCustomCityText] = useState('');
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectMsg, setDetectMsg] = useState<string | null>(null);

  const handleSelect = (city: City) => {
    setActiveCity(city);
    onClose();
  };

  const handleCustomSubmit = () => {
    const trimmed = customCityText.trim();
    if (trimmed.length > 0) {
      // Capitalize nicely
      const formatted = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
      setActiveCity(formatted as City);
      setCustomCityText('');
      onClose();
    }
  };

  const handleDetectLocation = async () => {
    try {
      setIsDetecting(true);
      setDetectMsg('Locating device...');
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setDetectMsg('Location permission denied');
        setIsDetecting(false);
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const addresses = await Location.reverseGeocodeAsync({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });

      if (addresses.length > 0) {
        const detected =
          addresses[0].city ||
          addresses[0].subregion ||
          addresses[0].region ||
          'Ahmedabad';
        setActiveCity(detected as City);
        setDetectMsg(`Detected: ${detected}!`);
        setTimeout(() => {
          setIsDetecting(false);
          onClose();
        }, 600);
      } else {
        setDetectMsg('Could not resolve city name');
        setIsDetecting(false);
      }
    } catch {
      setDetectMsg('Detection failed');
      setIsDetecting(false);
    }
  };

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={styles.content}>
              <View style={styles.header}>
                <View style={styles.titleRow}>
                  <MapPin size={20} color="#0F172A" />
                  <Text style={styles.title}>Select Destination</Text>
                </View>
                <TouchableOpacity onPress={onClose} hitSlop={10}>
                  <X size={20} color="#64748B" />
                </TouchableOpacity>
              </View>

              <Text style={styles.subtitle}>
                Choose a destination or explore any city worldwide with Roamly AI:
              </Text>

              {/* GPS Auto-Detect Button */}
              <TouchableOpacity
                style={styles.gpsButton}
                onPress={handleDetectLocation}
                disabled={isDetecting}
                activeOpacity={0.8}
              >
                {isDetecting ? (
                  <ActivityIndicator size="small" color="#4F46E5" />
                ) : (
                  <Navigation size={16} color="#4F46E5" />
                )}
                <Text style={styles.gpsButtonText}>
                  {detectMsg || 'Auto-Detect Current City (GPS)'}
                </Text>
              </TouchableOpacity>

              {/* Custom City Input */}
              <View style={styles.inputContainer}>
                <Search size={16} color="#64748B" style={{ marginLeft: 12 }} />
                <TextInput
                  style={styles.input}
                  placeholder="Type any city (e.g. Ahmedabad, Paris)..."
                  placeholderTextColor="#94A3B8"
                  value={customCityText}
                  onChangeText={setCustomCityText}
                  onSubmitEditing={handleCustomSubmit}
                  returnKeyType="go"
                />
                {customCityText.trim().length > 0 && (
                  <TouchableOpacity
                    style={styles.goButton}
                    onPress={handleCustomSubmit}
                  >
                    <Text style={styles.goButtonText}>Set</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* City List */}
              <ScrollView style={{ maxHeight: 240 }} showsVerticalScrollIndicator={false}>
                <View style={styles.cityList}>
                  {AVAILABLE_CITIES.map((city) => {
                    const isSelected =
                      activeCity.toLowerCase() === city.name.toLowerCase();
                    return (
                      <TouchableOpacity
                        key={city.name}
                        activeOpacity={0.7}
                        style={[
                          styles.cityCard,
                          isSelected && styles.cityCardSelected,
                        ]}
                        onPress={() => handleSelect(city.name)}
                      >
                        <View>
                          <Text
                            style={[
                              styles.cityName,
                              isSelected && styles.cityNameSelected,
                            ]}
                          >
                            {city.name}
                          </Text>
                          <Text style={styles.countryName}>
                            {city.country} · {city.currency}
                          </Text>
                        </View>
                        {isSelected && (
                          <View style={styles.checkCircle}>
                            <Check size={16} color="#FFFFFF" />
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>
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
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  content: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    width: '100%',
    maxWidth: 380,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  subtitle: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 16,
  },
  cityList: {
    gap: 10,
  },
  cityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
  },
  cityCardSelected: {
    borderColor: '#0F172A',
    backgroundColor: '#F1F5F9',
  },
  cityName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E293B',
  },
  cityNameSelected: {
    color: '#0F172A',
  },
  countryName: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  checkCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gpsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    marginBottom: 12,
  },
  gpsButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4F46E5',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    marginBottom: 14,
    height: 44,
  },
  input: {
    flex: 1,
    paddingHorizontal: 10,
    fontSize: 14,
    color: '#0F172A',
  },
  goButton: {
    backgroundColor: '#4F46E5',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    marginRight: 6,
  },
  goButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
});
