import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

export interface AccountSheetProps {
  visible: boolean;
  email: string | null;
  onClose: () => void;
  onConnectDrive: () => void;
  onSyncNow: () => void;
  onSignOut: () => void;
}

/** The phone version of the desktop user menu: a bottom sheet. */
export default function AccountSheet({ visible, email, onClose, onConnectDrive, onSyncNow, onSignOut }: AccountSheetProps) {
  const item = (label: string, onPress: () => void, danger = false) => (
    <Pressable
      key={label}
      onPress={() => {
        onClose();
        onPress();
      }}
      style={({ pressed }) => [styles.item, pressed && styles.pressed]}
    >
      <Text style={[styles.itemText, danger && { color: colors.danger }]}>{label}</Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <Text style={styles.who}>{email ?? 'Working locally — notes stay on this phone'}</Text>
        {email
          ? [item('Sync now', onSyncNow), item('Sign out', onSignOut, true)]
          : item('Connect Drive', onConnectDrive)}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(8,10,15,0.6)' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 16,
    paddingBottom: 36,
    paddingHorizontal: 12,
  },
  who: { color: colors.textDim, fontSize: 13, paddingHorizontal: 12, paddingBottom: 10 },
  item: { paddingVertical: 14, paddingHorizontal: 12, borderRadius: 10 },
  pressed: { backgroundColor: colors.panel },
  itemText: { color: colors.text, fontSize: 16 },
});
