/**
 * Fixture-based parity test suite for the x-mcp XDK migration (PR 1).
 *
 * For each of the 6 Bearer-auth read endpoints, we:
 *   1. Intercept the outbound HTTP request with nock using a captured fixture.
 *   2. Call XApiClient.<method>() and XdkAdapter.<method>() with identical args.
 *   3. Assert byte-identical `result` JSON and identical `rateLimit` string.
 *
 * Edge cases: 429, 404, 401, empty results, pagination with next_token.
 *
 * Any parity gap found is documented in DIVERGENCES.md at repo root.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import nock from "nock";

import { XApiClient, XApiConfig } from "../src/x-api.js";
import { XdkAdapter } from "../src/xdk-adapter.js";
import { shouldUseXdk } from "../src/flags.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");
const API_HOST = "https://api.x.com";
const FAKE_BEARER = "fake-test-bearer-token";

const legacyConfig: XApiConfig = {
  apiKey: "k",
  apiSecret: "s",
  accessToken: "at",
  accessTokenSecret: "ats",
  bearerToken: FAKE_BEARER,
};

const legacy = new XApiClient(legacyConfig);
const xdk = new XdkAdapter({ bearerToken: FAKE_BEARER });

function loadFixture(name: string) {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
}

/**
 * Register N identical HTTP interceptors for a given request.
 * Both legacy and XDK hit the same URL prefix — we persist the interceptor
 * so both clients can consume it. We verify URL equality via a matcher
 * that records each request.
 */
interface CapturedRequest {
  path: string;
  method: string;
}

function mockTwice(
  pathMatcher: (uri: string) => boolean,
  status: number,
  body: unknown,
  headers: Record<string, string>,
): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  // Register two one-shot interceptors. Each call consumes one.
  for (let i = 0; i < 2; i++) {
    nock(API_HOST)
      .get(pathMatcher)
      .reply(function (uri) {
        captured.push({ path: uri, method: "GET" });
        return [status, body, headers];
      });
  }
  return captured;
}

test.beforeEach(() => {
  nock.cleanAll();
  if (!nock.isActive()) nock.activate();
});

test.afterEach(() => {
  nock.cleanAll();
});

// ---------------------------------------------------------------------------
// Happy-path parity: 6 endpoints
// ---------------------------------------------------------------------------

test("getTweet: parity on 200 response", async () => {
  const f = loadFixture("getTweet.json");
  const tweetId = f._meta.args.tweetId;
  const captured = mockTwice(
    (uri) => uri.startsWith(`/2/tweets/${tweetId}`),
    f.status,
    f.body,
    f.headers,
  );

  const legacyRes = await legacy.getTweet(tweetId);
  const xdkRes = await xdk.getTweet(tweetId);

  assert.deepStrictEqual(xdkRes.result, legacyRes.result, "result JSON must match");
  assert.strictEqual(xdkRes.rateLimit, legacyRes.rateLimit, "rateLimit string must match");
  assert.strictEqual(captured.length, 2, "expected 2 outbound requests");
  assert.ok(
    captured[0].path.includes(`/2/tweets/${tweetId}`),
    `legacy hit unexpected path: ${captured[0].path}`,
  );
  assert.ok(
    captured[1].path.includes(`/2/tweets/${tweetId}`),
    `XDK hit unexpected path: ${captured[1].path}`,
  );
});

test("getUser (by username): parity on 200 response", async () => {
  const f = loadFixture("getUser.json");
  const username = f._meta.args.username;
  const captured = mockTwice(
    (uri) => uri.startsWith(`/2/users/by/username/${username}`),
    f.status,
    f.body,
    f.headers,
  );

  const legacyRes = await legacy.getUser({ username });
  const xdkRes = await xdk.getUser({ username });

  assert.deepStrictEqual(xdkRes.result, legacyRes.result);
  assert.strictEqual(xdkRes.rateLimit, legacyRes.rateLimit);
  assert.strictEqual(captured.length, 2);
});

