import { forwardRef } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { HeaderButton } from '@granite/plugins';
import { colors } from '../theme';
import Icon from './Icon';
import NoteEditor from './NoteEditor';
import type { NoteEditorHandle, NoteEditorProps } from './NoteEditor.types';

export interface NoteScreenProps extends NoteEditorProps {
  dirty: boolean;
  onOpenSidebar: () => void;
  onOpenMenu: () => void;
  onToggleReading: () => void;
  /** Buttons plugins put in the top bar (a text pill each: the phone has no room for an unknown icon). */
  buttons: HeaderButton[];
  onPressButton: (pluginId: string) => void;
}

/** One note, full screen: round sidebar and ⋮ buttons, then the live editor (which shows the note's editable title). */
const NoteScreen = forwardRef<NoteEditorHandle, NoteScreenProps>(function NoteScreen(
  { dirty, onOpenSidebar, onOpenMenu, onToggleReading, buttons, onPressButton, ...editor },
  ref,
) {
  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.bar}>
        <Pressable onPress={onOpenSidebar} style={styles.round} accessibilityLabel="Open sidebar">
          <Icon name="page-layout-sidebar-left" size={24} />
        </Pressable>
        <View style={styles.right}>
          {dirty && <View style={styles.dirty} />}
          {buttons.map((b) => (
            <Pressable key={b.pluginId} onPress={() => onPressButton(b.pluginId)} style={styles.pill} accessibilityLabel={b.title}>
              <Text style={styles.pillText}>{b.title}</Text>
              {b.badge && <View style={[styles.badge, { backgroundColor: b.badge }]} />}
            </Pressable>
          ))}
          <Pressable
            onPress={onToggleReading}
            style={[styles.round, editor.reading && styles.roundOn]}
            accessibilityLabel={editor.reading ? 'Stop reading mode' : 'Reading mode'}
            accessibilityState={{ selected: editor.reading }}
          >
            <Icon name="book-open-page-variant-outline" size={24} color={editor.reading ? colors.accent : colors.text} />
          </Pressable>
          <Pressable onPress={onOpenMenu} style={styles.round} accessibilityLabel="Note menu">
            <Icon name="dots-vertical" size={24} />
          </Pressable>
        </View>
      </View>
      <NoteEditor ref={ref} {...editor} />
    </KeyboardAvoidingView>
  );
});

export default NoteScreen;

/** Shown when no note is open. */
export function EmptyNote({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  return (
    <View style={styles.screen}>
      <View style={styles.bar}>
        <Pressable onPress={onOpenSidebar} style={styles.round} accessibilityLabel="Open sidebar">
          <Icon name="page-layout-sidebar-left" size={24} />
        </Pressable>
      </View>
      <Text style={styles.empty}>Open a note from the sidebar</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.editor },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 52, paddingHorizontal: 16, paddingBottom: 8 },
  round: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.panel, alignItems: 'center', justifyContent: 'center' },
  roundOn: { borderWidth: 1, borderColor: colors.accent },
  right: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pill: { height: 48, paddingHorizontal: 18, borderRadius: 24, backgroundColor: colors.panel, alignItems: 'center', justifyContent: 'center' },
  pillText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  badge: { position: 'absolute', top: 8, right: 10, width: 9, height: 9, borderRadius: 5 },
  dirty: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  empty: { color: colors.textFaint, fontSize: 16, padding: 18 },
});
