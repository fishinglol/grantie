import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

/** Short-lived status message, floating over the bottom of the screen. */
export default function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.wrap} pointerEvents="none">
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 96,
    backgroundColor: colors.panelHover,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  text: { color: colors.text, fontSize: 13 },
});
