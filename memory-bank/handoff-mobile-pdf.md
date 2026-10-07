# Handoff prompt — PDF reading + "Note PDF" on the phone app (phase 1)

_Written 2026-10-03 by Claude after reading the code. Give this whole file to the AI that will do the work. Everything under "Verified" was read in the repo; everything under "Not verified" was not, so check it before relying on it._

## Your task
Add PDF support to the **phone app** (`apps/mobile`, Expo / React Native, Android first), phase 1 only:
1. A `.pdf` in the vault shows in the phone's sidebar and opens in a **text reader** (reflowed text, not page images).
2. While reading, a **round floating button** (bottom-right, accent colour `colors.accent`, a note icon) opens a **bottom sheet** (like the Popup/calendar sheet) with a note for that PDF.
3. That note is named **`Note PDF – <pdf name>`** (file `Note PDF – <pdf name>.md`, in the PDF's folder). This is only the default: the user can rename it afterwards with the sheet's existing editable heading. It is created on the first tap, never before.

User decisions already made (do not re-ask): note per PDF; text mode first, a page-image mode later; "add selected text to the note" is **phase 2**, not now; ask the user before every `npm run ship`.
Out of scope: editing/annotating the PDF, page-image mode, selection → quote, the desktop app, PDF++ colours/outline/page composer.

## Rules for this repo (from `CLAUDE.md`, they matter)
- Before touching an area read `memory-bank/` (`activeContext.md`, `systemPatterns.md`, `progress.md`, `techContext.md` "OTA updates can't add native modules"). Update `activeContext.md` when done.
- **Ask the user before adding a dependency.** `pdfjs-dist` is already approved for the desktop app; for `apps/mobile` say so and get a yes before installing it there.
- Use real APIs; never mock around a working one. Verify with `npx tsc -b` (not `tsc --noEmit`). No unrequested features, no drive-by edits.
- **Ask the user before `npm run ship`** (it reaches their real phone). Never commit unless asked.
- The working tree has many uncommitted changes by the user (branch `feat/registry-followups`; `origin/main` is ahead, at desktop 0.1.5). Touch only what you need. **First ask the user which base to use**; see the last section.

## Verified (read in the repo)
- **The phone has no PDF code at all.** `apps/mobile/src/vault.ts:71` lists only `.md|.markdown|.canvas` (so PDFs that Drive sync already put on the phone are invisible there). `App.tsx` `openNote` (~line 224) does `fs.readTextFile` and keeps one `open = { rel, text }`; a PDF must bypass that (canvases are the precedent: `isCanvas`, `App.tsx:43`, `:826`, `:844`).
- **Sync moves any file, both ways**, with no size limit (`packages/core-cloud/src/syncEngine.ts`; only text under 1 MB is merged). `expoFs.ts` has `readBinaryFile` / `writeBinaryFile`.
- **The note editor is a WebView whose page is one generated inline HTML string** (`scripts/build-editor.mjs` → `src/editorHtml.ts`, 1.7 MB now). Consequences: no URL to load a worker from; file-URL access flags were deliberately removed for security (`memory-bank/securityReport.md`), so **PDF bytes must reach the page over the bridge** (base64, in chunks) and the page must keep checking `event.source` and the random bridge key (`NoteEditor.tsx`, `editorBridge.ts`). A new page must do the same.
- **A bottom-sheet note already exists**: `Sheet` in `apps/mobile/editor-web/main.tsx` (~line 206): handle, editable heading that renames the file, ⋮ menu, close, saves as you type and on close. But it lives inside the editor page and is only opened by a plugin's `vault.open(path, { beside: true })`.
- **The phone already auto-updates** (this answers the user's worry): `App.tsx:245-252` checks `Updates.checkForUpdateAsync`, fetches and reloads at start. It is the Expo OTA path (`npm run ship` = `eas update --channel preview`, runtimeVersion policy `appVersion`). The Mac's in-app updater is a different mechanism (Tauri) and does not exist on the phone because the phone uses OTA. Limits: **OTA ships JavaScript only**; the installed APK (built 2026-09-24) has no newer native modules, and one OTA that required one crashed the app (`techContext.md`). `pdfjs-dist` is pure JS, so OTA is fine **if you add no native module**.
- Desktop already has the feature (not committed, only in the user's tree, installed via a patched `origin/main` build): `packages/core-notes/src/pdfLink.ts` (`buildPdfLink`, `parsePdfLink`, `pdfBacklinks`, link format `[x.pdf, p.3](Folder/x.pdf#page=3&selection=2,28,3,14)`), viewer in `apps/desktop/src/pages/pdf/`. pdf.js **legacy build** was needed there for macOS 13 WebKit.

## Not verified (check first)
- That `expo-document-picker` is in the installed APK (it is in `package.json`, and an earlier "Open .md…" used it, `progress.md` ~line 194, but check the APK date vs when it was added). Phase 1 can skip an "Add PDF…" button: PDFs arrive by Drive sync. If you add the picker and are not sure, do not.
- How large a PDF the bridge/WebView can take as base64 (a 40 MB file is a 53 MB string). Plan: chunk it, cap (e.g. 30 MB), and show a clear message above the cap. Measure in the web preview, then tell the user it is untested on the Samsung.
- Thai PDFs: extracted text can come out in the wrong order or with detached vowels/tone marks, and scanned PDFs have no text layer at all. Show "This PDF has no selectable text" instead of an empty page. Test with at least one Thai PDF if the user can give one.
- Android System WebView age on the user's phone (Samsung SM-A356E is recent); keep using pdf.js's `legacy` build.

## Design (recommended; challenge it if the code says otherwise)
1. **Separate reader page, not the editor page.** Adding pdf.js (≈0.5 MB + a 1.3 MB worker) to `editorHtml.ts` would slow every note. Build a second generated page (`pdfHtml.ts`, new `scripts/build-pdf.mjs` modelled on `build-editor.mjs`, its own `editor-web`-like folder), loaded only when a PDF opens, with the worker inlined as a Blob URL (or pdf.js's main-thread fallback if a Blob worker fails in the WebView; test which works).
2. **Text mode** = per page `page.getTextContent()`, grouped into lines by `y`, paragraphs by bigger gaps, hyphen-at-line-end joined, one section per page with a small "p. N" label, pages rendered lazily (IntersectionObserver). Put the grouping in a **pure function with node tests**: `packages/core-notes/src/pdfText.ts` + `test/pdfText.test.ts` (shared later by desktop). Keep the page number so phase 2 can link back with `#page=N`.
3. **App side**: a new `PdfScreen` next to `NoteScreen` (same top bar: sidebar button, ⋮). In `App.tsx` branch on `.pdf` like `isCanvas`; never `readTextFile` a PDF. `vault.ts` must list `.pdf` and the sidebar must show it (name keeps `.pdf`, own icon). Moving/duplicating/deleting a PDF through the existing sidebar actions must not read it as text (the desktop had exactly this bug in `moveNote`: it read the PDF as text and would have corrupted it; check every phone path that calls `readTextFile`/`relocateLinks`).
4. **Floating button + sheet**: RN `Pressable` over the reader, `position: 'absolute'`, bottom-right above the safe area. On press: compute the note path (PDF's folder + `Note PDF – <stem>.md`; use `windowsSafe` and reject names the vault can't hold), create it only if missing, then show it in a bottom sheet. Do **not** reuse the single `open` / `latest` / `savedText` note state in `App.tsx` for the sheet; give the sheet its own small component and state (an RN `Modal` or an absolutely positioned panel hosting a `NoteEditor`), save as typing stops and on close, reuse the existing rename op for the heading, and keep the top part of the PDF visible above the sheet. Read `NoteEditor.tsx`/`editorBridge.ts` to see whether a second `NoteEditor` can live next to the reader; if not, say so and propose the alternative before building.
5. A new note may start empty. If you add a first line, make it a link back to the PDF in the desktop format (`buildPdfLink` from `pdfLink.ts`, page = the page on screen) so desktop backlinks work; the desktop only highlights links that carry `selection=`, so a page-only link adds no highlight, which is fine. Ask the user if you want that line.

## Steps and checks
1. Ask the user: which base branch (see below), and approval for `pdfjs-dist` in `apps/mobile`. → verify: both answered.
2. `pdfText.ts` + tests, pure. → verify: `node --test` in `packages/core-notes`, include a two-column page and a hyphenated line.
3. Reader page + build script, then app wiring (listing, `PdfScreen`, no text read). → verify in the Expo web preview (`.claude/launch.json` config `mobile-web`, 390×844 in the Browser pane): seed a PDF in the in-memory fs (`src/memFs.ts`, e.g. through a dynamic import in `javascript_tool`), it appears in the sidebar, opens, shows text, no console errors, other notes still open and edit.
4. Floating button + sheet. → verify in the preview: first tap creates `Note PDF – <name>.md` (and not before), typing saves, rename through the heading works, closing and re-tapping reopens the same note, a second PDF gets its own note.
5. `npx tsc -b` in `apps/mobile`; core-notes tests; update `memory-bank/activeContext.md` (what was done, what is **not** verified on the Samsung).
6. Tell the user it is ready; **ask before `npm run ship`**. After shipping the app applies the update on launch; if it crashes at start, ship a fix immediately and start the app twice (`techContext.md`).

## Base branch (ask the user first)
Desktop PDF code is not on `main` and not committed. For the phone you only need `packages/core-notes/src/pdfLink.ts` if you add the back-link line; it is an untracked file in the user's working tree. Either work in the user's tree (touching only `apps/mobile` and `packages/core-notes`), or have the user commit the desktop PDF work first. Do not commit the user's other uncommitted changes.

## Status check (2026-10-03, after the user created the branch)
- Branch `feat/mobile-pdf` exists, at the same commit as `feat/registry-followups` (`3b7dc20`), with all of the user's uncommitted work in the tree. Step 1's base-branch question is answered: work on this branch.
- `pdfjs-dist` 5.7.284 is in the root `node_modules` only because `apps/desktop` declares it. **`apps/mobile/package.json` does not list it yet**: run `npm install pdfjs-dist@^5 -w mobile` (the user has approved it) before the reader page imports it.
- Step 2 was started by someone: `packages/core-notes/src/pdfText.ts` + `test/pdfText.test.ts` (untracked). **It is not finished**: `node --test` gives 14 pass / 2 fail. (a) "separates items far apart in y into different paragraphs" gets 1 paragraph, (b) the soft-hyphen test gets `con tinue` instead of `continue` (the hyphen is dropped but a space is kept). Also: not exported from `src/index.ts`; code uses single quotes while the package uses double quotes; `groupLines` only compares each item with the line before it, so a two-column page can interleave (the two-column test is too weak to prove it); `hasEOL` and Thai combining marks are ignored. Treat it as a draft: fix the tests/logic, do not trust it.

## Status update (2026-10-03, Claude)
Phase 1 is built and tested in the web preview; see `activeContext.md` "Session 2026-10-03 (phone)". Left: the real phone (ask the user before `npm run ship`), then phase 2.
