import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../theme';
import Icon from './Icon';

export interface NoteListProps {
  notes: string[];
  folders: string[];
  /** Open note (relative to the vault), highlighted in the list. */
  selected: string | null;
  /** "Local vault" or the signed-in account. */
  title: string;
  syncing: boolean;
  onOpen: (note: string) => void;
  /** Create a note or folder called `name` inside `folder` ("" = vault root). */
  onCreate: (kind: 'note' | 'folder', folder: string, name: string) => void;
  onOpenSettings: () => void;
}

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const parent = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Sidebar content: the notes tree, then new-note / new-folder buttons, then the vault footer. */
export default function NoteList({ notes, folders, selected, title, syncing, onOpen, onCreate, onOpenSettings }: NoteListProps) {
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

  const renderDir = (dir: string, depth: number) => (
    <>
      {folders
        .filter((f) => parent(f) === dir)
        .map((folder) => {
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
                style={({ pressed }) => [styles.row, { marginLeft: depth * 16 }, pressed && styles.pressed]}
              >
                <Icon name={open ? 'folder-open-outline' : 'folder-outline'} size={22} color={activeFolder === folder ? colors.accent : colors.textDim} />
                <Text style={[styles.label, activeFolder === folder && { color: colors.accent }]} numberOfLines={1}>
                  {basename(folder)}
                </Text>
              </Pressable>
              {open && renderDir(folder, depth + 1)}
            </View>
          );
        })}
      {notes
        .filter((n) => parent(n) === dir)
        .map((note) => (
          <Pressable
            key={note}
            onPress={() => onOpen(note)}
            style={({ pressed }) => [styles.row, { marginLeft: depth * 16 }, selected === note && styles.selected, pressed && styles.pressed]}
          >
            <Text style={[styles.label, { marginLeft: 4 }]} numberOfLines={1}>
              {basename(note).replace(/\.(md|markdown)$/i, '')}
            </Text>
          </Pressable>
        ))}
    </>
  );

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
        {renderDir('', 0)}
        {creating && (
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
        )}
        {notes.length === 0 && folders.length === 0 && !creating && <Text style={styles.empty}>No notes yet — tap the pencil to add one</Text>}
      </ScrollView>

      <View style={styles.toolbar}>
        <Pressable onPress={() => setCreating(creating === 'note' ? null : 'note')} hitSlop={10} style={styles.tool}>
          <Icon name="square-edit-outline" size={26} color={creating === 'note' ? colors.accent : colors.text} />
        </Pressable>
        <Pressable onPress={() => setCreating(creating === 'folder' ? null : 'folder')} hitSlop={10} style={styles.tool}>
          <Icon name="folder-plus-outline" size={26} color={creating === 'folder' ? colors.accent : colors.text} />
        </Pressable>
      </View>

      <View style={styles.footer}>
        <View style={{ flex: 1 }}>
          <Text style={styles.vault} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.counts}>
            {syncing ? 'syncing…' : `${plural(notes.length, 'file')}, ${plural(folders.length, 'folder')}`}
          </Text>
        </View>
        <Pressable onPress={onOpenSettings} hitSlop={10} style={styles.gear}>
          <Icon name="cog-outline" size={26} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 56 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 12, paddingBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 24 },
  selected: { backgroundColor: colors.panel },
  pressed: { backgroundColor: colors.panelHover },
  label: { color: colors.text, fontSize: 20, flex: 1 },
  empty: { color: colors.textFaint, padding: 16, fontSize: 15 },
  input: {
    color: colors.text,
    fontSize: 20,
    backgroundColor: colors.panel,
    borderRadius: 24,
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginTop: 4,
  },
  toolbar: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 14, paddingHorizontal: 20 },
  tool: { padding: 8 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 22, paddingTop: 6, paddingBottom: 30 },
  vault: { color: colors.heading, fontSize: 24, fontWeight: '700' },
  counts: { color: colors.textDim, fontSize: 14, marginTop: 2 },
  gear: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.panel, alignItems: 'center', justifyContent: 'center' },
});
