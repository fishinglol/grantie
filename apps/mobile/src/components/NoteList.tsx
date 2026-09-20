import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../theme';
import AccountChip, { type AccountChipProps } from './AccountChip';

export interface NoteListProps {
  notes: string[];
  folders: string[];
  /** Note path (relative to the vault) with unsaved changes, if any. */
  dirtyNote: string | null;
  account: AccountChipProps;
  onOpen: (note: string) => void;
  /** Create a note or folder called `name` inside `folder` ("" = vault root). */
  onCreate: (kind: 'note' | 'folder', folder: string, name: string) => void;
}

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const parent = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/** The notes tree: same folders-and-notes layout as the desktop sidebar, sized for a thumb. */
export default function NoteList({ notes, folders, dirtyNote, account, onOpen, onCreate }: NoteListProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /** Folder new notes/folders land in: the last one tapped, "" = vault root. */
  const [activeFolder, setActiveFolder] = useState('');
  const [creating, setCreating] = useState<'note' | 'folder' | null>(null);
  const [name, setName] = useState('');

  const commit = () => {
    const trimmed = name.trim();
    if (creating && trimmed) onCreate(creating, activeFolder, trimmed);
    setCreating(null);
    setName('');
  };

  const renderDir = (dir: string, depth: number) => {
    const subfolders = folders.filter((f) => parent(f) === dir);
    const inHere = notes.filter((n) => parent(n) === dir);
    return (
      <>
        {subfolders.map((folder) => {
          const open = !collapsed.has(folder);
          return (
            <View key={folder}>
              <Pressable
                onPress={() => {
                  setActiveFolder(folder);
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(folder)) next.delete(folder);
                    else next.add(folder);
                    return next;
                  });
                }}
                style={({ pressed }) => [styles.row, { paddingLeft: 16 + depth * 18 }, pressed && styles.pressed]}
              >
                <Text style={styles.chevron}>{open ? '▾' : '▸'}</Text>
                <Text style={[styles.folder, activeFolder === folder && { color: colors.accent }]} numberOfLines={1}>
                  {basename(folder)}
                </Text>
              </Pressable>
              {open && renderDir(folder, depth + 1)}
            </View>
          );
        })}
        {inHere.map((note) => (
          <Pressable
            key={note}
            onPress={() => onOpen(note)}
            style={({ pressed }) => [styles.row, { paddingLeft: 16 + depth * 18 + 18 }, pressed && styles.pressed]}
          >
            <Text style={styles.note} numberOfLines={1}>
              {basename(note).replace(/\.(md|markdown)$/i, '')}
            </Text>
            {dirtyNote === note && <View style={styles.dirty} />}
          </Pressable>
        ))}
      </>
    );
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>NOTES</Text>
        <View style={styles.actions}>
          <Pressable onPress={() => setCreating('note')} hitSlop={8} style={styles.action}>
            <Text style={styles.actionText}>+ Note</Text>
          </Pressable>
          <Pressable onPress={() => setCreating('folder')} hitSlop={8} style={styles.action}>
            <Text style={styles.actionText}>+ Folder</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        {creating && (
          <View style={[styles.row, { paddingLeft: 16 }]}>
            <TextInput
              autoFocus
              value={name}
              onChangeText={setName}
              onSubmitEditing={commit}
              placeholder={creating === 'note' ? 'Note name' : 'Folder name'}
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              returnKeyType="done"
            />
          </View>
        )}
        {notes.length === 0 && folders.length === 0 && !creating && <Text style={styles.empty}>No notes in this vault yet</Text>}
        {renderDir('', 0)}
      </ScrollView>

      <AccountChip {...account} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingTop: 64,
    paddingHorizontal: 16,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { color: colors.accent, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  actions: { flexDirection: 'row', gap: 8 },
  action: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: colors.panel },
  actionText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  list: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 13, paddingRight: 16 },
  pressed: { backgroundColor: colors.panel },
  chevron: { color: colors.textDim, width: 12, fontSize: 12 },
  folder: { color: colors.text, fontSize: 16, fontWeight: '600', flex: 1 },
  note: { color: colors.text, fontSize: 16, flex: 1 },
  dirty: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    backgroundColor: colors.panel,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  empty: { color: colors.textFaint, padding: 16 },
});
