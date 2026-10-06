# Hello Granite (sample plugin)

The smallest useful plugin, and the one to copy when you start your own. Three commands: insert today's date, count the
words in the note, upper-case the selection.

A plugin is a folder with two files:

- `manifest.json`: `id` (also the folder name), `name`, `version`, and the `permissions` it needs. The full field list
  is in [The manifest](https://granite-docs-phi.vercel.app/guide/manifest).
- `main.js`: plain JavaScript that uses the `granite` global.

## Permissions

| Permission | Why this plugin needs it |
| --- | --- |
| `editor.read` | Reads the note (word count) and the selection (upper-case). |
| `editor.write` | Inserts the date and replaces the selection. |

It has no network access and never reads your other notes. Ask only for what your plugin really uses; the other
permissions (`editor.style`, `editor.blocks`, `editor.input`, `editor.links`, `editor.sync`, `editor.caret`, `ui.panel`,
`vault.read`, `vault.write`, `network`) are listed in
[Permissions & the sandbox](https://granite-docs-phi.vercel.app/guide/permissions).

## Install
Copy this folder to `<your vault>/.granite/plugins/hello-granite/`. It syncs to your other devices with the
vault. Then open the account menu (desktop) or the gear (phone) → **Plugins**, and switch it on **on each
device**. Nothing runs until you enable it.

## Write your own
The API (`GraniteApi`) is described in the [API reference](https://granite-docs-phi.vercel.app/api/) and typed in
[`packages/plugins/src/api.ts`](../../../packages/plugins/src/api.ts): `commands`, `editor`, `blocks`, `input`, `links`,
`caret`, `ui`, `vault` and `notice`. Everything is async and works the same on desktop and phone. Plugins run in a sandbox
with no DOM access to the app and no network unless `network` is declared.

To share it, put it in a public GitHub repo of your own and list it in the community registry, see
[Publishing to the Store](https://granite-docs-phi.vercel.app/guide/publishing). In your own copy, change `author` (and add
`homepage`) to you, add a `LICENSE` file and a `README.md` that says why each permission is needed, and add three real
screenshots in `screenshots/`. This sample is Granite's own and is covered by the repo's licence (`LICENSE` at the top of
the repo).
