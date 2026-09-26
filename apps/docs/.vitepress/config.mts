import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Granite Plugins",
  description: "Build plugins for Granite — one JavaScript file, sandboxed, running the same on desktop and phone.",
  head: [["link", { rel: "icon", href: "/favicon.png" }]],
  cleanUrls: true,
  themeConfig: {
    logo: "/logo.png",
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "API reference", link: "/api/" },
      { text: "Examples", link: "/guide/examples" },
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
