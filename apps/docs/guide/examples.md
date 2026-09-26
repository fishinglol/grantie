# Example plugins

Every plugin listed in Granite's Store lives in
[`examples/plugins/`](https://github.com/fishinglol/grantie/tree/main/examples/plugins) — read any of them for
real, shipped patterns. They're ordinary review-merged pull requests, so their code is exactly what a
contributed plugin looks like.

| Plugin | What it does | Permissions | Good for learning |
| --- | --- | --- | --- |
| [`hello-granite`](https://github.com/fishinglol/grantie/tree/main/examples/plugins/hello-granite) | Insert today's date, count words, uppercase the selection | `editor.read`, `editor.write` | The smallest possible plugin — start here |
| [`sheet`](https://github.com/fishinglol/grantie/tree/main/examples/plugins/sheet) | Ruled index-card paper theme for the whole editor | `editor.style` | `editor.setStyle`, app-wide CSS |
| [`excel`](https://github.com/fishinglol/grantie/tree/main/examples/plugins/excel) | A full spreadsheet inside a note: formulas, formatting, dropdowns, checkboxes | `editor.blocks`, `editor.input`, `editor.read`, `editor.write` | `blocks.register`, a large plugin's engine/UI split |
| [`cards`](https://github.com/fishinglol/grantie/tree/main/examples/plugins/cards) | A Google-Keep-style sticky-note board inside a note | `editor.blocks`, `editor.input`, `editor.read`, `editor.write` | Rich text fields, images as data URIs inside a block |
| [`simple-table`](https://github.com/fishinglol/grantie/tree/main/examples/plugins/simple-table) | A plain Markdown table you type straight into; paste from Excel | `editor.blocks`, `editor.input`, `editor.links`, `editor.write`, `vault.read`, `vault.write` | `input.onPaste`, storing data as ordinary Markdown |
| [`calendar`](https://github.com/fishinglol/grantie/tree/main/examples/plugins/calendar) | Your notes by date: month, weeks or year view | `editor.blocks`, `editor.input`, `editor.read`, `editor.write`, `vault.read`, `vault.write` | `vault.list`/`vault.open`, a port of an MIT-licensed Obsidian plugin |
| [`dropdown`](https://github.com/fishinglol/grantie/tree/main/examples/plugins/dropdown) | A coloured choice chip, like a status or priority field | `editor.blocks`, `editor.input` | A small, focused block plugin |
| [`popup`](https://github.com/fishinglol/grantie/tree/main/examples/plugins/popup) | A card that opens another note as a popup/split view; follows renames | `editor.blocks`, `editor.input`, `vault.read`, `vault.write` | `vault.open`, tracking a note across renames |
| [`smart-chips`](https://github.com/fishinglol/grantie/tree/main/examples/plugins/smart-chips) | Paste a link to ~66 sites, press Tab for a title + icon chip | `editor.links`, `network` | `links.register`, fetching a page title with `network` |
| [`live-collab`](https://github.com/fishinglol/grantie/tree/main/examples/plugins/live-collab) | Share a note and edit it together live, with cursors — like Google Docs | `editor.sync`, `editor.read`, `editor.write`, `editor.blocks`, `editor.input`, `ui.panel`, `vault.read`, `vault.write`, `network` | `editor.sync` (live collaboration), `ui.headerButton`, a bundled dependency (Yjs via esbuild), `setup` steps |

## Reading order, if you're new

1. **`hello-granite`** — commands, `editor.read`/`editor.write`, nothing else.
2. **`dropdown`** or **`popup`** — a single focused block plugin using `editor.blocks` + `editor.input`.
3. **`simple-table`** or **`calendar`** — a block plugin that also reads/writes the vault.
4. **`excel`** or **`live-collab`** — a full-sized plugin: multiple files bundled into one `main.js`, or a
   large single-file engine.

## Plugins with a bundler

Most examples are one plain `main.js` — no build step. `live-collab` is the exception: it depends on Yjs, so
it has its own `package.json` and uses [esbuild](https://esbuild.github.io) to bundle everything into one
`main.js` (`npm run build` inside that folder). Reach for a bundler only when you need a real dependency —
plain JavaScript is enough for everything else on this page.
