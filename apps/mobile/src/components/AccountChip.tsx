import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

export interface AccountChipProps {
  /** Signed-in Google account, or null when working locally. */
  email: string | null;
  syncing: boolean;
  onPress: () => void;
}

/** The small account/settings chip at the bottom of the notes list (opens `AccountSheet`). */
export default function AccountChip({ email, syncing, onPress }: AccountChipProps) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{(email ?? 'L')[0]!.toUpperCase()}</Text>
      </View>
      <Text style={styles.label} numberOfLines={1}>
        {email ?? 'Local vault'}
      </Text>
      {syncing && <Text style={styles.sync}>syncing…</Text>}
      <Text style={styles.gear}>⚙</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 12,
    marginBottom: 12,
    padding: 10,
    borderRadius: 10,
  },
  pressed: { backgroundColor: colors.panel },
  avatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.bg, fontWeight: '700', fontSize: 13 },
  label: { flex: 1, color: colors.text, fontSize: 14 },
  sync: { color: colors.textDim, fontSize: 12 },
  gear: { color: colors.textDim, fontSize: 16 },
});
