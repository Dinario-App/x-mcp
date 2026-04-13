interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number;
}

interface XApiErrorBody {
  errors?: Array<{ message: string; title?: string; detail?: string; type?: string }>;
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
