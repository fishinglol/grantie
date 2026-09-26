# Live Collab

Edit one note together with other people, at the same time, like Google Docs. You see their cursor and the text they select, with their name and colour, and their typing appears as they type.

It is a Granite plugin (plugin API 7: `editor.sync` to follow the note, `ui.panel` for the Share button and window). The plugin holds the shared text with [Yjs](https://yjs.dev) and talks to a small **relay** that passes the edits between people.

**Everything is end-to-end encrypted.** The invite holds a secret that never leaves the devices. What the relay sees is a hash of it (the room's name) and encrypted blobs it cannot read (AES-GCM, key derived from the secret). So the relay can be Granite's shared one: it cannot read your notes.

## Use it

Needs Granite with plugin API 7 (the **Share** button). Install *Live Collab* from the Store and switch it on; a **Share** button appears at the top right of every note (a pill on the phone).

1. **Start:** open the note, press **Share → Start sharing**. Live Collab puts an invite block at the top of the note (below its properties) and connects. The window now lists who is in the note, with their cursor colours. (The gear ⚙ sets your name, and, if you want, your own server; see below.)
2. **Invite:** press **Copy link** and send it. Your friend presses **Share**, pastes it into *Join someone else's note* and presses **Join**: it opens as a new note (`Shared note ….md`) holding your text. You see each other's cursors and typing.
3. **Stop:** **Share → Leave the live session**. Opening another note also ends it. Each person's own copy of the note is a normal `.md` file the whole time.

The old way still works: `//` → *Live session* inserts the invite block, and the note's `⋯` menu has *Go live with this note* / *Leave the live session*. A pasted ```` ```collab ```` block joins too.

If a note that already has text joins a room, its text is first saved as `Live Collab backup <date>.md`, then the note becomes the room's text. A note that is *only* the invite can't start a room: the person who made the invite has to go live first. An empty note can't be shared (there is nothing to share).

## Which relay?

- **Granite's relay** (built in once `DEFAULT_SERVER` in `src/invite.ts` is set, see the next section): nothing to set up. If it is not set yet, the Share window asks for a server address the first time.
- **Your own**: put its `wss://` address in the ⚙ settings of the Share window (it is kept in a note called `Live Collab`). Two ways to run one are below.

## Run the relay on Cloudflare (for whoever maintains Granite's relay)

A Cloudflare Worker with one Durable Object per room. It needs no computer of your own, has a permanent `wss://` address and fits the free plan. Once:

1. Make a free account at <https://dash.cloudflare.com> (the first deploy also asks you to choose a `workers.dev` name).
2. In this folder: `npx wrangler login` (opens the browser), then `npx wrangler deploy`.
3. It prints `https://granite-live.<your-name>.workers.dev`. The relay's address is that with `wss://` instead of `https://`.
4. Put it in `DEFAULT_SERVER` in `src/invite.ts`, run `npm run build`, raise `version` in `manifest.json` and `package.json`, and ship the plugin. People who update get the built-in relay.

The Worker keeps nothing on disk and forgets a room when the last person leaves. A room takes at most 20 people and about 4 MB of edits in one session (a very long session with a lot of typing can fill it: the window then says so and you start a new one). One address may open at most 30 connections a minute (the `JOIN_LIMIT` rate limit in `wrangler.toml`, which needs wrangler 4.36 or later), so nobody can use up the relay everyone shares. The Node relay (`npm run server`) takes at most 1000 rooms and 20 connections from one address.

## Run your own relay on your computer

```
cd examples/plugins/live-collab
npm install
npm run server          # listens on port 1234 (PORT=… to change)
```

The plugin needs a `wss://` address (a TLS one). Two easy ways to get one for the server running on your Mac:

- **Cloudflare Tunnel** (free, no account for a quick one): `cloudflared tunnel --url http://localhost:1234` prints an `https://….trycloudflare.com` address; use `wss://….trycloudflare.com` as your server. It changes each time you start it.
- **Any host with TLS** (Fly.io, Render, a VPS behind Caddy/nginx): run `npm run server` there and use `wss://your-host`.

## What the relay (and anyone in between) can and cannot see

- **Cannot:** the note's text, names, cursors, who is where. All of it is encrypted with a key only the people with the invite have.
- **Can:** that somebody connected to a room (the room's hashed name, when, from which network address), how much data goes through, and that it goes on. It could drop or replay messages (it cannot forge them: a changed message fails to decrypt and is ignored).
- **Whoever has the invite** can read and edit the note and join later, so treat an invite like a link to a shared document. The invite also travels inside the shared text (the block at the top), so everyone in the room has it. To cut someone off, start a new session from a fresh invite.

## Limits (what is not done or not checked)

- **Chrome-based browsers block a plugin from opening plain `ws://` to `localhost` or your home network** ("local network" protection), which is why the plugin asks for `wss://`. A manifest `connect` list can name `ws://` servers, but that only helps where the browser allows it.
- Encryption uses the browser's WebCrypto, which needs a secure page. If a device does not have it, the window says live editing is switched off; it never falls back to unencrypted. **Not checked on a real phone** (the WebView's page may or may not count as secure).
- The Share window was checked in the desktop and phone-sized web previews (button, window, settings, error message, note properties kept) and, with the real `main.js` and the real Node relay, in a Node test that presses its buttons (start, copy, join, leave) and shows the relay only ever holds unreadable data. The Cloudflare Worker's wiring is tested with stand-ins for Cloudflare's objects; **it has not been run on Cloudflare yet**.
- Not checked: **Copy link** in a real phone WebView (a fallback is the selectable link field), the real Tauri window, over the internet, or with Google Drive sync running on both sides. With Drive on, each device saves the shared text to its own file and Drive syncs those files as usual; if both files change between two syncs, Granite's three-way merge handles it, but that combination is untested.
- One live note at a time. No canvas pointers, no chat, no accounts: an invite is a link, not an e-mail address. If the connection drops, what you type is kept and shared when it returns.

## Build

`main.js` is generated from `src/` and bundles Yjs and the encrypted relay client (`npm run build`). `npm test` runs the unit tests and an end-to-end test (the real `main.js` and Node relay, two simulated editors).
