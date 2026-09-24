# Excel

A spreadsheet that lives **inside a note**, like Excel or Google Sheets. It is not a pop-up: the grid is drawn
in place, in the flow of the page, on desktop and phone.

- Permissions: **Draw its own blocks inside your notes** (`editor.blocks`) and **Change the open note**
  (`editor.read` / `editor.write`, only for the two commands that add a sheet to the note). It never reads your other notes and has no network.
- Install: copy this folder to `<vault>/.granite/plugins/excel/` (it syncs to your phone), then switch it on
  under Plugins on each device.
- Use: open a note and pick **Turn this page into a sheet** from the **⋯** button at the top right of the page (phone: the ⋮
  menu). The whole page becomes a sheet. Or run **Insert a spreadsheet** from the Plugins screen, or type a ```` ```sheet ````
  fence yourself: each sheet is one fenced block, so a note can also hold several, between paragraphs. A page that
  already has text keeps it, below the sheet.
- The sheet is stored as JSON between the fences, one cell per line, so it is a normal Markdown note that syncs
  and diffs like any other. While the cursor is inside the block (or after **`</>`** in its toolbar) it shows as
  that text. A sheet whose text no longer parses is never replaced by an empty grid; it offers "Show as text".

## What it does

- **Grid**: column letters and row numbers, click / drag / Shift-click to select, arrow keys, Tab, Enter,
  Ctrl+arrows, Home/End, PageUp/PageDown, name box (type `A1:C5` to select), formula bar, type to edit, F2,
  click a cell while typing `=` to insert its reference, resize columns/rows by dragging a header border,
  drag the bar at the bottom to change the sheet's height.
- **Formulas** (`=SUM(A1:A5)`, `$A$1`, `A:A`, ranges, `%`, `&`, comparisons):
  SUM AVERAGE MIN MAX COUNT COUNTA COUNTBLANK PRODUCT MEDIAN LARGE SMALL STDEV SUMPRODUCT ROUND ROUNDUP ROUNDDOWN
  TRUNC ABS SIGN SQRT POWER EXP LN LOG LOG10 MOD INT CEILING FLOOR PI RAND RANDBETWEEN · IF IFS IFERROR IFNA AND
  OR XOR NOT SWITCH CHOOSE ISBLANK ISNUMBER ISTEXT ISERROR ISNA · LEN UPPER LOWER PROPER TRIM LEFT RIGHT MID CONCAT
  CONCATENATE TEXTJOIN SUBSTITUTE REPLACE FIND SEARCH REPT EXACT VALUE TEXT · COUNTIF SUMIF AVERAGEIF COUNTIFS
  SUMIFS · VLOOKUP HLOOKUP XLOOKUP MATCH INDEX ROWS COLUMNS · TODAY NOW DATE YEAR MONTH DAY WEEKDAY DAYS EDATE
  DATEDIF. Errors show as `#DIV/0!`, `#VALUE!`, `#NAME?`, `#REF!`, `#N/A`, `#CIRCULAR!`.
- **Editing**: undo / redo, copy / cut / paste (formulas keep working: relative references move, `$` ones don't;
  plain tab-separated text pastes in from other apps), drag the corner handle to fill (numbers continue a series),
  Ctrl+D fill down, insert / delete rows and columns (formulas are rewritten), sort a selection A→Z / Z→A.
- **Formatting**: bold, italic, underline, strikethrough, text and fill colour, alignment, wrap, borders, number
  formats (number, integer, currency, percent, date, plain text) with more / fewer decimals, font size. Typing `50%` or
  `2026-09-21` formats the cell for you.
- **Format menu** (like Sheets'): Number, Text, Alignment (also top / middle / bottom), Wrapping, Font size, **Merge cells**
  (all / horizontally / vertically / unmerge), **Conditional formatting** (rules by value, text, between, or a custom formula,
  with fill / text colour / bold; the first matching rule wins), **Alternating colours** (header + two tones) and Clear formatting.
- **More in the Format menu**: **Theme** (match the note, Light, Dark, Sepia, Green; sans / serif / mono font), **Wrapping** (Overflow
  runs long text over empty cells, Wrap, Clip), **Rotation** (tilt or turn text), **Smart chips** (dropdown, checkbox, remove) and
  **Convert to table**: a header row with sort A→Z / Z→A and **filter by values** arrows on every column, banded rows, and rows the
  filter hides are hidden. Alternating colours also take your own header / row colours (Custom colours…).
- **Cell types**: checkbox, and dropdown chips with colours (pick from the chips, or the ✎ at the bottom of the list to edit them —
  a row per option with a colour swatch, its name, a drag handle to reorder and a trash button, like Sheets' "Data validation rules").
- **Row / column size**: drag a header border (a dark bar shows where you can grab it, also with a finger), or double-click it to
  fit the contents. On a phone the round handle at the selection's corner drags out a range.
- A sum / average / count of the selected numbers appears in the status bar.

## Not there yet

Frozen rows/columns, charts, images in cells, several tabs in one sheet (use several blocks),
and cross-sheet references.
