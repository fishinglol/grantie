## What plugin, and what changed

<!-- New plugin, or a change to an existing one? One or two sentences. -->

## Checklist (see CONTRIBUTING.md)

- [ ] `id` equals the folder name and is not used by another plugin
- [ ] `version` raised (if this changes an existing plugin)
- [ ] `permissions` are only what the code uses, and the README says why each is needed
- [ ] `main.js` is plain, readable JavaScript (not minified, no bundled libraries)
- [ ] No `eval`, no remote scripts, note text is never used as HTML
- [ ] Works on the phone, or `"desktopOnly": true`
- [ ] `npm test --workspace @granite/plugins` passes

## How I tested it

<!-- Desktop / phone, and what you tried. Say what you could not test. -->
