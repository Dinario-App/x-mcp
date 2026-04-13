const PR1_TOOLS = new Set([
  "get_tweet",
  "get_user",
  "search_tweets",
  "get_timeline",
  "get_followers",
  "get_following",
]);

function parseFlag(): Set<string> {
  const raw = process.env.USE_XDK_TOOLS?.trim();
  if (!raw) return new Set();
  if (raw === "1" || raw.toLowerCase() === "all") {
    return new Set(PR1_TOOLS);
  }
  if (raw.toLowerCase() === "pr1") {
    return new Set(PR1_TOOLS);
  }
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

const enabled = parseFlag();

export function shouldUseXdk(toolName: string): boolean {
  return enabled.has(toolName);
}

export function xdkEnabledTools(): string[] {
  return Array.from(enabled);
}
