import { cors, pluginIds, redis, visitor, type Req, type Res } from "../_lib";

/**
 * POST /api/installs/<plugin id>: the app calls this once a plugin is installed. It carries no body and no user
 * data. An unknown id is refused, and one address counts once per plugin per day.
 */
export default async function handler(req: Req, res: Res): Promise<void> {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).end();
  const id = String(req.query.id);
  if (!pluginIds.includes(id)) return res.status(404).json({ error: "unknown plugin" });
  try {
    const first = await redis("SET", `seen:${id}:${visitor(req, id)}`, 1, "NX", "EX", 86400);
    if (first === "OK") await redis("INCR", `installs:${id}`);
    res.status(204).end();
  } catch {
    res.status(503).json({ error: "counter unavailable" });
  }
}
