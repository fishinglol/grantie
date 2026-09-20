# Granite — mobile (Expo / React Native)

A phone version of the desktop app:
1. **Notes list** — the vault's folders and notes, "+ Note" / "+ Folder", and an
   account chip at the bottom (bottom sheet instead of the desktop hover menu).
2. **Live-preview editor** — the *same* editor as desktop (`@granite/live-editor`,
   CodeMirror 6) running inside a WebView. Edits autosave to the vault.
3. **Add an image** — pick a photo; it is copied to `<note folder>/assets/` and
   linked at the cursor.

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
- Touch: tapping an image selects it and the toolbar (zoom, `</>`) works, but the
  resize handle and drag-to-move are mouse-only for now.
- No moving notes between folders, and no paste/drag-in of files (photo picker only).

## Google Drive sync (needs a development build)

"Connect Drive" (account chip → sheet) signs in with Google and two-way syncs the vault with a
`Granite Vault` folder in your Drive, using the same engine as desktop (`@granite/core-cloud`),
so notes and `assets/` images flow between phone and desktop. It syncs on sign-in, every minute
while the app is open, when you return to the app, and after you leave a note or add an image.

Google only accepts a native app's own client ID, so this **does not work in Expo Go**:
1. Google Cloud console → Credentials → create an **iOS** (bundle id `ios.bundleIdentifier`) and/or
   **Android** (package name + SHA-1) OAuth client. Same project/consent screen as the desktop client.
2. Copy `.env.example` to `.env`, set `EXPO_PUBLIC_GOOGLE_CLIENT_ID`.
3. Build a dev client: `npx expo run:ios` / `npx expo run:android` (or EAS). `app.config.js`
   registers the reversed-client-ID redirect scheme.

Without a client ID the app works fully offline; Connect Drive just says it isn't configured.
The refresh token is kept in a file in the app sandbox (outside the vault), not the Keychain yet.
