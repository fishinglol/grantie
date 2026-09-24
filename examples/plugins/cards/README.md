# Cards

A board of colourful note cards that lives **inside a note**, like a sticky-note wall. It is not a pop-up: the board is drawn
in place on desktop and phone.

- Permissions: **Draw its own blocks inside your notes** (`editor.blocks`) and **Change the open note**
  (`editor.read` / `editor.write`, only for the two commands that add a board to the note). It never reads your other notes and has no network.
- Install: from the **Store** tab of Plugins (desktop), or copy this folder to `<vault>/.granite/plugins/cards/`
  (it syncs to your phone), then switch it on under Plugins on each device.
- Use: open a note and pick **Turn this page into a card board** from the **⋯** button at the top right of the page (phone: the ⋮
  menu). Or run **Insert a card board** from the Plugins screen, or type a ```` ```cards ```` fence yourself: each board is one
  fenced block, so a note can hold several. A page that already has text keeps it, below the board.
- The board is stored as text between the fences, one card per line (JSON), so it is a normal Markdown note that syncs and diffs like
  any other. While the cursor is inside the block (or after **`</>`**) it shows as that text. A board whose text no longer parses is
  never replaced by an empty one; it offers "Show as text".

## What it does

- **Take a note…** bar (title, text or checklist), then **Close** to add it. An empty note is discarded.
- **Cards in a wall**: each card goes into the shortest column (2 columns on a phone). Hover a card (always visible on touch) for
  **colour**, **image**, **archive**, **⋮** (delete, make a copy) and the **pin**.
- **Click a card** to open it big: edit title and text, colour, add / remove pictures (also paste one in), **Archive**, **⋮** (delete, make
  a copy, show / hide checkboxes), **Close**. It saves as you type.
- **Checklists**: Enter adds an item, Backspace on an empty item removes it, ticked items move under "N completed items".
  You can tick items straight from the card.
- **Pinned / Others** sections, **12 colours** (a light and a dark shade each, picked by the note's theme), **Archive** and **Bin**
  (restore, delete forever, Empty Bin; notes in the Bin are removed after 7 days), and **search** across all notes.
- **Pictures** are shrunk to at most 1000 px and stored as JPEG inside the note (roughly 60–150 KB each), so the whole board is one
  `.md` file. A board with many pictures makes a big note and slower syncs.

## Not there yet

Reminders, collaborators, drawing, labels, drag-to-reorder cards, multi-select, and a picture picker verified on a real phone
(the desktop browser preview works).
