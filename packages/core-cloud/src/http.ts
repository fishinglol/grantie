/**
 * The HTTP "port". Structurally satisfied by the standard `fetch`, so the
 * desktop app passes Tauri's `fetch` straight in and tests pass a fake.
 */
export interface HttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<any>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface HttpRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}

export type HttpClient = (url: string, init?: HttpRequestInit) => Promise<HttpResponse>;

/** Throw with the response body included — Google's errors are only useful in the body. */
export async function ensureOk(res: HttpResponse, what: string): Promise<HttpResponse> {
  if (res.ok) return res;
  let detail = "";
  try {
    detail = (await res.text()).slice(0, 500);
  } catch {
    /* body already consumed or unreadable */
  }
  throw new Error(`${what} failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}`);
}

/**
 * Wraps `http` so every request reports when it started, how long it took and how it ended, to find out where a sync spends
 * its time. Only the method, the URL (never headers, so never the token) and the status are reported.
 */
export function timedHttp(http: HttpClient, log: (line: string) => void): HttpClient {
  return async (url, init) => {
    const started = Date.now();
    const what = `${init?.method ?? "GET"} ${url.replace("https://www.googleapis.com/", "").replace("https://oauth2.googleapis.com/", "oauth:")}`.slice(0, 140);
    try {
      const res = await http(url, init);
      log(`${new Date(started).toISOString()} ${Date.now() - started}ms ${res.status} ${what}`);
      return res;
    } catch (e) {
      log(`${new Date(started).toISOString()} ${Date.now() - started}ms FAILED ${what}`);
      throw e;
    }
  };
}
