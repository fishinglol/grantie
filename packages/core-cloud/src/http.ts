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
