# x-mcp Parity Tests

Fixture-based parity tests between `XApiClient` (legacy) and `XdkAdapter` (XDK-backed) for the 6 read-only Bearer-auth endpoints in PR 1.

## Run

```bash
npm test
```

No env vars required. All HTTP is intercepted by [nock](https://github.com/nock/nock) using fixtures in `test/fixtures/`.

## Why nock (not msw)

- Nock intercepts at the Node `http`/`undici` layer, which catches both the legacy `fetch()` calls and the XDK's internal `globalThis.fetch` uniformly — no per-framework setup.
- Nock 14 supports Node's native `fetch` (undici-based), and this repo targets Node 22+.
- MSW is designed primarily for browser workflows; its Node adapter adds a request handler layer we don't need for a 12-test parity suite.
- Nock's request-capture API (`.reply(function (uri) { ... })`) cleanly exposes the outbound URL for URL-equality assertions between the two clients.

## Regenerate fixtures from the live API

Fixtures in `test/fixtures/*.json` are currently hand-crafted against the X API v2 schema. To refresh them against real API responses:

```bash
X_BEARER_TOKEN=<throwaway-account-token> npm run capture-fixtures
```

Requirements:
- Use a throwaway X developer account's Bearer token. **Never** use `@DinarioApp`'s token.
- After capture, run `git diff test/fixtures/` and verify no tokens, PII, or private IDs leaked.
- The capture script writes a curated allowlist of headers (`content-type`, `x-rate-limit-*`). Other headers are stripped.

## CI integration

Add to `.github/workflows/test.yml` (or equivalent):

```yaml
- name: Install
  run: npm ci
- name: Parity tests
  run: npm test
```

No secrets needed in CI — all tests are offline.

## Known divergences

See `DIVERGENCES.md` at repo root. As of PR 1 scaffold (commit `bb49d1c`), there are three parity gaps — one of them (`getTimeline`) is a hard blocker. Tests encode the current behavior; when a divergence is fixed in the adapter, the corresponding test should be tightened to full parity.

## File layout

- `test/parity.test.ts` — 12 test cases (6 happy-path + 6 edge/divergence).
- `test/fixtures/*.json` — captured or hand-crafted response fixtures.
- `scripts/capture-fixtures.ts` — regenerate fixtures from the live API.
