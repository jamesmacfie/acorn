# Implementation guide — the extensibility work

**Status:** execution plan · **Audience:** the developer implementing it.

This is the hub document: it says **what to build, in what order, why, and how
to know each step is done**. Every other doc in this folder augments it — the
full map is [README.md](./README.md). The immediate sources:

- [review.md](./review.md) — the findings and prioritized recommendations this
  plan executes; citations like *(review #3)* refer to its recommendation table.
- [extensibility.md](./extensibility.md) + [contribution-points.md](./contribution-points.md)
  (§4) + [state-and-policies.md](./state-and-policies.md) (§5) — the
  plugin-platform target; citations *(ext §N)*, *(points §4.N)*, *(state §5.N)*.
- [integrations.md](./integrations.md) — the integration-provider contract
  Phase 7 implements and every future provider (Sentry, Better Stack, Notion)
  is built against; citations *(integrations §N)*.
- [inventories.md](./inventories.md) — the exact channel/route/pref/listener
  lists the phases work through; citations *(inv §N)*. **Work from the
  inventory, not from memory** — it turns "migrate the IPC surface" into a
  checklist of 67 named channels.
- [feature-parity.md](./feature-parity.md) — the behaviour-level parity
  contracts, one checkbox per shipped behaviour; citations *(parity §N)*.
  **A phase that moves a domain re-verifies that domain's contract section**
  — the parity map (ext §7) proves features have homes; this doc proves the
  behaviours survived the move.
- [performance.md](./performance.md), [ui-state.md](./ui-state.md),
  [agent-runtime.md](./agent-runtime.md) — budgets, reaction rules, and runtime
  corrections that ride these phases or run beside them.
- [security.md](./security.md) — the invariants every phase must preserve and
  the new rules Phase 3 must add. [testing.md](./testing.md) — the suites and
  what they gate. [ux.md](./ux.md) — the new user-facing surfaces, specified
  once. [docs-overhaul.md](./docs-overhaul.md) — the doc each phase must update.

## How to work this plan

1. **Each phase is independently shippable**, leaves the app working, and is
   worth doing even if the phases after it never happen. Ship phases as a
   short stack of reviewable PRs, not one mega-branch.
2. **Before claiming a phase done**: `pnpm lint`, `pnpm test`, the phase's
   Verify list, and — once it exists — the smoke suite
   ([testing.md](./testing.md) §1). Phases that touch boot/transport/restore
   also compare perf marks against the captured baseline
   ([performance.md](./performance.md) §3.1).
3. **Docs ride the PR**: a PR that changes an architecture fact updates the
   doc stating that fact ([docs-overhaul.md](./docs-overhaul.md) §1–2), ticks
   off the entries it consumed in [inventories.md](./inventories.md), and
   ticks the behaviours it preserved in
   [feature-parity.md](./feature-parity.md).
4. **Security invariants are non-negotiable**: the eight in
   [security.md](./security.md) §2 hold after every phase; a phase that breaks
   one has failed its verify step regardless of what else it achieved.
5. When this guide and a design doc disagree on a detail, **this guide wins**
   (it is later and more concrete); update the design doc in the same PR.

## Developer contract — what a PR must leave behind

The phases below intentionally open architectural seams before moving folders.
That is only safe if every PR leaves the next developer with a smaller, more
obvious system than it found. For every phase PR:

- **Name the boundary you are changing.** The PR description says which
  contract moved (`ApiError`, sync descriptor, WS frame, pane contribution,
  prefs slice, etc.) and lists the upstream callers and downstream consumers
  touched.
- **Prefer one new home over another convention.** If the phase creates a
  concept, put it in the home named in this guide; don't add a sibling helper
  with near-identical responsibility.
- **Make the registry/data table the source of truth.** Derived lists stay
  derived. A PR that leaves a new hand-synced list behind has not finished the
  phase.
- **Keep compatibility until the last commit of a slice.** For transport and
  registry work, add the new path, prove it, then delete the old path in the
  same domain slice. The revert boundary is the domain, not the whole phase.
- **Update inventories as you consume them.** Tick off named channels, pref
  keys, alert sites, keyed collections, route-test gaps, and stale docs in the
  same PR that changes them. If the code has moved, change the line references.
- **No silent failure path.** Any new mutation, poller, background refresh, or
  agent operation names its failure surface before it ships
  ([ui-state.md](./ui-state.md) §3).

### First homes for new abstractions

These paths are the default landing places. Change them only if the local code
layout makes the alternative clearly simpler, and record the reason in the PR.

| Concept | First home | Must expose |
| --- | --- | --- |
| API response/error contract | `apps/desktop/src/shared/api.ts` plus server helper near existing route utilities | `ApiError`, route builders/types, `respondError` |
| Auth enforcement | `apps/desktop/src/server/middleware/requireUser.ts` | middleware that rejects missing `c.get('user')`; `/auth` never mounts under it |
| Sync engine | `apps/desktop/src/server/sync/engine.ts` / `policy.ts` | `serveThenRevalidate`, in-flight dedupe, TTL constants |
| Composition root | `apps/desktop/src/main/bootstrap.ts` | `bootstrap()`, ordered construction, `reconcile()`, reverse-order dispose |
| HTTP routes replacing IPC | feature-owned `server/routes/*` modules mounted from the app factory | typed route + route test + 401 test |
| Stream transport | one WS module beside the loopback server startup | frame union, authenticated upgrade, attach replay ordering |
| Agent tool projection | core tool registry plus feature-owned tool definition modules | registry, MCP projection, harness route projection, permission filtering |
| Client registries | `client/core/registries/*` until Phase 10 foldering | register/derive/dispose APIs, conformance hooks |
| Startup restore | `client/core/startup/createStartupRestore.ts` until Phase 10 foldering | phased hydrate/persist pipeline, `PrefKeys`, failure notices |
| Event bus / will-phase | `client/core/events/*` until Phase 10 foldering | typed `on`, `emit`, `will`, timeout-bounded concern collection |

## Decisions this guide bakes in

Three places the source docs offered alternatives; the choices are made once
so phases don't re-litigate them:

1. **Transport: collapse to loopback HTTP + WebSocket, not a typed-IPC bus.**
   review.md offers both a typed IPC contract module (#3) and, in its
   technology section, moving the IPC surface onto the Hono server with a WS
   for PTY streams. Building the typed bus first would create an artifact the
   transport collapse then deletes. So: migrate request/response IPC to HTTP
   routes typed through `shared/api.ts` (the contract seam that already
   exists), add one WS for streams, and keep a *minimal* hand-typed IPC
   residue for true Electron-isms — exactly three channels *(inv §1c)*. The
   typed IPC module is the fallback only if the transport collapse stalls.
2. **No runtime validation across the HTTP surface.** Per review.md's
   deliberate non-recommendation: compile-time linkage made mandatory
   (`satisfies`, shared types) is the right level for a single-user loopback
   app. zod stays at the genuinely untrusted boundaries — SQLite JSON blobs
   written by older versions, agent-supplied harness/tool inputs, and (new
   with Phase 3) request bodies on routes that write files or spawn processes.
3. **Registries before foldering.** Every extension seam is opened in place
   (registries, event bus, projections) while features stay statically
   imported; the `core/` + `plugins/` folder move (ext §9 step 7) is the
   *last* step, when it degenerates to `git mv` plus lint rules.

## Three gates that cut across the sequence

- **The smoke suite gates Phases 3, 5, and 6.** Five Playwright-Electron
  tests (boot / restore / open-task / terminal-echo / quit-clean), specified
  in [testing.md](./testing.md) §1. It lands on `main` before Phase 3 starts.
  Phase 6's known failure mode is a startup race — one manual relaunch will
  not catch it; S2 (the restore test) exists for exactly that.
- **The perf baseline gates Phases 1, 3, and 6.** Capture the marks in
  [performance.md](./performance.md) §3.1 *before* each of those phases
  touches its path; "no visible regression" is unverifiable otherwise —
  the app has zero instrumentation today.
- **The parity contracts gate every feature move.** The smoke suite guards
  mechanics, not the product surface; a phase PR that moves a domain
  re-verifies that domain's section in
  [feature-parity.md](./feature-parity.md) using the verification method the
  section names. A behaviour that can't be ticked is a regression or a
  documented non-goal — never silence.

---

## Phase 0 — Contract hygiene (small, mechanical, do first)

*(review #1, #6 — closes the server-drift half of review §3)*

**Why:** the server↔client contract (`shared/api.ts`) is enforced by
discipline, not the compiler: only 9 `c.json` sites use `satisfies`
*(inv §2c)*, 191 error responses use four ad-hoc shapes *(inv §2b)*, and 56
inline session guards repeat the same three lines *(inv §2a)*. Everything
later (Phase 3 adds ~65 routes; Phase 4 projects tools onto routes) multiplies
whichever convention exists — so fix the convention while the surface is small.

**What:**

- **`satisfies` on every response mapper.** Work through the inv §2c table,
  highest-traffic first: `toPublic`/`ghToPublic` (`pulls.ts`),
  `toPublicPull`/`readComposite`/`readFiles`/`toThread` (`prMirror.ts`),
  `me.ts`'s bare literal, then `repoMirror.ts`, `rollbar.ts`, `linear.ts`,
  `prCreate.ts`'s inline maps. Where a mapper has a typed return already
  (`readComposite`), still add `satisfies` on the constructed object — the
  point is that *omitting a new field fails right there*, not at the caller.
- **One error envelope.** Add to `shared/api.ts`:

  ```ts
  export type ApiError = {
    error: string        // stable machine code: 'unauthenticated', 'merge_failed', …
    detail?: string[]    // optional human-readable context (upstream prose goes here)
  }
  ```

  and one helper `respondError(c, status, code, detail?)`. Sweep the 191
  sites onto it (mechanical; per-file counts in inv §2b). Two deliberate
  mappings: the harness `kind` variant folds into `error` codes (its four
  kinds are already machine codes); `prCreate.ts:122`'s GitHub 422 prose
  moves into `detail`, and `error` becomes the stable `'validation_failed'`.
  The `{error, status}` variant drops `status` from the body — it duplicates
  the HTTP status. **The sweep standardizes the shape, never the semantic
  vocabulary** *(parity §16)*: `reauth` (upstream GitHub 401 → client bounces
  to login), `rate_limited`, `sso`, `node_id_unknown`, `validation_failed`,
  and the provider reauth codes are meaningful machine codes the client
  branches on — they survive as `error` values, byte-identical.
- **`requireUser` middleware.** Generalize the one centralized guard that
  already exists (`harness.ts:93-96`'s `.use('*')`): a `requireUser`
  middleware applied per protected router at mount time, deleting the 56
  inline guards. `/auth` stays outside it by construction. Harness/internal
  routes keep their `INTERNAL_TOKEN` middleware and do not inherit user-token
  auth unless a specific route also needs user identity. While in each file,
  adopt the shared mirror-repo lookup helper (`resolveRepoForUser`) where a
  hand-rolled lookup exists.

**Done when:** a field added to a shared response type fails `pnpm lint` in
every mapper that omits it; all error responses are `ApiError`; no route file
contains an inline `unauthenticated` return.

**Verify:** `pnpm lint`, `pnpm test`; new route tests for one migrated router
proving the envelope + a parameterized 401 test over the router table
([testing.md](./testing.md) §2 — the `prActions`/`prCreate`/`harness` tests
land with this phase, they're the cheapest risk reduction available).

**Considerations:** don't "improve" response shapes while sweeping — this
phase changes *enforcement*, not contracts; any shape fix (there will be
temptations) is its own commit with its own client-side check. The client's
`readJson<T>` cast stays as-is (decision 2).

**First PR checklist:** add `ApiError`/`respondError`, add `requireUser`,
migrate one low-risk tested router to prove the pattern, and add the
parameterized 401 helper. Only then sweep the high-error-count files.

## Phase 1 — Composition root + lifecycle

*(review #4, review §2 — the precondition for everything that registers anything)*

**Why:** `registerTerminalIpc` is the accidental `main()` for the entire main
process — knowledge/run/local-git/database IPC, harness bridges, workflow
wiring, and reconciliation are all installed from inside the PTY module, and
the HTTP listener starts *before* the wiring runs (the boot window where
`/api/tasks/:id/notes` 503s). There is also no shutdown path at all: pg pools
and the idle-watch interval leak on quit. Every later phase registers
something; they need one place to register it.

**What:**

- Create `main/bootstrap.ts`: build DB (migrate) → construct each domain
  service (terminal, worktrees, knowledge, runtime, workflows, database) →
  install harness/context bridges → **then** start the HTTP listener → then
  create the window → then run `reconcile()`.
- Shrink `terminal.ts` to the PTY engine: move the registration of
  knowledge/run/local-git/database IPC and tmux/worktree/workflow
  reconciliation out of `registerTerminalIpc` into the root. The module-level
  mutable wiring (`memoryInjector`, `internalApiEnv`, `memoryReviewTrigger`)
  becomes constructor/setter injection performed by the root.
- One coordinated `reconcile()` step: tmux resurrect, worktree prune,
  workflow resume, run from the root, in order, in one place (ext §3.2).
  **Boot policy** *(perf §3.6)*: window as soon as the listener is up;
  `reconcile()` runs after, off the critical path — it's the work that grows
  with accumulated sessions/worktrees, and the shell doesn't need it to paint.
  The synchronous migration stays pre-listener (the server needs the schema).
- Add `will-quit` teardown: end pg pools (`main/database.ts`), clear the
  idle-watch interval (`terminal.ts:241`), dispose anything the root
  constructed, in reverse construction order. (When Phase 5's will-phase
  lands, `app:quit` consent runs *before* this teardown — state §5.)
- Timing logs on the boot steps (migrate, each reconcile sub-step,
  listener-up) into the observability log — the main-process half of the perf
  baseline *(perf §3.1)*.

**Done when:** `electron.ts` calls `bootstrap()` once; `terminal.ts` no longer
imports the other domains; quit runs a teardown you can see in the log.

**Verify:** launch, use a task end-to-end, quit cleanly; smoke S1/S5 once the
suite exists; grep proves no `set*Bridge` call happens after the listener
starts; boot marks compared against the pre-phase baseline.

**Considerations:** this phase *moves* wiring, it must not *change* wiring —
resist folding Phase 3 previews into it. The 503 fallback in the bridge
routes stays (it becomes dead code that Phase 4 deletes); removing it here
would couple this phase to route behavior.

**First PR checklist:** introduce `bootstrap()` as a thin wrapper around the
existing sequence with no moved domain code, add boot timing logs, and route
`electron.ts` through it. Subsequent commits move wiring out of `terminal.ts`
one domain at a time, ending with teardown.

## Phase 2 — The sync engine

*(review #2, points §4.9 — the highest-leverage server refactor)*

**Why:** the serve-then-revalidate state machine is hand-implemented five
times and the copies have already diverged — three different cold-detection
idioms, a duplicated `STALE_AFTER_MS`, ETag on the pulls list but not the
repos list *(inv §2d has every site and line range)*. Every future mirrored
resource (Phase 7 makes them contributions) re-derives it again unless the
machine is extracted once.

**What:**

- Extract `serveThenRevalidate` into `server/sync/engine.ts`:

  ```ts
  serveThenRevalidate<T>(c, {
    resource: string          // sync_state key (db/resourceKeys.ts builders) — opaque
    ttlMs: number             // from the cache-policy module
    etag?: boolean            // If-None-Match revalidation
    read: () => Promise<T | null>       // cached view; null = cold
    refresh: (prior: SyncState | null) => Promise<void>  // fetch + atomic persist
  }): Promise<T>              // fresh: read · stale: read + fire refresh · cold: await refresh, read
  ```

  owning the four-branch flow (fresh-serve / stale-serve-and-background-
  refresh / cold-block / not-modified), `sync_state` bookkeeping, in-flight
  refresh dedup (two stale hits must not fire two refreshes), and rate-limit
  backoff. Cold detection becomes `read() === null` — one idiom, replacing
  the three *(review §1c)*.
- One cache-policy module (`server/sync/policy.ts`) holding every TTL from
  the inv §2d table; delete the duplicated `STALE_AFTER_MS` (`pulls.ts:14`).
- Port the five copies: `pulls.ts`, `pullDetail.ts`, `pullFiles.ts`,
  `repos.ts`, `pullsBatch.ts` (its per-resource freshness check reuses the
  engine's decision function even though it batches). Add ETag revalidation
  to the repos list while porting it — free rate-limit savings (review §1c).
- `linear.ts`/`rollbar.ts` TTL-check on `issues.fetchedAt` per row, not
  `sync_state` — a different (per-item) granularity. Port them to the engine
  with their freshness read supplied by the descriptor (the engine owns the
  *flow*, not the bookkeeping store). Do **not** migrate them onto
  `sync_state` inside Phase 2; that is a data-model follow-up if per-item
  freshness proves insufficient.

**Done when:** no route hand-implements serve-then-revalidate; TTLs are
greppable data in one module; the engine has unit tests for all four branches
plus 304 and backoff ([testing.md](./testing.md) §2.5).

**Verify:** existing route tests + engine unit tests; manual check that PR
list, detail, files, and repos still background-refresh (open a stale view,
watch it update).

**Considerations:** preserve the atomic delete-then-insert `db.batch` writes
inside `refresh` — the engine wraps them, it must not unbundle them. Don't
change any TTL value in this phase; centralize first, tune later (a TTL change
is user-visible behavior). Keep the `resource` key **opaque and
caller-defined** — the engine must not assume it encodes a repo. Every key
today happens to be repo-scoped, but a future user-scoped feed (a dashboard's
"PRs assigned to me across all repos", an inbox) keys by connection/user
identity instead, and `sync_state` is keyed on `(resource, key)` with no repo
assumption. This costs nothing now and is expensive to retrofit after the
engine ships (ext §9 future-seams).

**First PR checklist:** extract the pure decision function and test the four
branches before moving any route; then port one GitHub route, then the
remaining GitHub routes, then the provider variants.

## Phase 3 — Transport collapse (IPC → HTTP + WS)

*(review technology change #1; supersedes review #3 per decision 1 — gated on
the smoke suite and the perf baseline)*

**Why:** the app runs three transports (HTTP, 70 IPC channels, MCP stdio) with
three auth stories and three contract seams — and the IPC seam is the worst
drift surface in the codebase: every contract exists in three hand-synced
copies (preload, main handler, client interface) with nothing linking them
(review §3). Collapsing request/response IPC onto the already-running loopback
server gives one auth story, one typed seam, a preload that shrinks to three
channels, and near-full `dev:node` browser mode. It is also the transport
Phase 4's tool projection and agent-runtime §3.2's live step tail need.

**What:**

- **Work the inventory** *(inv §1a — 65 req/resp channels in 8 domains)*.
  Migrate domain by domain, one PR each, roughly smallest-first: `search`
  (1 channel) → `editor` (5) → `run` (5) → `workflow` (5) → knowledge (11) →
  local-git (11) → `database` (9) → terminal control (18). Each PR: routes on
  the Hono app typed through `shared/api.ts` route builders, `requireUser`
  from Phase 0, delete the domain's preload block and hand-declared client
  interface *(inv §1d)*, route tests incl. the 401 case
  ([security.md](./security.md) §7).
- **Route shape convention:** task-scoped channels (nearly all — they take a
  `taskId`) become `/api/tasks/:id/<domain>/<verb>` (e.g. `editor:read` →
  `GET /api/tasks/:id/editor/file?path=…`, `local:commit` →
  `POST /api/tasks/:id/git/commit`); machine-scoped ones (`term:repoPath:*`,
  `term:profiles`, `mcp:*`) get `/api/<domain>/…`. Path params for
  identity, body for payload, zod on bodies that write files or spawn
  processes (decision 2's new-boundary clause).
- **Shared route contract convention:** every new route builder and response
  type lives in `shared/api.ts`; route modules construct response values with
  `satisfies`; clients call through the existing `readJson`/`writeJson`
  helpers rather than importing server modules. Request bodies that write
  files, run commands, or execute SQL get a zod schema beside the route
  handler and a malformed-body test.
- **The database, local-git, editor, and search domains are
  security-sensitive route sets, not transport bookkeeping.** The database
  domain alone can run SQL and mutate databases *(parity §7)*; editor/git
  routes write files and run git *(parity §14)*. Their migration PRs carry
  tests beyond the standard 401/malformed-body pair: **path traversal,
  symlink escape, missing worktree, and stale buffer** for
  editor/git/search; for database, identifier validation on generated SQL
  (a non-introspected identifier is rejected), the never-persisted
  connection URL, and pool teardown on disconnect. The behavioural
  contracts these routes must preserve are parity §7 and §14 — verify
  against them, not against the old preload signatures.
- **One WebSocket** endpoint on the loopback origin carrying the stream
  surface *(inv §1b)*: `term:out` frames per session, `term:input` upstream,
  attach/detach as socket messages, plus the `term:status` and
  `workflow:notice` pings. Upgrade auth per [security.md](./security.md) §3:
  Host guard + session cookie + exact-Origin check, 403 otherwise — WS gets
  no browser same-origin protection, and this socket carries keystrokes to a
  shell. **Coalesce PTY output into ~16 ms frames** with xterm's standard
  flow-control pattern *(perf §3.3)* — today main sends one IPC message per
  PTY chunk (`terminal.ts:214-223`), so framed right the WS move is a
  throughput win to claim, not a regression to avoid. Design the framing for
  a `workflow:step:event` frame type from day one *(agent-runtime §3.2)* —
  the frame type exists even if nothing emits it yet.
- **The residue stays IPC** *(inv §1c)*: `browser:bind` (a webContents
  capability handle — must never be HTTP-reachable), `term:repoPath:pick`
  (native dialog), `acorn:close-pane` (main→window ping). `preload.ts` ends
  at exactly these three plus platform flags/capability probes.

**Done when:** preload exposes only the residue; every former channel has a
typed route or WS frame; the terminal streams over WS with no visible
regression under a busy TUI (verifiable because the keystroke-echo and
busy-TUI baseline marks were captured first).

**Verify:** `pnpm lint`, `pnpm test`, smoke suite (S4 especially),
keystroke-echo marks vs baseline, then a live pass per migrated pane; finally
`dev:node` in a plain browser exercising everything that no longer needs
Electron — the completeness smoke test of the whole migration.

**Considerations / risks:** the PTY path is the risky part — do it last, after
the request/response domains have shaken out the route+auth conventions. Keep
each domain PR revertable (the preload block deletion is what makes it
non-revertable, so delete preload code in the same PR only once the routes
are proven — or in a trailing cleanup commit). Watch replay semantics on
`term:attach`: the ring-buffer replay must arrive before live frames on the
new socket (sequence it server-side, don't rely on message timing).

**First PR checklist:** add the route/client/test pattern with `search`
without touching WS; then migrate `editor`, because it exercises path
confinement and write validation without PTY streaming. Start WS only after
three request/response domains are gone and the route convention has stopped
changing.

## Phase 4 — Agent-tool projection (the keystone)

*(points §4.8, review #13, review §1d — depends on Phases 1 and 3)*

**Why:** one agent verb currently costs five edit sites across four layers
(preload → knowledgeIpc → harness route → bridge → MCP tool), and the layers
have already forked semantically — the UI's `notes:write` and the agent's
create the same note with different provenance. Meanwhile MCP tool
availability is frozen at connect (`hasRunTargets` snapshot). The projection
makes an agent capability one declaration, and it is the seam the permissions
model hangs off.

**What:**

- Define `AgentToolContribution` exactly as points §4.8 specifies —
  `{ name, description, input: zod, scope, risk, when?, handler,
  exposeToRenderer? }` — and the projection: each declaration becomes an MCP
  tool (schema from `input`, availability re-evaluated with
  `tools/list_changed`), a harness HTTP route
  (`POST /api/tasks/:id/tools/:name`, `INTERNAL_TOKEN` auth, the `respond()`
  envelope → Phase 0's `ApiError`), and optionally a typed renderer client
  method (plain HTTP post-Phase 3).
- Port the existing tool groups onto it: notes (6 verbs), memory (5), run
  (5), browser (`browser_*`), plus the read-only trio
  (`git_log`/`local_changes`/`local_diff`). This deletes `harnessWiring.ts`,
  the bridge setters in `harness.ts`, the per-tool bodies in `mcp/server.ts`,
  and the matching preload/`knowledgeIpc.ts` groups (whatever Phase 3 left).
- Collapse the notes-channel semantic fork while porting: one store API where
  provenance (`author`, `sessionId`) comes from the channel's `scope`, so
  agent-created and UI-created notes can't drift again.
- State the loopback rule at the seam: tools call the app over HTTP except
  where the handler is explicitly marked in-process (today's
  `git_log`/`local_changes`/`local_diff`) — the marking is a field on the
  contribution, not a comment.
- Include the `risk: 'read' | 'write' | 'execute'` tier from day one
  (classification rule of thumb in [security.md](./security.md) §4 —
  retrofitting a taxonomy over an established tool set never happens). The
  permissions settings page renders the registry grouped by tier per
  [ux.md](./ux.md) §3; per-tier/per-tool toggles persist as a prefs slice the
  projection consults alongside `when`.
- Projection response convention: the handler returns domain data or throws a
  typed tool error; the projection layer alone translates that into MCP
  content, harness HTTP `ApiError`, or renderer response. Do not let feature
  tool handlers know which projection called them.

**Done when:** adding one agent verb is one object in one file, reachable via
MCP, harness HTTP, and (if exposed) the renderer; the permissions page lists
every tool with its tier.

**Verify:** MCP `tools/list` identical before/after (minus the availability
fix — `run_*` tools now appear when a repo gains targets mid-session); a
table-driven harness route test per projected tool ([testing.md](./testing.md)
§2.3); a live agent session exercising notes + run tools; toggling a tier off
makes the tool vanish from `tools/list`.

**Considerations:** keep tool *names and schemas* byte-identical through the
port — agents in the wild have these memorized in their MCP configs; renames
are a separate, deliberate change. The `when` re-evaluation must be cheap
(state §5.2's synchronous-predicate rule) — `hasRunTargets` reads loaded
config, not disk.

**The MCP feature is more than tool calls** *(parity §8)* — don't let the
projection absorb all MCP attention and orphan the settings/inspection
surface: the config inspector (`mcp:inspect` — three named config files,
multiple server shapes, invalid JSON as visible rows, secret masking before
the renderer), `createStarter`, register/unregister via agent CLIs (acorn
never edits agent config files directly), auto-registration on Claude/Codex
session launch, and the packaged/dev naming split (`acorn` vs `acorn-dev`,
`ACORN_MCP_NAME`). Phase 3 migrates the two `mcp:*` channels *(inv §1a)*;
this phase leaves the inspector as a settings-page contribution with the §8
behaviours intact.

**First PR checklist:** land the registry and project one read-only tool
(`git_log` or `notes_list`) end-to-end. Then port notes/memory as the
provenance fix, then run/browser execute-tier tools with permissions.

## Phase 5 — Client registries

*(review #5, #8; ext §9 step 1, points §4.1/§4.3/§4.4/§4.6 — the biggest
UX-side seam opening; gated on the smoke suite)*

**Why:** adding a pane touches ~6 sites in 4 files, and the evidence it bites
is in-tree: docs/panes.md says eight panes, the code has ten *(inv §3d)*.
Shortcuts are 13 `window` listeners *(inv §3b — 9 global sites plus 4
component-local Esc handlers)* coordinated by a denylist and prose comments;
the help screen is a third hand-synced copy that already lies. The one-shot
mailbox pattern has quietly grown to four instances *(inv §3f)*. These
registries are ext §9's step 1 — most of the extensibility win, no folder
moves.

**What:**

- **Pane registry** — `PaneContribution` per points §4.1, driving `PANE_IDS`,
  `PANE_LABELS`, `PANE_ORDER`, the shortcut defaults, the switcher buttons,
  and `paneBody()` (all sites in inv §3d). Unknown persisted ids stay inert
  (generalize `isPaneId`). Fix the one contract breaker while here: the `pr`
  pane takes `{ task }` and stops reading `useParams()` (review §1a) — pinned
  by the conformance suite ([testing.md](./testing.md) §4).
- **Modern pane management** ([ux.md](./ux.md) §7 — rides the pane-registry
  slice, since the registry rebuilds the pane host anyway): resize dividers
  with persisted per-task pane-id-keyed weights, pinning (pinned panes survive
  `show`; guarded close), focus-directed maximize (⌘⇧⏎ generalized from the
  terminal drawer, session-only), and a `move` reorder action. `TaskLayout`
  grows `weights?: Partial<Record<PaneId, number>>` and `pinned?: PaneId[]`
  with absent-field defaults so existing persisted layouts need no migration;
  each new reducer action lands with `layout.test.ts` cases for close→reopen,
  show, reorder, unknown ids, and min-width clamping. The drawer's existing
  resize/maximize code
  (`TerminalPanel.tsx:161-173`, `App.tsx:79-100`) is the pattern source —
  generalize it, don't fork it.
- **Command registry** feeding ⌘K: the hardcoded action list
  (`CommandPalette.tsx:63-80`, inv §3e) becomes contributions; run targets /
  recipes / workflows formalize as palette item providers (they're already
  provider-shaped via `composeItems`).
- **Keybinding registry** owning registration, conflict detection (replacing
  `RESERVED_CHORDS` + the prose coordination), user remapping, and the help
  screen — semantics per [ux.md](./ux.md) §4 (last-registrant-loses-loudly;
  help renders the registry). Collapse the 9 global keydown listener sites
  *(inv §3b)* into one dispatcher that reproduces the two existing semantics:
  capture-phase pre-emption (the palette-over-Monaco trick) and
  modifier-disambiguation (TabRail ⌘digit vs TerminalPanel ⌘⇧digit). The four
  Esc-close locals stay component-local (genuine focus semantics). Include the
  **`when: 'pane'` scope** (points §4.4): the dispatcher gates a pane-scoped
  chord on the core focused-surface signal (from `use:paneFocus`, below), so
  today's hand-rolled typing-guarded pane listeners — `PullList` bare `j`/`k`
  (`PullList.tsx:69`), `DiffView` `⌘F` (`DiffView.tsx:292`) *(inv §3b)* —
  register as bindings instead of surviving as new `window` listeners. Pane
  chords may reuse a chord another pane owns but must not collide with
  `global`/`task`; they appear in the help screen when their pane is focused.
- **Settings-page registry** replacing the `TABS` list in `SettingsModal.tsx`.
  The current modal is more than a tab list — appearance themes, integration
  cards (GitHub synthesized/non-disconnectable), the MCP inspector, the
  workflows inspector, terminal defaults, shortcut capture, the GitHub OAuth
  permissions re-request, per-workspace pages, and the onboarding-shared
  repo-assignment body. Treat this as a **page registry plus typed settings
  services** (points §4.6 — pages dispatch through prefs slices and
  workspace-config codecs, never raw JSON), and give every current page a
  named parity owner before it moves *(parity §12 is the page list)*. The
  integrations page moves as-is in this phase — its hardcoded provider cards
  and credential form are replaced by the provider registry in Phase 7
  *(integrations §3)*; don't generalize them here.
- **Client event bus** (`ctx.events` shape from state §5): `task:archived`
  etc.; convert the three `evictPreviewWebview` call sites and all four
  mailbox signals *(inv §3f — including `noteToOpen` and
  `pendingEditorReveal`, which review.md's original finding missed)* into subscriptions /
  `openPane(id, intent)`. Include the **will-phase** for destructive events:
  handlers return concerns (timeout-bounded), core renders them in one
  confirmation dialog per [ux.md](./ux.md) §1 — the hardcoded close-task
  dialog in `TaskView.tsx` and the archive `confirm()`s become the first
  consumers (terminal "agent running", changes "uncommitted files",
  workflows "run in progress"). Extend to workspace removal and `app:quit`
  (composing with Phase 1's teardown).
- **Slot error boundaries + core UI kit seed** *(ext §3.5)*: wrap every
  registry-rendered contribution (panes, badges, overlays, settings pages) in
  an `ErrorBoundary` degrading to an inert placeholder — there is zero
  ErrorBoundary usage today, so one throwing pane kills the shell. Promote
  the loose shared components (`CopyButton`, `UserAvatar`, `Picker`, tooltip)
  into a `client/ui/` kit on the token layer; seed it with the `QueryGate`
  loading/error primitive *(ui-state §2.5, states per ux §5)*. Extract the
  form-control wrappers the app already duplicates raw — `Button` (~198 native
  `<button>` sites), `TextField`/`Select`/`Disclosure` — into the same kit;
  wrap a headless Solid primitive for `Picker`/tooltip a11y and skin it with
  tokens rather than hand-rolling focus/ARIA. Scope is what ships today, no
  speculative catalog (no `Table` — lists are div-based) *(ext §3.5)*.
- **Keyboard-navigation primitives** *(ext §3.5, points §4.1 pane contract,
  ux §7)*: land three in `client/ui/` alongside the kit so navigable content
  is the path of least resistance, not per-plugin effort — (1) a
  `createListNavigation` hook + `use:` directive (roving tabindex, arrow/`j`/
  `k`/Home/End, `role`/`aria-activedescendant`, reusing the dispatcher's
  `isTypingTarget` guard); (2) the core `use:paneFocus` directive the pane host
  applies to mark the focused surface on `focusin`, not just click — this is
  the signal the `when: 'pane'` scope reads and it closes the keyboard-vs-click
  gap in ux §7; (3) a focus-scope/trap for the overlay layer (dialogs,
  palettes, ux §8). Adopt the behavior from the same headless lib as the
  controls; the roving primitive is what makes the pane keyboard contract
  (§4.1) satisfiable without every pane reinventing focus.
- **One error surface** *(ui-state §3 rule 1, ux §5)*: mutations report
  failures through inline signals (foreground) or notices (background);
  retire all 25 `window.alert`/`confirm` sites *(inv §3g — 15 files, not just
  ChangesPane)* as their features convert. Four error dialects collapse to
  one users can actually see.

**Done when:** adding a pane is one file plus one registration line — prove it
by re-registering `search` or `database` through the registry; the help screen
and palette derive from registries; `window.alert` count is zero; panes
resize, pin, move, and maximize per ux §7 and the persisted arrangement
(pane set/order/id-keyed weights/pins) survives relaunch. Pane content is
keyboard-navigable by default (§4.1) — tabbing into a pane marks it the focused
surface, collections navigate by arrow/`j`/`k` with one tab-stop, and pane-local
chords fire only while their pane is focused; the conformance suite enforces it
([testing.md](./testing.md) §4).

**Verify:** `pnpm lint`, `pnpm test` (the pure models keep their tests),
smoke S3, the conformance suite over all ten panes, and a keyboard walkthrough
of every chord and palette row (the inv §3b table is the checklist). For pane
management: drag a divider with a terminal and Monaco open (no tearing, refit
coalesced), pin + `show` flips, ⌘⇧⏎ on a focused pane and on a focused
terminal, relaunch restores id-keyed weights and pins but not maximize. For
keyboard nav: `Tab` into a pane activates it (not just click) and traverses its
content in DOM order without bleeding into the next pane; arrow keys move within
a list on one tab-stop; a pane chord (`j`/`k`, `⌘F`) fires only while its pane
is focused and is inert otherwise.

**Considerations:** this phase is big — slice it as six PRs in the bullet
order above (pane registry first; it's the pattern-setter, with pane
management as its follow-up PR once conformance is green). While extracting the
shell into region slots, keep the layout **parameterized on the current
workspace context rather than assuming a workspace is always active** — "no
selected-workspace dimension, derived from the current repo" (points §4.2) is a
derivation rule, not a guarantee one is always present. This costs nothing now
and keeps a future app-level view with no workspace (a cross-workspace
dashboard, ext §9.1) an additive change rather than a shell refactor. The
keybinding dispatcher is the riskiest slice: get the capture-phase and typing-target
semantics wrong and Monaco/xterm users feel it immediately; port the existing
guards (`isTypingTarget`, `e.code`-based digit checks) verbatim, don't
re-derive them.

**First PR checklist:** pane registry only. Re-register one simple pane first,
prove all derived lists come from the registry, then convert the rest and fix
the `pr` pane contract. The immediate follow-up PR is pane management on top
of that host: reducer shape + tests first, then dividers/pin/maximize/move UI,
and the `use:paneFocus` directive lands here (it belongs to the pane host and
is the focused-surface signal both maximize/move and the `when: 'pane'` scope
read). Do not start keybindings until pane conformance and pane-management
reducer tests are green — and the `when: 'pane'` scope depends on
`use:paneFocus` already being in place. The `client/ui/` list-navigation and
focus-scope primitives are their own slice, sequenced with the UI-kit seed.

## Phase 6 — Startup restore pipeline

*(review #9; ext §8.3 — named the single riskiest piece; its own phase, gated
on smoke S2)*

**Why:** startup correctness currently depends on the relative firing order of
three effects, a `{ defer: true }`, an `isRestoring()` guard, and a `restored`
signal — a distributed state machine whose invariants live in comments that
exist because races already happened. Every persisted slice edits App.tsx in
two places, and the two prefs write-back protocols contradict each other.

**What:**

- Extract `createStartupRestore()` owning hydrate-then-persist with **explicit
  ordered phases** (`workspace` → `view` → `panes`), replacing App.tsx's
  effect-order choreography. Slices register into a phase; persistence arms
  only after `boot:restored` fires.
- **Tier audit first**: classify all 20 pref keys *(inv §3a — 13
  restore-phase keys, 6 reactive-read keys, 1 legacy fallback)* on the state
  §5.1 tier table; the audit output is the slice list with a restore phase
  each — the input to the port. Add the `PrefKeys` const while auditing (the
  keys are currently bare strings at every call site), then replace ad-hoc
  parse/write code with `PersistedStateSlice` descriptors from
  [state-and-policies.md](./state-and-policies.md) §5.1a. **The audit covers
  more than pref keys**: persisted view state also lives in `localStorage`
  today — PullDetail's collapsible-section state
  (`PullDetail.tsx:42-49`, `section-open:*`) and comment drafts
  (`comments/draftState.ts`) — and in settings-page component state. Classify
  each as T3 (gets a descriptor) or deliberately leave it in localStorage
  with a one-line reason; either is fine, but it's a recorded decision, not
  an accident *(parity §4)*.
- **Descriptor registry for T3 state.** Core and plugins register persisted
  slices with `{ key, scope, restore, version, codec, empty, unknownIds,
  maxBytes? }`. The restore pipeline iterates those descriptors by phase;
  persistence derives storage keys from scope ids, serializes through the
  descriptor, throttles writes, and refuses oversize payloads with a notice.
  No feature writes raw JSON to prefs after this phase.
- Unify the two contradictory prefs write-back protocols — **the optimistic
  `setQueryData` protocol wins** (`savePref.ts` already does it): prefs is
  one query key with many mounted subscribers, so the invalidating protocol
  re-notifies the whole shell for a diff view-mode toggle. `left_collapsed`'s
  persist effect (`App.tsx:285`) is the one invalidating holdout *(inv §3a)*.
  While in `savePref`: give it the failure path it lacks — a failed pref
  write is currently a `void`-ed unhandled rejection *(ui-state §2.1)*; it
  becomes a notice.
- **Persist less** *(perf §3.4)*: `dehydrateOptions` excluding
  file-body/patch queries from the IndexedDB persister (re-fetchable from the
  local blob cache over loopback) and a persister `throttle` — today every
  cache write can serialize the whole 24 h cache. Less persisted → faster
  restore, which is this phase's point.
- Port App.tsx slice by slice (theme, workspace restore, repo/path restore,
  task focus, the five hydrations, the seven persist effects); App.tsx ends
  as shell + composition.
- **Scoped-state eviction, containers only if earned** *(state §5.1 — depends
  on Phase 5's event bus)*: one `task:archived` / workspace-removal
  subscriber per feature clears its keyed collections — the full list with
  current eviction status (mostly "none") is inv §3c. Build the
  `ctx.state.app/workspace/task/pane` container machinery only if hand-keyed
  collections keep multiplying afterward.

**Done when:** App.tsx has no free-standing restore/persist effects; restore
order is data, not effect timing; every T3 slice has a descriptor/codec; no
module-scope Map keyed by task/workspace id hand-manages its own eviction;
every pref key is a `PrefKeys` member.

**Verify:** smoke S2 before/after every slice PR (this is the phase S2 exists
for); manual relaunch matrix — last workspace/task/source/layout (pane set,
order, id-keyed weights, pins — not maximize)/editor tabs restore exactly;
kill-during-boot leaves prefs unclobbered (the race the guards existed for);
IDB restore time vs baseline.

**Considerations:** port one slice per PR with S2 green between — the failure
mode is a race, and bisecting a big-bang port is misery. The legacy
`task_panes` fallback read stays until a migration writes `task_layouts` for
everyone (cheap: keep the fallback, it's 3 lines). While porting rail state:
`rail_order` is view state and **intentionally separate from `tasks.sort`**
(`tasks.sort` stays the server-side seed; `rail_order` is the user's
arrangement, including the pin partition) — don't "simplify" them into one
key *(parity §2)*.

**First PR checklist:** create `PrefKeys`, classify every key in a committed
table, add the `PersistedStateSlice` type/registry with a no-op slice, and
write codec tests for `task_layouts` before moving behavior out of `App.tsx`.
The first real moved slice should be theme, not workspace/task restore.

## Phase 7 — Integration providers and source contributions

*(review #7; points §4.2/§4.14; the full contract is
[integrations.md](./integrations.md) — the "before integration #3" deadline)*

**Why:** Linear and Rollbar are fully bespoke; a third integration would copy
~8 touch points including a hand-rolled decrypt-try-skip loop that already
exists six times. The generic `issues`/`integrations` tables anticipated a
provider abstraction the code never grew. And the two shipped providers are
misleadingly similar — the first provider with OAuth, a self-hosted base URL,
repo-scoped bindings, or richer item identity (Sentry, Better Stack, Notion)
breaks a "Linear/Rollbar, but generic-looking" abstraction immediately. Do
this before the next integration, not after, and do it against the written
contract, not against the two existing providers' shapes.

**What** (each bullet is roughly one PR, in order):

- **Provider descriptor registry** *(integrations §1)* —
  `IntegrationProviderContribution` with activation-time cross-checks (a
  source/pane/context-section/tool naming an unregistered provider id is an
  activation error). This subsumes review #7's minimal `Provider` interface;
  one `forEachConnection` helper replaces the six decrypt-try-skip loops
  (`linear.ts:49,122,181`, `rollbar.ts:57`, …); `integrations.ts`'s if-else
  becomes registry lookup. Express Linear and Rollbar as descriptors.
- **Connection model + core-owned connect flow** *(integrations §3)* — the
  provider hooks (`validate`/`normalize`/`test`/`summarize`) drive one core
  connect/store path; `IntegrationsSettings.tsx`'s hardcoded provider cards
  render from the registry; typed columns land for what core reads
  (`status`, `authKind`, `lastValidatedAt`, account), `meta` migrates into
  codec-owned `config`. Rotation (stable connection id, replaced secret)
  comes with this PR — it is the case the delete-and-re-add model cannot
  express. OAuth flow/refresh is a named deferral until the first OAuth
  provider *(integrations §19)*.
- **Link identity + write integrity** *(integrations §5; data-model track)* —
  task-link writes take `connectionId` + provider ref and core stamps
  `providerId` from the connection; nullable `task_links.refJson` for full
  `ExternalRef`s; `identifier` stays the display id. Agent tools and plugins
  can no longer create rows whose provider and connection disagree.
- **Codecs + context formatters** *(integrations §7, §9; decision 2's
  untrusted boundary)* — per-provider `issues.data` codecs (parse + validate
  at the read seam instead of `as LinearIssueDetail`) with the
  summary-never-clobbers-detail merge invariant; delete `taskContext.ts`'s
  cross-provider shape-guessing (`data.state?.name ?? data.status ??
  data.level`) in favor of each provider's `LinkContextFormatter`.
- **Source contributions + typed promotion** *(points §4.2, integrations
  §8)* — replacing `SOURCE_IDS` / `availableSources` / the per-source
  `<Match>` in App.tsx / `ORIGIN_GLYPH`; issue reads become Phase-2 sync
  descriptors (per-connection dedupe/backoff); `seedTask` becomes the
  `canPromote`/`prepare`/`create`/`afterCreate` contract, with
  attach-to-current-task as a distinct mode (Rollbar's `+task` — parity §6).
- **Capabilities, mutations, error taxonomy** *(integrations §4, §11, §12)* —
  capability declarations resolved per connection at validation; keep the
  capability set **open** (a new flag is additive data, not a union break) —
  `webhooks` and `userFeed` are the declared-but-not-yet-consumed markers, the
  latter reserving the future-dashboard "user-scoped feed" gate (ext §9.1);
  Linear's comment becomes a declared mutation (capability-gated, invalidation
  policy named); provider error codes migrate onto the generic `provider_*`
  taxonomy — a **deliberate rename with client branches updated in the same
  PR** (not a Phase 0-style sweep; the GitHub identity codes `reauth`/`sso`/
  `rate_limited` stay byte-identical per security invariant 9). Lifecycle
  semantics land here too: disconnect keeps its cascade but becomes the core
  default around provider hooks, and disable/reauth stop implying deletion
  *(integrations §14)*.
- **Integration conformance suite** *(integrations §18, testing §4)* —
  table-driven off the descriptor, running against Linear and Rollbar as
  expressed providers. This is part of the phase, not a follow-up: the
  minimum-contract gate *(integrations §19)* is what "done before provider
  #3" means.

**Done when:** the litmus test from ext §9 — a Sentry integration (source +
pane + context section + linkifier) touches zero core files — and the
minimum-contract checklist *(integrations §19)* is fully ticked. The final PR
must include a dry-run file list for that Sentry integration. Building it is
optional; the dry run is not. If the dry run shows core files, fix the
contract, not the dry run.

**Verify:** Linear + Rollbar connect/browse/pane/promote flows unchanged live;
the conformance suite green over both providers; codec rejection path covered
by a test feeding an old-shape blob; a list refresh over a detailed Linear
row preserves `description`/`comments`/`activity`. **The Sentry dry run
proves extensibility; provider-specific regression tests prove parity — land
them before or with the port** *(parity §6)*: Linear first-hit-wins bare-id
resolution vs explicit `integrationId` browsing, workspace-scoped project
links, active-issues-only browse, `branchName`-seeded branch defaults,
threaded comment replies via `parentId`, XSS-safe markdown; Rollbar
stale-cache-beats-nothing on live failure, counter-string identity, and
`+task` promotion onto the current task. These behaviours live in
provider-specific code the generic contract doesn't express — exactly what a
faithful-looking port drops.

**Considerations:** GitHub's dual role is a design input, not a Phase 7
deliverable — core synthesizes the identity connection into the same registry
(`authKind: 'github-session'`, not disconnectable) so generic surfaces don't
branch on it, but the github plugin's own capability/scope declarations ride
whichever phase moves GitHub product code *(integrations §2)*. Named
deferrals with seams: OAuth + refresh, the generalized `ExternalBinding`
table (`workspace_projects` is documented as its first instance —
integrations §6), webhooks *(integrations §15)*. Don't build any of them
speculatively; the contract names where they land. Integration security rules
([security.md](./security.md) §8) are part of each PR's review checklist —
especially no-secrets-in-responses and the stamped provider id.

**First PR checklist:** descriptor registry + `forEachConnection` +
Linear/Rollbar expressed as descriptors with **zero behaviour change** —
prove the registry by deleting the if-else, not by changing flows. Then the
connect-flow PR (it touches user-visible settings; the regression tests for
parity §6 should exist by then), then link integrity, then codecs/formatters,
then sources/promotion, then capabilities/mutations/errors, then conformance.

## Phase 8 — Workflow and profile registries

*(review #10; points §4.10, §4.11)*

**Why:** the workflow engine's whole point is extension and it's closed at the
core — a step-kind ladder, a one-case policy switch, and a positional
join-binding that silently rebinds when steps reorder. Agent profiles are
scattered across four files. Both become cheap registries; the *engine
skeleton* (durable rows, re-entrant `tick()`, DI) is exemplary and does not
change.

**What:**

- **8A: registry extraction, no behavior change.** Add `Map<kind,
  StepHandler>` in `workflowRunner.ts` replacing the `executeStep` ladder, with
  the `StepHandler` contract from [agent-runtime.md](./agent-runtime.md) §4.1.
  Add the policy registry replacing `evaluatePolicy`; `checks-green` is
  registered by the GitHub side, revealing the layering points §4.10 calls
  out. Existing step kinds keep their current behavior.
- **8B: parser/runtime control-flow contract.** Replace `runJoin`'s
  nearest-preceding-fan-out index scan with explicit `joins:`. Add
  `${steps.<name>.output}` templating and the `decide` branch step. Unknown
  kinds, dangling `joins:`, invalid/backward branch targets, and invalid
  template references surface as parse/start errors with named messages.
  Non-selected branch targets become `skipped`; unmatched verdicts fail unless
  a `default` branch exists.
- **8C: agent-profile registry.** Agent-profile contributions per points §4.11
  (`command`, `backendPreference`, `mcpRegistration`, `headlessArgv`,
  `resumeArgv`, `streamJson`) replace `BUILTIN_PROFILES`,
  `PROFILE_MCP_FLAVOUR`, and the per-agent branches in
  `headless.ts`/`agents/model.ts`. Adding an agent = one small module. Add the
  **one-shot structured mode** (`aiArgv?`/single-turn) the `decide` step needs;
  the cheap tier reuses this registry, not a new transport.
- **8D: tool ceilings once Phase 4 exists.** A workflow and step may declare a
  tool allowlist/risk ceiling; step ceilings can only narrow workflow ceilings,
  and global user permissions apply last. Enforcement is the same permission
  filter the Phase 4 projection consults (agent-runtime §4.1/§6.2).
- **8E: cancellation controls.** Cancel-run and kill-step use the engine-owned
  active-handler registry from agent-runtime §4.1. Cancel cascades to fan-out
  child steps *and* their child tasks (`parentStepId`/`tasks.parentId`), kills
  in-flight processes, and adds `cancelling`/`cancelled` to the persisted
  status vocabulary.
- **8F: triggers after `ctx.poll`.** Source/integration contributions
  (points §4.2/§4.14) register trigger predicates with `ctx.poll` (state §5.2)
  — app-open, no daemon; `workflow_runs.trigger` widens past `'manual'`. This
  is the shippable slice of "Pulse".
- The remaining runtime *corrections* (handoff-note scoping, ci-loop session
  resume, concurrency budgets) live in [agent-runtime.md](./agent-runtime.md)
  §2 and **don't wait for this phase** — see ongoing tracks. Concurrency
  governance (semaphore + turn/depth caps, agent-runtime §2.3) is design-docs
  only, not a phase deliverable; there is deliberately **no cost budgeting**
  (subscriptions). Typed failure-recovery (agent-runtime §6.4) is a decided
  shape, deferred until a workflow needs it.

**Done when:** the substeps above have landed in order; a new step kind or
agent profile is one registration; a TOML workflow using an unknown kind, a
dangling `joins:`, an invalid branch target, or an invalid template reference
fails with a named error; cancel-run stops a running fan-out and all its
children; trigger-started runs record the contributing trigger id.

**Verify:** existing workflow runner tests keep passing; a TOML workflow using
every step kind (including a `decide` branch) runs end-to-end; a fan-out
cancelled mid-flight leaves every child `cancelled` with no orphaned process;
each profile still spawns/resumes/registers MCP (live check per profile).

## Phase 9 — Platform migrations

*(review technology changes #2–#4 — independent of the phases above; schedule
opportunistically)*

- **`<webview>` → `WebContentsView`** for the preview pane: main-owned,
  bounds-managed, survives pane switches natively; composes with
  `browserService.ts`'s CDP binding. Pairs with Phase 5's `keepAlive` slot
  (ext §8.2) — whichever lands second gets simpler. Preview parity is more
  than `keepAlive` *(parity §13)*: the human browser chrome
  (back/forward/reload/stop/home/editable URL/loading state), the home-URL
  resolution priority (recipe `browser=run:<id>` → default run target →
  workspace preview config → dev-server fallback), one kept-alive browser
  per task preserving page/scroll/form state, overlay z-index interactions,
  and — security — an equivalent of today's `will-attach-webview` http(s)
  restriction for the new attachment/navigation path, with `browser:bind`
  staying IPC-only. Verify **visually and via agent tools** (a blank or
  unbound preview still passes pane-registry tests): preview survives
  pane/task switches with state intact, `browser_*` tools drive the *task's
  preview surface*, eviction on archive, non-http(s) navigation blocked.
- **better-sqlite3 → `node:sqlite`**, killing half the dual-ABI dance.
  **Spike first**, as its own time-boxed PR that ships nothing: Drizzle
  driver maturity, FTS5 in Electron's bundled build (the memory index needs
  it), and the `db.batch`/transaction atomicity the mirror writes rely on.
  Any one failing parks the migration — node-pty keeps the rebuild scripts
  alive regardless, so this reduces the dance, not removes it.
- **`safeStorage` (not keytar)** for the planned keychain work — decided now,
  built when packaging matters. `SESSION_ENC_KEY` moves first
  ([security.md](./security.md) §6).

## Phase 10 — Foldering

*(ext §9 step 7 — only after the seams exist)*

`git mv` into `core/` + `plugins/` per ext §6's assembled layout; add lint
rules: no plugin→plugin internal imports, no core→plugin imports; cross-plugin
extension only through declared contribution points. This phase should feel
anticlimactic — if it doesn't (if a move forces an API change), a seam was
missed and the move waits. Update the repo map in CLAUDE.md and the README
per [docs-overhaul.md](./docs-overhaul.md) §4.

The operational contracts move too *(parity §18)*: the ABI rebuild scripts,
the smoke-browser script, `electron-builder` packaging config, and the
`ELECTRON_RUN_AS_NODE` MCP launcher all reference paths this phase changes —
update them in the same PR and say in the docs where each concern now lives.
Two standing constraints regardless of phase: the app keeps
`127.0.0.1:4317` as a stable storage origin (`ACORN_PORT` override intact) —
IndexedDB and cookies key off it — and `dev:node` stays a first-class dev
mode (Phase 3 makes it *better*; nothing later may make it second-class).

---

## Ongoing tracks (no phase gate)

- **Tests where the risk is** — the full plan is [testing.md](./testing.md):
  the smoke suite lands before Phase 3 and gates 3/5/6; the
  `prActions`/`prCreate`/`harness` route tests ride Phase 0; handler bodies
  split from registration as main-process files are touched; the plugin
  conformance suite rides Phase 5.
- **Performance** — the full plan is [performance.md](./performance.md).
  Two items don't wait for any phase: the ~10-line `document.hidden` pause on
  the 3 s/5 s client polls and `refetchInterval` ticks *(perf §3.2; sites in
  inv §3h)*, and the two obvious secondary indexes *(perf §3.5 — the schema
  has zero)*: `pull_requests (userId, repoId, state, updatedAt)` and
  `workflow_steps (runId)` / `terminal_sessions (taskId)`. The rest folds
  into phases (coalescing → 3, persister → 6, lineage-derived indexes →
  data-model track) plus one standing constraint: component decomposition
  must preserve the diff hydration scheduling *(perf §1.7)*.
- **UI reaction hygiene** — the full story is [ui-state.md](./ui-state.md):
  three written rules (every mutation names its failure surface; event-driven
  stores are latest-wins; derive-don't-effect), plus two phase-independent
  fixes: a ~10-line `latestOnly` generation-guard helper adopted in
  `sessions.ts`/`taskStatus.ts` (both double-triggered and clobberable by
  out-of-order responses today), and catches on
  `savePref`/`TabRail.submitDraft` (both currently fail silently). The
  error-surface unification and `QueryGate` ride Phase 5; the
  effect-as-derivation cleanups are opportunistic.
- **Agent runtime corrections** — the full story is
  [agent-runtime.md](./agent-runtime.md); all are small, high-value, and
  phase-independent: scope handoff notes per-run + per-task and retire them
  from context on run completion (§2.1 — a confirmed cross-run/cross-task
  bleed with silent truncation on top; **do this one first**); pass the prior
  iteration's `sessionId` to ci-loop headless runs (§2.2 — resume is plumbed
  and never used); a `MAX_CONCURRENT_HEADLESS` semaphore, per-step turn cap,
  and fan-out depth cap → safety-rail (§2.3 — fan-out is an uncapped
  `Promise.all`; deliberately no cost ceiling);
  cancel-run/kill-step in the agents panel (§3.1, UX per [ux.md](./ux.md) §6
  — today nothing running can be stopped). Plus poll→push for the panel via
  the runner's existing `notify` path (§3.3).
- **Data-model hygiene** *(review #12, §5; ext §8.5)*: prune the nine child
  tables alongside the PR-list prune. The decision is: no broad FK retrofit in
  this phase sequence; use declared parent lineage as the source of truth. The
  plugin-era rules live in ext §8.5: tables declare scope (user vs machine)
  and parent lineage — core derives cascade + prune **and
  a secondary index on the declared parent column** *(perf §3.5 — one
  declaration, three artifacts)*, retiring `db/cascade.ts`; the nine
  per-feature `workspaces` columns fold into
  `workspace_config (workspaceId, key, value)` with per-plugin codecs (pairs
  with Phase 7's codecs) **under the compatibility contract in ext §8.5** —
  one-time copy-and-drop migration with the code switch in the same PR (no
  split-brain writers), identity/ordering/appearance columns stay on
  `workspaces`, codecs preserve today's normalization and error codes, and
  workspace deletion clears `workspace_config` with `workspace_projects`;
  one drizzle project and one migration journal while
  plugins stay in-tree. Retention and pruning follow the user-data
  preservation stance in state §5.2 — plugin migrations bias to read-time
  normalization plus next-write upgrade, never resets. The integration-model
  moves ride Phase 7's PRs rather than a separate migration wave
  *(integrations §3, §5, §6)*: typed connection columns (`status`,
  `authKind`, `lastValidatedAt`, account) with `meta` folding into
  codec-owned `config`; nullable `task_links.refJson` for full external
  refs; `provider` columns become core-derived on write; and
  `workspace_projects` is documented as the first `ExternalBinding` table —
  the generalized table waits for the first repo-scoped binding need.
- **Deduplication** *(review §7)*: one `atomicWrite`, one frontmatter parser,
  one last-stdout-line helper, one user-script execution policy; retire the
  `Env`/`BLOBS` Workers costume (`createApp(runtime)`, plain
  `readBlob`/`writeBlob`) *(review #14)*.
- **Observability**: JSON-lines log under `userData` with a settings-pane
  tail — the failure mode worth catching is "background refresh silently
  stopped". This log is also where the perf baseline lives (perf §3.1); no
  separate telemetry apparatus. Never log request bodies/headers
  ([security.md](./security.md) §6).
- **Component decomposition** *(review §4; ext §3.5, §8.1)*:
  DiffView/PullDetail/TaskView get the pure-model + thin-view split already
  proven in `layout.ts`/`diff/model.ts` — chip away model-first as those
  files are touched; no big-bang rewrite. One constraint: the DiffView split
  must preserve the hydration scheduling intact (idle-callback batches,
  priority queue, rAF-batched measure — perf §1.7); it's the
  best-engineered perf path in the app and easy to silently re-time while
  "just moving code".
- **Autosave clobber guard** *(state §5.2 — small, prevents data loss, do
  anytime)*: record buffer `mtime` at load; re-stat before each autosave
  write and refuse + surface reload-or-overwrite on divergence; reload clean
  buffers on focus. No watcher infrastructure — an mtime compare in
  `autosave.ts` plus the editor pane's focus handler.
- **Repo-config trust gate** *(points §4.12, tenet 8; threat analysis
  [security.md](./security.md) §5, dialog UX [ux.md](./ux.md) §2)*: hash the
  repo layer in `runConfig.ts`; first execution from an unacknowledged hash
  (run ▶, workflow start, `run_*` tools) shows the commands and records a
  machine-scoped `config_acks (repo, hash, ackedAt)` row; changed config
  re-asks with a diff. Lands naturally with Phase 8 but is independently
  shippable. **The gate covers executable config; parity covers the whole
  config contract** *(parity §3)*: the four-layer merge precedence (repo →
  user → `repo_paths.runTargets` → workspace fallbacks, with workspace
  `devScript` as the base `dev` target), parse errors surfaced as
  palette/config-error rows, `[layout.<id>]` recipes, `copy = [...]`
  semantics (traversal-rejecting, warn-on-missing, never-overwrite),
  setup/archive scripts with `setupScriptTrigger`, and the preview home-URL
  priority. Landing the gate while regressing any of these means worktree
  creation and recipes break while run buttons still look correct.
- **Poll scheduler + retention sweep** *(state §5.2)*:
  `ctx.poll.register(key, intervalMs, fn)` — coalesced, visibility-paused,
  rate-limit-aware — migrating the rail status pollers onto it as the proof
  (it subsumes the interim visibility pause above); a retention pass in the
  composition root's `reconcile()` (size-capped LRU over the blob dir — it
  currently has no deletion path at all — plus aging out terminal/workflow
  child rows of long-archived tasks), with per-table policy constants
  alongside the Phase 2 TTLs.
- **Plugin conformance tests** — [testing.md](./testing.md) §4: pane renders
  from a bare `{ task }`; `activate()` only registers and its disposables
  dispose; persisted-state parsers tolerate unknown ids. Cheapest insurance
  that the contracts stay true as contributors multiply.

## Sequencing summary

Phases 0–2 are pure wins with no design risk — start immediately, any order.
Phase 3 unlocks Phase 4; Phase 5 unlocks 6–8; Phase 9 is parallel; Phase 10 is
last. Two gates cut across the sequence: the smoke suite lands before Phase 3
and gates 3/5/6, and the perf baseline marks are captured before Phases 1/3/6
touch their paths. The agent-runtime corrections (§2.1 first), the two
immediate perf items, and the UI-hygiene quick fixes are phase-independent —
do them whenever.

If only three things ever ship, ship 0, 1, and 2 — they close the
highest-severity findings (review §§1c, 2, 3-server) while staying invisible
to the UI. The overall litmus test is unchanged from ext §9: a new integration
or a fourth agent profile touches **zero** core files.

```
Phase 0 (contracts) ──┐
Phase 1 (comp. root) ─┼─→ Phase 3 (transport) ─→ Phase 4 (tool projection)
Phase 2 (sync engine) ┘         ↑ smoke suite + perf baseline gate
                                                Phase 7 (providers) ← Phase 2
Phase 5 (registries) ─→ Phase 6 (restore) · Phase 8 (workflow/profiles)
        ↑ smoke suite gate
Phase 9 (platform) — parallel, opportunistic
Phase 10 (foldering) — last
```