test("searchTweets: parity on 200 response (with next_token pagination)", async () => {
  const f = loadFixture("searchTweets.json");
  const captured = mockTwice(
    (uri) => uri.startsWith("/2/tweets/search/recent"),
    f.status,
    f.body,
    f.headers,
  );

  const legacyRes = await legacy.searchTweets(f._meta.args.query, f._meta.args.maxResults);
  const xdkRes = await xdk.searchTweets(f._meta.args.query, f._meta.args.maxResults);

  assert.deepStrictEqual(xdkRes.result, legacyRes.result);
  assert.strictEqual(xdkRes.rateLimit, legacyRes.rateLimit);
  // Meta.next_token should survive round-trip
  assert.strictEqual(
    (xdkRes.result as { meta: { next_token: string } }).meta.next_token,
    "b26v89c19zqg8o3fpds2z3z3d1xj9vhlozwyc17jxd3gx",
  );
});

test("getTimeline: DIVERGENCE #1 resolved — excluded from PR 1 XDK scope, legacy-only", async () => {
  // Resolution: the XDK endpoint differs (reverse_chronological vs /tweets)
  // AND requires OAuth 2.0 user token. Dropped from PR 1 — revisit in PR 2.
  // See DIVERGENCES.md #1.
  const f = loadFixture("getTimeline.json");
  const userId = f._meta.args.userId;

  // Flag routing excludes get_timeline.
  assert.strictEqual(
    shouldUseXdk("get_timeline"),
    false,
    "get_timeline must NOT be routable via XDK in PR 1",
  );
  // Structural guarantee: adapter method is absent.
  assert.strictEqual(
    typeof (xdk as unknown as Record<string, unknown>).getTimeline,
    "undefined",
    "XdkAdapter.getTimeline must not exist in PR 1",
  );

  // Legacy path still works.
  nock(API_HOST).get((uri) => uri.startsWith(`/2/users/${userId}/tweets`)).reply(
    f.status,
    f.body,
    f.headers,
  );
  const legacyRes = await legacy.getTimeline(userId, f._meta.args.maxResults);
  assert.ok(legacyRes.result, "legacy getTimeline must still succeed");
});

test("getFollowers: parity on 200 response", async () => {
  const f = loadFixture("getFollowers.json");
  const userId = f._meta.args.userId;
  const captured = mockTwice(
    (uri) => uri.startsWith(`/2/users/${userId}/followers`),
    f.status,
    f.body,
    f.headers,
  );

  const legacyRes = await legacy.getFollowers(userId, f._meta.args.maxResults);
  const xdkRes = await xdk.getFollowers(userId, f._meta.args.maxResults);

  assert.deepStrictEqual(xdkRes.result, legacyRes.result);
  assert.strictEqual(xdkRes.rateLimit, legacyRes.rateLimit);
  assert.strictEqual(captured.length, 2);
});

