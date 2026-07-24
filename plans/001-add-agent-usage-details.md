# Plan 001: Add local Claude and Codex usage details to the Agents surface

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat d39f779..HEAD -- apps/desktop/package.json pnpm-lock.yaml apps/desktop/src/plugins/agents apps/desktop/src/app/main/bootstrap.ts apps/desktop/src/app/main/serverBridges.ts apps/desktop/src/app/server/devNode.ts apps/desktop/src/app/server/routes.ts apps/desktop/src/core/client/tasks/TaskView.tsx docs/terminal-and-agents.md`
>
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `d39f779`, 2026-07-24

## Why this matters

Acorn already treats Claude Code and Codex as first-class agent profiles, but
the Agents panel only reports task-local process/workflow state. A user cannot
currently see whether either provider is near its session or weekly limit
without leaving Acorn. This change adds a compact account-level usage read
model to the same Agents surface, using the CLIs and local files the user is
already authenticated with; it does not ask Acorn to own OAuth tokens or API
keys.

The implementation must preserve an important boundary: usage belongs to the
provider account, not to a task or individual terminal session. Collect it
once in the main process, cache it globally, and let both the task-scoped panel
and its rail button consume the same snapshot.

## Current state

### Acorn architecture and insertion points

- `apps/desktop/src/plugins/agents/client/AgentsPanel.tsx` is the right-hand
  Agents drawer. It currently composes a task-scoped terminal/workflow roster,
  launcher, and selected-agent feed. There is no agents server/shared usage
  surface.
- `apps/desktop/src/core/client/tasks/TaskView.tsx:200-231` owns the open signal,
  renders the right-rail Agents button, and mounts `AgentsPanel`.
- `apps/desktop/src/core/client/tooltip/RailTips.tsx:16-28` reads `data-tip`,
  `data-tip-sub`, and `data-tip-key` from the hovered rail button. The
  description is plain text, which is sufficient for a compact
  `🟢 Claude 82% · 🟡 Codex 34%` summary; the core tooltip does not need a new
  structured rendering contract.
- `apps/desktop/src/app/server/routes.ts` is the app-owned composition root for
  plugin HTTP routers.
- `apps/desktop/src/app/main/serverBridges.ts` wires pure-Node plugin bridges
  for both Electron and `dev:node`. The editor search route is the relevant
  pattern: `apps/desktop/src/plugins/editor/server/routes/search.ts` declares a
  typed bridge slot and `apps/desktop/src/plugins/editor/main/search.ts`
  implements it.
- `apps/desktop/src/plugins/terminal/client/sessions.ts` is the relevant client
  state pattern: a module-level Solid signal, a single initialization path,
  and latest-request-wins refresh behavior.
- `apps/desktop/src/plugins/profiles-claude/main/claudeCode.ts:5-11` identifies
  the Claude profile as command `claude`; the Codex equivalent is
  `apps/desktop/src/plugins/profiles-codex/main/codex.ts:15-21`, command
  `codex`.
- `apps/desktop/package.json` already depends on `node-pty` and xterm 5.5.0 for
  interactive terminal support, but not the Node-compatible
  `@xterm/headless` terminal renderer needed to reconstruct a full-screen
  command's final screen without a DOM.

Current panel placement:

```tsx
// apps/desktop/src/plugins/agents/client/AgentsPanel.tsx:123-145
<aside class="agents-panel">
  <div class="agents-head">
    <span class="agents-title">Agents</span>
    <button ...>+ New agent</button>
    <button ...>✕</button>
  </div>
  ...
  <ul class="agents-roster">
```

Current rail button:

```tsx
// apps/desktop/src/core/client/tasks/TaskView.tsx:219
<button
  type="button"
  class="pane-switch-btn"
  data-tip="Agents"
  data-tip-sub="Roster · launcher · feed"
  ...
>
  ⠿
