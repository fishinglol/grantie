import { useEffect, useState } from 'react';
import { Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { BUILD_URL, fetchInstallCounts, installsLabel, permissionLines, pluginHue, type InstalledPlugin } from '@granite/plugins';
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
  /** Which page of the banner is showing (0: install, 1: build a plugin) and how wide the banner is. */
  const [slide, setSlide] = useState(0);
  const [bannerW, setBannerW] = useState(0);
  const { width } = useWindowDimensions();
  /** How many times each plugin has been installed (empty when the counter can't be reached). */
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    void fetchInstallCounts().then(setCounts);
  }, []);

  const label = (entry: CatalogPlugin) => {
    const have = installed.find((p) => p.manifest?.id === entry.manifest.id)?.manifest;
    return entry.manifest.soon ? 'SOON' : !have ? 'GET' : have.version !== entry.manifest.version ? 'UPDATE' : 'INSTALLED';
  };
  const getButton = (entry: CatalogPlugin) => {
    const text = label(entry);
    const done = text === 'INSTALLED' || text === 'SOON';
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
            ...(counts[m.id] > 0 ? [['INSTALLS', counts[m.id].toLocaleString('en-US')]] : []),
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
        {m.soon ? <Text style={styles.desc}>Coming soon. We are still working on it, so it can't be installed yet.</Text> : null}
        {m.setup && !m.soon ? (
          <>
            <Text style={styles.section}>Before you start</Text>
            {m.setup.map((step, i) => (
              <Text key={step} style={styles.step}>{i + 1}. {step}</Text>
            ))}
          </>
        ) : null}
        <Text style={styles.section}>Needs your permission to</Text>
        {permissionLines(m).length === 0 ? (
          <Text style={styles.perm}>Nothing. It needs no permissions.</Text>
        ) : (
          permissionLines(m).map((line) => (
            <Text key={line} style={styles.perm}>• {line}</Text>
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
      <View onLayout={(e) => setBannerW(e.nativeEvent.layout.width)}>
        {bannerW > 0 && (
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setSlide(Math.round(e.nativeEvent.contentOffset.x / bannerW))}
          >
            <View style={[styles.banner, { width: bannerW }]}>
              <Text style={styles.bannerKicker}>GRANITE PLUGINS</Text>
              <Text style={styles.bannerTitle}>Make your notes do more. Just install.</Text>
            </View>
            <View style={[styles.banner, { width: bannerW }]}>
              <Text style={styles.bannerKicker}>FOR DEVELOPERS</Text>
              <Text style={styles.bannerTitle}>Build a plugin for Granite</Text>
              <Text style={styles.bannerText}>One JavaScript file. Runs on desktop and phone. Get your own page and see how many people install it.</Text>
              <Pressable onPress={() => void Linking.openURL(BUILD_URL)} style={[styles.get, { alignSelf: 'flex-start', marginTop: 14 }]}>
                <Text style={styles.getText}>READ THE GUIDE</Text>
              </Pressable>
            </View>
          </ScrollView>
        )}
        <View style={styles.dots}>
          {[0, 1].map((i) => (
            <View key={i} style={[styles.dot, slide === i && styles.dotOn]} />
          ))}
        </View>
      </View>
      <Text style={styles.listTitle}>All Plugins</Text>
      {catalog.map((entry) => (
        <Pressable key={entry.manifest.id} onPress={() => setOpenId(entry.manifest.id)} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
          <Icon id={entry.manifest.id} name={entry.manifest.name} size={60} />
          <View style={styles.rowText}>
            <Text style={styles.rowAuthor}>{[entry.manifest.author ?? 'Community', installsLabel(counts[entry.manifest.id])].filter(Boolean).join(' · ')}</Text>
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
  bannerText: { color: colors.text, fontSize: 14, lineHeight: 20, marginTop: 8 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 7, marginTop: 8 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.panelHover },
  dotOn: { backgroundColor: colors.accent },
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
  step: { color: colors.text, fontSize: 15, lineHeight: 22, marginBottom: 6 },
  perm: { color: colors.textDim, fontSize: 14, lineHeight: 24 },
  zoom: { flex: 1, backgroundColor: 'rgba(4,5,8,0.92)', alignItems: 'center', justifyContent: 'center' },
});
