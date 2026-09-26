# API reference

Everything a plugin can do is reached through one global, `granite`, typed as `GraniteApi` in the
`@granite/plugins` package:

```ts
declare const granite: import("@granite/plugins").GraniteApi;
```

The current API version is **7** (`API_VERSION` in `@granite/plugins`). A manifest can require a minimum with
`minApiVersion` — see [The manifest](/guide/manifest).

## Rules that apply everywhere

- **Everything is `async`.** The plugin runs in a sandboxed frame and reaches the app over a message
  channel — the same channel on desktop and on the phone — so every call returns a `Promise`, even ones that
  feel like they should be synchronous.
- **Every group needs its permission.** A call to a method whose permission isn't in the manifest is refused
  outright — it never silently no-ops. See the permission named in each section below, and the full model in
  [Permissions & the sandbox](/guide/permissions).
- **`commands.add` and `notice` need no permission** — always available.
- **Commands and RPC calls have a 15 second timeout**, after which the host kills the call.

## The surfaces

| Namespace | Permission | What it's for |
| --- | --- | --- |
| [`commands`](/api/commands) | none | Register something the user can run from the Plugins screen (and optionally the note's `⋯` menu) |
| [`editor`](/api/editor) | `editor.read` / `editor.write` / `editor.style` / `editor.sync` | Read and change the open note's text, restyle the editor, or run a live collaboration session |
| [`blocks`](/api/blocks) | `editor.blocks` | Draw your own UI in place of a fenced code block inside a note |
| [`input`](/api/input) | `editor.input` | React to what the user types alone on a line, what they paste, or add a `//` menu entry |
| [`links`](/api/links) | `editor.links` | Turn pasted/typed links to known sites into chips, or read what another plugin knows about a URL |
| [`ui`](/api/ui) | `ui.panel` | Add a button at the top of a note that opens the plugin's own window |
| [`vault`](/api/vault) | `vault.read` / `vault.write` | List, read, write and open notes elsewhere in the vault |
| `notice(message)` | none | Show a short message to the user |

The source of truth for every signature and doc comment on this page is
[`packages/plugins/src/api.ts`](https://github.com/fishinglol/grantie/blob/main/packages/plugins/src/api.ts)
in the repo — if something here and the code ever disagree, the code wins.
