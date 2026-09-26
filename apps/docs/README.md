# Granite Plugins docs

The plugin-developer site, built with [VitePress](https://vitepress.dev). Content only; the plugin system
itself lives in `packages/plugins` and `examples/plugins/`.

```bash
npm install        # from the repo root
npm run dev -w @granite/docs
npm run build -w @granite/docs   # outputs apps/docs/.vitepress/dist
```

## Deploying (Vercel)

**`grantie.vercel.app` is Granite's real marketing site (a separate project — its source isn't in this repo).
Do not point it at `apps/docs`; that would replace the live marketing site.**

Deploy this as its **own, separate** Vercel project instead (Vercel → Add New → Project, same GitHub repo,
a distinct project name):

- **Root Directory**: `apps/docs`
- **Framework preset**: VitePress (or, if not offered, Build command `npm run build`, Output directory
  `.vitepress/dist`, Install command `npm install` — run from the monorepo root so workspace linking works)

A new project gets its own `<something>.vercel.app` domain by default; attach a custom subdomain (e.g.
`docs.granite.app` or `plugins.granite.app`) in that project's Settings → Domains if you want one. This is a
one-time dashboard setup that a code change here can't do by itself.

## Updating content

- `guide/` — getting started, manifest reference, permissions, publishing, examples.
- `api/` — one page per `GraniteApi` namespace. The source of truth for signatures is
  [`packages/plugins/src/api.ts`](../../packages/plugins/src/api.ts) — when that file's public shape changes,
  update the matching page here in the same change.
