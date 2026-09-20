# Granite — mobile (Expo / React Native)

First-pass local features:
1. **Read + parse a local `.md` file** — via `@granite/core-notes` (`parseNote`),
   shown as raw text.
2. **Insert an image** — pick a photo, it is copied to `vault/assets/` and a
   relative `![alt](assets/…)` link is appended to the note.

## Run it

```bash
npm install          # from the repo root (workspaces)
cd apps/mobile
npx expo start
```

Then open in **Expo Go** on a real phone (scan the QR), or press `i` / `a` for a
simulator if you have Xcode / Android Studio.

### Web preview (fast iteration, no phone)

```bash
npm run web
```

Runs the real UI + real `@granite/core-notes` in a browser, backed by an
in-memory filesystem ([`src/memFs.ts`](src/memFs.ts)) since `expo-file-system`
has no web support. Nothing persists across reloads. Handy for working on the UI;
the actual storage path is native only.

## How it's wired

```
App.tsx                 UI only
src/vault.ts            creates a sample vault (Paths.document on native, memory on web)
src/expoFs.ts           FileSystem port impl with expo-file-system   (native)
src/memFs.ts            FileSystem port impl, in-memory               (web preview)
@granite/core-notes     all parsing + image-embed logic (platform-agnostic, tested)
```

The app contains **no markdown logic** — it calls `NoteRepository.load()` and
`NoteRepository.insertImage()`. The desktop app will do the same with a Tauri
`FileSystem` adapter.

## First-pass limitations

- The "vault" is a folder inside the app's sandbox (`Paths.document/vault`).
  Opening an arbitrary folder from Files / Google Drive with **persistent**
  read-write access (iOS security-scoped bookmarks, Android SAF) is deferred —
  it belongs with the sync milestone.
- **Open .md…** loads a temporary copy; edits to external files are not saved
  back yet.
- Body rendering is a lightweight built-in pass (headings / lists / images).
  Swap in `react-native-markdown-display` when full Markdown rendering is needed.
