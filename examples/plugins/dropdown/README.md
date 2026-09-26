# Dropdown

A coloured **choice chip** inside a note (a status, a priority…), drawn in place on desktop and phone.

- Permissions: **Draw its own blocks inside your notes** (`editor.blocks`) and **See what you type on an empty line and what you paste**
  (`editor.input`, only for the entry in the `//` list). It never reads your other notes and has no network.
  Needs Granite with plugin API 4 (`minApiVersion`).
- Install: from the **Store** tab of Plugins (desktop or phone), or copy this folder to `<vault>/.granite/plugins/dropdown/`
  (it syncs to your other devices), then switch it on under Plugins on each device.

## Use

- Type **`//`** alone on an empty line and choose **Dropdown** (tap it, or arrows + Enter; `//dr` filters). A chip with four options
  (important, normal, not really, not important) appears.
- Click the chip to open the options and pick one. Picking the chosen one again clears it. Escape closes the list.
- The **pencil** at the bottom of the list edits the options: rename them, click the round colour to pick another, drag the dots to reorder,
  the bin deletes one, **Add another item** adds one, **Done** closes the editor. **Delete dropdown** removes the whole chip.

## How it is stored

As text between ```` ```dropdown ```` fences: the chosen option, then one `name | colour` line per option. It stays readable and syncs like any note:

````
```dropdown
value: normal
important | red
normal | yellow
not really | blue
not important | gray
```
````

Colours: red, orange, yellow, green, teal, blue, purple, pink, brown, gray (an unknown colour reads as gray). A name is one line: `|` is written `/`.

## Not there yet

Several chips chosen at once, a dropdown inside a table cell or in the middle of a sentence, several dropdowns sharing one list of options.
