import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import Icon from './Icon';

export interface SheetItem {
  label: string;
  icon: Parameters<typeof Icon>[0]['name'];
  onPress: () => void;
  /** Drawn in red, for actions that destroy something. */
  danger?: boolean;
}

export interface ActionSheetProps {
  visible: boolean;
  /** Small caption above the first group (e.g. the signed-in account). */
  caption?: string;
  /** Each group is drawn as one rounded card, like the mobile Obsidian menus. */
  groups: SheetItem[][];
  onClose: () => void;
}

/** Bottom sheet of grouped actions: the phone version of the desktop's hover menus. */
export default function ActionSheet({ visible, caption, groups, onClose }: ActionSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        {caption ? <Text style={styles.caption}>{caption}</Text> : null}
        {groups.map((group, g) => (
          <View key={g} style={styles.card}>
            {group.map((item, i) => (
              <Pressable
                key={item.label}
                onPress={() => {
                  onClose();
                  item.onPress();
                }}
                style={({ pressed }) => [styles.item, i > 0 && styles.divider, pressed && styles.pressed]}
              >
                <Icon name={item.icon} size={22} color={item.danger ? colors.danger : colors.textDim} />
                <Text style={[styles.label, item.danger && { color: colors.danger }]}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        ))}
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
    gap: 10,
  },
  grabber: { alignSelf: 'center', width: 44, height: 4, borderRadius: 2, backgroundColor: colors.panelHover, marginBottom: 6 },
  caption: { color: colors.textDim, fontSize: 13, paddingHorizontal: 8, paddingBottom: 2 },
  card: { backgroundColor: colors.panel, borderRadius: 20, overflow: 'hidden' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16, paddingHorizontal: 18 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.panelHover },
  pressed: { backgroundColor: colors.panelHover },
  label: { color: colors.text, fontSize: 17 },
});
