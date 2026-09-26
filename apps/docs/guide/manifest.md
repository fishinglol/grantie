# The manifest

`manifest.json` describes the plugin before any of its code runs — its identity, and everything it will be
allowed to do. It's validated (`parseManifest` in `@granite/plugins`) before a plugin is ever loaded; an
invalid manifest fails to install with a readable error instead of silently misbehaving.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | `string` | yes | Lower-case letters, digits, dashes; at most 40 characters. Also the plugin's folder name (`<vault>/.granite/plugins/<id>/`). |
| `name` | `string` | yes | Shown in the Plugins screen and the Store. |
| `version` | `string` | yes | Bump it with every change — the Store's **Update** button compares this against the installed copy. |
| `description` | `string` | no | The Store's detail page. |
| `tagline` | `string` | no | One short line for the Store's list view. |
| `author` | `string` | no | Shown in the Store. |
| `homepage` | `string` | no | An `https://` address (your site or repo). Your name on the plugin's [public page](/plugins/) links to it. |
| `permissions` | `Permission[]` | yes (may be empty) | See [Permissions & the sandbox](/guide/permissions). Nothing is granted that isn't listed here. |
| `minApiVersion` | `integer` | no | The lowest [API version](/api/) the plugin needs. The current version is **7**. |
| `desktopOnly` | `boolean` | no | Hides the plugin on the phone — for something that genuinely needs a large screen. |
| `connect` | `string[]` | no | Up to 10 `wss://host[:port]` or `ws://host[:port]` addresses the plugin may open a WebSocket to. `network` alone already covers `https:`/`wss:`; this is only for a plain `ws:` server (e.g. on your own LAN). Shown to the user like a permission. |
| `setup` | `string[]` | no | Up to 8 steps (≤300 characters each) shown as a numbered **"Before you start"** list on the plugin's Store page — for anything a person must do first (create an account, run a server). Leave it out when there's nothing. |
| `soon` | `boolean` | no | Lists the plugin in the Store as **SOON**: visible, but not installable yet. For something whose design isn't reviewed/finished. |

## Example

```json
{
  "id": "excel",
  "name": "Excel",
  "version": "1.4.0",
  "tagline": "A spreadsheet inside any note",
  "description": "A spreadsheet right inside your note, like Excel or Google Sheets: formulas, formatting, dropdowns, checkboxes.",
  "author": "Granite",
  "permissions": ["editor.blocks", "editor.input", "editor.read", "editor.write"],
  "minApiVersion": 4
}
```

## Rules worth knowing

- **`id` is permanent.** It's the folder name on every user's disk and the key the Store uses to tell versions
  apart — don't change it after publishing.
- **An unknown permission fails validation outright**, so a typo in `permissions` is caught at install time,
  not as a silent missing feature.
- **`connect` entries are validated by pattern** (`wss?://host[:port]`, up to 10). Anything else is rejected
  with an error naming the field.
- The Store only lists a plugin with **at least 3 screenshots** in its `screenshots/` folder — see
  [Publishing to the Store](/guide/publishing).
