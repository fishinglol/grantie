import { useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';
import { colors } from '../theme';

export interface NoteTitleProps {
  /** The note's name without `.md`. */
  name: string;
  /** Rename the file to match. Resolves false if it didn't happen, and the title goes back to `name`. */
  onRename: (title: string) => Promise<boolean>;
}

/** The open note's name as a heading above the text; editing it renames the file. */
export default function NoteTitle({ name, onRename }: NoteTitleProps) {
  const [draft, setDraft] = useState(name);
  const [current, setCurrent] = useState(name);
  // The name changed from outside (a rename, or sync): follow it.
  if (current !== name) {
    setCurrent(name);
    setDraft(name);
  }
  const commit = async () => {
    if (draft.trim() === name) return setDraft(name);
    if (!(await onRename(draft))) setDraft(name);
  };
  return (
    <TextInput
      value={draft}
      onChangeText={setDraft}
      onBlur={() => void commit()}
      onSubmitEditing={() => void commit()}
      returnKeyType="done"
      submitBehavior="blurAndSubmit"
      autoCorrect={false}
      selectionColor={colors.accent}
      accessibilityLabel="Note title"
      style={styles.title}
    />
  );
}

const styles = StyleSheet.create({
  title: { color: colors.textDim, fontSize: 32, fontWeight: '700', paddingHorizontal: 18, paddingTop: 8, paddingBottom: 4 },
});
