# Handoff prompt — canvas whiteboard tools (FigJam-style toolbar)

_Written 2026-10-08 by Claude after reading the code. Give this whole file to the AI that will do the work. "Verified" = read in the repo. "Not verified" = not read; check it before you rely on it._

## Your task
The user sent FigJam screenshots and asked (in Thai) for **Granite's canvas to have a FigJam-style toolbar with roughly the same set of tools.** Today the canvas is Obsidian-style: cards, arrows and groups. This adds a whiteboard layer on top of it: a pen, shapes, stickies, connector styles, sections and a minimap.

Reference crops (toolbar only) are in `memory-bank/handoff-canvas-refs/`:
- `pen-drawer.png`: the pen drawer that opens above the main bar.
- `shapes-drawer.png`: the shapes and connectors drawer.
- `more-shapes-panel.png`: the "More shapes" side panel.

The user's other screenshots were full boards with personal content, so they are described here instead of copied:
- The main bar is a white pill at the bottom centre.
- Tooltips: "Square R", "Ellipse O", "Section ⇧S".
- A selected section shows a blue frame with a "Section 1" title chip and a small dark toolbar above it (fill colour ▾, align ▾, a frame icon, eye, lock ▾).
- A **minimap** sits bottom-right, with **− / +** zoom buttons and a **?** help button beside it.

### What the reference toolbar contains (left → right)
| # | FigJam item | Granite target |
|---|---|---|
| 1 | Select (pointer) | `tool = "select"`. This is today's behaviour: drag on empty space = box-select. |
| 2 | Hand | `tool = "hand"`. A left-drag pans and nothing can be selected. Space+drag keeps panning in any tool. |
| 3 | Marker. Opens the **pen drawer**: marker, highlighter, washi tape, eraser \| 2 stroke variants \| 9 colours (black, red, orange, yellow, green, blue, purple, white, custom 🌈) | Freehand strokes (new). See "Strokes". |
| 4 | Sticky-note stack | Sticky note = a text card with a sticky look (square, filled colour, no border). |
| 5 | Shape + connector icon. Opens the **shapes drawer**: a current-shape dropdown \| elbow connector, curved connector, straight arrow, plain line \| square, circle, diamond, triangle, down-triangle, rounded rect, cylinder, mind-map icon \| "More shapes" | Shapes are new (see "Shapes"). Connector style is new (see "Connectors"). "More shapes" opens a side panel with search and the *Basic* set only. |
| 6 | Text (T) | A borderless text card. |
| 7 | Section (⇧S) | The existing **group**, with a title chip, its colour and "drag to draw". |
| 8 | Table | A text card seeded with a 3×3 Markdown pipe table. `LiveEditor` already draws pipe tables. |
| 9 | Stamp | **Out of scope.** Do not show a dead button. |
| 10 | Comment | **Out of scope** (needs people/threads). Do not show it. |
| 11 | Widgets (shapes+ icon) | A popover that lists the **plugin buttons** the bar shows today (`langs`: Excel, Cards, Simple Table…). |
| 12 | "+" | A popover with the existing **Note from vault / Media from vault**, plus **Link card** (the format already supports `type:"link"`, but no UI makes one). |

Also add: a **minimap** (bottom-right) and **− / + / ?** next to it.

