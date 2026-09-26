import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Granite Plugins",
  description: "Build plugins for Granite — one JavaScript file, sandboxed, running the same on desktop and phone.",
  head: [["link", { rel: "icon", href: "/favicon.png" }]],
  cleanUrls: true,
  // A plugin's own page: its name and tagline as the title and description, and the first screenshot as the picture a shared link shows.
  transformPageData(pageData) {
    const plugin = pageData.params as { name?: string; tagline?: string; description?: string; screenshots?: string[] } | undefined;
    if (!plugin?.name) return;
    const site = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "granite-docs-phi.vercel.app"}`;
    const description = plugin.tagline || plugin.description || "";
    pageData.title = plugin.name;
    pageData.description = description;
    pageData.frontmatter.head = [
      ["meta", { property: "og:title", content: `${plugin.name} — Granite plugin` }],
      ["meta", { property: "og:description", content: description }],
      ["meta", { property: "og:image", content: `${site}${plugin.screenshots?.[0] ?? ""}` }],
      ["meta", { name: "twitter:card", content: "summary_large_image" }],
    ];
  },
  themeConfig: {
    logo: "/logo.png",
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "API reference", link: "/api/" },
      { text: "Examples", link: "/guide/examples" },
      { text: "Plugins", link: "/plugins/" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "The manifest", link: "/guide/manifest" },
          { text: "Permissions & the sandbox", link: "/guide/permissions" },
          { text: "Publishing to the Store", link: "/guide/publishing" },
          { text: "Example plugins", link: "/guide/examples" },
        ],
      },
      {
        text: "API reference",
        items: [
          { text: "Overview", link: "/api/" },
          { text: "commands", link: "/api/commands" },
          { text: "editor", link: "/api/editor" },
          { text: "blocks", link: "/api/blocks" },
          { text: "input", link: "/api/input" },
          { text: "links", link: "/api/links" },
          { text: "ui", link: "/api/ui" },
          { text: "vault", link: "/api/vault" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/fishinglol/grantie" }],
    search: { provider: "local" },
    footer: {
      message: "Granite plugins run in a sandbox with declared permissions — nothing is granted implicitly.",
    },
  },
});
