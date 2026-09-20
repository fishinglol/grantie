# Hello Granite (sample plugin)

A plugin is a folder with two files:

- `manifest.json`: `id` (also the folder name), `name`, `version`, and the `permissions` it needs
  (`editor.read`, `editor.write`, `vault.read`, `vault.write`, `network`).
- `main.js`: plain JavaScript that uses the `granite` global.

## Install
Copy this folder to `<your vault>/.granite/plugins/hello-granite/`. It syncs to your other devices with the
vault. Then open the account menu (desktop) or the gear (phone) → **Plugins**, and switch it on **on each
device**. Nothing runs until you enable it.

## Write your own
Keep to the API in `packages/plugins/src/api.ts` (`GraniteApi`): `commands.add`, `editor.getText / getSelection /
replaceSelection`, `vault.list / read / write`, `notice`. Everything is async and works the same on desktop and
phone. Plugins run in a sandbox with no DOM access to the app and no network unless `network` is declared.
