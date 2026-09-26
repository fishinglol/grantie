import { createHash } from "node:crypto";
import { pluginIds } from "./_ids";

export interface Req {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[] | undefined>;
}
export interface Res {
  status(code: number): Res;
  setHeader(name: string, value: string): Res;
  json(body: unknown): void;
  end(): void;
}

export { pluginIds };

export function cors(res: Res): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/** Upstash Redis over its REST API (the env names are the ones the Vercel Marketplace integration sets). */
export async function redis(...command: (string | number)[]): Promise<unknown> {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("counter is not configured");
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(command) });
  if (!res.ok) throw new Error(`counter answered ${res.status}`);
  return ((await res.json()) as { result: unknown }).result;
}

/** A short one-way hash of who is asking, kept only for a day, so one address counts once per plugin per day. */
export function visitor(req: Req, id: string): string {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0].trim() ?? "unknown";
  return createHash("sha256").update(`${id}|${ip}`).digest("hex").slice(0, 32);
}
