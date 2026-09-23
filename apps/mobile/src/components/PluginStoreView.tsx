import { useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { PERMISSION_LABELS, pluginHue, type InstalledPlugin } from '@granite/plugins';
import { colors } from '../theme';
import type { CatalogPlugin } from '../catalog';

export interface PluginStoreViewProps {
  catalog: CatalogPlugin[];
  installed: InstalledPlugin[];
  onInstall: (entry: CatalogPlugin) => Promise<void>;
}

function Icon({ id, name, size }: { id: string; name: string; size: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.225, backgroundColor: `hsl(${pluginHue(id)}, 66%, 50%)`, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontSize: size * 0.46, fontWeight: '700' }}>{name.trim()[0]?.toUpperCase()}</Text>
    </View>
  );
}

/** The phone's plugin Store, laid out like an app store: a list with GET buttons, and a page per plugin with its pictures. */
export default function PluginStoreView({ catalog, installed, onInstall }: PluginStoreViewProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<CatalogPlugin['screenshots'][number] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { width } = useWindowDimensions();

  const label = (entry: CatalogPlugin) => {
    const have = installed.find((p) => p.manifest?.id === entry.manifest.id)?.manifest;
    return !have ? 'GET' : have.version !== entry.manifest.version ? 'UPDATE' : 'INSTALLED';
  };
  const getButton = (entry: CatalogPlugin) => {
    const text = label(entry);
    const done = text === 'INSTALLED';
    return (
      <Pressable
        disabled={done || busy !== null}
        onPress={() => {
          setBusy(entry.manifest.id);
          void onInstall(entry).finally(() => setBusy(null));
        }}
        style={[styles.get, done && styles.getDone]}
      >
        <Text style={[styles.getText, done && styles.getTextDone]}>{busy === entry.manifest.id ? '…' : text}</Text>
      </Pressable>
    );
  };

  const open = catalog.find((c) => c.manifest.id === openId);
  if (open) {
    const m = open.manifest;
    const shotW = Math.min(width * 0.78, 360);
    return (
      <View>
        <Pressable onPress={() => setOpenId(null)} style={styles.back} hitSlop={8}>
          <Text style={styles.backText}>‹ Store</Text>
        </Pressable>
        <View style={styles.head}>
          <Icon id={m.id} name={m.name} size={84} />
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>{(m.author ?? 'Community').toUpperCase()}</Text>
            <Text style={styles.title}>{m.name}</Text>
            {m.tagline ? <Text style={styles.tagline}>{m.tagline}</Text> : null}
            <View style={styles.headGet}>{getButton(open)}</View>
          </View>
        </View>
        <View style={styles.facts}>
          {[
            ['VERSION', m.version],
            ['DEVELOPER', m.author ?? '—'],
            ['PERMISSIONS', String(m.permissions.length)],
          ].map(([k, v], i) => (
            <View key={k} style={[styles.fact, i > 0 && styles.factBorder]}>
              <Text style={styles.factKey}>{k}</Text>
              <Text style={styles.factVal} numberOfLines={1}>{v}</Text>
            </View>
          ))}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shots}>
          {open.screenshots.map((src, i) => (
            <Pressable key={i} onPress={() => setZoom(src)}>
              <Image source={src} style={{ width: shotW, height: shotW * 0.625, borderRadius: 12 }} resizeMode="cover" />
            </Pressable>
          ))}
        </ScrollView>
        {m.description ? <Text style={styles.desc}>{m.description}</Text> : null}
        <Text style={styles.section}>Needs your permission to</Text>
        {m.permissions.length === 0 ? (
          <Text style={styles.perm}>Nothing. It needs no permissions.</Text>
        ) : (
          m.permissions.map((p) => (
            <Text key={p} style={styles.perm}>• {PERMISSION_LABELS[p]}</Text>
          ))
        )}
        <Modal visible={zoom !== null} transparent animationType="fade" onRequestClose={() => setZoom(null)}>
          <Pressable style={styles.zoom} onPress={() => setZoom(null)}>
            {zoom !== null && <Image source={zoom} style={{ width: width - 24, height: (width - 24) * 0.625 }} resizeMode="contain" />}
          </Pressable>
        </Modal>
      </View>
    );
  }

  return (
    <View>
      <View style={styles.banner}>
        <Text style={styles.bannerKicker}>GRANITE PLUGINS</Text>
        <Text style={styles.bannerTitle}>Make your notes do more. Just install.</Text>
      </View>
      <Text style={styles.listTitle}>All Plugins</Text>
      {catalog.map((entry) => (
        <Pressable key={entry.manifest.id} onPress={() => setOpenId(entry.manifest.id)} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
          <Icon id={entry.manifest.id} name={entry.manifest.name} size={60} />
          <View style={styles.rowText}>
            <Text style={styles.rowAuthor}>{entry.manifest.author ?? 'Community'}</Text>
            <Text style={styles.rowName}>{entry.manifest.name}</Text>
            <Text style={styles.rowTag} numberOfLines={1}>{entry.manifest.tagline ?? entry.manifest.description}</Text>
          </View>
          {getButton(entry)}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: colors.panel, borderRadius: 20, padding: 20, marginBottom: 6, borderWidth: 1, borderColor: colors.panelHover },
  bannerKicker: { color: colors.accent, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  bannerTitle: { color: colors.heading, fontSize: 24, fontWeight: '800', lineHeight: 28, marginTop: 6 },
  listTitle: { color: colors.heading, fontSize: 20, fontWeight: '700', marginTop: 16, marginBottom: 4, paddingHorizontal: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.panelHover, borderRadius: 12 },
  rowPressed: { backgroundColor: colors.panel },
  rowText: { flex: 1 },
  rowAuthor: { color: colors.textDim, fontSize: 12 },
  rowName: { color: colors.heading, fontSize: 17, fontWeight: '700' },
  rowTag: { color: colors.textDim, fontSize: 13 },
  get: { backgroundColor: colors.accent, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 16, minWidth: 74, alignItems: 'center' },
  getDone: { backgroundColor: colors.panelHover },
  getText: { color: colors.bg, fontSize: 13, fontWeight: '800', letterSpacing: 0.4 },
  getTextDone: { color: colors.textDim },
  back: { paddingVertical: 6, paddingHorizontal: 4, alignSelf: 'flex-start' },
  backText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 6, backgroundColor: colors.panel, borderRadius: 20, padding: 16 },
  kicker: { color: colors.accent, fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  title: { color: colors.heading, fontSize: 26, fontWeight: '800' },
  tagline: { color: colors.text, fontSize: 14, marginTop: 2 },
  headGet: { alignItems: 'flex-start', marginTop: 10 },
  facts: { flexDirection: 'row', marginVertical: 14 },
  fact: { flex: 1, alignItems: 'center', gap: 4, paddingHorizontal: 6 },
  factBorder: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.panelHover },
  factKey: { color: colors.textDim, fontSize: 10, fontWeight: '700', letterSpacing: 0.6 },
  factVal: { color: colors.text, fontSize: 16, fontWeight: '700' },
  shots: { gap: 10, paddingVertical: 4, paddingRight: 8 },
  desc: { color: colors.text, fontSize: 15, lineHeight: 22, marginTop: 14 },
  section: { color: colors.heading, fontSize: 17, fontWeight: '700', marginTop: 18, marginBottom: 6 },
  perm: { color: colors.textDim, fontSize: 14, lineHeight: 24 },
  zoom: { flex: 1, backgroundColor: 'rgba(4,5,8,0.92)', alignItems: 'center', justifyContent: 'center' },
});
