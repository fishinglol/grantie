# Cursor Effects

Your text cursor, your way. Works the same on desktop and phone.

- **Shape and look:** line, block (solid or outline) or underline; any colour or the theme's; thickness, strength;
  blinking (blink, fade or steady) and its speed; **glide** (the cursor slides to the next spot).
- **Effects (each optional):** pixel **trail** behind a moving cursor, **dust** rising as you type, **pop** (typed
  letters float up; deleting bursts), **torch** (dim everything but a pool of light around the cursor).
- **Presets:** Classic, Block, Neon, Typewriter, Torch.
- Respects the system's **reduce motion** setting (no gliding, no particles, a steady cursor).

Press the **Cursor** button at the top of a note to change it. Settings are kept on each device.

## Install

Plugins → Store → Cursor Effects → GET, on each device. Or copy this folder to
`<vault>/.granite/plugins/cursor-fx/` (it syncs to your phone) and switch it on under Plugins.

## Permissions

| Permission | Why |
| --- | --- |
| `editor.caret` | To know where your cursor is and when you type, and to draw over the editor. The drawing layer **cannot use the internet**. |
| `editor.style` | To hide the editor's own cursor, which this plugin replaces. Nothing else about the editor's look changes. |
| `ui.panel` | The **Cursor** button and its settings window. |

It never reads or changes a note.

## How it is built

This is the reference plugin for the `editor.caret` API (plugin API 8, [docs](../../../apps/docs/api/caret.md)).
One plain `main.js` runs in two frames of the plugin: the **overlay** (a transparent, network-less layer over the
window that draws the cursor and effects) and the normal frame (the settings window). The window sends its choices
to the overlay with `granite.caret.setOptions`.

The idea comes from the Obsidian plugin [cursor-smith](https://github.com/Sadsnake1/cursor-smith) (MIT); the effects here are
written from scratch for Granite's API and do not use its code.
