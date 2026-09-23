import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { PERMISSION_LABELS, PLUGINS_DIR, type CommandInfo, type InstalledPlugin } from '@granite/plugins';
import { colors } from '../theme';
import type { CatalogPlugin } from '../catalog';
import PluginStoreView from './PluginStoreView';

export interface PluginsSheetProps {
  visible: boolean;
  installed: InstalledPlugin[];
  enabled: string[];
  /** Why an enabled plugin didn't start, by plugin id. */
  errors: Record<string, string>;
  /** Commands the running plugins registered (only exist while a note is open). */
  commands: CommandInfo[];
  hasNote: boolean;
  /** Plugins the Store can install (bundled with the app). */
  catalog: CatalogPlugin[];
  onInstall: (entry: CatalogPlugin) => Promise<void>;
  onToggle: (id: string, on: boolean) => void;
  onRun: (command: CommandInfo) => void;
  onRefresh: () => void;
  onClose: () => void;
}

/** The phone's Plugins screen: what is installed, switch on/off, and run commands. */
export default function PluginsSheet({ visible, installed, enabled, errors, commands, hasNote, catalog, onInstall, onToggle, onRun, onRefresh, onClose }: PluginsSheetProps) {
  const [tab, setTab] = useState<'installed' | 'store'>('installed');
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <Text style={styles.title}>Plugins</Text>
        <View style={styles.tabs}>
          {(['installed', 'store'] as const).map((t) => (
            <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabOn]}>
              <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{t === 'installed' ? 'Installed' : 'Store'}</Text>
            </Pressable>
          ))}
        </View>
        <ScrollView style={styles.list} bounces={false}>
          {tab === 'store' && <PluginStoreView catalog={catalog} installed={installed} onInstall={onInstall} />}
          {tab === 'installed' && installed.length === 0 && (
            <Text style={styles.empty}>
              No plugins installed yet. Open the Store tab to add one (or add a plugin folder to {PLUGINS_DIR}/ in your vault on your
              computer; it syncs here through Drive, then tap Refresh).
            </Text>
          )}
          {tab === 'installed' && installed.map((plugin) => {
            const m = plugin.manifest;
            if (!m) {
              return (
                <View key={plugin.folder} style={[styles.card, styles.broken]}>
                  <Text style={styles.name}>{plugin.folder}</Text>
                  <Text style={styles.error}>Can't load: {plugin.error}</Text>
                </View>
              );
            }
            const on = enabled.includes(m.id);
            const mine = commands.filter((c) => c.pluginId === m.id);
            return (
              <View key={m.id} style={styles.card}>
                <View style={styles.head}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>
                      {m.name} <Text style={styles.version}>v{m.version}</Text>
                    </Text>
                    {m.author ? <Text style={styles.version}>{m.author}</Text> : null}
                  </View>
                  {m.desktopOnly ? (
                    <Text style={styles.version}>Desktop only</Text>
                  ) : (
                    <Switch
                      value={on}
                      onValueChange={(v) => onToggle(m.id, v)}
                      trackColor={{ true: colors.accent, false: colors.panelHover }}
                    />
                  )}
                </View>
                {m.description ? <Text style={styles.desc}>{m.description}</Text> : null}
                <View style={styles.perms}>
                  {m.permissions.length === 0 ? (
                    <Text style={styles.perm}>Needs no permissions</Text>
                  ) : (
                    m.permissions.map((p) => (
                      <Text key={p} style={styles.perm}>
                        {PERMISSION_LABELS[p]}
                      </Text>
                    ))
                  )}
                </View>
                {errors[m.id] ? <Text style={styles.error}>Couldn't start: {errors[m.id]}</Text> : null}
                {on && !m.desktopOnly && !hasNote ? <Text style={styles.version}>Open a note to use its commands.</Text> : null}
                {on && mine.length > 0 && (
                  <View style={styles.commands}>
                    {mine.map((c) => (
                      <Pressable key={c.id} onPress={() => onRun(c)} style={({ pressed }) => [styles.command, pressed && styles.pressed]}>
                        <Text style={styles.commandText}>{c.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
        <View style={styles.actions}>
          <Pressable onPress={onRefresh} style={styles.secondary}>
            <Text style={styles.secondaryText}>Refresh</Text>
          </Pressable>
          <Pressable onPress={onClose} style={styles.primary}>
            <Text style={styles.primaryText}>Done</Text>
          </Pressable>
        </View>
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
    paddingBottom: 30,
    paddingHorizontal: 14,
    maxHeight: '92%',
  },
  grabber: { alignSelf: 'center', width: 44, height: 4, borderRadius: 2, backgroundColor: colors.panelHover, marginBottom: 10 },
  title: { color: colors.heading, fontSize: 22, fontWeight: '700', paddingHorizontal: 8, paddingBottom: 10 },
  tabs: { flexDirection: 'row', backgroundColor: colors.panel, borderRadius: 12, padding: 3, marginBottom: 10 },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 10 },
  tabOn: { backgroundColor: colors.bg },
  tabText: { color: colors.textDim, fontSize: 15, fontWeight: '600' },
  tabTextOn: { color: colors.heading },
  list: { flexGrow: 0 },
  empty: { color: colors.textDim, fontSize: 15, lineHeight: 22, padding: 8 },
  card: { backgroundColor: colors.panel, borderRadius: 18, padding: 14, marginBottom: 10, gap: 8 },
  broken: { backgroundColor: 'rgba(224,120,122,0.14)' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { color: colors.heading, fontSize: 17, fontWeight: '700' },
  version: { color: colors.textDim, fontSize: 13, fontWeight: '400' },
  desc: { color: colors.text, fontSize: 14 },
  perms: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  perm: { color: colors.textDim, fontSize: 12, backgroundColor: colors.bg, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10, overflow: 'hidden' },
  error: { color: colors.danger, fontSize: 13 },
  commands: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  command: { backgroundColor: colors.panelHover, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14 },
  pressed: { backgroundColor: colors.accent },
  commandText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 10, paddingTop: 8 },
  secondary: { flex: 1, backgroundColor: colors.panel, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  secondaryText: { color: colors.text, fontSize: 16, fontWeight: '600' },
  primary: { flex: 1, backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  primaryText: { color: colors.bg, fontSize: 16, fontWeight: '700' },
});
