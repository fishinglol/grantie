import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import { folderOrder, nameOf } from '../tree';
import Icon from './Icon';

export interface FolderPickerProps {
  visible: boolean;
  /** Name of the note being moved, for the heading. */
  noteName: string;
  /** Folder the note is in now ("" = vault root); it can't be picked. */
  current: string;
  folders: string[];
  onPick: (folder: string) => void;
  onClose: () => void;
}

/** Bottom sheet listing the vault and every folder and subfolder, to choose where a note goes. */
export default function FolderPicker({ visible, noteName, current, folders, onPick, onClose }: FolderPickerProps) {
  const choices = [{ rel: '', depth: 0 }, ...folderOrder(folders).map((f) => ({ ...f, depth: f.depth + 1 }))];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <Text style={styles.heading} numberOfLines={1}>
          Move “{noteName}” to…
        </Text>
        <ScrollView style={styles.card} bounces={false}>
          {choices.map(({ rel, depth }) => {
            const here = rel === current;
            return (
              <Pressable
                key={rel || '(vault)'}
                disabled={here}
                onPress={() => {
                  onClose();
                  onPick(rel);
                }}
                style={({ pressed }) => [styles.item, { paddingLeft: 18 + depth * 20 }, pressed && styles.pressed]}
              >
                <Icon name={rel === '' ? 'home-outline' : 'folder-outline'} size={22} color={here ? colors.textFaint : colors.textDim} />
                <Text style={[styles.label, here && { color: colors.textFaint }]} numberOfLines={1}>
                  {rel === '' ? 'Vault (top level)' : nameOf(rel)}
                </Text>
                {here && <Text style={styles.hint}>current</Text>}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(8,10,15,0.6)' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 10,
    paddingBottom: 34,
    paddingHorizontal: 14,
    maxHeight: '75%',
  },
  grabber: { alignSelf: 'center', width: 44, height: 4, borderRadius: 2, backgroundColor: colors.panelHover, marginBottom: 12 },
  heading: { color: colors.textDim, fontSize: 14, paddingHorizontal: 8, paddingBottom: 10 },
  card: { backgroundColor: colors.panel, borderRadius: 20 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16, paddingRight: 18 },
  pressed: { backgroundColor: colors.panelHover },
  label: { color: colors.text, fontSize: 17, flex: 1 },
  hint: { color: colors.textFaint, fontSize: 13 },
});
