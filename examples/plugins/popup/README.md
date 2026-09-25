# Popup

A card in your note that **opens another note as a popup**, drawn in place on desktop and phone.

- Permissions: **Draw its own blocks inside your notes** (`editor.blocks`), **See what you type on an empty line and what you paste**
  (`editor.input`, only for the entry in the `//` list) and **Read your notes** (`vault.read`, to list them, show a preview and open the one you pick).
  It never writes to your notes and has no network. Needs Granite with plugin API 4 (`minApiVersion`).
- Install: from the **Store** tab of Plugins (desktop or phone), or copy this folder to `<vault>/.granite/plugins/popup/`
  (it syncs to your other devices), then switch it on under Plugins on each device.

## Use

- Type **`//`** alone on an empty line and choose **Popup** (tap it, or arrows + Enter; `//po` filters). It sits in the same list as the
  other plugins' entries (Calendar, Table, Dropdown…).
- Pick a note from the list (search by name or folder). The block becomes a card with the note's name and the first lines of its text.
- Tap the card: on the **phone** the note slides up over the page as a bottom sheet (edit it there, pull down to close); on the **desktop** it opens
  in the other half of a split view.
- The pencil picks another note, the bin deletes the card. If the note was renamed or deleted the card says so and offers a new choice.

## How it is stored

As text between ```` ```popup ```` fences, so it stays readable and syncs like any note:

````
```popup
note: Daily/2026-09-25.md
```
````

## Works with the other plugins

It only uses the shared `//` list and `vault.open`, the same calls Calendar uses, so it sits next to any other plugin's blocks in a note, and its entry shows in the `//` list beside theirs
(checked with Calendar, Cards and Dropdown installed together).

## Not there yet

Opening a section of a note instead of the whole note, a popup from inside a table cell or the middle of a sentence, links by `[[name]]` (the card stores the path,
so moving the note in the vault needs a new choice).
