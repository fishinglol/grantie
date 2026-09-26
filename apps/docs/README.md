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

Its own Vercel project, `granite-docs` (never the project behind `grantie.vercel.app`, which is the marketing site).
The site is built from the whole repository — `scripts/build-registry.mjs` reads `examples/plugins/` and
`packages/plugins/` — so deploy a *prebuilt* output from this folder:

```bash
cd apps/docs && npm run deploy   # vercel build --prod && vercel deploy --prebuilt --prod
```

A plain `vercel deploy` from here would upload only `apps/docs` and fail. (Connecting the GitHub repo to the project
with Root Directory `apps/docs` also works, since Vercel then includes files outside the root.)

### Install counter (one-time setup)

`api/installs*.ts` count installs in Upstash Redis. In the Vercel dashboard: `granite-docs` → Storage → Create →
Upstash Redis, and connect it to the project (it adds `KV_REST_API_URL` / `KV_REST_API_TOKEN`). Until then the
endpoints answer 503 and the site simply shows no numbers.

## Updating content

- `guide/` — getting started, manifest reference, permissions, publishing, examples.
- `api/` — one page per `GraniteApi` namespace. The source of truth for signatures is
  [`packages/plugins/src/api.ts`](../../packages/plugins/src/api.ts) — when that file's public shape changes,
  update the matching page here in the same change.
