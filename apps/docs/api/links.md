# `links`

`editor.links`

## `links.register(provider)`

```ts
register(provider: LinkProviderInfo | LinkProviderInfo[]): Promise<void>

interface LinkProviderInfo {
  id: string;
  name: string;
  label?: string;
  hosts: string[];
  color: string;
  icon: string; // a small <svg>, no scripts or links
  title?: (url: string) => string | null | Promise<string | null>;
}
```

Describes one or more sites so that:

- a Markdown link `[Title](url)` to one of them is drawn as a chip (icon + title), and
- pasting a matching address offers **"Tab to replace with"** that chip.

`hosts` entries are a domain (`youtube.com`, matching subdomains too) or a domain **plus path**
(`docs.google.com/document`, matching only that path) — the most specific match wins when more than one
provider could match a URL. `title(url)` is called when a matching address is pasted, to ask for the page's
real title; return `null` to fall back to `label`. It has 5 seconds, and may use `fetch` if the manifest also
declares `network`.

```js
granite.links.register({
  id: "youtube",
  name: "YouTube",
  hosts: ["youtube.com", "youtu.be"],
  color: "#ff0000",
  icon: "<svg>...</svg>",
  title: async (url) => {
    const res = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`);
    return res.ok ? (await res.json()).title ?? null : null;
  },
});
```

## `links.chip(url)`

`(url: string): Promise<{ name; label; color; icon } | null>` — how a link to `url` would be drawn (icon
colour, name), according to whichever running plugin's `register` call knows that site — or `null` if none
does. `icon` here is an image URL, not raw SVG. Useful for a block that draws its own link chips (Simple
Table's table cells use this) rather than relying on the editor's own rendering.

## `links.title(url)`

`(url: string): Promise<string | null>` — the page's title, asked of whichever plugin knows the site (it may
fetch it, up to 5 seconds), or `null`.

## `links.open(url)`

`(url: string): Promise<void>` — opens an `http`/`https` address in the system browser.

See [`smart-chips`](https://github.com/fishinglol/grantie/tree/main/examples/plugins/smart-chips) for a full
`register` implementation covering ~66 sites.
