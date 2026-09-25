# Simple Table

A plain table that lives **inside a note**, drawn in place on desktop and phone (and on a canvas, as a card).

- Permissions: **Draw its own blocks inside your notes** (`editor.blocks`), **See what you type on an empty line and what you
  paste** (`editor.input`: the entry in the `//` list and the paste of spreadsheet cells) **Change the open note**
  (`editor.write`, only for the "Insert a simple table" command) and **Show links to known sites as chips** (`editor.links`, to ask Smart Chips how a link looks and to open one). It never reads your other notes and has no network.
  Needs Granite with plugin API 5 (`minApiVersion`).
- Install: from the **Store** tab of Plugins (desktop or phone), or copy this folder to `<vault>/.granite/plugins/simple-table/`
  (it syncs to your other devices), then switch it on under Plugins on each device.

## Use

- Type **`//`** alone on an empty line: a list of what plugins can insert opens (Table, Calendar, Spreadsheet, Cards…). Pick **Table** (tap it,
  or arrows + Enter; typing more filters, `//ta`) and a blank table appears there. (Not inside a code block; a `//` after other text on the
  line, such as a URL, is left alone.)
- **Paste cells copied from Excel or Google Sheets**: they become a table, the first row as the header. Anything without tabs in it is pasted as usual.
- Click a cell and type. **Tab** / **Shift+Tab** move across, **Enter** and the arrow keys move down / up, and Tab or Enter in the last row adds a
  row. **+ Row ↓** (adds a row at the bottom), **+ Column →** (adds a column on the right), the **×** on a header (delete that column) and the **×** at the end of a row (delete that row).
  Pasting several cells into a cell fills the table from there.
- **`//` in a cell (1.3.0)**: type **`//`** in a data cell (not the header) and a small menu opens, like the one in a note: **Dropdown** or **Link** (arrows + Enter, or click).
  Escape leaves the `//` as text.
- **Link chips in cells (1.3.0)**: paste a web address into a data cell. If **Smart Chips** is on and knows the site (YouTube, GitHub, Google Docs...), the cell becomes that site's chip
  (icon + title, the title is fetched a moment later); otherwise the address stays as text. Click a chip to open the page; click the empty part of the cell (or move into it with the
  keyboard) to edit its text, which is a Markdown link `[Title](url)`. Needs Smart Chips for the chips, and the `editor.links` permission (`minApiVersion` 5).
- **Dropdown cells**: choosing **Dropdown** makes *that cell* a dropdown (other cells stay as they are; do the same in another cell of the column to reuse the column's options): a list of coloured options opens (important,
  normal, not really, not important the first time). A click only selects the cell; open the list again with the **▾** arrow at its right edge, a double-click, or Enter / Space; picking the chosen one again, or Backspace / Delete, clears it. The **pencil**
  edits the column's options (rename, colour, drag to reorder, delete, **Add another item**, **Remove from this cell**); renaming an option renames the cells that hold it.
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

A dropdown cell stores only the option's name (so the table still reads as text). The options and colours, shared by a column's dropdown cells, and the rows that are dropdowns are kept in one comment line at the end of the fence:
`<!-- dropdowns {"0":{"o":[["important","red"],["normal","yellow"]],"r":[1,3]}} -->` (column and row numbers counted from 0, the header being row 0; colours: red, orange, yellow, green, teal, blue, purple, pink, brown, gray).

## Not there yet

Column widths, changing alignment from the UI, sorting, formulas (use the Excel plugin), merging cells, dragging rows or columns.
