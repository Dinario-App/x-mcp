# XDK Feature-Flag Rollback Runbook

**Scope**: x-mcp migration to `@xdevplatform/xdk`. PR 1 covers 5 read tools behind `USE_XDK_TOOLS`.

**Default state**: `USE_XDK_TOOLS` unset → 100% legacy path. Every MCP call routes through `XApiClient`, not `XdkAdapter`. Rollback is a matter of clearing the env var and restarting the MCP process.

## When to roll back

Roll back **immediately** if any of the following appear in `#ops-alerts` or an agent's output:
- HTTP 4xx/5xx error without rate-limit suffix (`Rate limit: ...`) on a tool listed in `USE_XDK_TOOLS`
- Parity drift: XDK-routed tool returns a different shape than legacy (compare Closer baseline)
- `ApiError` string leaks into MCP output instead of the legacy `${operation} failed (HTTP N): ...` format
- Any `wrapXdkError` stack trace in logs
- Silent missing fields in `get_user` output (check for `created_at`, `description`, `url`, `location`, `pinned_tweet_id`)

## Where the flag lives

The flag is read once at MCP process startup from `/Users/dinario/Developer/Dinario/tools/x-mcp/.env`:

```
USE_XDK_TOOLS=get_tweet,get_user,search_tweets,get_followers,get_following
```

Accepted values:
- **unset** or **empty** → 100% legacy (default, safest)
- **comma list** → only listed tools route via XDK, others legacy
- **`pr1`** or **`all`** → all 5 PR 1 tools (`get_tweet`, `get_user`, `search_tweets`, `get_followers`, `get_following`)

`get_timeline` is NEVER XDK-routed in PR 1 even with `pr1` — see `DIVERGENCES.md` #1.

## Rollback procedure (per agent)

Each OpenClaw agent runs its own MCP process with its own `.env`. Roll back in this order: Forge → Closer → Perkins (least production-impact first).

### Step 1 — Flip the flag
```bash
# On the affected agent's Mac mini / tmux session:
cd ~/Developer/Dinario/tools/x-mcp
# Comment out or delete the USE_XDK_TOOLS line
sed -i.bak '/^USE_XDK_TOOLS=/d' .env
```

Or narrower per-tool rollback (keep XDK on working tools, drop the failing one):
```bash
# If only get_user is misbehaving:
sed -i.bak 's/USE_XDK_TOOLS=.*/USE_XDK_TOOLS=get_tweet,search_tweets,get_followers,get_following/' .env
```

### Step 2 — Restart the MCP
Claude Code loads MCPs at startup; changing `.env` does nothing to a running process. Restart Claude Code on that agent's machine. The MCP reloads with the new flag value.

### Step 3 — Verify legacy path is live
On first MCP tool call post-restart, look for this in stderr / Claude Code MCP logs:
- **Legacy active**: no `[x-mcp] XDK enabled for tools: ...` line
- **XDK partial**: `[x-mcp] XDK enabled for tools: <subset>` — confirms narrower scope took effect
- **XDK full (unintended)**: line lists all 5 tools — env var didn't unset; repeat Step 1

Quick verification: invoke any rolled-back tool and confirm response still succeeds. Error-shape smoke: invoke `get_user` with an invalid username — should produce `getUser failed (HTTP N): ...` format.

## Post-rollback actions

1. **Post to `#ops-alerts`** using this template:

```
🔴 x-mcp XDK rollback — <agent name> at <HH:MM ET>
Trigger: <brief reason, e.g., "get_user missing created_at field">
Scope: <tools rolled back, or "all XDK tools">
Current state: <"full legacy" | "partial: <list>">
Commit: 26729ff (or latest on feat/xdk-migration-pr1)
Next: awaiting RCA. Do not re-enable without engineering sign-off.
```

2. **Do not re-enable** `USE_XDK_TOOLS` on that agent until the root cause is documented and a fix (or upstream XDK patch) has landed.

3. **Preserve the MCP log window** that triggered the rollback — copy to a Gist or paste into `#ops-alerts` thread. Auto-generated XDK behavior can be hard to reproduce without it.

## Emergency kill-switch (all 3 agents at once)

If you see parity drift cascading, don't do per-agent rollback — kill XDK fleet-wide:

```bash
# Run on each of Perkins / Closer / Forge:
ssh mac-mini  # if remote
cd ~/Developer/Dinario/tools/x-mcp && sed -i.bak '/^USE_XDK_TOOLS=/d' .env
# Restart Claude Code on that machine (cmd-Q + relaunch, or CLI equivalent)
```

Expected total downtime: ~2 minutes per agent, sequential. No X API downtime — legacy path is always live.

## Rollback verification checklist

- [ ] `.env` file no longer contains `USE_XDK_TOOLS=...` (or contains only the intended narrow scope)
- [ ] Claude Code restarted on the affected machine
- [ ] First post-restart MCP call succeeds and returns legacy-shaped response
- [ ] `#ops-alerts` message posted
- [ ] Incident logged to Brain `03-Infrastructure/` with trigger + resolution

## Contacts

- Technical Director (re-sign-off on any re-enable): Software Architect agent
- Product Director (approves cutover re-attempt): Product Manager agent
- Human engineer sign-off required before any **PR 2+** work (write-path or OAuth 2.0) per 2026-04-13 director standing rule
