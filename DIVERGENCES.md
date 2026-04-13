# XDK Migration — Parity Audit Log

Behavioral gaps discovered between the legacy `XApiClient` (hand-rolled fetch + oauth-1.0a) and the new `XdkAdapter` (`@xdevplatform/xdk@0.5.0`). All exercised by `test/parity.test.ts`.

---

## #1 — `getTimeline` hits a different endpoint AND refuses Bearer auth

**Severity:** P0 — blocked PR 1 as originally scoped.
**Status:** **RESOLVED — dropped from PR 1 scope.** Revisit in PR 2 with OAuth 2.0 user-context auth.

**Gap:** Legacy calls `GET /2/users/{id}/tweets` (user's own posts, Bearer-compatible). XDK's `client.users.getTimeline(id)` calls `GET /2/users/{id}/timelines/reverse_chronological` (authenticated user's home feed, requires `OAuth2UserToken` or `OAuth1 UserToken`). XDK's `validateAuthentication()` throws synchronously when only a bearer token is configured.

**Evidence:**
- `node_modules/@xdevplatform/xdk/dist/index.js:6256` — `let path = "/2/users/{id}/timelines/reverse_chronological";`
- Original failing test invocation raised: `Authentication required ... Required: OAuth2UserToken, UserToken. Available: bearer_token.`

**Resolution:**
- `XdkAdapter.getTimeline` method removed entirely.
- `flags.ts::PR1_TOOLS` excludes `get_timeline` — even with `USE_XDK_TOOLS=pr1` the handler falls through to legacy `XApiClient.getTimeline`.
- `test/parity.test.ts` asserts both the flag exclusion and the structural absence of the adapter method.

**Follow-up (PR 2):** once OAuth 2.0 user-context auth is wired into the adapter, reintroduce `getTimeline` via `client.users.getTimeline` **only if** we actually want the home-timeline semantics. If we want "user's own posts" (what `get_timeline` currently exposes), bypass the typed method and call `client.request("GET", "/2/users/{id}/tweets", ...)`.

---

## #2 — Error responses: XDK throws `ApiError` before `raw: true` is honored

**Severity:** P1 — changes error surface for downstream consumers.
**Status:** **RESOLVED — `wrapXdkError` shim in `src/response.ts`.**

**Gap:** Inside `Client.request()` (XDK `dist/index.js:8321`), `!response.ok` triggers `throw new ApiError(...)` **before** checking `options.raw`. The adapter's shared `handleResponse()` never runs. Result:
- 429 responses lost the legacy `"Rate limited on <op>. Reset at: <iso>. Rate limit: ..."` message.
- 4xx/5xx lost the legacy `"<op> failed (HTTP <status>): <detail>. Rate limit: ..."` shape.

**Resolution:** every adapter method now wraps the XDK call in `try/catch` and re-throws via `wrapXdkError(err, operation)`. The helper detects XDK's `ApiError` by `name` + `status`/`headers`/`data` duck-typing, reconstructs rate-limit headers into the legacy format, and produces the identical error string. Parity tests assert the exact legacy message on 429, 404, and 401.

**Follow-up:** consider upstream PR to XDK honoring `options.raw` before throwing. Low priority — the shim works.

---

## #3 — `getUser` requested a smaller `user.fields` set

**Severity:** P1 — would silently return less data to MCP callers.
**Status:** **RESOLVED — `USER_FIELDS_FULL` expanded in `xdk-adapter.ts`.**

**Gap:** Legacy requested `created_at,description,public_metrics,verified,profile_image_url,url,location,pinned_tweet_id`. Adapter requested `name,username,verified,profile_image_url,public_metrics`, dropping `created_at`, `description`, `url`, `location`, `pinned_tweet_id`.

**Resolution:** `USER_FIELDS_FULL` now matches the legacy set. Note `name` and `username` are removed — the X API returns these by default regardless of requested fields, so they're not gained or lost. Parity test asserts every legacy-requested field is present in the XDK outbound URL.

---

## Things that already match (no action needed)

- `getTweet`, `searchTweets`, `getFollowers`, `getFollowing` — URLs identical under `raw: true`; `x-rate-limit-*` headers round-trip through `handleResponse`.
- `next_token` / `paginationToken` forwarding on both clients.
- Empty-result responses (`meta.result_count: 0`) byte-identical.
- 2xx response bodies byte-identical — `raw: true` bypasses XDK's `transformKeys()` snake→camel conversion.

## Merge readiness

All three divergences resolved. 12/12 parity tests green. PR 1 is code-complete pending:
- [ ] Sly approves push to origin + merge to main
- [ ] 72h @web3sly_1 dry-run with `USE_XDK_TOOLS=pr1`
- [ ] 48h Forge shadow-mode before Perkins/Closer flip
