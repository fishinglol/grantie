import { cors, pluginIds, redis, type Req, type Res } from "./_lib";

/** GET /api/installs → `{ "<plugin id>": <installs>, ... }` for every listed plugin. */
export default async function handler(req: Req, res: Res): Promise<void> {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).end();
  try {
    const ids = pluginIds;
    const values = (await redis("MGET", ...ids.map((id) => `installs:${id}`))) as (string | null)[];
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    res.status(200).json(Object.fromEntries(ids.map((id, i) => [id, Number(values[i] ?? 0)])));
  } catch {
    res.status(503).json({ error: "counter unavailable" });
  }
}
