import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import type { DeviceCode } from '@granite/core-cloud';
import { colors } from '../theme';

export interface DeviceSignInProps {
  /** The code to show, or null while it is still being requested. */
  device: DeviceCode | null;
  onCancel: () => void;
}

/** "Connect Drive": shows the code to type at google.com/device while the app waits for approval. */
export default function DeviceSignIn({ device, onCancel }: DeviceSignInProps) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Connect Google Drive</Text>
          {device ? (
            <>
              <Text style={styles.step}>1. Open the Google page below.</Text>
              <Pressable onPress={() => WebBrowser.openBrowserAsync(device.verificationUrl)} style={styles.open}>
                <Text style={styles.openText}>Open google.com/device</Text>
              </Pressable>
              <Text style={styles.step}>2. Type this code and approve:</Text>
              <Text style={styles.code} selectable>
                {device.userCode}
              </Text>
              <View style={styles.waiting}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.step}>Waiting for you to approve…</Text>
              </View>
            </>
          ) : (
            <ActivityIndicator color={colors.accent} style={{ marginVertical: 24 }} />
          )}
          <Pressable onPress={onCancel} style={styles.cancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(8,10,15,0.7)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 420, backgroundColor: colors.bg, borderRadius: 24, padding: 24, gap: 12 },
  title: { color: colors.heading, fontSize: 22, fontWeight: '700' },
  step: { color: colors.textDim, fontSize: 15 },
  open: { backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  openText: { color: colors.bg, fontSize: 16, fontWeight: '700' },
  code: {
    color: colors.heading,
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: 3,
    textAlign: 'center',
    backgroundColor: colors.panel,
    borderRadius: 14,
    paddingVertical: 16,
  },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  cancel: { alignItems: 'center', paddingVertical: 12 },
  cancelText: { color: colors.textDim, fontSize: 16 },
});
