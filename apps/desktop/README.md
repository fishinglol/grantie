# Granite — desktop (Tauri)

Local features (identical to the mobile app, same core module):
1. **Read + parse a local `.md` file** — via `@granite/core-notes` (`parseNote`).
2. **Insert an image** — pick a file, it is copied to `GraniteVault/assets/` and a
   relative `![alt](assets/…)` link is appended to the note.
3. **Open note…** — read any other Markdown file on disk.

Plus, since v0.2:

4. **A first page** — connect Google Drive, or choose "Continue without syncing".
5. **Two-way Drive sync** — notes *and* their images, between
   `~/Documents/GraniteVault` and a `Granite Vault` folder in your Drive.

## Run it

```bash
npm install                 # from the repo root (workspaces)
cd apps/desktop
npm run tauri dev           # launches the desktop window (first build compiles Rust, slow)
```

The app runs with no setup at all — the login page's **Continue without syncing**
takes you straight to your local vault. Drive sync needs a one-time OAuth client
(next section).

Build a distributable app bundle:

```bash
npm run tauri build         # -> src-tauri/target/release/bundle/
```

Prereqs: Rust toolchain (`rustup`) and Xcode Command Line Tools on macOS.

## Connecting Google Drive

Granite has no server and no Granite account. It talks to *your* Drive with *your*
own OAuth client, so you need to create one once:

1. <https://console.cloud.google.com/> → create or pick a project
2. **APIs & Services → Library** → enable **Google Drive API**
3. **APIs & Services → OAuth consent screen** → *External* → add your own Google
   address under **Test users**. Leave the app in *Testing* — no Google review is
   needed, because Granite only asks for the `drive.file` scope.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID** →
   application type **Desktop app**
5. `cp .env.example .env` and paste the client ID + secret in

Restart `npm run tauri dev` and the login page's Google button becomes live.

### What Granite can see

The only scope requested is **`drive.file`**: an app may touch *files it created
itself* and nothing else. Granite cannot list, read, or modify anything already in
your Drive — the API simply does not return it. That is also why the "Granite
Vault" folder is created by the app rather than picked from your existing folders.

The client *secret* for a Desktop-app client is not confidential (Google documents
it as such — it ships inside every copy of the binary). PKCE is what actually
protects the exchange, and Granite always sends one.

## How sync works

Two-way, file-level, every 60 seconds and after every edit:

| Situation | What happens |
| --- | --- |
| New note or image locally | Uploaded to `Granite Vault/` in Drive |
| New file appeared in Drive | Downloaded into `~/Documents/GraniteVault` |
| Changed on one side only | That side wins |
| Changed on **both** sides | **Both are kept** — the Drive copy is saved beside yours as `note (Drive copy 2026-09-03 14-05-09).md` |
| Deleted on one side | Restored from the other (see limitations) |

Images ride along with the notes: an `assets/photo.png` insert becomes
`Granite Vault/assets/photo.png` in Drive, and the note's relative
`![](assets/photo.png)` link keeps working on any device that has both.

The bookkeeping ("what did this file look like at the last clean sync") lives in
the OS app-config dir, *not* in the vault — the vault stays a clean folder of
`.md` files and their assets.

## How it's wired

```
src/App.tsx             the gate: restore session -> LoginPage or NoteApp
src/LoginPage.tsx       first page: Continue with Google / Continue without syncing
src/NoteApp.tsx         the note UI + the sync status chip in the header
src/googleLogin.ts      desktop half of the OAuth flow (loopback + system browser)
src/stores.ts           session + sync-index files in the OS app-config dir
src/vault.ts            creates GraniteVault/welcome.md in ~/Documents on first launch
src/tauriFs.ts          implements the FileSystem / VaultFileSystem ports
src-tauri/              Rust shell: fs + dialog + opener + http plugins, OAuth listener
@granite/core-notes     parsing + image-embed logic (shared with mobile, tested)
@granite/core-cloud     OAuth, the Drive provider, and the sync engine (tested)
```

Filesystem access is scoped to `$HOME`, `$DOCUMENT` and `$APPCONFIG` in
`src-tauri/capabilities/default.json`; HTTP is scoped to Google's two hosts in the
same file; local images render through Tauri's asset protocol (`convertFileSrc`),
scoped in `tauri.conf.json`.

### Why there is a tiny web server in the Rust side

Google's flow for installed apps redirects the *system browser* back to
`http://127.0.0.1:<port>/callback?code=…`. `src-tauri/src/lib.rs` binds a
loopback-only socket, hands the port to the frontend so it can build the auth URL,
and waits for that one request (5-minute timeout). ~90 lines of `std::net`, no
extra crate. Signing in happens in the real browser, with a real address bar —
never in a window Granite controls.

## Limitations to know about

- **Deletes do not propagate.** Deleting a note on one side makes the next sync
  restore it from the other. Removing a note is a two-place action for now. This
  is deliberate: one-sided delete propagation, layered on a file listing that can
  fail, is how sync engines eat vaults.
- **Merges are file-level, not text-level.** Two devices editing the same note
  between syncs produce a conflict *copy*, not a merged note. Merging the two
  edits is exactly what the planned Yjs CRDT engine (`packages/core-sync`) is for
  — the conflict branch in `VaultSync` is the seam it plugs into.
- **The Google refresh token is stored in plain text** in the app-config dir,
  protected only by your OS user account's file permissions. Moving it to the
  system keychain is a follow-up.
- Sync is polled every 60s while the app is open; there is no Drive change
  subscription and no background sync while the app is closed.
- Vault path is fixed (`~/Documents/GraniteVault`). Choosing an arbitrary vault
  folder and remembering it is future work.
- Path helpers assume `/` separators — macOS/Linux. Windows needs `\` handling in
  `@granite/core-notes`.
- Body rendering is a lightweight built-in pass (headings / lists / images).
  Swap in `markdown-it` when full Markdown rendering is needed.
