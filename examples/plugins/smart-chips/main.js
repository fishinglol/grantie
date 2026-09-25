// Smart Chips: paste a link to a site you use (YouTube, Google Docs, GitHub, ...) and Granite offers "Tab to replace with" a chip:
// the site's icon and the page's title. A chip is an ordinary Markdown link, `[Title](url)`, so the note still reads anywhere.
// This file only knows the sites: their name, colour, icon and how to find a title. The editor draws the chips and the offer (plugin API 5).
// Titles come from the address itself when it holds one (GitHub, Reddit, Wikipedia, Notion...) or from the site's public oEmbed
// endpoint (YouTube, Spotify, SoundCloud, TikTok, Vimeo), which is why the plugin asks for the "network" permission. Sites that need a login
// to show a title (Google Docs, Sheets, Drive...) keep their name ("Google Docs"); edit the text in the brackets to rename a chip.

const FETCH_MS = 3500;

// ── little helpers ──
/** Split an address into its host (no `www.`), path pieces (decoded) and query. */
function parts(url) {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean).map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
    return { host: u.hostname.replace(/^www\./, "").toLowerCase(), seg, q: u.searchParams };
  } catch {
    return { host: "", seg: [], q: new URLSearchParams() };
  }
}

/** `my-page_title` → `my page title`, with a capital first letter. */
function words(slug) {
  const s = slug.replace(/[-_+]+/g, " ").replace(/\s+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}

const clip = (s, n = 120) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** JSON from an oEmbed endpoint, or null when it is slow, blocked or not JSON. */
async function getJson(endpoint) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_MS);
  try {
    const res = await fetch(endpoint, { signal: ctl.signal });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const oembed = (base, extra = "") => async (url) => {
  const data = await getJson(`${base}${base.includes("?") ? "&" : "?"}${extra}url=${encodeURIComponent(url)}`);
  return data && typeof data.title === "string" && data.title.trim() ? clip(data.title.trim()) : null;
};

// ── icons: a coloured rounded square with a simple white shape or letter (drawn here, not the sites' own logos) ──
const SHAPES = {
  doc: (f) => `<path d="M4.5 5h7M4.5 8h7M4.5 11h4.5" stroke="${f}" stroke-width="1.4" stroke-linecap="round"/>`,
  grid: (f) => `<path d="M3.6 3.6h8.8v8.8H3.6zM3.6 8h8.8M8 3.6v8.8" stroke="${f}" stroke-width="1.3" fill="none"/>`,
  slides: (f) => `<rect x="3.2" y="4.6" width="9.6" height="6.8" rx="1" stroke="${f}" stroke-width="1.3" fill="none"/>`,
  form: (f) => `<path d="M4 5.2h.1M4 8h.1M4 10.8h.1M6.2 5.2h5.8M6.2 8h5.8M6.2 10.8h5.8" stroke="${f}" stroke-width="1.4" stroke-linecap="round"/>`,
  play: (f) => `<path d="M6 4.6l5.6 3.4L6 11.4z" fill="${f}"/>`,
  pin: (f, bg) => `<path d="M8 13s-3.6-3.5-3.6-6.2a3.6 3.6 0 017.2 0C11.6 9.5 8 13 8 13z" fill="${f}"/><circle cx="8" cy="6.8" r="1.3" fill="${bg}"/>`,
  cal: (f) => `<rect x="3.4" y="4.2" width="9.2" height="8.2" rx="1.2" stroke="${f}" stroke-width="1.3" fill="none"/><path d="M3.4 7h9.2M6 3v2M10 3v2" stroke="${f}" stroke-width="1.2"/>`,
  cam: (f) => `<rect x="3" y="5.4" width="6.6" height="5.2" rx="1.2" fill="${f}"/><path d="M10.4 7.4L13 6v4l-2.6-1.4z" fill="${f}"/>`,
  mail: (f) => `<rect x="3.2" y="4.6" width="9.6" height="6.8" rx="1" stroke="${f}" stroke-width="1.3" fill="none"/><path d="M3.6 5.4L8 8.8l4.4-3.4" stroke="${f}" stroke-width="1.2" fill="none"/>`,
  folder: (f) => `<path d="M3.2 5.2h3.2l1 1.2h5.4v5.4H3.2z" fill="${f}"/>`,
  note: (f) => `<path d="M6.4 11V4.6l5-1v6.4" stroke="${f}" stroke-width="1.2" fill="none"/><circle cx="5.2" cy="11" r="1.3" fill="${f}"/><circle cx="10.2" cy="10" r="1.3" fill="${f}"/>`,
  chat: (f) => `<path d="M3.4 4.4h9.2v5.6H8.4L5.6 12.6V10H3.4z" fill="${f}"/>`,
  code: (f) => `<path d="M6.4 5.4L3.8 8l2.6 2.6M9.6 5.4L12.2 8 9.6 10.6" stroke="${f}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  cart: (f) => `<path d="M3 3.6h1.7l1.2 6h5.2l1-4H5.2" stroke="${f}" stroke-width="1.3" fill="none" stroke-linejoin="round"/><circle cx="6.6" cy="12" r=".9" fill="${f}"/><circle cx="10.6" cy="12" r=".9" fill="${f}"/>`,
};

function icon(color, shape, fg = "#ffffff") {
  const letters = shape.startsWith("t:") ? shape.slice(2) : null;
  const size = letters ? [0, 10, 8, 6.5, 5.5][Math.min(letters.length, 4)] : 0;
  const inner = letters
    ? `<text x="8" y="${8 + size * 0.36}" font-size="${size}" font-weight="700" font-family="Arial,Helvetica,sans-serif" text-anchor="middle" fill="${fg}">${letters}</text>`
    : SHAPES[shape](fg, color);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="4" fill="${color}"/>${inner}</svg>`;
}

// ── titles that can be read off the address itself ──
function githubTitle(url) {
  const { seg } = parts(url);
  if (seg.length === 0) return null;
  if (seg.length === 1) return seg[0];
  const repo = `${seg[0]}/${seg[1]}`;
  if (seg[2] === "issues" && seg[3]) return `${repo} · Issue #${seg[3]}`;
  if (seg[2] === "pull" && seg[3]) return `${repo} · PR #${seg[3]}`;
  if (seg[2] === "commit" && seg[3]) return `${repo} · ${seg[3].slice(0, 7)}`;
  if ((seg[2] === "blob" || seg[2] === "tree") && seg.length > 4) return `${repo} · ${seg[seg.length - 1]}`;
  return repo;
}

function xTitle(url) {
  const { seg } = parts(url);
  if (seg.length === 0 || ["i", "home", "explore", "search", "hashtag"].includes(seg[0])) return null;
  return seg[1] === "status" ? `Post by @${seg[0]}` : `@${seg[0]}`;
}

function redditTitle(url) {
  const { seg } = parts(url);
  if (seg[0] !== "r" || !seg[1]) return seg[0] === "user" && seg[1] ? `u/${seg[1]}` : null;
  return seg[2] === "comments" && seg[4] ? `${words(seg[4])} · r/${seg[1]}` : `r/${seg[1]}`;
}

function wikipediaTitle(url) {
  const { seg } = parts(url);
  return seg[0] === "wiki" && seg[1] ? `${seg[1].replace(/_/g, " ")} – Wikipedia` : null;
}

function stackTitle(url) {
  const { seg } = parts(url);
  return seg[0] === "questions" && seg[2] ? words(seg[2]) : null;
}

function mediumTitle(url) {
  const { seg } = parts(url);
  const last = seg[seg.length - 1];
  if (!last || seg[0] === "tag") return null;
  return last.startsWith("@") ? last : words(last.replace(/-[0-9a-f]{10,12}$/, ""));
}

function notionTitle(url) {
  const last = parts(url).seg.pop();
  if (!last) return null;
  const slug = last.replace(/-?[0-9a-f]{32}$/i, "");
  return slug && slug !== last ? words(slug) : null;
}

function figmaTitle(url) {
  const { seg } = parts(url);
  return ["file", "design", "proto", "board", "slides"].includes(seg[0]) && seg[2] ? words(seg[2]) : null;
}

function linkedinTitle(url) {
  const { seg } = parts(url);
  if (!["in", "company", "school"].includes(seg[0]) || !seg[1]) return null;
  // `/in/jane-doe-1a2b3c4d5`: the trailing id (letters and digits mixed) is not part of the name.
  return words(seg[1].replace(/-(?=[0-9a-z]*\d)[0-9a-z]{8,10}$/i, "")).replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function instagramTitle(url) {
  const { seg } = parts(url);
  if (["p", "reel", "reels", "tv"].includes(seg[0])) return seg[0] === "p" ? "Instagram post" : "Instagram reel";
  return seg[0] && !["explore", "accounts", "stories"].includes(seg[0]) ? `@${seg[0]} on Instagram` : null;
}

function handleTitle(site, prefix = "@") {
  return (url) => {
    const { seg } = parts(url);
    return seg[0] && !["videos", "directory", "settings", "downloads", "search"].includes(seg[0]) ? `${prefix}${seg[0].replace(/^@/, "")} on ${site}` : null;
  };
}

function mapsTitle(url) {
  const { seg } = parts(url);
  const at = seg.indexOf("place");
  const place = at >= 0 && seg[at + 1] ? seg[at + 1] : parts(url).q.get("q");
  return place ? clip(place.replace(/\+/g, " ")) : null;
}

function meetTitle(url) {
  const code = parts(url).seg[0];
  return code && /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i.test(code) ? `Meet · ${code}` : null;
}

function npmTitle(url) {
  const { seg } = parts(url);
  return seg[0] === "package" && seg[1] ? (seg[1].startsWith("@") && seg[2] ? `${seg[1]}/${seg[2]}` : seg[1]) : null;
}

const pypiTitle = (url) => {
  const { seg } = parts(url);
  return seg[0] === "project" && seg[1] ? seg[1] : null;
};

const arxivTitle = (url) => {
  const { seg } = parts(url);
  return (seg[0] === "abs" || seg[0] === "pdf") && seg[1] ? `arXiv:${seg[1].replace(/\.pdf$/, "")}` : null;
};

const ownerRepoTitle = (url) => {
  const { seg } = parts(url);
  return seg.length >= 2 ? `${seg[0]}/${seg[1]}` : seg[0] || null;
};

// ── the sites ──
// [id, name, label (until a title is found), hosts, colour, icon shape, text colour on the icon, title(url)]
const SITES = [
  ["gdocs", "Google Docs", "Google Docs", ["docs.google.com/document"], "#4285f4", "doc"],
  ["gsheets", "Google Sheets", "Google Sheets", ["docs.google.com/spreadsheets"], "#0f9d58", "grid"],
  ["gslides", "Google Slides", "Google Slides", ["docs.google.com/presentation"], "#f4b400", "slides"],
  ["gforms", "Google Forms", "Google Forms", ["docs.google.com/forms", "forms.gle"], "#7248b9", "form"],
  ["gdrive", "Google Drive", "Google Drive file", ["drive.google.com"], "#1fa463", "folder"],
  ["gcal", "Google Calendar", "Google Calendar", ["calendar.google.com"], "#4285f4", "cal"],
  ["gmail", "Gmail", "Gmail", ["mail.google.com"], "#ea4335", "mail"],
  ["gmeet", "Google Meet", "Google Meet", ["meet.google.com"], "#00897b", "cam", "#fff", meetTitle],
  ["gmaps", "Google Maps", "Google Maps", ["google.com/maps", "maps.google.com", "maps.app.goo.gl", "goo.gl/maps"], "#34a853", "pin", "#fff", mapsTitle],
  ["youtube", "YouTube", "YouTube video", ["youtube.com", "youtu.be"], "#ff0000", "play", "#fff", oembed("https://www.youtube.com/oembed", "format=json&")],
  ["spotify", "Spotify", "Spotify", ["open.spotify.com", "spotify.link"], "#1db954", "note", "#fff", oembed("https://open.spotify.com/oembed")],
  ["soundcloud", "SoundCloud", "SoundCloud", ["soundcloud.com"], "#ff5500", "t:S", "#fff", oembed("https://soundcloud.com/oembed", "format=json&")],
  ["vimeo", "Vimeo", "Vimeo video", ["vimeo.com"], "#1ab7ea", "play", "#fff", oembed("https://vimeo.com/api/oembed.json")],
  ["tiktok", "TikTok", "TikTok video", ["tiktok.com"], "#111111", "t:♪", "#fff", oembed("https://www.tiktok.com/oembed")],
  ["twitch", "Twitch", "Twitch", ["twitch.tv"], "#9146ff", "t:T", "#fff", handleTitle("Twitch", "")],
  ["netflix", "Netflix", "Netflix", ["netflix.com"], "#e50914", "t:N"],
  ["applemusic", "Apple Music", "Apple Music", ["music.apple.com"], "#fa243c", "note"],
  ["podcasts", "Apple Podcasts", "Podcast", ["podcasts.apple.com"], "#9933cc", "t:P"],
  ["bilibili", "Bilibili", "Bilibili video", ["bilibili.com", "b23.tv"], "#00a1d6", "play"],
  ["x", "X", "X", ["x.com", "twitter.com"], "#111111", "t:X", "#fff", xTitle],
  ["threads", "Threads", "Threads", ["threads.net", "threads.com"], "#111111", "t:@", "#fff", handleTitle("Threads")],
  ["bluesky", "Bluesky", "Bluesky", ["bsky.app"], "#1185fe", "t:B", "#fff", (url) => { const { seg } = parts(url); return seg[0] === "profile" && seg[1] ? `@${seg[1]} on Bluesky` : null; }],
  ["reddit", "Reddit", "Reddit", ["reddit.com", "redd.it"], "#ff4500", "t:R", "#fff", redditTitle],
  ["instagram", "Instagram", "Instagram", ["instagram.com"], "#e1306c", "t:IG", "#fff", instagramTitle],
  ["facebook", "Facebook", "Facebook", ["facebook.com", "fb.com", "fb.watch"], "#1877f2", "t:f", "#fff"],
  ["linkedin", "LinkedIn", "LinkedIn", ["linkedin.com"], "#0a66c2", "t:in", "#fff", linkedinTitle],
  ["pinterest", "Pinterest", "Pinterest", ["pinterest.com", "pin.it"], "#e60023", "t:P"],
  ["line", "LINE", "LINE", ["line.me", "lin.ee"], "#06c755", "chat"],
  ["telegram", "Telegram", "Telegram", ["t.me", "telegram.me"], "#26a5e4", "t:T", "#fff", handleTitle("Telegram")],
  ["whatsapp", "WhatsApp", "WhatsApp chat", ["wa.me", "whatsapp.com"], "#25d366", "chat"],
  ["discord", "Discord", "Discord", ["discord.com", "discord.gg"], "#5865f2", "chat"],
  ["slack", "Slack", "Slack", ["slack.com"], "#4a154b", "t:#", "#fff"],
  ["zoom", "Zoom", "Zoom meeting", ["zoom.us"], "#2d8cff", "cam"],
  ["teams", "Microsoft Teams", "Teams meeting", ["teams.microsoft.com", "teams.live.com"], "#6264a7", "t:T", "#fff"],
  ["onedrive", "OneDrive", "OneDrive file", ["onedrive.live.com", "1drv.ms", "sharepoint.com"], "#0078d4", "folder"],
  ["dropbox", "Dropbox", "Dropbox file", ["dropbox.com"], "#0061ff", "folder"],
  ["notion", "Notion", "Notion page", ["notion.so", "notion.site"], "#37352f", "t:N", "#fff", notionTitle],
  ["figma", "Figma", "Figma file", ["figma.com"], "#a259ff", "t:F", "#fff", figmaTitle],
  ["canva", "Canva", "Canva design", ["canva.com"], "#00a3b4", "t:C", "#fff"],
  ["miro", "Miro", "Miro board", ["miro.com"], "#ffd02f", "t:M", "#050038"],
  ["trello", "Trello", "Trello board", ["trello.com"], "#0052cc", "grid"],
  ["jira", "Jira", "Jira", ["atlassian.net"], "#0052cc", "t:J", "#fff"],
  ["linear", "Linear", "Linear", ["linear.app"], "#5e6ad2", "t:L", "#fff"],
  ["asana", "Asana", "Asana", ["asana.com"], "#f06a6a", "t:A", "#fff"],
  ["airtable", "Airtable", "Airtable", ["airtable.com"], "#fcb400", "grid", "#111"],
  ["github", "GitHub", "GitHub", ["github.com", "gist.github.com"], "#24292f", "code", "#fff", githubTitle],
  ["gitlab", "GitLab", "GitLab", ["gitlab.com"], "#fc6d26", "code", "#fff", ownerRepoTitle],
  ["huggingface", "Hugging Face", "Hugging Face", ["huggingface.co"], "#ffd21e", "t:HF", "#111", ownerRepoTitle],
  ["codepen", "CodePen", "CodePen", ["codepen.io"], "#111111", "code"],
  ["stackoverflow", "Stack Overflow", "Stack Overflow question", ["stackoverflow.com", "stackexchange.com"], "#f48024", "t:S", "#fff", stackTitle],
  ["npm", "npm", "npm package", ["npmjs.com"], "#cb3837", "t:n", "#fff", npmTitle],
  ["pypi", "PyPI", "PyPI project", ["pypi.org"], "#3775a9", "t:Py", "#fff", pypiTitle],
  ["kaggle", "Kaggle", "Kaggle", ["kaggle.com"], "#20beff", "t:K", "#fff"],
  ["arxiv", "arXiv", "arXiv paper", ["arxiv.org"], "#b31b1b", "t:X", "#fff", arxivTitle],
  ["wikipedia", "Wikipedia", "Wikipedia", ["wikipedia.org"], "#4b5563", "t:W", "#fff", wikipediaTitle],
  ["medium", "Medium", "Medium article", ["medium.com"], "#111111", "t:M", "#fff", mediumTitle],
  ["imdb", "IMDb", "IMDb", ["imdb.com"], "#f5c518", "t:IMDb", "#111"],
  ["chatgpt", "ChatGPT", "ChatGPT chat", ["chatgpt.com", "chat.openai.com"], "#10a37f", "chat"],
  ["claude", "Claude", "Claude chat", ["claude.ai"], "#d97757", "chat"],
  ["amazon", "Amazon", "Amazon product", ["amazon.com", "amzn.to", "amazon.co.uk", "amazon.de", "amazon.co.jp"], "#ff9900", "cart", "#111"],
  ["shopee", "Shopee", "Shopee product", ["shopee.co.th", "shopee.com", "shopee.sg", "shopee.ph", "shopee.vn", "shopee.co.id"], "#ee4d2d", "cart"],
  ["lazada", "Lazada", "Lazada product", ["lazada.co.th", "lazada.com", "lazada.sg", "lazada.com.my", "lazada.vn"], "#0f146d", "cart"],
  ["pantip", "Pantip", "Pantip topic", ["pantip.com"], "#6b5b95", "t:P", "#fff"],
];

const PROVIDERS = SITES.map(([id, name, label, hosts, color, shape, fg, title]) => ({
  id,
  name,
  label,
  hosts,
  color,
  icon: icon(color, shape, fg),
  ...(title && { title }),
}));

if (typeof granite !== "undefined") granite.links.register(PROVIDERS);

if (typeof __chipsTest !== "undefined") Object.assign(__chipsTest, { PROVIDERS, parts, words, githubTitle, xTitle, redditTitle, wikipediaTitle, notionTitle, mediumTitle, mapsTitle, icon });
