# Customising how Granite looks

What a plugin can change, and the call to use. Everything here works on a plugin's own device only after the person has
switched it on and seen its permissions.

| To change… | Use | Permission | Desktop | Phone |
| --- | --- | --- | --- | --- |
| **Colours and themes** (the whole palette: background, panels, accent, text) | [`editor.setStyle`](/api/editor#restyling-the-editor) with the CSS variables | `editor.style` | yes | the note's page only |
| **Icons of folders, notes and canvases** in the sidebar | [`ui.setIcons`](/api/ui#ui-seticons-icons-api-9) | `ui.icons` | emoji and svg | emoji |
| **The text cursor** (shape, colour, trail, glow) | [`caret`](/api/caret) | `editor.caret` | yes | yes |
| **A button and window** at the top of a note | [`ui.headerButton`](/api/ui) | `ui.panel` | yes | yes |
| **Your own blocks** inside a note | [`blocks.register`](/api/blocks) | `editor.blocks` | yes | yes |
| **Link chips** (icon + title) | [`links`](/api/links) | `editor.links` | yes | yes |

## Colours and themes

Granite's colours are CSS variables, so a theme is a handful of them, not a rewrite of the app:

```js
await granite.editor.setStyle(`
  .live-editor {
    --bg: #fbf7f0;        /* the note's page */
    --panel: #f1eadc;     /* cards, menus */
    --accent: #c2410c;    /* links, the active item, buttons */
    --text: #2b2b2b;
    --text-dim: #6b6256;
  }
`);
```

The variables are `--bg`, `--bg-body`, `--panel`, `--panel-hover`, `--accent`, `--text`, `--text-dim`, `--text-faint` and `--h`
(headings). Prefer them to hard-coded colours, keep every selector under `.live-editor`, and avoid `!important`, as the
[editor reference](/api/editor#restyling-the-editor) explains. The style applies to the whole window while the plugin runs and is
switched off while the Plugins screen is open. On the phone, `setStyle` reaches the note's page; the sidebar and sheets keep
Granite's palette. There is no light/dark switch in Granite yet, so a theme plugin sets the palette it wants.

## Icons

```js
await granite.ui.setIcons({
  defaults: { folder: "📁", folderOpen: "📂", note: "📝" },
  rules: [{ match: "Fais OS/**", icon: "🧠" }],
});
```

See [`ui.setIcons`](/api/ui#ui-seticons-icons-api-9) for the patterns, SVG icons with a colour, how several plugins combine,
and what the phone draws. It needs `"minApiVersion": 9`.