</button>
```

Current pure-Node bridge composition:

```ts
// apps/desktop/src/app/main/serverBridges.ts:20-26
export function wireServerBridges(db: AppDatabase): void {
  setSearchBridge(searchBridge(db))
  setEditorBridge(editorBridge(db))
  setLocalGitBridge(localGitBridge(db))
  setDatabaseBridge(databaseBridge(db))
  setDockerBridge(dockerBridge(db))
  registerDockerWsChannel()
}
```

### ClaudeBar behavior to reimplement

ClaudeBar was inspected at `/Users/jamesmacfie/Source/ClaudeBar`, commit
`796e012`. Treat it as behavioral reference material, not as a runtime
dependency and not as code to copy verbatim.

Claude's default no-extra-credentials path:

1. Locate `claude` on the inherited/login-shell `PATH`.
2. Spawn a PTY at 160 columns × 50 rows with:
   `claude /usage --allowed-tools ""`.
3. Remove `CLAUDE_CODE_OAUTH_TOKEN` from the child environment so a setup token
   without profile scope does not override the CLI's own stored login.
4. Capture until three seconds of meaningful output inactivity, with a
   20-second hard timeout. Respond to trust/onboarding prompts when present.
5. Replay the PTY byte stream through a terminal emulator before parsing;
   stripping ANSI escape sequences alone is not sufficient because `/usage`
   redraws a full-screen terminal with cursor movement and alternate buffers.
6. Parse current session, current week, model-specific limits such as Fable,
   percent used/left, reset text/time, plan/account, and extra-usage
   spent/budget.
7. When `/usage` reports that it is only available for subscription plans,
   invoke `claude /cost` and parse session API cost and API duration instead.
8. Independently scan recently modified
   `~/.claude/projects/**/*.jsonl` assistant messages to estimate today's
   input/output/cache token totals and cost. Deduplicate streamed messages by
   `(message.id, requestId)`, keeping the last cumulative record. ClaudeBar's
   pricing is a local model-price table, not a network pricing request, so this
   estimate needs no API key. It also computes session count, working time
   (new session after a gap over 30 minutes), cache savings, and yesterday's
   comparison.

Codex's default no-extra-credentials path:

1. Spawn
   `codex -s read-only -a untrusted app-server` with stdin/stdout pipes.
2. Exchange newline-delimited JSON-RPC: `initialize`, `initialized`, then
   `account/rateLimits/read`.
3. Read `rateLimits.planType`, `primary`, and `secondary`. Each window has
   `usedPercent` and may have a Unix-seconds `resetsAt`; expose primary as the
   current/session window and secondary as weekly, converting to percent
   remaining.
4. If app-server fails, spawn a PTY with
   `codex -s read-only -a untrusted`, send `/status`, and parse `5h limit` and
   `Weekly limit` percentages. This fallback may not provide reset times.

ClaudeBar also has direct Claude/Codex HTTP modes that read, refresh, and
rewrite OAuth credentials. Those modes are deliberately excluded here: they
broaden Acorn's credential ownership and are not necessary for the requested
local usage view.

### Normalized product contract

Create a plugin-owned, serializable contract in
`apps/desktop/src/plugins/agents/shared/usage.ts`. It must model absence
explicitly instead of inventing values:

```ts
export type AgentUsageProviderId = 'claude' | 'codex'
export type AgentUsageHealth =
  | 'healthy'
  | 'warning'
  | 'critical'
  | 'depleted'
  | 'unknown'

export type AgentUsageQuota = {
  id: string
  label: string
  percentRemaining: number
  resetsAt: number | null
  resetText: string | null
  health: AgentUsageHealth
}

export type AgentUsageCost = {
  source: 'extra_usage' | 'cli_cost'
  spentUsd: number
  budgetUsd: number | null
  remainingUsd: number | null
  resetsAt: number | null
  resetText: string | null
  apiDurationSeconds: number | null
  estimated: false
}

export type AgentDailyUsagePeriod = {
  day: string // local YYYY-MM-DD
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  totalNonCacheTokens: number
  workingSeconds: number
  sessionCount: number
  estimatedCostUsd: number | null
  estimatedCacheSavingsUsd: number | null
  pricingFallback: boolean
}

export type AgentDailyUsage = {
  today: AgentDailyUsagePeriod
  yesterday: AgentDailyUsagePeriod | null
  skippedFileCount: number
}

export type AgentUsageErrorCode =
  | 'cli_missing'
  | 'authentication_required'
  | 'update_required'
  | 'trust_failure'
  | 'timeout'
  | 'output_limit'
  | 'parse_failure'
  | 'execution_failure'

