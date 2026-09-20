import { type ReactNode, useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { NoteRepository, type LoadedNote } from '@granite/core-notes';

import { expoFs } from './src/expoFs';
import { memFs } from './src/memFs';
import { ensureSampleVault } from './src/vault';

const isWeb = Platform.OS === 'web';
const fs = isWeb ? memFs : expoFs;
const repo = new NoteRepository(fs);

async function readBytes(uri: string): Promise<Uint8Array> {
  if (isWeb) return new Uint8Array(await (await fetch(uri)).arrayBuffer());
  return new File(uri).bytes();
}

export default function App() {
  const [path, setPath] = useState<string | null>(null);
  const [note, setNote] = useState<LoadedNote | null>(null);
  const [status, setStatus] = useState('Starting…');
  const [busy, setBusy] = useState(false);
  const [external, setExternal] = useState(false);

  const load = useCallback(async (uri: string, isExternal = false) => {
    setBusy(true);
    try {
      setNote(await repo.load(uri));
      setPath(uri);
      setExternal(isExternal);
      setStatus(`Read + parsed ${uri.split('/').pop()}`);
    } catch (err) {
      setStatus(`Error: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    ensureSampleVault(fs).then((uri) => load(uri));
  }, [load]);

  const insertImage = useCallback(async () => {
    if (!path) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setStatus('Photo permission denied');
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({ quality: 1 });
    if (picked.canceled) return;
    const asset = picked.assets[0];
    if (!asset) return;

    setBusy(true);
    try {
      const data = await readBytes(asset.uri);
      const res = await repo.insertImage({
        notePath: path,
        image: { fileName: asset.fileName ?? `image${extFromMime(asset.mimeType)}`, data },
        altText: asset.fileName ?? 'image',
      });
      setNote(res.note);
      setStatus(`Inserted ${res.markdown}  →  wrote ${res.imagePath.split('/vault/').pop()}`);
    } catch (err) {
      setStatus(`Error: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [path]);

  const openExternal = useCallback(async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: ['text/markdown', 'text/plain', 'public.text', '*/*'],
      copyToCacheDirectory: true,
    });
    if (res.canceled) return;
    const file = res.assets[0];
    if (!file) return;
    if (isWeb) await memFs.writeTextFile(file.uri, await (await fetch(file.uri)).text());
    load(file.uri, true);
  }, [load]);

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.title}>Granite</Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {path ? path.replace(/^.*\/Documents\//, '…/') : '—'}
        </Text>
      </View>

      <View style={styles.toolbar}>
        <Button label="Reload" onPress={() => path && load(path, external)} disabled={busy || !path} />
        <Button label="Insert image" onPress={insertImage} disabled={busy || !path || external} />
        <Button label="Open .md…" onPress={openExternal} disabled={busy} />
      </View>

      <View style={styles.statusBar}>
        {busy && <ActivityIndicator size="small" color="#e8935f" />}
        <Text style={styles.statusText} numberOfLines={2}>{status}</Text>
      </View>

      {external && (
        <Text style={styles.warn}>
          Opened a copy — edits to external files aren&apos;t saved back yet (needs
          persistent folder access; tracked with the sync milestone).
        </Text>
      )}

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {note ? (
          <Section title="Raw file">
            <Text style={styles.raw}>{note.raw}</Text>
          </Section>
        ) : (
          <Text style={styles.dim}>No note loaded</Text>
        )}
      </ScrollView>
    </View>
  );
}

function extFromMime(mime?: string): string {
  if (!mime) return '.jpg';
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/heic': '.heic',
    'image/webp': '.webp',
    'image/gif': '.gif',
  };
  return map[mime] ?? '.jpg';
}

const Button = ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    style={({ pressed }) => [styles.btn, disabled && styles.btnDisabled, pressed && styles.btnPressed]}
  >
    <Text style={styles.btnText}>{label}</Text>
  </Pressable>
);

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {children}
  </View>
);

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#1b1f2a' },
  header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 12 },
  title: { color: '#e8935f', fontSize: 30, fontWeight: '700' },
  subtitle: { color: '#8b93a7', fontSize: 12, marginTop: 2 },
  toolbar: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  btn: { backgroundColor: '#2b3040', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, flex: 1 },
  btnDisabled: { opacity: 0.4 },
  btnPressed: { backgroundColor: '#3a4055' },
  btnText: { color: '#e6e9f0', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  statusBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 10 },
  statusText: { color: '#8b93a7', fontSize: 12, flex: 1 },
  warn: { color: '#d9a441', fontSize: 12, paddingHorizontal: 20, paddingBottom: 8 },
  body: { flex: 1, backgroundColor: '#0f1219' },
  bodyContent: { padding: 20, paddingBottom: 60 },
  dim: { color: '#5c6474' },
  section: { marginBottom: 22 },
  sectionTitle: { color: '#e8935f', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  raw: { color: '#7f88a0', fontFamily: 'Courier', fontSize: 11, lineHeight: 16 },
});
