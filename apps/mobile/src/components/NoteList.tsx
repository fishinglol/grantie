import { Fragment, useRef, useState } from 'react';
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../theme';
import { noteTitle } from '@granite/core-notes';
import { nameOf, parentOf, visibleRows } from '../tree';
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
  onCreate: (kind: 'note' | 'folder' | 'canvas', folder: string, name: string) => void;
  /** A note was dragged into `folder` ("" = vault root). */
  onMove: (note: string, folder: string) => void;
  /** A folder was long-pressed: the app offers to move or delete it. */
  onFolderMenu: (folder: string) => void;
  onOpenSettings: () => void;
}

/** Every row is this tall, so the row under a finger is plain arithmetic. */
const ROW = 52;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Sidebar content: the notes tree, then new-note / new-folder buttons, then the vault footer.
 * Long-press a note and drag it onto a folder (or onto the list's background for the vault root);
 * long-press a folder for its move / delete menu.
 */
export default function NoteList({ notes, folders, selected, title, syncing, onOpen, onCreate, onMove, onFolderMenu, onOpenSettings }: NoteListProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /** Folder new notes/folders land in: the last one tapped, "" = vault root. */
  const [tapped, setActiveFolder] = useState('');
  /** A folder that was moved or deleted no longer counts as the target for new notes. */
  const activeFolder = tapped === '' || folders.includes(tapped) ? tapped : '';
  const [creating, setCreating] = useState<'note' | 'folder' | 'canvas' | null>(null);
  const [name, setName] = useState('');
  /** Note being dragged, where the finger is, and the folder ("" = root) it would land in. */
  const [dragging, setDragging] = useState<{ note: string; x: number; y: number; over: string } | null>(null);

  const rows = visibleRows(notes, folders, collapsed);
  const allCollapsed = folders.length > 0 && folders.every((f) => collapsed.has(f));
  const wrap = useRef<View>(null);
  const scrollY = useRef(0);
  const listTop = useRef(0);
  const drag = useRef<string | null>(null);
  const panning = useRef(false);
  const latest = useRef({ rows, onMove });
  latest.current = { rows, onMove };

  const targetAt = (pageY: number): string => {
    const row = latest.current.rows[Math.floor((pageY - listTop.current + scrollY.current) / ROW)];
    if (!row) return '';
    return row.kind === 'folder' ? row.rel : parentOf(row.rel);
  };
  const endDrag = () => {
    drag.current = null;
    panning.current = false;
    setDragging(null);
  };
  const pan = useRef(
    PanResponder.create({
      // Once a long-press has picked a note up, take over the gesture from the row and the list.
      onMoveShouldSetPanResponderCapture: () => drag.current !== null,
      onPanResponderGrant: () => {
        panning.current = true;
      },
      onPanResponderMove: (_, g) => setDragging((d) => d && { ...d, x: g.moveX, y: g.moveY, over: targetAt(g.moveY) }),
      onPanResponderRelease: (_, g) => {
        const note = drag.current;
        const target = targetAt(g.moveY);
        endDrag();
        if (note && target !== parentOf(note)) latest.current.onMove(note, target);
      },
      onPanResponderTerminate: endDrag,
    }),
  ).current;

  const startDrag = (note: string, x: number, y: number) => {
    wrap.current?.measureInWindow((_x, top) => {
      listTop.current = top;
      drag.current = note;
      setDragging({ note, x, y, over: targetAt(y) });
    });
  };

  /** Start (or cancel) creating: the target folder is opened, so the name is typed, and the result appears, inside it. */
  const startCreating = (kind: 'note' | 'folder' | 'canvas') => {
    setCreating(creating === kind ? null : kind);
    if (activeFolder) setCollapsed((prev) => (prev.has(activeFolder) ? new Set([...prev].filter((f) => f !== activeFolder)) : prev));
  };

  const commit = () => {
    const trimmed = name.trim();
    if (creating && trimmed) onCreate(creating, activeFolder, trimmed);
    setCreating(null);
    setName('');
  };

  const nameInput = (depth = 0) => (
    <TextInput
      autoFocus
      value={name}
      onChangeText={setName}
      onSubmitEditing={commit}
      placeholder={creating === 'note' ? 'Note name' : creating === 'canvas' ? 'Canvas name' : 'Folder name'}
      placeholderTextColor={colors.textFaint}
      style={[styles.input, { marginLeft: depth * 16 }]}
      returnKeyType="done"
    />
  );
  /** The name is typed under the target folder's row; when that row is hidden (inside a collapsed folder) it goes at the end. */
  const inputUnder = rows.some((r) => r.kind === 'folder' && r.rel === activeFolder) ? activeFolder : '';

  const toggle = (folder: string) => {
    setActiveFolder(folder);
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  };

  return (
    <View style={styles.screen}>
      <View ref={wrap} style={styles.listWrap} {...pan.panHandlers}>
        <ScrollView
          style={[styles.list, dragging?.over === '' && styles.rootTarget]}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={!dragging}
          scrollEventThrottle={16}
          onScroll={(e) => {
            scrollY.current = e.nativeEvent.contentOffset.y;
          }}
        >
          {rows.map((row) =>
            row.kind === 'folder' ? (
              <Fragment key={row.rel}>
                <Pressable
                  onPress={() => toggle(row.rel)}
                  onLongPress={() => onFolderMenu(row.rel)}
                  delayLongPress={350}
                  style={({ pressed }) => [styles.row, { marginLeft: row.depth * 16 }, dragging?.over === row.rel && styles.dropTarget, pressed && styles.pressed]}
                >
                  <Icon name={row.open ? 'folder-open-outline' : 'folder-outline'} size={22} color={activeFolder === row.rel ? colors.accent : colors.textDim} />
                  <Text style={[styles.label, activeFolder === row.rel && { color: colors.accent }]} numberOfLines={1}>
                    {nameOf(row.rel)}
                  </Text>
                </Pressable>
                {creating && inputUnder === row.rel && nameInput(row.depth + 1)}
              </Fragment>
            ) : (
              <Pressable
                key={row.rel}
                onPress={() => onOpen(row.rel)}
                onLongPress={(e) => startDrag(row.rel, e.nativeEvent.pageX, e.nativeEvent.pageY)}
                delayLongPress={350}
                onPressOut={() => setTimeout(() => !panning.current && drag.current && endDrag(), 60)}
                style={({ pressed }) => [
                  styles.row,
                  { marginLeft: row.depth * 16 },
                  selected === row.rel && styles.selected,
                  dragging?.note === row.rel && styles.lifted,
                  pressed && styles.pressed,
                ]}
              >
                {row.rel.toLowerCase().endsWith('.canvas') && <Icon name="view-grid-outline" size={20} color={colors.textDim} />}
                <Text style={[styles.label, { marginLeft: 4 }]} numberOfLines={1}>
                  {noteTitle(nameOf(row.rel))}
                </Text>
              </Pressable>
            ),
          )}
          {creating && inputUnder === '' && nameInput()}
          {notes.length === 0 && folders.length === 0 && !creating && <Text style={styles.empty}>No notes yet — tap the pencil to add one</Text>}
        </ScrollView>
      </View>

      <View style={styles.toolbar}>
        <Pressable onPress={() => startCreating('note')} hitSlop={10} style={styles.tool}>
          <Icon name="square-edit-outline" size={26} color={creating === 'note' ? colors.accent : colors.text} />
        </Pressable>
        <Pressable onPress={() => startCreating('folder')} hitSlop={10} style={styles.tool}>
          <Icon name="folder-plus-outline" size={26} color={creating === 'folder' ? colors.accent : colors.text} />
        </Pressable>
        <Pressable onPress={() => startCreating('canvas')} hitSlop={10} style={styles.tool} accessibilityLabel="New canvas">
          <Icon name="view-grid-plus-outline" size={26} color={creating === 'canvas' ? colors.accent : colors.text} />
        </Pressable>
        {folders.length > 0 && (
          <Pressable onPress={() => setCollapsed(allCollapsed ? new Set() : new Set(folders))} hitSlop={10} style={styles.tool}>
            <Icon name={allCollapsed ? 'expand-all-outline' : 'collapse-all-outline'} size={26} />
          </Pressable>
        )}
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

      {dragging && (
        <View style={[styles.ghost, { left: dragging.x - 70, top: dragging.y - 70 }]} pointerEvents="none">
          <Text style={styles.ghostText} numberOfLines={1}>
            {noteTitle(nameOf(dragging.note))}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 56 },
  listWrap: { flex: 1 },
  list: { flex: 1 },
  rootTarget: { backgroundColor: 'rgba(232, 147, 95, 0.06)' },
  listContent: { paddingHorizontal: 12, paddingBottom: 12 },
  row: { height: ROW, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, borderRadius: 24 },
  dropTarget: { backgroundColor: 'rgba(232, 147, 95, 0.22)' },
  lifted: { opacity: 0.35 },
  ghost: {
    position: 'absolute',
    width: 140,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: colors.panelHover,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  ghostText: { color: colors.text, fontSize: 16 },
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
