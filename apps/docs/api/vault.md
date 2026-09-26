# `vault`

## `vault.list()`

`vault.read` — `(): Promise<string[]>` — vault-relative paths of every note, e.g. `Projects/plan.md`.

## `vault.read(path)`

`vault.read` — `(path: string): Promise<string>` — a note's text.

## `vault.write(path, text)`

`vault.write` — `(path: string, text: string): Promise<void>` — writes a note. Only `.md`/`.markdown` files
inside the vault; the hidden `.granite/` folder can never be reached this way.

## `vault.open(path, options?)` (API 3, `{ beside }` since API 4)

```ts
open(path: string, options?: { beside?: boolean }): Promise<void>
```

`vault.read` — opens a note in the editor in place of the one currently showing. With `{ beside: true }`, a
desktop window opens it in the other half of a split view (creating one if there isn't one already), so the
note you called this from stays visible; on the phone it opens full-screen with a button back to where you
came from.

## Every path is checked

Whatever a plugin passes to `vault.read`/`vault.write`/`vault.open`, it's validated before touching disk
(`safeNotePath`):

- must be a relative, vault-internal path (no leading `/`, no `\`, no `C:`-style scheme)
- no path segment may be empty, `.`, `..`, or start with a dot (so `.granite/` and any other hidden folder is
  always out of reach)
- must end in `.md` or `.markdown`

A path that fails any of these throws instead of silently doing something else — build error handling around
that.

```js
granite.commands.add({
  id: "new-daily-note",
  name: "Open today's daily note",
  run: async () => {
    const path = `Daily/${new Date().toISOString().slice(0, 10)}.md`;
    const notes = await granite.vault.list();
    if (!notes.includes(path)) await granite.vault.write(path, "# Today\n");
    await granite.vault.open(path, { beside: true });
  },
});
```

See [`popup`](https://github.com/fishinglol/grantie/tree/main/examples/plugins/popup) and
[`calendar`](https://github.com/fishinglol/grantie/tree/main/examples/plugins/calendar) for real uses of
`vault.open`.
