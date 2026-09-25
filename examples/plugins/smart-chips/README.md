# Smart Chips

Paste a link and turn it into a **chip**: the site's icon and the page's title, in a small rounded box, like Google Docs' smart chips.
Works on desktop and phone.

- Permissions: **Show links to known sites as chips** (`editor.links`) and **Use the internet** (`network`). The internet is used for one
  thing: when you paste a link to YouTube, Spotify, SoundCloud, TikTok or Vimeo, the plugin asks *that site's own* public oEmbed endpoint
  for the title (the pasted address is sent to that site, and nowhere else). It never reads your notes.
  Needs Granite with plugin API 5 (`minApiVersion`).
- Install: from the **Store** tab of Plugins (desktop or phone), or copy this folder to `<vault>/.granite/plugins/smart-chips/`
  (it syncs to your other devices), then switch it on under Plugins on each device.

## Use

1. Paste a web address (alone) into a note. It stays as text, with a small bar above it: **Tab to replace with** `[icon] Title`.
2. Press **Tab** (on a phone, tap the bar) and the address becomes a chip. Anything else you do (typing, moving the cursor, Escape) leaves it as text.
3. Click a chip to open the page in your browser. (For a normal link, Ctrl/Cmd-click.)

Links you already have in a note, `[text](url)` to any of these sites, are drawn as chips as soon as the plugin is on.

## Sites

Google Docs / Sheets / Slides / Forms / Drive / Calendar / Gmail / Meet / Maps, YouTube, Spotify, SoundCloud, Vimeo, TikTok, Twitch, Netflix, Apple Music
and Podcasts, Bilibili, X, Threads, Bluesky, Reddit, Instagram, Facebook, LinkedIn, Pinterest, LINE, Telegram, WhatsApp, Discord, Slack, Zoom, Teams,
OneDrive, Dropbox, Notion, Figma, Canva, Miro, Trello, Jira, Linear, Asana, Airtable, GitHub, GitLab, Hugging Face, CodePen, Stack Overflow, npm, PyPI,
Kaggle, arXiv, Wikipedia, Medium, IMDb, ChatGPT, Claude, Amazon, Shopee, Lazada, Pantip.

Where the title comes from: the site's oEmbed endpoint (YouTube, Spotify, SoundCloud, TikTok, Vimeo), the address itself (GitHub `owner/repo · PR #12`,
Reddit, Wikipedia, Notion, Figma, Stack Overflow, Medium, Google Maps place names, X `Post by @name`…), or otherwise the site's name ("Google Docs").
Pages that need you to be signed in (Google Docs, Sheets, Drive…) cannot show their real title; edit the text between the brackets to rename a chip.
The icons are simple coloured shapes and letters drawn by the plugin, not the sites' own logos.

## How it is stored

An ordinary Markdown link: `[Rick Astley - Never Gonna Give You Up](https://www.youtube.com/watch?v=dQw4w9WgXcQ)`. Without the plugin it is just a link.

## Add a site

Add a line to `SITES` in `main.js`: `[id, name, label, hosts, colour, icon, text colour, title(url)]`. `hosts` are `example.com` (and its subdomains) or
`example.com/path` (only that path). Then it is the editor (plugin API 5, `granite.links.register`) that draws the chips.

## Not there yet

Pasting over selected text to link it, chips for a bare address that was not pasted, other websites (no title can be read without the page's own
permission), the sites' real logos, a hover card.
