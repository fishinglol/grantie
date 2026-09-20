import { forwardRef } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import Icon from './Icon';
import NoteEditor from './NoteEditor';
import type { NoteEditorHandle, NoteEditorProps } from './NoteEditor.types';

export interface NoteScreenProps extends NoteEditorProps {
  title: string;
  dirty: boolean;
  onOpenSidebar: () => void;
  onOpenMenu: () => void;
}

/** One note, full screen: round sidebar and ⋮ buttons, the note's title, then the live editor. */
const NoteScreen = forwardRef<NoteEditorHandle, NoteScreenProps>(function NoteScreen(
  { title, dirty, onOpenSidebar, onOpenMenu, ...editor },
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
          <Pressable onPress={onOpenMenu} style={styles.round} accessibilityLabel="Note menu">
            <Icon name="dots-vertical" size={24} />
          </Pressable>
        </View>
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {title}
      </Text>
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
  right: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dirty: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  title: { color: colors.textDim, fontSize: 32, fontWeight: '700', paddingHorizontal: 18, paddingTop: 8 },
  empty: { color: colors.textFaint, fontSize: 16, padding: 18 },
});
