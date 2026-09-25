# Live Collab

Edit one note together with other people, at the same time, like Google Docs. You see their cursor and the text they select, with their name and colour, and their typing appears as they type.

It is a Granite plugin (plugin API 6, permission `editor.sync`). The plugin holds the shared text with [Yjs](https://yjs.dev) and talks to a small **relay server that you run yourself**. Nothing goes through anyone else's server.

## Use it

1. **Once:** install *Live Collab* from the Store and switch it on. Make a note called `Live Collab` with two lines:
   ```
   name: Ann
   server: wss://your-server.example.com
   ```
   (`//` → *Live session* makes this note for you the first time.) `name` is what others see next to your cursor.
2. **Start:** in the note you want to share, type `//` on an empty line and choose **Live session**. It puts an invite block in the note (the server from your settings note and a fresh secret room id). Then open the note's `⋯` menu and choose **Go live with this note**.
3. **Invite:** send the invite block (the ```` ```collab ```` lines) to a friend. They paste it into an **empty** note and choose **Go live with this note** too. They now have your note's text, and you see each other's cursors.
4. **Stop:** `⋯` → **Leave the live session**. Opening another note also ends it. Each person's own copy of the note is a normal `.md` file the whole time.

If a note that already has text joins a room, its text is first saved as `Live Collab backup <date>.md`, then the note becomes the room's text. A note that is *only* the invite can't start a room: the person who made the invite has to go live first.

## Run the server

```
cd examples/plugins/live-collab
npm install
npm run server          # listens on port 1234 (PORT=… to change)
```

The plugin needs a `wss://` address (a TLS one). Two easy ways to get one for the server running on your Mac:

- **Cloudflare Tunnel** (free, no account for a quick one): `cloudflared tunnel --url http://localhost:1234` prints an `https://….trycloudflare.com` address; use `wss://….trycloudflare.com` as `server:`. It changes each time you start it.
- **Any host with TLS** (Fly.io, Render, a VPS behind Caddy/nginx): run `npm run server` there and put `wss://your-host` in the settings note.

The server keeps nothing on disk and forgets a room when the last person leaves. It only accepts rooms whose id is 32 random letters and digits, so nobody can stumble onto one. **Whoever knows the room id can join, and the server can read the text that passes through it** (it is not end-to-end encrypted). Treat an invite like a link to a shared document, and run the server yourself.

## Limits (what is not done or not checked)

- **Chrome-based browsers block a plugin from opening plain `ws://` to `localhost` or your home network** ("local network" protection), which is why the plugin asks for `wss://`. A manifest `connect` list can name `ws://` servers, but that only helps where the browser allows it.
- Checked with the real plugin, the real server and two real editors in Chrome (headless, with that protection switched off for the test) and in Node. **Not checked:** on a phone, in the real Tauri window, over the internet, or with Google Drive sync running on both sides. With Drive on, each device saves the shared text to its own file and Drive syncs those files as usual; if both files change between two syncs, Granite's three-way merge handles it, but that combination is untested.
- One live note at a time. No canvas pointers, no chat, no "who is here" list (you get a message when someone joins or leaves). If the connection drops, what you type is kept and shared when it returns.
- The invite block travels inside the shared text, so everyone in the room can see (and could edit) the room id.

## Build

`main.js` is generated from `src/` and bundles Yjs and the websocket client (`npm run build`). `npm test` runs the unit tests and an end-to-end test (the real `main.js` and server, two simulated editors).
