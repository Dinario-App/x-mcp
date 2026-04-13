/**
 * Regenerate test fixtures from the live X API.
 *
 * Usage:
 *   X_BEARER_TOKEN=<throwaway-token> npm run capture-fixtures
 *
 * SAFETY:
 * - Use a throwaway account's Bearer token. NEVER use @DinarioApp's.
 * - This script writes to test/fixtures/*.json and scrubs auth-related headers.
 * - Before committing, run `git diff test/fixtures/` and verify no tokens or PII leaked.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "..", "test", "fixtures");
const API_BASE = "https://api.x.com/2";

const token = process.env.X_BEARER_TOKEN;
if (!token) {
  console.error("X_BEARER_TOKEN env var required.");
  process.exit(1);
}

const SAFE_HEADERS = new Set([
  "content-type",
  "x-rate-limit-limit",
  "x-rate-limit-remaining",
  "x-rate-limit-reset",
]);

async function capture(name: string, url: string, args: Record<string, unknown>) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json();
  const headers: Record<string, string> = {};
  for (const [k, v] of res.headers.entries()) {
    if (SAFE_HEADERS.has(k.toLowerCase())) headers[k.toLowerCase()] = v;
  }
  const fixture = {
    _meta: {
      endpoint: url.replace(API_BASE, ""),
      capturedAt: new Date().toISOString(),
      args,
    },
    status: res.status,
    headers,
    body,
  };
  writeFileSync(join(FIXTURES, `${name}.json`), JSON.stringify(fixture, null, 2));
  console.log(`wrote ${name}.json (status=${res.status})`);
}

const TWEET_ID = "1234567890123456789"; // replace with a real throwaway-account tweet
const USER_ID = "2244994945"; // @XDevelopers — public profile
const USERNAME = "XDevelopers";

const TWEET_FIELDS = "created_at,public_metrics,author_id,conversation_id,in_reply_to_user_id,referenced_tweets,attachments,entities,lang,note_tweet";
const USER_FIELDS_FULL = "created_at,description,public_metrics,verified,profile_image_url,url,location,pinned_tweet_id";

await capture(
  "getTweet",
  `${API_BASE}/tweets/${TWEET_ID}?tweet.fields=${TWEET_FIELDS}&expansions=author_id&user.fields=name,username,verified,profile_image_url,public_metrics`,
  { tweetId: TWEET_ID },
);
await capture(
  "getUser",
  `${API_BASE}/users/by/username/${USERNAME}?user.fields=${USER_FIELDS_FULL}`,
  { username: USERNAME },
);
await capture(
  "searchTweets",
  `${API_BASE}/tweets/search/recent?query=solana&max_results=10&tweet.fields=created_at,public_metrics,author_id,conversation_id,entities,lang,note_tweet&expansions=author_id&user.fields=name,username,verified,profile_image_url`,
  { query: "solana", maxResults: 10 },
);
await capture(
  "getTimeline",
  `${API_BASE}/users/${USER_ID}/tweets?max_results=10&tweet.fields=created_at,public_metrics,author_id,conversation_id,entities,lang,note_tweet&expansions=author_id,attachments.media_keys,referenced_tweets.id&user.fields=name,username,verified&media.fields=url,preview_image_url,type`,
  { userId: USER_ID, maxResults: 10 },
);
await capture(
  "getFollowers",
  `${API_BASE}/users/${USER_ID}/followers?max_results=100&user.fields=created_at,description,public_metrics,verified,profile_image_url`,
  { userId: USER_ID, maxResults: 100 },
);
await capture(
  "getFollowing",
  `${API_BASE}/users/${USER_ID}/following?max_results=100&user.fields=created_at,description,public_metrics,verified,profile_image_url`,
  { userId: USER_ID, maxResults: 100 },
);

console.log("done. Review `git diff test/fixtures/` for leaked secrets before committing.");