test("getFollowing: parity on 200 response", async () => {
  const f = loadFixture("getFollowing.json");
  const userId = f._meta.args.userId;
  const captured = mockTwice(
    (uri) => uri.startsWith(`/2/users/${userId}/following`),
    f.status,
    f.body,
    f.headers,
  );

  const legacyRes = await legacy.getFollowing(userId, f._meta.args.maxResults);
  const xdkRes = await xdk.getFollowing(userId, f._meta.args.maxResults);

  assert.deepStrictEqual(xdkRes.result, legacyRes.result);
  assert.strictEqual(xdkRes.rateLimit, legacyRes.rateLimit);
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test("edge: 429 rate-limit — DIVERGENCE #2 resolved, both paths produce legacy 'Rate limited on ...'", async () => {
  const errs = loadFixture("errors.json");
  const e = errs.rateLimit429;

  nock(API_HOST).get((uri) => uri.startsWith("/2/tweets/1")).reply(e.status, e.body, e.headers);
  await assert.rejects(legacy.getTweet("1"), /Rate limited on getTweet/);

  nock(API_HOST).get((uri) => uri.startsWith("/2/tweets/1")).reply(e.status, e.body, e.headers);
  await assert.rejects(
    xdk.getTweet("1"),
    /Rate limited on getTweet/,
    "wrapXdkError must reshape XDK ApiError to legacy 'Rate limited on ...' format",
  );
});

test("edge: 404 not-found — DIVERGENCE #2 resolved, both paths produce '... failed (HTTP 404): ...'", async () => {
  const errs = loadFixture("errors.json");
  const e = errs.notFound404;

  nock(API_HOST).get((uri) => uri.startsWith("/2/tweets/0")).reply(e.status, e.body, e.headers);
  await assert.rejects(legacy.getTweet("0000000000000000000"), /getTweet failed \(HTTP 404\)/);

  nock(API_HOST).get((uri) => uri.startsWith("/2/tweets/0")).reply(e.status, e.body, e.headers);
  await assert.rejects(
    xdk.getTweet("0000000000000000000"),
    /getTweet failed \(HTTP 404\)/,
    "wrapXdkError must reshape 404 ApiError to legacy shape",
  );
});

test("edge: 401 auth-fail — DIVERGENCE #2 resolved, both paths produce '... failed (HTTP 401): ...'", async () => {
  const errs = loadFixture("errors.json");
  const e = errs.unauthorized401;

  nock(API_HOST).get((uri) => uri.startsWith("/2/users/by/username/")).reply(
    e.status,
    e.body,
    e.headers,
  );
  await assert.rejects(legacy.getUser({ username: "anyone" }), /getUser failed \(HTTP 401\)/);

  nock(API_HOST).get((uri) => uri.startsWith("/2/users/by/username/")).reply(
    e.status,
    e.body,
    e.headers,
  );
  await assert.rejects(
    xdk.getUser({ username: "anyone" }),
    /getUser failed \(HTTP 401\)/,
    "wrapXdkError must reshape 401 ApiError to legacy shape",
  );
});

test("edge: empty search — parity on zero-result response", async () => {
  const errs = loadFixture("errors.json");
  const e = errs.emptySearch;
  const captured = mockTwice(
    (uri) => uri.startsWith("/2/tweets/search/recent"),
    e.status,
    e.body,
    e.headers,
  );

  const legacyRes = await legacy.searchTweets("zzz_no_match_zzz", 10);
  const xdkRes = await xdk.searchTweets("zzz_no_match_zzz", 10);

  assert.deepStrictEqual(xdkRes.result, legacyRes.result);
  assert.strictEqual(xdkRes.rateLimit, legacyRes.rateLimit);
  assert.strictEqual(captured.length, 2);
});

test("edge: pagination next_token is forwarded on both clients", async () => {
  const f = loadFixture("searchTweets.json");
  const nextToken = "abc123paginationcursor";

  const paths: string[] = [];
  for (let i = 0; i < 2; i++) {
    nock(API_HOST)
      .get((uri) => uri.startsWith("/2/tweets/search/recent"))
      .reply(function (uri) {
        paths.push(uri);
        return [f.status, f.body, f.headers];
      });
  }

  await legacy.searchTweets("x", 10, nextToken);
  await xdk.searchTweets("x", 10, nextToken);

  // Legacy uses snake_case param `next_token`
  assert.ok(
    paths[0].includes(`next_token=${nextToken}`),
    `legacy URL missing next_token: ${paths[0]}`,
  );
  // XDK maps nextToken -> next_token per the OpenAPI spec
  assert.ok(
    paths[1].includes(`next_token=${nextToken}`),
    `XDK URL missing next_token: ${paths[1]}`,
  );
});

// ---------------------------------------------------------------------------
// URL-parameter divergence: field lists
// ---------------------------------------------------------------------------

test("url-params: DIVERGENCE #3 resolved — XDK requests every user.field legacy does", async () => {
  const f = loadFixture("getUser.json");
  const username = f._meta.args.username;
  const paths: string[] = [];
  for (let i = 0; i < 2; i++) {
    nock(API_HOST)
      .get((uri) => uri.startsWith(`/2/users/by/username/${username}`))
      .reply(function (uri) {
        paths.push(uri);
        return [f.status, f.body, f.headers];
      });
  }

  await legacy.getUser({ username });
  await xdk.getUser({ username });

  const legacyUserFields = new URL(API_HOST + paths[0]).searchParams.get("user.fields") ?? "";
  const xdkUserFields = new URL(API_HOST + paths[1]).searchParams.get("user.fields") ?? "";
  const legacySet = new Set(legacyUserFields.split(",").filter(Boolean));
  const xdkSet = new Set(xdkUserFields.split(",").filter(Boolean));
  const legacyOnly = [...legacySet].filter((k) => !xdkSet.has(k));

  assert.deepStrictEqual(
    legacyOnly,
    [],
    `XDK must request every user.field legacy does. Missing: ${legacyOnly.join(", ")}`,
  );
});
