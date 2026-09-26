# Publishing to the Store

Granite's plugin Store is a **reviewed store**, not an open, self-serve upload: every plugin listed in it has
had its code read and approved. There's no server-side registry to upload to — the Store is generated from
one place in the Granite repo.

## How the Store is built

Both apps' Store tab lists whatever is in
[`examples/plugins/`](https://github.com/fishinglol/grantie/tree/main/examples/plugins) in the Granite repo:

- **Desktop** bundles every folder there at build time (`import.meta.glob(...?raw)` in `pluginCatalog.ts`) —
  no network call, no separate registry.
- **Phone** generates `src/pluginCatalog.ts` from the same folder (`scripts/build-catalog.mjs`) as part of its
  build.

So the only way onto the Store is a folder under `examples/plugins/<id>/` in the repo itself, which means:

## Contributing a plugin

1. **Fork the repo** and add your plugin under `examples/plugins/<id>/` — a `manifest.json` and `main.js` (see
   [Getting started](/guide/getting-started) and [The manifest](/guide/manifest)).
2. **Add at least 3 screenshots** to `examples/plugins/<id>/screenshots/`. A plugin isn't listed in either
   Store without them — real captures of it running, not mockups.
3. **Write a `README.md`** for the folder (what it does, how to install it, anything worth knowing) — every
   shipped example plugin has one; follow that pattern.
4. **Open a pull request.** A maintainer reads the code before it's merged. There's no other path to
   distribution today — nothing is installable from an unreviewed source, and there's no install-from-URL or
   community registry outside this repo.

## Updating a listed plugin

Bump `version` in `manifest.json` in the **same change** as any behavior change — the Store's **Update**
button only appears when the bundled version differs from what a user has installed. A feature added without
a version bump is invisible to anyone who already installed the plugin.

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

## Not-yet-installable plugins

A manifest can be marked `"soon": true` to appear in the Store as **SOON** — visible on its page, but not
installable — for a design that's built but not yet reviewed enough to hand to everyone (Live Collab shipped
this way while its relay and encryption design were still being reviewed). Remove the flag once it's ready.
