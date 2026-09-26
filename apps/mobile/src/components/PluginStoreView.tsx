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
  /** The "Build a plugin" page that invites people to write one. */
  const [buildOpen, setBuildOpen] = useState(false);
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

  if (buildOpen) {
    return (
      <View>
        <Pressable onPress={() => setBuildOpen(false)} style={styles.back} hitSlop={8}>
          <Text style={styles.backText}>‹ Store</Text>
        </Pressable>
        <View style={styles.head}>
          <Icon id="build" name="+" size={84} />
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>FOR DEVELOPERS</Text>
            <Text style={styles.title}>Build a plugin</Text>
            <Text style={styles.tagline}>One JavaScript file. The same on desktop and phone.</Text>
            <View style={styles.headGet}>
              <Pressable onPress={() => void Linking.openURL(BUILD_URL)} style={styles.get}>
                <Text style={styles.getText}>READ THE GUIDE</Text>
              </Pressable>
            </View>
          </View>
        </View>
        <Text style={styles.section}>Why build one</Text>
        <Text style={styles.perm}>• Write plain JavaScript once. It runs in the desktop app and the phone app.</Text>
        <Text style={styles.perm}>• A small API: commands, your own blocks inside a note, typing and paste hooks, link chips, a header button and vault access.</Text>
        <Text style={styles.perm}>• It runs in a sandbox and asks for permission, so people can trust it before turning it on.</Text>
        <Text style={styles.perm}>• Your plugin gets its own public page with your screenshots and a link to you, and the Store counts how many people install it.</Text>
        <Text style={styles.section}>How it works</Text>
        <Text style={styles.step}>1. Write a folder with a manifest.json and a main.js.</Text>
        <Text style={styles.step}>2. Try it in your own vault, no build step.</Text>
        <Text style={styles.step}>3. Send a pull request with three screenshots and a README.</Text>
        <Text style={styles.step}>4. Once it is reviewed and merged, it shows up here.</Text>
      </View>
    );
  }

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
      <View style={styles.banner}>
        <Text style={styles.bannerKicker}>GRANITE PLUGINS</Text>
        <Text style={styles.bannerTitle}>Make your notes do more. Just install.</Text>
        <Pressable onPress={() => setBuildOpen(true)} style={[styles.get, { alignSelf: 'flex-start', marginTop: 14 }]}>
          <Text style={styles.getText}>Build your own plugin</Text>
        </Pressable>
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
