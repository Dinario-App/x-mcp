import { ApiError } from "@xdevplatform/xdk";

interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number;
}

interface XApiErrorBody {
  errors?: Array<{ message: string; title?: string; detail?: string; type?: string }>;
}

interface DuckTypedApiError {
  name: string;
  message: string;
  status?: number;
  headers?: Headers | Record<string, string>;
  data?: unknown;
}

function headersFrom(h: Headers | Record<string, string> | undefined): Headers {
  if (!h) return new Headers();
  if (h instanceof Headers) return h;
  return new Headers(h as Record<string, string>);
}

function isXdkApiError(err: unknown): err is {
  name: string;
  message: string;
  status: number;
  headers: Headers;
  data?: unknown;
} {
  if (err instanceof ApiError) return true;
  // Duck-type fallback: defence-in-depth if XDK regenerates and renames the class.
  // Per Technical Director: `instanceof` first, duck-type second, never silent pass-through.
  const d = err as DuckTypedApiError | null;
  return (
    !!d &&
    typeof d === "object" &&
    d.name === "ApiError" &&
    typeof d.status === "number" &&
    d.headers !== undefined
  );
}

/**
 * XDK throws its own ApiError on non-2xx responses BEFORE honoring
 * `requestOptions.raw`, so our shared handleResponse never sees the
 * Response. This helper reshapes that ApiError back into the legacy
 * `${operation} failed (HTTP N): detail. Rate limit: ...` format so
 * MCP callers see identical error messages whether the flag is on or off.
 *
 * Detection order (per TD re-sign-off):
 *   1. `instanceof ApiError` — authoritative, compile-time-verified
 *   2. Duck-type fallback on name/status/headers — survives SDK regen
 *   3. Non-ApiError throws pass through unchanged
 */
export function wrapXdkError(err: unknown, operation: string): Error {
  if (!isXdkApiError(err)) {
    return err instanceof Error ? err : new Error(String(err));
  }
  const headers = headersFrom(err.headers);
  const rl = parseRateLimit(headers);
  const rateLimitStr = rl ? formatRateLimit(rl) : "";
  const status = err.status;

  if (status === 429) {
    const resetTime = rl ? new Date(rl.reset * 1000).toISOString() : "unknown";
    return new Error(`Rate limited on ${operation}. Reset at: ${resetTime}. ${rateLimitStr}`);
  }

  const body = err.data as XApiErrorBody | undefined;
  const detail = body?.errors?.map((x) => x.detail || x.message).join("; ") || err.message;
  return new Error(`${operation} failed (HTTP ${status}): ${detail}. ${rateLimitStr}`);
}

export function parseRateLimit(headers: Headers): RateLimitInfo | null {
  const limit = headers.get("x-rate-limit-limit");
  const remaining = headers.get("x-rate-limit-remaining");
  const reset = headers.get("x-rate-limit-reset");
  if (limit && remaining && reset) {
    return {
      limit: parseInt(limit, 10),
      remaining: parseInt(remaining, 10),
      reset: parseInt(reset, 10),
    };
  }
  return null;
}

export function formatRateLimit(rl: RateLimitInfo): string {
  const resetDate = new Date(rl.reset * 1000);
  const secondsUntilReset = Math.max(0, Math.ceil((rl.reset * 1000 - Date.now()) / 1000));
  return `Rate limit: ${rl.remaining}/${rl.limit} remaining. Resets at ${resetDate.toISOString()} (${secondsUntilReset}s)`;
}

export async function handleResponse<T>(
  response: Response,
  operation: string,
): Promise<{ result: T; rateLimit: string }> {
  const rl = parseRateLimit(response.headers);
  const rateLimitStr = rl ? formatRateLimit(rl) : "";

  if (response.status === 429) {
    const resetTime = rl ? new Date(rl.reset * 1000).toISOString() : "unknown";
    throw new Error(`Rate limited on ${operation}. Reset at: ${resetTime}. ${rateLimitStr}`);
  }

  const text = await response.text();
  let data: T;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${operation} failed (HTTP ${response.status}): ${text.slice(0, 500)}`);
  }

  if (!response.ok) {
    const errBody = data as unknown as XApiErrorBody;
    const errMsg =
      errBody.errors?.map((e) => e.detail || e.message).join("; ") || text.slice(0, 500);
    throw new Error(`${operation} failed (HTTP ${response.status}): ${errMsg}. ${rateLimitStr}`);
  }

  return { result: data, rateLimit: rateLimitStr };
}
