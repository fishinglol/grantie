# Permissions & the sandbox

Granite's plugin trust model is **sandboxed with declared permissions** — not the "fully trusted" model
Obsidian uses. A plugin only gets access to what its `manifest.json` lists, and the person installing it sees
that list, in plain language, before switching it on. Nothing is granted implicitly.

## How the sandbox works

Every plugin runs inside a hidden `<iframe sandbox="allow-scripts">` — no `allow-same-origin`, so the frame
has an **opaque origin**: it cannot read the app's DOM, `localStorage`, cookies, or reach anything on the
network by default. Its Content-Security-Policy blocks every request unless `network` is declared (which
then allows `connect-src https: wss:`). The only way out of the frame is `postMessage` to the host, which
answers RPC calls one at a time and refuses any call whose method needs a permission the manifest doesn't
list.

This has been verified against a hostile plugin attempting to reach the parent DOM, local storage, the
network, and the desktop app's native bridge — all blocked. A plugin command also has a **15 second timeout**
before the host kills it, so a hang or infinite loop in a command can't freeze the app (an infinite loop
*inside* one call can still stall that plugin's own frame — see Known limits below).

## The permission list

| Permission | Unlocks | Label the user sees |
| --- | --- | --- |
| `editor.read` | `editor.getText`, `editor.getSelection` | "Read the open note" |
| `editor.write` | `editor.replaceSelection`, `editor.setText` | "Change the open note" |
| `editor.style` | `editor.setStyle` | "Change how the editor looks" |
| `editor.blocks` | `blocks.register` | "Draw its own blocks inside your notes" |
| `editor.input` | `input.trigger`, `input.onPaste`, `input.addItem` | "See what you type on an empty line and what you paste" |
| `editor.links` | `links.register`, `links.chip`, `links.title`, `links.open` | "Show links to known sites as chips" |
| `editor.sync` | `editor.sync.*` (live collaboration) | "Follow what you type and your cursor as you type, and change the note live (for working together)" |
| `ui.panel` | `ui.headerButton`, `ui.setBadge`, `ui.copy` | "Add a button at the top of a note and open a window of its own" |
| `vault.read` | `vault.list`, `vault.read`, `vault.open` | "Read your notes" |
| `vault.write` | `vault.write` | "Create and change notes" |
| `network` | `fetch`/WebSocket to any `https:`/`wss:` address | "Use the internet" |

`commands.add` and `notice` need no permission — every plugin can register a command and show a message.

Ask for the smallest set that does the job: a plugin that only draws sticky-note blocks needs `editor.blocks`
and `editor.input` (for its `//` entry), nothing about the vault or the network.

## `connect` — a plain `ws://` server

`network` covers any `https:`/`wss:` address, which is enough for a normal API or a TLS WebSocket server. If a
plugin needs a **plain, unencrypted** `ws://` connection — typically a server on the user's own network during
development — list it explicitly in the manifest's `connect` field (`ws://host:port` or `wss://host[:port]`).
It's shown to the user the same way a permission is.

Two platform notes if you're building something like this:

- Chrome blocks a sandboxed, opaque-origin frame from reaching plain `ws://` on localhost/LAN addresses
  (local-network protection) — you'll likely need a `wss://` tunnel even for local development.
- `network`'s `connect-src https:` does **not** cover `wss:` in Chrome — the CSP for a plugin with `network`
  explicitly includes both `https:` and `wss:` to work around this.

## Vault paths are always checked

Every path a plugin gives to `vault.read`/`vault.write`/`vault.open` is validated (`safeNotePath`): it must be
relative, contain no `..` or leading-dot segments, and end in `.md`/`.markdown`. A plugin can never read or
write outside the vault, into the hidden `.granite/` folder, or to a non-Markdown file — regardless of what
`vault.write` is asked to do.

## Known limits

- An infinite loop **inside** a single call can still stall that plugin's own frame (the 15 s timeout applies
  between calls, not to one synchronous loop).
- CSS from `editor.style` applies **app-wide**, not scoped to the plugin — it's shown to the user as a
  permission for exactly that reason, and it's checked (`checkPluginCss`) to block `@import`, `url()`,
  `image-set()`, backslash escapes and anything that could break out of its `<style>` tag.
- `ui.panel` allows one window at a time, and only one header button per plugin.
