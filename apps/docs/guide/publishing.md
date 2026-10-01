# Publishing to the Store

Granite's plugin Store is a **reviewed store**, not an open, self-serve upload: every plugin listed in it has
had its code read and approved. Your plugin lives in **your own GitHub repo**, and the reviewed list is a
separate repo, [`granite-plugins`](https://github.com/fishinglol/granite-plugins), that pins the exact version
that was approved.

## How the Store is built

The Store shows two kinds of plugin:

- **Registry plugins** (community plugins, the normal path). Each is a repo of its author's own. The
  registry's `plugins.json` lists, for each one, the repo, a **full commit SHA**, and the SHA-256 of that
  commit's `manifest.json` and `main.js`. When someone presses **GET**, the app downloads those two files from
  `raw.githubusercontent.com/<repo>/<commit>/…` and **refuses any file that doesn't match its hash**.
  Changing your repo (or moving a tag) changes nothing for users until a new entry is reviewed and merged.
- **Built-in plugins.** The folders in
  [`examples/plugins/`](https://github.com/fishinglol/grantie/tree/main/examples/plugins) in the Granite repo
  ship inside the app. These are Granite's own and the reference examples. They reach users with an app release.

The desktop Store reads the registry when it opens (offline, it shows the built-in ones). A plugin installed
on desktop is written into your vault, so it syncs to your phone like any other plugin; the phone's own Store
doesn't read the registry yet.

## Listing your plugin

1. **Put your plugin in a repo of your own** with, at the top level: `manifest.json`, `main.js`, a
   `README.md`, a licence, and **at least 3 screenshots** in `screenshots/` (`.png`, `.jpg` or `.webp`).
   Real captures of it running, not mockups. Start from [Getting started](/guide/getting-started) and
   [The manifest](/guide/manifest). The plugin must be plain, readable JavaScript.
2. **Commit it**, and note the full 40-character commit SHA (`git rev-parse HEAD`).
3. **Fork [`granite-plugins`](https://github.com/fishinglol/granite-plugins)** and run
   `node scripts/registry.mjs pin <owner/name> <commit>`. It reads your files at that commit and adds one entry
   to `plugins.json` with the hashes. (`--local <dir>` reads a checkout on your machine instead.)
4. **Open a pull request.** CI runs `node scripts/registry.mjs verify`: it re-downloads your files at the
   pinned commit and checks that they match, that the manifest's `id` is the entry's `id`, and that there are
   at least 3 screenshots. Then a maintainer **reads `main.js` at that commit** before merging.
5. **Once merged**, your plugin appears in the Store's list, with your name, screenshots and the permissions it
   asks for, and a **SOURCE** line showing your repo.

## Updating a listed plugin

Raise `version` in `manifest.json`, commit, and open a new pull request that runs `pin` with the new commit
(it replaces your entry). The Store's **Update** button appears when the listed version differs from what a
user has installed, so a change without a version bump is invisible to anyone who already installed it. Users
get the new version only after it has been reviewed and merged.

## Not yet for registry plugins

The public plugin pages on this site (`/plugins/<id>`) and the install counter are built from the built-in
plugins only. A registry plugin has its own repo page on GitHub for now.

## Contributing to the built-in plugins

To fix or extend one of Granite's own plugins, fork the Granite repo and change its folder under
`examples/plugins/<id>/` (raise `version`, keep 3 screenshots and the `README.md`), run
`npm run check-plugins -w @granite/plugins` and open a pull request. The clash check starts every plugin in that
folder and fails if two of them draw the same ```` ```lang ```` blocks, answer the same typed text or draw chips
for the same site, or if one registers something its manifest has no permission for. On a pull request, CI also
fails when a built-in plugin's files changed but its `version` didn't. Try your own plugin next to the built-in
ones for the same reason: a clash means only one of the two would ever work, so pick another block name.

## Public plugin pages

Every built-in plugin also gets a page of its own on this site (`/plugins/<id>`), built from its folder: its
name and tagline, its screenshots, the permissions it asks for, its `author` (linked to `homepage` if set), and how
many times it has been installed. The page previews with the first screenshot when shared. Nothing extra to submit:
it appears once the pull request is merged and the site rebuilds.

## What reviewers look for

Since the sandbox already constrains what a plugin's code *can* do, review mostly checks:

- **Permissions match behavior** — nothing asked for that the code doesn't use, and nothing the code needs
  left undeclared.
- **`setup` is filled in** when the plugin needs an account, a server, or any one-time step before it works —
  this becomes the Store's "Before you start" list.
- **Real screenshots**, not placeholders.
- Anything reaching the network (`network` permission or `connect`) is legible about *what* it talks to and
  *why* — see how [Smart Chips](https://github.com/fishinglol/grantie/tree/main/examples/plugins/smart-chips)
  and [Live Collab](https://github.com/fishinglol/grantie/tree/main/examples/plugins/live-collab) describe
  theirs.
- **Readable code.** A hand-written `main.js` is reviewed as is. A bundled or minified one must come with its
  source and a build script in your repo (like Live Collab's `src/` and `build.mjs`), and the reviewer rebuilds it
  and compares it with the committed `main.js` — what reviewers read is what people run.
- **Note content is data, never markup.** Your block's text can come from someone else (a shared note, an import,
  a live session). Put it on the page with `textContent` / DOM nodes, or escape it before `innerHTML`; otherwise a
  crafted note runs code with *your* plugin's permissions.
- **Installed alongside a block plugin and a style plugin, it still behaves.** Plugins share one editor and one
  window, so install the new one next to [`simple-table`](https://github.com/fishinglol/grantie/tree/main/examples/plugins/simple-table)
  (a block with its own focus) and [`sheet`](https://github.com/fishinglol/grantie/tree/main/examples/plugins/sheet) (app-wide CSS) and click
  through both while the new plugin runs. Most cross-plugin bugs are one plugin assuming it's the only thing on
  screen — this catches that before a user does. `apps/desktop/scripts/plugin-smoke-test.mjs` automates a version
  of this (installs everything in `examples/plugins/` at once, including whatever you're adding, and clicks
  through the real `//` list) against a running `desktop-web` preview; not a substitute for trying the plugin
  yourself, but a fast first pass.
- **`editor.style` is scoped.** Every selector sits under `.live-editor` (or narrower); no bare `body`, `*`,
  `input`, `button`, `a`, or `!important`. This is the one permission the sandbox can't contain — CSS reaches
  the whole app — so it's a manual read every time, not a one-off check. See "Keep it scoped" in
  [`editor`](/api/editor).
- **The pull request only adds or changes your own entry** in `plugins.json`. Nothing else in the registry moves.
- **The pinned commit is the reviewed commit.** Read the code at that SHA, not at the repo's latest.

Asking for more permissions (or servers) in an update is fine, but each device switches the plugin off until its
owner allows the new ones, so say in the description why they are needed.

## Not-yet-installable plugins

A manifest can be marked `"soon": true` to appear in the Store as **SOON** — visible on its page, but not
installable — for a design that's built but not yet reviewed enough to hand to everyone (Live Collab shipped
this way while its relay and encryption design were still being reviewed). Remove the flag once it's ready.
