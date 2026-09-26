# Granite Plugins docs

The plugin-developer site — [grantie.vercel.app](https://grantie.vercel.app) — built with
[VitePress](https://vitepress.dev). Content only; the plugin system itself lives in `packages/plugins` and
`examples/plugins/`.

```bash
npm install        # from the repo root
npm run dev -w @granite/docs
npm run build -w @granite/docs   # outputs apps/docs/.vitepress/dist
```

## Deploying (Vercel)

This is one app inside an npm-workspaces monorepo, so the Vercel project needs:

- **Root Directory**: `apps/docs`
- **Framework preset**: VitePress (or, if not offered, Build command `npm run build`, Output directory
  `.vitepress/dist`, Install command `npm install` — run from the monorepo root so workspace linking works)

Set this once in the Vercel project's Settings → General → Root Directory (or `vercel.json` at the repo
root); it isn't something a code change here can configure by itself.

## Updating content

- `guide/` — getting started, manifest reference, permissions, publishing, examples.
- `api/` — one page per `GraniteApi` namespace. The source of truth for signatures is
  [`packages/plugins/src/api.ts`](../../packages/plugins/src/api.ts) — when that file's public shape changes,
  update the matching page here in the same change.
