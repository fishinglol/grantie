# Granite — mobile (Expo / React Native)

A phone version of the desktop app:
1. **Sidebar** — slides in from the left (round button, top left): the vault's folders and notes,
   new-note / new-folder icons, and the vault name with a gear that opens the account sheet.
   The layout follows the mobile Obsidian app.
2. **Live-preview editor** — the *same* editor as desktop (`@granite/live-editor`,
   CodeMirror 6) running inside a WebView. Edits autosave to the vault.
3. **Moving notes** — long-press a note in the sidebar and drag it onto a folder (or the list background for
   the vault's top level), or use ⋮ → *Move file* and pick a folder or subfolder. Relative image links are
   rewritten so they keep pointing at the same files (`relocateLinks`, shared with desktop).
4. **⋮ menu** (top right) — *Move file*, *Add image* (pick a photo; it is copied to `<note folder>/assets/`
   and linked at the cursor) and *Share note*.

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
- No paste/drag-in of files (photo picker only).
- Moving a note while signed in to Drive: deletes don't sync yet, so the old copy may come back (same known risk as desktop).

## Plugins

Gear → **Plugins** lists plugins found in `<vault>/.granite/plugins/` (they arrive through Drive sync from your
computer). Switch a plugin on (per device) and run its commands; they run in a sandbox inside the editor page and
need the permissions shown on the card. Try `examples/plugins/hello-granite`. Details: `memory-bank/pluginDesign.md`.

## Google Drive sync

"Connect Drive" (gear in the sidebar → sheet) signs in with Google and two-way syncs the vault with a
`Granite Vault` folder in your Drive, using the same engine as desktop (`@granite/core-cloud`),
so notes and `assets/` images flow between phone and desktop. It pushes a moment after you stop typing, checks Drive for changes every 5 seconds while the app is open
(one cheap request; a full sync only runs if something changed), and syncs when you return to the app.
Deleting a note (⋮ → Delete file) also moves its Drive copy to the Drive trash and removes it on your other devices.

Sign-in uses Google's **device-code flow**: the app shows a code, you open google.com/device (any
browser, any device), type the code and approve. Nothing redirects back into the app, so it works in
**Expo Go** with no development build.

One-time setup (same Google Cloud project as the desktop client):
1. Credentials → Create credentials → OAuth client ID → application type **TVs and Limited Input devices**.
2. Copy `.env.example` to `.env` and paste the client ID and secret.
3. Restart Expo with a clean cache: `npx expo start -c`.
4. If the consent screen is in "Testing", add your Google account as a test user.

Without a client ID the app works fully offline; Connect Drive just says it isn't configured.
The refresh token is kept in a file in the app sandbox (outside the vault), not the Keychain yet.
