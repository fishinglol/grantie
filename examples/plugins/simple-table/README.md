# Simple Table

A plain table that lives **inside a note**, drawn in place on desktop and phone (and on a canvas, as a card).

- Permissions: **Draw its own blocks inside your notes** (`editor.blocks`), **See what you type on an empty line and what you
  paste** (`editor.input`) and **Change the open note** (`editor.write`, only for the "Insert a simple table" command).
  It never reads your other notes and has no network. Needs Granite with plugin API 2 (`minApiVersion`).
- Install: from the **Store** tab of Plugins (desktop or phone), or copy this folder to `<vault>/.granite/plugins/simple-table/`
  (it syncs to your other devices), then switch it on under Plugins on each device.

## Use

- Type **`//`** alone on an empty line: a blank table appears there. (Not inside a code block; a `//` after other text on the line, such as
  a URL, is left alone.)
- **Paste cells copied from Excel or Google Sheets**: they become a table, the first row as the header. Anything without tabs in it is pasted as usual.
- Click a cell and type. **Tab** / **Shift+Tab** move across, **Enter** and the arrow keys move down / up, and Tab or Enter in the last row adds a
  row. **+ Row**, **+ Column**, the **×** on a header (delete that column) and the **×** at the end of a row (delete that row).
  Pasting several cells into a cell fills the table from there.
- **`</>`** shows the table as text; **Delete table** removes it. On a canvas, the plugin's button on the bottom bar adds one as a card.

## How it is stored

As an ordinary Markdown pipe table between ```` ```simple-table ```` fences, so the note stays readable and syncs and diffs like any other:

````
```simple-table
| Day | Date |
| --- | :---: |
| 1 | 2026-09-21 |
```
````

Alignment marks in the second line (`:---:`, `---:`) are kept. A cell is one line: line breaks become spaces, `|` is written `\|`.
A table whose text no longer reads is never replaced by an empty one; it offers "Show as text".

## Not there yet

Column widths, changing alignment from the UI, sorting, formulas (use the Excel plugin), merging cells, dragging rows or columns.