export type AgentProviderUsage = {
  provider: AgentUsageProviderId
  availability: 'available' | 'missing' | 'error'
  health: AgentUsageHealth
  plan: string | null
  account: { email: string | null; organization: string | null } | null
  quotas: AgentUsageQuota[]
  cost: AgentUsageCost | null
  daily: AgentDailyUsage | null
  capturedAt: number | null
  stale: boolean
  error: { code: AgentUsageErrorCode; message: string } | null
}

export type AgentUsageSnapshot = {
  providers: AgentProviderUsage[]
  refreshedAt: number
}
```

CLI-reported cost is kept separate from the daily estimated total. Optional
budget/reset/API duration data is represented as `null`, not zero. Daily token
counts keep input, output, cache-write, cache-read, and non-cache total
separate.

Use these exact health thresholds for remaining percentage:

- `<= 0`: `depleted` (neutral/grey)
- `< 20`: `critical` (red)
- `< 50`: `warning` (yellow/orange)
- `>= 50`: `healthy` (green)
- missing/unavailable: `unknown` (neutral/grey)

Clamp parsed percentages into 0–100. Provider health is the worst health among
its reported quotas; the rail tooltip specifically uses the quota with
`id === "session"`, not the worst quota.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Add renderer | `pnpm --filter @acorn/desktop add @xterm/headless@5.5.0` | exit 0; package and lockfile updated |
| Focused tests | `pnpm --filter @acorn/desktop test -- src/plugins/agents` | exit 0; all Agents tests pass |
| Boundary test | `pnpm --filter @acorn/desktop test -- src/core/boundaries.test.ts` | exit 0; no new forbidden import edge |
| Typecheck | `pnpm lint` | exit 0, no TypeScript errors |
| Full tests | `pnpm test` | exit 0; all Vitest tests pass |
| Production build | `pnpm --filter @acorn/desktop build` | exit 0; Electron main and renderer bundles build |
| Restore Electron ABI before a manual launch | `pnpm run rebuild` | exit 0 |

`pnpm test` rebuilds `better-sqlite3` and `node-pty` for Node. Run
`pnpm run rebuild` before `pnpm dev` if performing the manual Electron smoke
test after tests.

## Suggested executor toolkit

- `@xterm/headless` 5.5.0 is the version aligned with Acorn's existing xterm
  5.5 dependency. Its API is documented in the xterm.js package/release
  material; do not upgrade the rest of the xterm packages as part of this
  feature.
- Read `docs/architecture-overview.md`, `docs/plugins.md`, and
  `docs/terminal-and-agents.md` before coding.

## Scope

**In scope** (the only product files/directories to modify):

- `apps/desktop/package.json`
- `pnpm-lock.yaml`
- `apps/desktop/src/plugins/agents/shared/usage.ts` (create)
- `apps/desktop/src/plugins/agents/main/usage/processRunner.ts` (create)
- `apps/desktop/src/plugins/agents/main/usage/processRunner.test.ts` (create)
- `apps/desktop/src/plugins/agents/main/usage/claudeUsage.ts` (create)
- `apps/desktop/src/plugins/agents/main/usage/claudeUsage.test.ts` (create)
- `apps/desktop/src/plugins/agents/main/usage/claudeDailyUsage.ts` (create)
- `apps/desktop/src/plugins/agents/main/usage/claudeDailyUsage.test.ts` (create)
- `apps/desktop/src/plugins/agents/main/usage/codexUsage.ts` (create)
- `apps/desktop/src/plugins/agents/main/usage/codexUsage.test.ts` (create)
- `apps/desktop/src/plugins/agents/main/usage/service.ts` (create)
- `apps/desktop/src/plugins/agents/main/usage/service.test.ts` (create)
- `apps/desktop/src/plugins/agents/server/routes/usage.ts` (create)
- `apps/desktop/src/plugins/agents/server/routes/usage.test.ts` (create)
- `apps/desktop/src/plugins/agents/client/usageClient.ts` (create)
- `apps/desktop/src/plugins/agents/client/usageStore.ts` (create)
- `apps/desktop/src/plugins/agents/client/usageStore.test.ts` (create)
- `apps/desktop/src/plugins/agents/client/usageModel.ts` (create)
- `apps/desktop/src/plugins/agents/client/usageModel.test.ts` (create)
- `apps/desktop/src/plugins/agents/client/AgentUsageSection.tsx` (create)
- `apps/desktop/src/plugins/agents/client/AgentsToggle.tsx` (create)
- `apps/desktop/src/plugins/agents/client/AgentsPanel.tsx`
- `apps/desktop/src/plugins/agents/client/agents-panel.css`
- `apps/desktop/src/app/main/bootstrap.ts`
- `apps/desktop/src/app/main/serverBridges.ts`
- `apps/desktop/src/app/server/devNode.ts`
- `apps/desktop/src/app/server/routes.ts`
- `apps/desktop/src/core/client/tasks/TaskView.tsx`
- `docs/terminal-and-agents.md`
- `plans/README.md` (status update only)

Tests may create temporary directories and fixture files at runtime. Keep
fixture strings inline in the named test files so the source scope does not
expand.

**Out of scope** (do NOT touch, even though they look related):

- Direct calls to Claude or Codex web APIs, OAuth token refresh, API-key
  settings, or reading credentials into the renderer.
- SQLite/Drizzle schema, migrations, IndexedDB, or persistent usage history.
- Usage for providers other than Claude and Codex.
- Task/session attribution of account-level quota or local daily usage.
- A structured or interactive extension to the core `RailTips` component.
- Changes to Claude/Codex agent-profile contribution contracts.
- Pricing fetched from a remote service.
- Notifications, burn-rate forecasting, pace calculations, or new settings.
- Upgrading `@xterm/xterm`, `@xterm/addon-fit`, or `@xterm/addon-webgl`.
- Copying source files or license headers from ClaudeBar into Acorn.

## Git workflow

- Work on the current `bar` branch. Do not create another branch.
- Commit by logical unit if commits are requested; match the repository's
  conventional style, for example `feat(agents): add local usage details`.
- Do not push or open a pull request unless the operator explicitly asks.

## Steps

### Step 1: Add the normalized usage contract and terminal renderer dependency

1. Run `pnpm --filter @acorn/desktop add @xterm/headless@5.5.0`. Confirm this
   adds the package under desktop dependencies and changes only the expected
   lockfile entries.
2. Create `plugins/agents/shared/usage.ts` with the normalized contract above,
   route constants for:
   - `GET /api/agents/usage`
   - `POST /api/agents/usage/refresh`
3. Export pure helpers for percentage clamping, health derivation, worst-health
   selection, and selecting a provider's session quota. Keep wire data as
   JSON-safe primitives; timestamps are Unix epoch milliseconds.
4. Do not add the contract to `core/shared/api.ts`: both HTTP endpoints and
   their consumers belong to the Agents plugin.

**Verify**:
`pnpm --filter @acorn/desktop exec tsc --noEmit` → exit 0 and no errors.

### Step 2: Build a bounded, privacy-safe PTY capture adapter

Create `main/usage/processRunner.ts` as infrastructure used only by the Agents
usage collectors.

Requirements:

- Resolve executables from `process.env.PATH`; never invoke a shell and never
  concatenate a command string.
- Build a child environment from an explicit allowlist:
  `HOME`, `PATH`, `SHELL`, `LANG`, `LC_ALL`, `USER`, `LOGNAME`, and `TMPDIR`,
  plus `TERM=xterm-256color`. Do not pass Acorn/GitHub/Linear/session secrets.
- Support command, argument array, working directory, columns/rows, optional
  startup input, prompt-response rules, meaningful-idle timeout, hard timeout,
  and maximum captured-byte count.
- Default to 160 × 50, three seconds meaningful-idle, 20 seconds hard timeout,
  and a finite cap no larger than 2 MiB.
- Ignore OSC-only terminal chatter when deciding whether output is meaningful.
- Kill the PTY on success, timeout, output overflow, abort, and error. Settle
  exactly once.
- Replay the captured bytes through `@xterm/headless` after capture, and return
  the active buffer's translated lines including scrollback. Capture the final
  screen before sending termination input so an alternate-buffer application
  cannot erase its own output.
- Never log raw PTY output. Tests may include synthetic non-secret output.

Design this with injected PTY/spawn and clock/timer boundaries so unit tests do
not launch the real installed CLIs.

Tests in `processRunner.test.ts` must cover cursor-addressed redraw, alternate
screen output, prompt response, idle completion, hard timeout, output cap, and
child cleanup.

**Verify**:
`pnpm --filter @acorn/desktop test -- src/plugins/agents/main/usage/processRunner.test.ts`
→ all new tests pass.

### Step 3: Implement the Claude quota and cost collector

Create `main/usage/claudeUsage.ts` with separately testable execution,
terminal-text parsing, reset parsing, and error classification.

Execution:

- Use the safe PTY adapter to run
  `claude /usage --allowed-tools ""` from
  `<dataDir>/agent-usage-probe`. Create that directory recursively.
- Explicitly delete `CLAUDE_CODE_OAUTH_TOKEN` even if the safe-environment
  implementation later changes.
- Detect and answer the documented trust/onboarding prompts once.
- If the rendered terminal still asks the user to trust the probe folder,
  perform the same narrow fallback behavior as ClaudeBar: atomically merge
  only
  `projects[absoluteProbeDir].hasTrustDialogAccepted = true` into
  `~/.claude.json`, preserving all unknown keys and file permissions, then
  retry once. Do not pre-approve arbitrary repositories or paths. If the file
  is malformed, has an unexpected top-level shape, or cannot be safely
  replaced, return a `trust_failure` result without modifying it.
- A CLI missing/auth/update/timeout/parse failure is provider-local. Normalize
  it; do not throw away Codex data.

Parsing:

- Accept either `% used` or `% left`, and normalize to remaining.
- Parse session, weekly/all-model, and model-specific quotas. Give the primary
  session quota the stable ID `session`, weekly `weekly`, and model quotas
  `model:<normalized-name>`.
- Carry both parsed `resetsAt` and the original normalized `resetText` when
  available. If a timezone/format cannot be safely parsed, keep the text and
  leave `resetsAt` null.
- Parse plan/account identity from the usage screen and, if needed,
  `~/.claude.json`'s public account metadata. Never expose or log tokens.
- Parse extra-usage spend/budget/reset. Calculate remaining dollars only when
  a budget exists.
- When the subscription-only message is detected, run `claude /cost` through
  the same adapter and expose CLI-reported session cost/API duration without
  fabricating quota values.

Use table-driven tests with rendered samples for `% used`, `% left`, session +
weekly + Fable/model limits, extra usage, subscription-only `/cost`, reset
formats, authentication/update errors, malformed output, and the setup-token
environment exclusion.

**Verify**:
`pnpm --filter @acorn/desktop test -- src/plugins/agents/main/usage/claudeUsage.test.ts`
→ all new Claude collector tests pass.

### Step 4: Add Claude daily local-log usage and pricing estimates

Create `main/usage/claudeDailyUsage.ts`.

- Recursively consider JSONL files under `~/.claude/projects` whose mtime can
  contribute to today or yesterday; do not scan file contents known to be
  older than the comparison window.
- Parse only assistant entries containing `message.usage`, model, timestamp,
  message ID, and request ID. Ignore malformed or unrelated lines without
  failing the whole provider.
- Deduplicate `(message.id, requestId)` and keep the last record so streamed
  cumulative output is counted once.
- Aggregate today and yesterday independently in local time.
- Report input, output, cache-creation, cache-read, non-cache total, session
  count, working seconds, estimated cost, and estimated cache savings.
- Reimplement the local model-pricing lookup behavior. Before entering rates,
  verify ClaudeBar's table against Anthropic's current official pricing page.
  Store rates per one million tokens and support normalized versioned model
  names/prefixes. Mark every derived monetary value `estimated: true`.
- Unknown models must not silently masquerade as a known model. Use an
  explicit conservative fallback rate with an accompanying
  `pricingFallback: true` field, or omit the estimated money while retaining
  token totals. Whichever behavior is chosen, lock it in a named test.
- Bound concurrency and file size. A single unreadable/oversized file should
  be skipped and counted in a non-sensitive diagnostic count, not crash the
  collector.
- Never return prompt text, response text, project paths, session IDs, message
  IDs, or request IDs to the renderer.

Tests must use temporary directories and cover empty/missing roots, malformed
lines, mtime filtering, last-record-wins deduplication, cache categories,
today/yesterday boundaries, 30-minute work-session gaps, known/unknown model
pricing, and unreadable/oversized files.

**Verify**:
`pnpm --filter @acorn/desktop test -- src/plugins/agents/main/usage/claudeDailyUsage.test.ts`
→ all new daily-usage tests pass.

### Step 5: Implement the Codex app-server collector with PTY fallback

Create `main/usage/codexUsage.ts` with an injectable line-oriented process
transport.

Primary path:

- Spawn `codex -s read-only -a untrusted app-server` with ordinary child
  process pipes and the same safe environment policy.
- Send newline-delimited JSON-RPC messages in this order:
  1. request `initialize` with Acorn client name/version,
  2. notification `initialized`,
  3. request `account/rateLimits/read`.
- Match response IDs, ignore notifications/other IDs, validate all decoded
  values as `unknown`, and enforce the 20-second timeout and 2 MiB cap.
- Always close stdin and terminate the process.
- Normalize `primary.usedPercent` to the `session` remaining quota and
  `secondary.usedPercent` to `weekly`; preserve `planType`; convert
  `resetsAt` Unix seconds to epoch milliseconds.
- If a free plan has no windows, report an available plan with a 100% session
  row labeled as a free plan. For other plans with no rate data, report a
  parse failure rather than inventing availability.

Fallback:

- On an RPC execution/protocol failure, run
  `codex -s read-only -a untrusted` in the PTY adapter and send `/status`.
- Parse `5h limit` and `Weekly limit` lines containing `% left`.
- Preserve the primary failure only as a diagnostic; if the fallback
  succeeds, the provider is available. Do not imply reset times the fallback
  did not return.

Tests must cover the JSON-RPC handshake/order/ID filtering, primary and
secondary windows, reset conversion, free plan, missing limits, malformed
JSON, timeout/cleanup, RPC-to-TTY fallback, TTY percentages, and both-path
failure.

**Verify**:
`pnpm --filter @acorn/desktop test -- src/plugins/agents/main/usage/codexUsage.test.ts`
→ all new Codex collector tests pass.

### Step 6: Orchestrate, cache, and expose the global snapshot

Create `main/usage/service.ts` and `server/routes/usage.ts`, then wire them at
the composition roots.

Service behavior:

- Construct one service for the app lifetime with the configured `dataDir`.
- Refresh Claude and Codex concurrently with `Promise.allSettled`.
- Keep a per-provider last successful value. A failed refresh returns the last
  value marked stale and attaches the normalized error; with no prior success,
  return a provider error row.
- Use a five-minute in-memory TTL and one shared in-flight promise. Multiple
  readers during a refresh must not launch duplicate CLIs.
- A forced refresh bypasses the TTL but joins an already-running refresh.
- Do not persist this snapshot in SQLite or IndexedDB.

HTTP/bridge behavior:

- `usage.ts` declares an `AgentUsageBridge` and bridge slot following
  `plugins/editor/server/routes/search.ts`.
- `GET /api/agents/usage` reads through the cache.
- `POST /api/agents/usage/refresh` forces refresh and is protected by the
  existing authenticated/CSRF route stack.
- Both endpoints return HTTP 200 for provider-local unavailable/error rows.
  Reserve HTTP errors for a missing bridge or unexpected route-level failure.
- Register the router at prefix `/api/agents` in `app/server/routes.ts`.
- Update `wireServerBridges` to receive `dataDir`, construct the service once,
  and set the bridge. Pass `dataDir` from `bootstrap.ts` and `devDataDir` from
  `devNode.ts`.
- No changes to `Env`, `RuntimeBindings`, preload IPC, or the database are
  required.

Tests must follow `plugins/editor/server/routes/search.test.ts` for bridge-slot
cleanup. Cover GET, forced POST, absent bridge, and provider-local errors.
Service tests cover TTL, single-flight, parallel provider completion, partial
failure, stale last-good data, and force refresh.

**Verify**:
`pnpm --filter @acorn/desktop test -- src/plugins/agents/main/usage/service.test.ts src/plugins/agents/server/routes/usage.test.ts`
→ all new service and route tests pass.

### Step 7: Add one global Solid usage store and compact formatters

Create `client/usageClient.ts`, `client/usageStore.ts`, and
`client/usageModel.ts`.

- Use `readJson`/`writeJson` from `core/client/apiClient`, as
  `plugins/agents/client/workflowClient.ts` does.
- The module-level store owns snapshot, initial-loading, refresh-loading, and
  route-level error signals.
- `initAgentUsage()` reference-counts mounted consumers, immediately ensures a
  cached snapshot, starts one five-minute polling interval while at least one
  consumer exists, and returns cleanup. It must never make a request per
  hover.
- Use latest-request-wins semantics so a slower earlier request cannot replace
  a forced refresh.
- Provide a manual `refreshAgentUsage()` using the POST endpoint.
- `usageModel.ts` contains pure formatters for dollars, token counts, relative
  reset/updated time, health icon/label, key-value row projection, and tooltip
  text.
- Tooltip output order is Claude then Codex and uses only each provider's
  session quota:
  `🟢 Claude 82% · 🟡 Codex 34%`.
- Use a neutral icon and em dash for loading/missing/error data. Do not display
  stale data as current without a stale marker in the panel.

Tests cover initialization/ref counting, polling cleanup, manual refresh
ordering, latest-only response races, all health thresholds, absent providers,
stale providers, dollar/token formatting, and deterministic Claude-before-
Codex tooltip order.

**Verify**:
`pnpm --filter @acorn/desktop test -- src/plugins/agents/client/usageStore.test.ts src/plugins/agents/client/usageModel.test.ts`
→ all new client model/store tests pass.

### Step 8: Add the compact usage UI and hover summary

Create `AgentUsageSection.tsx` and `AgentsToggle.tsx`; integrate them into the
existing panel/task seam.

Detailed panel:

- Mount `AgentUsageSection` immediately below the Agents header/launcher and
  above the task-scoped roster. Label it `Usage` so it is not confused with a
  selected agent's run data.
- Show one compact Claude block and one compact Codex block. Each has a
  CSS-colored health dot, provider, optional plan/account, last-updated/stale
  state, and semantic `<dl>` key/value rows.
- For each quota show percent remaining and reset information. Include all
  model-specific Claude rows, not just Fable.
- Show reported extra usage or `/cost` values with precise labels. Show
  locally calculated daily money as `Estimated today`, never as billed cost.
- Show available daily token breakdown, working time, session count, and
  estimated cache savings. Do not render placeholder zeroes for fields the
  provider did not report; omit them or label them unavailable.
- Show provider-local errors inline while preserving the other provider's
  details.
- Add a right-aligned `↻` refresh icon using the repository's existing refresh
  styling convention. Disable it during refresh.
- Give the usage section its own bounded scroll area (maximum roughly 40–45%
  of panel height) so the task roster and selected-agent feed remain usable at
  380 px panel width.

Rail summary:

- `AgentsToggle` owns the current button markup, initializes the usage store
  even while the drawer is closed, and sets `data-tip-sub` to the pure
  tooltip summary.
- Replace only the inline Agents button in `TaskView.tsx`; preserve active
  state, shortcut label, click behavior, glyph, and aria label.
- Do not modify `RailTips.tsx` or its CSS. Emoji/color-circle text is the
  intentional v1 rendering contract because `data-tip-sub` is plain text.

Use CSS variables already present in the UI: green from the add/success color,
warning from `--warn`, red from the delete/error color, and neutral from the
faint text color. Do not hard-code theme-specific hex colors.

**Verify**:

1. `pnpm --filter @acorn/desktop test -- src/plugins/agents` → all Agents tests
   pass.
2. `pnpm --filter @acorn/desktop test -- src/core/boundaries.test.ts` → pass;
   no new cross-plugin import baseline entry.
3. `pnpm lint` → exit 0.

### Step 9: Document behavior and run release-level verification

Update `docs/terminal-and-agents.md` with:

- account-scoped versus task-scoped ownership;
- local sources used for Claude and Codex;
- five-minute cache/poll and manual refresh;
- health thresholds;
- pricing as an estimate;
- the narrow Claude probe-folder trust entry;
- explicit statement that Acorn does not call provider usage APIs or own OAuth
  refresh tokens in this version;
- expected error states when a CLI is missing, logged out, outdated, or its
  output no longer parses.

Then run the full gates.

**Verify**:

1. `pnpm lint` → exit 0.
2. `pnpm test` → exit 0.
3. `pnpm --filter @acorn/desktop build` → exit 0.
4. `git diff --check` → no output.
5. `git status --short` → only files listed in Scope are present.

Optional but strongly recommended manual smoke after `pnpm run rebuild`:

- Launch `pnpm dev` with both CLIs already logged in.
- Hover the closed Agents rail button and see both session percentages.
- Open Agents and see detailed Claude/Codex rows without a second immediate
  process launch.
- Force refresh and verify the loading state, other Agents roster behavior,
  and terminal drawer still work.
- Repeat with each CLI temporarily unavailable on `PATH` and verify the other
  provider still renders.

## Test plan

New automated tests and their required cases are specified in Steps 2–7. Use:

- `apps/desktop/src/plugins/editor/server/routes/search.test.ts` as the route
  bridge-slot pattern;
- `apps/desktop/src/plugins/agents/client/model.test.ts` as the Agents plugin's
  pure model-test style;
- injected process/clock/filesystem boundaries so tests never depend on a
  developer's real Claude/Codex login, home files, network, or current CLI
  output.

No test may launch the installed `claude` or `codex` command. Parser fixtures
must be synthetic and contain no real account email, token, project path, or
usage amount.

## Done criteria

- [ ] The rail hover shows Claude then Codex session percentage with the
  correct green/yellow/red/neutral icon, including graceful missing/error
  states.
- [ ] The Agents drawer shows compact key/value quota/reset details for both
  providers and Claude cost/token details when locally available.
- [ ] No hover event launches a child process; one global store and one
  service single-flight cache serve both UI surfaces.
- [ ] No direct provider HTTP API, API key, OAuth refresh, DB migration,
  preload IPC, or core tooltip change was added.
- [ ] Raw terminal output, local message content, paths, IDs, and credentials
  never cross into the renderer or logs.
- [ ] Partial provider failure preserves the other provider and marks cached
  last-good data stale.
- [ ] `pnpm --filter @acorn/desktop test -- src/plugins/agents` exits 0.
- [ ] `pnpm --filter @acorn/desktop test -- src/core/boundaries.test.ts` exits
  0 with no baseline expansion.
- [ ] `pnpm lint`, `pnpm test`, and
  `pnpm --filter @acorn/desktop build` all exit 0.
- [ ] `git diff --check` has no output.
- [ ] No product files outside the Scope list are modified.
- [ ] `plans/README.md` status row is updated.

## STOP conditions

Stop and report back; do not improvise if:

- Any in-scope current-state excerpt has materially drifted after `d39f779`.
- `@xterm/headless@5.5.0` cannot render the captured alternate-buffer screen or
  cannot coexist with Acorn's pinned xterm 5.5 packages.
- Current installed Claude no longer supports the positional `/usage` or
  `/cost` invocation without an interactive user session.
- Current Codex app-server no longer supports
  `account/rateLimits/read`, or its response does not contain a stable
  equivalent of used percentage and reset time.
- Making Claude's probe folder trusted would require overwriting malformed
  config, changing an unknown config schema, or trusting any path other than
  the dedicated Acorn probe directory.
- Pricing cannot be verified from an official public source. Keep token totals
  but stop before shipping estimated money rather than guessing rates.
- The collectors require a new cross-plugin direct import, new preload bridge,
  `Env` change, database schema, or credential/API integration.
- A CLI invocation exposes secrets in args/output or requires a permission
  mode broader than the commands specified here.
- A verification step still fails after two reasonable scoped correction
  attempts.
- The change requires a product file not named in Scope.

## Maintenance notes

- CLI full-screen output and JSON-RPC contracts are external, versioned inputs.
  Keep parsing isolated and fixture-heavy; a provider format change should
  degrade to a provider-local error, never break the Agents panel.
- Anthropic model prices change. Review the local pricing table when new model
  IDs appear and always label its output estimated.
- Review the Claude trust fallback especially carefully: it must be an atomic,
  preserving merge for exactly the dedicated probe directory.
- Review process cleanup, output caps, and environment filtering. These are
  privileged local subprocesses even though they use read-only/status
  commands.
- A future richer tooltip can add structured delegated-tooltip data, but that
  should be a separate core UI contract. This plan intentionally uses the
  existing text subtitle.
- Direct provider APIs may offer richer credit/reset information, but adding
  them requires a separate security/design decision about OAuth credential
  ownership and refresh writes.