## Rules for this repo (from `CLAUDE.md`; they matter)
- Read `memory-bank/` first: `systemPatterns.md` "Pattern: canvas = a vault file edited as text", `progress.md` "Canvas mode, Obsidian-style", and `techContext.md` line ~114 (canvas deps). Update `activeContext.md` + `progress.md` when you are done.
- **Ask before adding any dependency.** Name the library, what it replaces and the trade-off. The likely candidate is `perfect-freehand` (MIT, tiny, nice variable-width strokes). The default plan below needs **no new dependency**. React Flow already ships `MiniMap`, `getSmoothStepPath` and `getStraightPath`. The colour picker is `<input type="color">`.
- Minimum code. No unrequested features. No drive-by edits. Verify with `npx tsc -b` in `apps/desktop` and `apps/mobile`, not `tsc --noEmit`.
- **Never commit unless asked. Ask before `npm run ship`** (it reaches the user's real phone).
- Current branch is `feat/mobile-pdf` and has untracked files. Ask the user which branch to work on before you start.

## Decisions to confirm with the user BEFORE coding (recommendation first)
1. **Where strokes live in the `.canvas` file.** JSON Canvas 1.0 has no drawings. `parseCanvas` (`jsonCanvas.ts:93`) **drops every node whose type isn't text/file/link/group**, so a new node type would be thrown away today.
   - (a) **Recommended:** a new node type `"drawing"` in `nodes`. Add it to the allowed list in `parseCanvas`. React Flow then gives selection, drag, resize, delete and undo for free.
   - (b) A top-level `"granite": { "drawings": [...] }` field. `rest` already keeps unknown top-level fields, but the whole node machinery would have to be built separately.
   - Either way, **Obsidian will not show drawings**, and it is *not verified* whether Obsidian keeps or deletes unknown nodes/fields when it saves. Tell the user this.
2. **Theme.** FigJam is light. Granite's canvas is dark (`colorMode="dark"`, `background: #141720`), and the apps have no light/dark switch. Recommended: copy the **layout and tools**, keep the app's dark palette (the bar and drawers use `--panel`, `--text`, `--accent`). Consequence: a black pen is nearly invisible, so the default pen colour should be the white swatch / `--text`.
3. **The two stroke variants** in the pen drawer (the `~` icon is selected, the grey squiggle is not). It was **not confirmed** what they mean in FigJam. Ask the user. If they don't care: thin (3 px) vs thick (8 px).
4. **Washi tape.** Recommended: include it as a wide (16 px), semi-transparent stroke with a striped pattern. Or drop it if the user doesn't want it.
5. **Phone.** The canvas is shared by desktop and phone (same `CanvasView`). Recommended: build once for both. On the phone the bar scrolls sideways, drawers open above it, and **while a pen tool is active one finger draws and two fingers pan/pinch.** Confirm the phone is in scope now.
6. **Section toolbar** (eye = hide, lock). Recommended: **colour + rename only**. Hide and lock are out of scope unless asked.

## Verified (read in the repo)
- All canvas code is in `packages/canvas`:
  - `src/CanvasView.tsx` (1006 lines): the React Flow board, cards, menus and the bottom bar.
  - `src/canvas.css` (297 lines).
  - `src/jsonCanvas.ts`: the pure format, 7 tests in `test/jsonCanvas.test.ts`, run with `npm test` (`node --test`).
- Both hosts render `CanvasView` with the same props:
  - desktop: `apps/desktop/src/NoteApp.tsx:1474`
  - phone WebView: `apps/mobile/editor-web/main.tsx:520`

  **This task needs no host change.** The phone page is bundled into `apps/mobile/src/editorHtml.ts` by `npm run build:editor` (in `apps/mobile`). Run it after changing the canvas, or the phone keeps the old canvas.
- **Data flow:** React Flow holds geometry and selection; the file holds everything else. `toData` merges positions and sizes back into each node's original object, so **any extra field you put on a node survives saves** (`...n.data.node`). Every change goes through `commit()`, which serialises the file, pushes undo history and calls `onChange`. New tools must create nodes through `addNodes()` and change them through `patchNode()`; then undo/redo, save and sync just work.
- Unknown **fields** on known nodes are kept. Obsidian's Advanced Canvas plugin stores its extras in `styleAttributes` (mentioned in `progress.md`). The exact key names it uses are **not verified**. Check https://github.com/Developer-Mike/obsidian-advanced-canvas before you pick names, and reuse its names where they match (shape names especially). Otherwise use your own keys under `styleAttributes`.
- **Existing interactions to keep working:**
  - double-click empty = text card
  - drag a handle = arrow; drop it on empty space = a new joined card
  - drag/click from the bar
  - selection menu (`SelectionMenu`: delete, colour, zoom, edit, open, group, flip arrow)
  - groups drag their cards (`groupKids`)
  - edge labels
  - reading mode (`readOnly`)
  - help card
  - plugin cards (`pluginLang`, `PLUGIN_ICONS`, `PLUGIN_SEED`, `PLUGIN_SIZE`)
  - Finder/sidebar drops through `CanvasHandle.addFile`
- **Current React Flow setup:** `panOnDrag={touch ? true : [1, 2]}`, `selectionOnDrag={!touch}`, `panOnScroll={!touch}`, ⌘/Ctrl + scroll zooms, `zoomOnDoubleClick={false}`, `deleteKeyCode` = Backspace/Delete. The top-right `Panel` holds zoom in/reset/fit/out, undo/redo and help.
- **Gotcha** (`progress.md`): the bar buttons act on `pointerdown`, and a scripted `.click()` does not trigger them. Use real mouse events (`computer` left_click) when testing.
- Edges are drawn by `LinkView` with `getBezierPath` only.

## Design (recommended; challenge it if the code says otherwise)

### Tool state
- `const [tool, setTool] = useState<Tool>("select")`.
- Pen settings: `{ kind: "marker"|"highlighter"|"washi"|"eraser", width, color }`.
- Shape setting: the last shape picked. Connector setting: the last style picked.
- Remember the pen and shape settings per viewer in `localStorage` (wrap it in try/catch). Do not put them in the file.
- **Esc** returns to `select`. After placing one sticky, shape, text or section, return to `select`, as FigJam does. Pen tools stay active until changed.
- Shortcuts, only when not typing (same guard as `onKeyDown`):
  - Seen in the screenshots: `R` square, `O` ellipse, `⇧S` section.
  - Suggested: `V` select, `H` hand, `M` marker, `S` sticky, `T` text, `X` connector.
  - Show each one in the button's `title` tooltip.
- Map the tool to React Flow props:
  - `select`: as today.
  - `hand`: `panOnDrag={true}`, `selectionOnDrag={false}`, `nodesDraggable={false}`.
  - Pen tools: an overlay captures the pointer (below).
  - Placing tools (sticky, shape, text, section, table): the pane's click/drag places the item.

### Strokes (marker, highlighter, washi, eraser)
- **Pure helpers go in a new `src/draw.ts`, with tests in `test/draw.test.ts`:**
  - `strokeBox(points, width)` → `{x, y, width, height}` plus points relative to the box.
  - `smoothPath(points)`: an SVG `d` built from quadratic curves through the midpoints. About 20 lines; no dependency.
  - `simplify(points, tolerance)`: drop points closer than ~1.5 px.
  - `hitsStroke(stroke, point, radius)`: for the eraser.
- **Drawing:** while a pen tool is active, render an absolutely positioned overlay `<div class="canvas-draw nodrag nopan">` over the pane that takes the pointer.
  - On `pointerdown`, capture the pointer and collect `flow.screenToFlowPosition` points.
  - Draw the live path in an SVG that uses the viewport transform (`useViewport()` or `useStore`).
  - On `pointerup`, create the node (shape below) with `addNodes`, then **unselect it** so the pen keeps drawing.
  - Ignore a second touch pointer, so two fingers can still pan and pinch. Do this with `pointerType` and a check for an active pointer.
- **Node shape:** `{ id, type: "drawing", x, y, width, height, color: "#hex", styleAttributes?: {...}, points: [[x,y],...], stroke: { width, kind } }`. Points are relative to `x`/`y` at the size the stroke was drawn, so resizing scales the SVG (`viewBox` = drawn size, `preserveAspectRatio="none"`, `vector-effect: non-scaling-stroke`).
  - No connection handles on drawings.
  - The selection menu offers delete and colour.
- **Highlighter:** wide (~14 px), `opacity: .4`, `mix-blend-mode: screen` on the dark board (multiply vanishes on dark; the PDF dark theme hit the same problem).
- **Washi:** wide, semi-transparent, striped `<pattern>`.
- **Eraser:** while dragging, delete every drawing that `hitsStroke` the pointer path. Do it as **one** undo step: collect the IDs during the drag, show them dimmed, and call `flow.deleteElements` once on `pointerup`. **Only drawings are erased**, never cards.
- **Pen drawer:** opens above the main bar when the marker is active (see `pen-drawer.png`):
  - the 4 tools
  - a divider, then the 2 variants
  - a divider, then 8 hex swatches + 🌈, which is a hidden `<input type="color">`. Show its chosen colour as the selected swatch.
  - Use these hex values, which roughly match the screenshot: `#1e1e1e #e5533d #f0a050 #f5c84c #7fcf7a #56a8f5 #7b5cf0 #ffffff`.

### Stickies, text, table
- **Sticky:** `type:"text"`, 200×200, `color` = a pastel hex, `styleAttributes: { sticky: true }` (or the Advanced Canvas equivalent).
  - CSS: a filled background in the colour, no border, a small shadow, dark text.
  - Click on the board = default size at that point, then start editing (`setEditing`). Keep **drag from the bar** (`dragOut`) too.
  - The sticky button opens a tiny colour row (the same swatches).
- **Text tool:** `type:"text"` with a "no border, no background" style flag. It looks like loose text on the board, but it is still a card that can be connected.
- **Table:** `addText(at, "| | | |\n|---|---|---|\n| | | |\n| | | |", {width: 420, height: 140})`. This needs no plugin. Leave the Simple Table plugin button in the Widgets popover as it is.

### Shapes
- `type:"text"` (so Obsidian at least shows the label text) plus `styleAttributes: { shape: "<name>" }`. Text inside is centred, and you double-click to type, like a card.
- Render a **`ShapeCard`**: if `node.type === "text"` and it has a shape, render it instead of `TextCard`. Do the switch in `TextCard` or with a small wrapper. `NODE_TYPES` is keyed by the file's `type`.
  - An SVG fills the box: fill = colour at ~25 %, stroke = the colour or `--text-dim`.
  - The `LiveEditor` text sits on top. Keep `Handles` and `Resizer`.
- **Shape path builders** (pure, in `draw.ts`, tested). Each one takes `(w, h)` and returns an SVG `d`:
  - drawer set: rect, ellipse, diamond, triangle, triangle-down, pill, cylinder
  - "More shapes" *Basic* adds: pentagon, octagon, cross, arrow-left, arrow-right, chevron, star, speech-bubble
- **Placing:** with the shape tool, a **click** places a 160×160 shape (a pill is 200×80). A **press-drag** draws it at the dragged size; Shift keeps it square. Do the drag-to-size with your own pointer handlers on the overlay, the same as the pen.
- **Shapes drawer** (see `shapes-drawer.png`): a current-shape dropdown, then the 4 connector styles, the 7 shapes, and **"More shapes"**. Skip the mind-map icon (out of scope).
- **More shapes** = a right-side panel styled like `more-shapes-panel.png`, with:
  - a search box (filters by name)
  - Recents (last 4 shapes used; kept in `localStorage`)
  - Connectors
  - Basic

  **Not** AWS/Azure/Cisco ("Other libraries" is out of scope).

### Connectors (edge styles)
- **Store:**
  - edge `styleAttributes.path`: `"curved"` (default = today), `"elbow"` or `"straight"`. Check Advanced Canvas's names first.
  - Plain line = `toEnd: "none"` (already in the format).
- **Draw:** `LinkView` picks `getBezierPath` / `getSmoothStepPath` / `getStraightPath` by the style.
- **Creating them:**
  - With the connector tool, drag from a card's handle as today; the new edge gets the chosen style.
  - Also let a drag that **starts on empty space** and ends on a card make… nothing. FigJam allows free-floating connectors, but JSON Canvas edges need two nodes. Say so in the help card, and don't build free-floating connectors.
- The edge selection menu gets a style switch (curved / elbow / straight).

### Sections (= groups)
- **Section tool:** press-drag on the board draws a group of that size (a click makes 600×400), then rename starts.
- **Look:** a title chip at the top-left, shown always and not only when selected. The default label is `Section N`, where N = the number of groups + 1.
- The existing "Create group" in the selection menu stays.
- Hide and lock are out of scope (decision 6).

### Bars, minimap, layout
- **Main bar:** rebuild `<Panel position="bottom-center" className="canvas-bar">` in the FigJam order of the table above: select, hand | pen | sticky | shape+connector | text, section, table | widgets, +.
  - Sizes: a rounded pill, ~56 px tall, 40 px icon buttons. The active tool gets `--accent` at ~20 % as its background.
  - A drawer opens **above** the bar in the same pill style (see the crops).
  - Show the bar only when `!readOnly`, as today.
- **Icons:** keep the existing one-path `Icon` helper. The FigJam bar uses big skeuomorphic pen and sticky images; plain line icons are fine. Do not add an icon library (that would be a dependency).
- **Minimap:** `<MiniMap position="bottom-right" pannable zoomable />` from `@xyflow/react`. Style it for the dark board; `nodeColor` takes each node's colour.
  - Move **− / +** (and fit) next to it at the bottom-right, plus **?** for help.
  - Keep undo/redo where they are (top-right).
  - Hide the minimap on the phone (`touch`) or when the canvas is empty.
- **Empty-canvas hint:** update the text to mention the toolbar.
- **Help card:** add the new shortcuts.
- **Phone (`touch`):**
  - The bar can scroll sideways (`overflow-x: auto`) at 375 px.
  - Drawers fit the width.
  - Pen tools: one finger draws.
  - Hand/select: as today.

## Steps and checks
1. Ask the user decisions 1–6 and which branch to use. Ask for approval if you want `perfect-freehand`. → verify: answered.
2. Format: allow `"drawing"` in `parseCanvas` (if they chose 1a). Add the `draw.ts` helpers and the shape paths. → verify: `npm test` in `packages/canvas` passes, with new tests for:
   - `strokeBox` / `smoothPath` / `simplify` / `hitsStroke`
   - each shape path is non-empty and inside its box
   - parse → serialize keeps a drawing node byte-for-byte
   - an Obsidian canvas without drawings is unchanged
3. Tool state + main bar + hand tool + minimap. → verify in the **desktop-web preview** (`.claude/launch.json` → `desktop-web`, port 1420): create a canvas from the sidebar; switch tools with clicks and shortcuts; hand pans; Esc returns to select; the minimap moves the view; no console errors.
4. Pen, highlighter, washi, eraser. → verify: draw 3 strokes, change colour (including custom), resize and move a stroke, erase two strokes in one drag, undo brings both back in one step. Reload the page and the strokes are still there (they are in the file).
5. Sticky, text, table, shapes (+ More shapes panel), connector styles, sections. → verify each by placing one, typing in it, connecting two shapes with each connector style, and reading the saved `.canvas` text: fields present, nothing else changed. Old features still work: double-click card, arrow to empty space, plugin card, note card, reading mode.
6. Phone: run `npm run build:editor` in `apps/mobile`, then use the **mobile-web preview** (`mobile-web`, 390×844 in the Browser pane). Check that the bar scrolls, a drawer fits, one-finger drawing works, and an existing canvas still opens.
7. Run `npx tsc -b` in `apps/desktop` and `apps/mobile`. `progress.md` mentions an older `vite.config.ts` error in desktop; if it is still there, say it is pre-existing. Update `memory-bank/activeContext.md`, `progress.md` and `systemPatterns.md` (the canvas pattern: new node type / style fields). In each, list what is **not verified**: the real Tauri window, a real phone (Samsung, Expo Go), Apple Pencil/stylus pressure, and whether Obsidian keeps drawings.
8. Tell the user it is ready, with screenshots from the preview. **Ask before `npm run ship`** and before any commit.

## Out of scope (don't build)
Stamps, comments, "Other libraries" shapes (AWS/Azure/Cisco), mind-map, free-floating connectors, section hide/lock, a light theme (unless decision 2 says so), multi-user cursors, pressure-sensitive strokes (unless `perfect-freehand` is approved), shape recognition, and exporting the canvas as an image.
