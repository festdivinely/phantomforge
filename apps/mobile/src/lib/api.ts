/**
 * The only place the app talks to the server. Every /api call carries the
 * owner token; errors come back as ApiError with a message a person can act on.
 */

export interface Connection {
  /** e.g. https://something.trycloudflare.com - no trailing slash. */
  url: string;
  token: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    /** HTTP status, or 0 when the server could not be reached at all. */
    readonly status: number,
  ) {
    super(message);
  }
  get unreachable() {
    return this.status === 0;
  }
  get unauthorized() {
    return this.status === 401;
  }
}

/** Accepts "abc.trycloudflare.com", "https://abc.../", etc. */
export function normalizeUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

const TIMEOUT_MS = 15_000;

export async function request<T>(
  conn: Connection,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${conn.url}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${conn.token}`,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(
      "Can't reach PhantomForge. Is the PC on and `pnpm tunnel` running? The tunnel address changes every time it restarts.",
      0,
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  const body = text ? safeJson(text) : undefined;
  if (!res.ok) {
    if (res.status === 401) throw new ApiError('The server refused the owner token.', 401);
    // Cloudflare answers 502/530 when the tunnel is up but the API is not.
    if (res.status === 502 || res.status === 530)
      throw new ApiError('The tunnel is up, but the PhantomForge API on the PC is not running.', 0);
    const serverMessage =
      body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : '';
    const message = serverMessage || `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return body as T;
}

/**
 * Loads an image the server only shows with the owner token, as a data URI
 * (React Native's <Image> can't send our header on every refresh).
 * Returns undefined when there is no picture yet.
 */
export async function fetchImageDataUri(conn: Connection, path: string): Promise<string | undefined> {
  const res = await fetch(`${conn.url}${path}`, { headers: { Authorization: `Bearer ${conn.token}` } });
  if (!res.ok) return undefined;
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${res.headers.get('content-type') ?? 'image/jpeg'};base64,${btoa(binary)}`;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
