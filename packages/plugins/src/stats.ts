/** Where installs are counted: the docs site's Vercel Functions (`apps/docs/api/installs*.ts`). */
export const INSTALLS_URL = "https://granite-docs-phi.vercel.app/api/installs";

/** Fetch with a time limit, so a slow or unreachable counter never holds the app up. */
async function limited(url: string, init?: RequestInit): Promise<Response> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 5000);
  try {
    return await fetch(url, { ...init, signal: abort.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Tell the counter a plugin was installed. Carries only the plugin's id (no body, nothing about the person) and never throws or waits. */
export function reportInstall(id: string): void {
  void limited(`${INSTALLS_URL}/${encodeURIComponent(id)}`, { method: "POST" }).catch(() => {});
}

/** Install counts by plugin id; `{}` when the counter can't be reached. */
export async function fetchInstallCounts(): Promise<Record<string, number>> {
  try {
    const res = await limited(INSTALLS_URL);
    return res.ok ? ((await res.json()) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** "1 install" / "12 installs", or "" when there is nothing to show yet. */
export function installsLabel(count: number | undefined): string {
  return count ? `${count.toLocaleString("en-US")} install${count === 1 ? "" : "s"}` : "";
}
