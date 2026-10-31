export interface ApiResult<T> {
  ok: boolean;
  /** 0 when the request never reached the server. */
  status: number;
  /** Null when the body was not JSON, such as an HTML error page. */
  data: T | null;
}

/**
 * fetch that never throws and never leaves a caller holding a parse error. A server crash or a lost
 * connection comes back as `ok: false`, so a button can always recover and show a message.
 */
export async function api<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, init);
    const data = (await response.json().catch(() => null)) as T | null;
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export function postJson<T>(url: string, body: unknown): Promise<ApiResult<T>> {
  return api<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
