import { forwardRef } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import NoteEditor from './NoteEditor';
import type { NoteEditorHandle, NoteEditorProps } from './NoteEditor.types';

export interface NoteScreenProps extends NoteEditorProps {
  title: string;
  dirty: boolean;
  onBack: () => void;
  onAddImage: () => void;
}

/** One note, full screen: a slim top bar (back, title, save dot) over the live editor. */
const NoteScreen = forwardRef<NoteEditorHandle, NoteScreenProps>(function NoteScreen(
  { title, dirty, onBack, onAddImage, ...editor },
  ref,
) {
  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.bar}>
        <Pressable onPress={onBack} hitSlop={10} style={styles.back}>
          <Text style={styles.backText}>‹ Notes</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {dirty && <View style={styles.dirty} />}
        <Pressable onPress={onAddImage} hitSlop={10} style={styles.image}>
          <Text style={styles.imageText}>Image</Text>
        </Pressable>
      </View>
      <NoteEditor ref={ref} {...editor} />
    </KeyboardAvoidingView>
  );
});

export default NoteScreen;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.editor },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 58,
    paddingBottom: 10,
    paddingHorizontal: 16,
    backgroundColor: colors.bg,
  },
  back: { paddingRight: 4 },
  backText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  title: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
  dirty: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  image: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: colors.panel },
  imageText: { color: colors.text, fontSize: 13, fontWeight: '600' },
});
