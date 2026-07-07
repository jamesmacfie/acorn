# Core services, state, and runtime policies (§5)

**Status:** design proposal · **Date:** 2026-07-07 · **Part of:** the
[extensibility.md](./extensibility.md) design (this file is §5 of that design;
section numbers are preserved so citations like "§5.1" resolve here). The
contribution-point catalog is [contribution-points.md](./contribution-points.md)
(§4).

This file covers where state *lives* and how the composed system *behaves*.
The companion rules for how state changes *propagate and fail* at runtime —
mutation failure surfaces, latest-wins refreshes, derive-don't-effect — are
[ui-state.md](./ui-state.md) and bind contributed UI equally.

---

## 5. Core services plugins consume

The other half of the contract — what `ctx` hands a plugin:

| Service | Backing (today) | Notes |
| --- | --- | --- |
| `ctx.tasks` / `ctx.workspaces` | `tasks.ts`, tasks/workspaces routes | read + typed mutations; no direct table access from plugin client code |
| `ctx.layout` | `applyLayoutAction` dispatch | `openPane(id, intent?)` replaces the mailbox signals; actions widen to resize/pin/move per [ux.md](./ux.md) §7 |
| `ctx.query` | TanStack client + shared key discipline | plugins namespace keys; invalidation helpers per resource |
| `ctx.prefs` | prefs table + restore pipeline | descriptor-based T3 slices (`plugin:key`, scope, restore phase, codec, budget); hydrate/persist ordering owned by core (implementation Phase 6) |
| `ctx.storage.files(taskId)` | `taskWorktree` capability | the only path-resolution API; confinement enforced |
| `ctx.db` (server/main) | shared SQLite conn | plugins own their tables; migrations contributed per plugin, run by core |
| `ctx.blobs` | on-disk SHA store | plain `readBlob/writeBlob` (the KV costume retired — review #14) |
| `ctx.state` | new (§5.1) | scoped T4 containers (`app`/`workspace(id)`/`task(id)`/`pane(taskId, paneId)`); lazy allocation, scoped subscriptions, core-owned eviction |
| `ctx.terminal` | PTY engine | `create/attach/sendToAgent/onStatus`; profiles come from §4.11 |
| `ctx.events` | new | typed bus: `task:created/activated/archived`, `workspace:switched`, `session:status`, `boot:restored`; will-phase consent on destructive events (below) |
| `ctx.poll` | new (§5.2) | the shared poll scheduler — `register(key, intervalMs, fn)`; coalesced, visibility-aware |
| `ctx.gh` | `server/github` clients | the REST/GraphQL clients + `ghError` taxonomy, exposed to server plugin parts (github plugin is its main user; others may read rate-limit state) |

(An earlier draft listed `ctx.ipc`, a typed channel bus. Superseded by the
transport collapse — [implementation.md](./implementation.md) decision 1: a
plugin's request/response surface is server routes; streams ride the shared
WebSocket; the tiny Electron-ism residue is core-owned and not a plugin API.)

`ctx.events` deserves emphasis: it is the disciplined replacement for the three
ad-hoc coupling channels found in review (`pendingTerminalFocus`,
`FILE_SCROLL_EVENT`, manual `evictPreviewWebview`) and for the archive flow's
"three obligations that must stay in sync". `task:archived` fires once from
core; terminal teardown, worktree removal, preview eviction, and query
invalidation are each a subscriber.

But a notify-only bus can only *announce* — it cannot ask. Archiving a task is
a decision plugins hold state about: a running workflow, an agent mid-session,
uncommitted changes. Today that knowledge is hardcoded into the close-task
dialog in `TaskView.tsx`, which can never know what plugins know. So
destructive events get a **will-phase**:

```ts
ctx.events.will('task:archive', async (task): Promise<Concern | null> =>
  hasRunningRun(task.id) ? { severity: 'warn', message: 'Workflow "ship-it" is running' } : null)
```

Core collects concerns from all registered will-handlers (with a short
timeout — a hung handler must not block the UI), renders them in one
confirmation dialog, and only fires `task:archived` after the user confirms.
No hard veto: in a local single-user app the user is the authority; plugins
inform the decision, they don't own it. Will-phases exist for `task:archive`,
workspace removal, and `app:quit` (running workflows/agents are exactly the
state worth surfacing before quit — the `will-quit` teardown in the
composition root runs *after* consent, not instead of it). Dialog UX:
[ux.md](./ux.md) §1.

### 5.1 The state model — tiers, scopes, one writer

State is currently the least-designed layer. `tasks.ts` is ~10 module-scope
signals plus ad-hoc collections keyed by workspace/task id (`viewByWorkspace`,
`taskLayouts`, `recipeBrowserUrls`, `terminalOpenTasks`, `terminalMaxTasks`;
`sessions.ts` adds `activeByTask`), imported by nine modules — a god store by
accretion, where each keyed `Map` hand-manages its own eviction. The plugin
model needs state to be as declared as UI. Three axes classify every piece of
state in the app; a piece that can't name its position on all three is the
smell.

**Tier — how durable it is, and where the authoritative copy lives.**

| Tier | What it is | Home | Retention (§5.2) | Examples |
| --- | --- | --- | --- | --- |
| T1 mirror | someone else's data, rebuildable | SQLite mirror tables via the sync engine (§4.9); client reads only through `ctx.query` | prunable by definition; TTL-governed | pulls, issues, checks |
| T2 durable app data | the user's own data | SQLite app tables behind typed services; plugins own private tables (extensibility §8.5) | kept; children of long-archived tasks age out | tasks, notes, memory, workflow runs |
| T3 persisted view state | how things are arranged | `ctx.prefs` slices, restored by the phased pipeline (extensibility §8.3) | kept; unknown ids inert | layouts, pane weights/pins, editor tabs, filters, theme |
| T4 session state | where the user is right now | `ctx.state` scoped signals; deliberately not persisted | dies with scope eviction | selection, scroll positions, active terminal tab |
| T5 process runtime | live resources | main-process services; `reconcile()` at boot, dispose at quit | disposed at quit | PTYs, webviews, pg pools |

The T3/T4 line is already policy in the code (per-workspace scroll and
active-terminal-tab restore are session-only *by design*): **T4 is the default
for view state.** Promoting a piece to T3 is a decision that must also pick its
restore phase (extensibility §8.3) and its unknown-id/staleness behavior — not
a `writeJson` added in passing.

**Navigation guarantee.** The user-facing rule is simple: when a user leaves a
workspace or task and later comes back in the same app session, the shell
returns to the same local state for that scope unless the scope was archived or
removed. When the app relaunches, only T3 state restores. That means:

- task-scoped T3 restores pane set/order/id-keyed weights/pins and editor tabs;
- workspace-scoped T3 restores durable workspace preferences such as PR filters;
- task/workspace-scoped T4 restores while navigating inside the running app
  (active terminal tab, per-workspace browse scroll, selection, focused pane),
  but deliberately resets on relaunch;
- process/runtime resources (T5) reconcile at boot if they are durable in the
  main process (tmux sessions), otherwise dispose.

The rule for a new state slice: if losing it on relaunch would make the app feel
like it forgot the user's arrangement, it is T3; if losing it only resets
momentary attention, it is T4.

**Scope — what it is keyed by.** `app`, `workspace(id)`, `task(id)`,
`pane(taskId, paneId)`. The core provides scoped containers —
`ctx.state.task(taskId)` returns a store whose *lifetime the core owns*:
created lazily, evicted on `task:archived` (likewise workspace scope on
workspace removal; pane scope dies with layout removal unless the pane is
`keepAlive`). This is what deletes the hand-keyed-Map-plus-manual-eviction
pattern rather than relocating it. T3 prefs slices declare the same scope so
their keys are derived (`plugin:key:taskId`), not hand-composed strings.

> **Build order note** (implementation Phase 6): the *problem* is eviction, and
> the event bus already solves it — one `task:archived` subscriber per feature
> clearing its keyed collections. Do that first; build the full `ctx.state`
> container machinery only if the hand-keyed collections keep multiplying.
> Six signals in a 94-line file doesn't yet justify the containers.

**Ownership — one writer, no hub stores.** A plugin's state is private to it;
cross-plugin *reads* go through declared contributions (badges, context
sections, services), never by importing another plugin's store module. The only
shared hubs are core stores (`ctx.tasks`, `ctx.layout`, the active
task/source signals) — shared because core-owned, not because convenient.
Events notify; they do not carry state. And the query cache is the *only*
client-side copy of T1/T2 server data — copying query results into signals
creates a second writer and is the one move this model bans outright. (The
`touched()`-guarded form seed is the sanctioned exception —
[ui-state.md](./ui-state.md) §1.)

Parity check against today's inventory: `selectedSource`/`activeTaskId` → core
app-scope T4; `taskLayouts` → core T3, task-scoped (and stays T3 as it grows
pane-id-keyed weights and pins, [ux.md](./ux.md) §7 — while pane *maximize* is
T4 session-only, the same split the terminal drawer already makes:
`term_height` persisted, `terminalMaxTasks` not); `viewByWorkspace` → core
workspace-scope T4; `terminalOpenTasks`/`activeByTask` → terminal plugin,
task-scope T4; editor tabs → editor plugin T3; workflow runs → T2 (already
exemplary: durable checkpoint rows, re-entrant `tick()`); the `sessions` map →
T5. Pane management is therefore not a plugin-private concern: `ctx.layout` is
the only writer for pane order, pins, weights, and focused/maximized pane
state, while panes contribute only constraints such as `minWidth`. Nothing in
the current app needs a fourth axis; anything future that does (e.g. state
shared *between* tasks in a workspace) is workspace-scope by construction.

### 5.1a Persisted-state schemas

Persisted view state is an app contract, not an incidental JSON blob. Every T3
slice — core or plugin — registers a descriptor before it can read or write:

```ts
interface PersistedStateSlice<T> {
  key: string                         // namespaced: 'core:task-layouts', 'editor:open-files'
  scope: 'app' | 'workspace' | 'task' | 'pane'
  restore: 'workspace' | 'view' | 'panes'
  version: number
  codec: {
    parse(raw: unknown): T            // validates, normalizes, never throws to caller
    serialize(value: T): unknown      // strips transient/runtime-only fields
  }
  empty(scopeId: string): T
  unknownIds: 'retain-inert' | 'drop'
  maxBytes?: number                   // guardrail for prefs/IDB payload growth
}
```

Core owns the storage mechanics: derive the persisted key from
`slice.key + scope id`, hydrate in restore-phase order, arm persistence after
`boot:restored`, throttle writes, and surface failures as notices
([ui-state.md](./ui-state.md) §3). A plugin owns only its descriptor and the
typed reducer/actions that produce the slice value.

**Schema rules:**

- **Codec at every boundary.** `parse(raw)` receives `unknown`, accepts older
  versions, normalizes to the current shape, and returns `empty()` on
  unrecoverable data after logging a warning. No T3/T2 JSON blob is cast
  straight to a concrete type.
- **Versioned, but lazy-migrated.** Prefer read-time normalization plus
  next-write upgrade over one-off migrations for prefs. Database-owned T2
  schema changes still use migrations.
- **Unknown ids are explicit.** Layouts and plugin references use
  `retain-inert` so disabled plugins do not destroy user arrangement. Pure
  enumerations with no future value use `drop`.
- **Stable ids over indexes.** Persist by contribution id (`paneId`,
  `sourceId`, command id), not by registry order. Pane weights are keyed by
  pane id for this reason.
- **Small and reconstructable.** T3 stores arrangement, not data. File bodies,
  patches, mirrored rows, search results, and tool outputs stay in T1/T2/T5 and
  are excluded from IndexedDB persistence ([performance.md](./performance.md)
  §3.4). `maxBytes` is a guardrail; a slice that needs more is probably in the
  wrong tier.
- **One writer.** A slice descriptor names its owner. Other plugins interact
  through contributions, commands, or services, never by mutating the slice.

**Initial slice table for Phase 6:**

| Slice/key | Scope | Tier | Restore | Codec behavior |
| --- | --- | --- | --- | --- |
| `core:last_workspace` / `last_task` / `last_source` | app | T3 | workspace → view | validate id exists or retain as pending until data loads; stale ids no-op |
| `core:task_layouts` (`task_layouts`, legacy `task_panes`) | task | T3 | panes | normalize legacy shapes; retain unknown pane ids inert; id-keyed weights; no maximize |
| `editor:open_files` | task | T3 | panes | validate paths through task worktree; missing files render closed/inert, not fatal |
| `github:pr_filters` | workspace | T3 | view | validate enum/filter values; unknown labels/statuses drop |
| `core:notices` | app | T3 | view | cap count/age; stale action targets become inert |
| `core:left_collapsed`, theme keys, shortcuts, rail order, terminal prefs | app/workspace as applicable | T3 | workspace | normalize enums/chords; conflicts handled by registries |

Everything else in inv §3a is either T4 session state (`viewByWorkspace`,
focused/maximized pane, active terminal tab) or T5 runtime and must not be
silently promoted to prefs.

**Plugin state decision table:**

| Plugin need | Use | Why |
| --- | --- | --- |
| Remote/provider data that can be re-fetched | `ctx.query` + sync descriptors (T1) | cache invalidation/TTL/backoff are shared |
| User-created domain data | plugin-owned SQLite table behind a typed service (T2) | durable, queryable, migratable |
| Workspace configuration edited by the user | workspace-config contribution + codec | scoped to workspace, not global prefs |
| UI arrangement the user expects after relaunch | `ctx.prefs.registerSlice(...)` (T3) | phased restore, versioned codec, bounded payload |
| Momentary UI attention while navigating | `ctx.state.workspace/task/pane(...)` (T4) | returns when navigating back during the same session, resets on relaunch |
| Live resources/processes | main service + `reconcile()`/dispose (T5) | runtime lifecycle belongs in the composition root |

Plugins do not get a generic "global store" escape hatch. If a plugin needs to
share something with another plugin, it exposes a contribution or service
method; the consuming plugin does not import or mutate the owner’s state.

### 5.2 Runtime policies — concurrency, budgets, retention

Structure says who contributes what; these three policies say how the composed
system behaves while running. Each is a stated posture, not a subsystem.

**Concurrent writers share one worktree.** Three writers touch the same files:
the editor pane (autosave), agent PTY sessions, and workflow steps. There are
no file watchers in main today, so nothing reconciles an agent's write with an
open editor buffer — autosave can silently clobber what the agent just wrote.
The posture, cheapest-first:

- *Editor vs agent:* the editor records each buffer's on-disk `mtime` at load;
  before an autosave write (`autosave.ts`) it re-stats — if the file changed
  underneath, it does **not** write, and surfaces reload-or-overwrite. Clean
  (unmodified) buffers reload on window/pane focus. This is the whole fix: an
  mtime guard plus reload-on-focus, no watcher infrastructure required (a
  watcher can upgrade staleness detection later; the guard is what prevents
  loss). *(Implementation: the "autosave clobber guard" ongoing track — do
  anytime; it prevents data loss.)*
- *Agent vs agent:* not locked. The worktree is git — divergence is visible in
  the changes pane, and "one interactive agent per task" stays UX guidance.
  Workflow fan-out already does the right thing structurally: parallel steps
  get their own worktrees (`workflow_steps.worktreePath`).
- *SQLite:* server and main share one connection in one process; WAL +
  `db.batch` atomicity already covers it. No change; the point is that files,
  not rows, are the contested resource.

**Budgets: shared scheduling, cheap predicates.** Plugin platforms get slow one
innocent contribution at a time — N plugins each owning a `setInterval`, badge
functions running per task row per reactive update. Two rules: (1) nothing
polls privately — recurring work registers with `ctx.poll` (one scheduler that
coalesces ticks, pauses when the window is hidden —
[performance.md](./performance.md) §3.2 — and backs off on rate-limit
signals from `ctx.gh`), which is where the rail's dirty/checks pollers (§4.13)
land; (2) `when` predicates and badge contributions must be synchronous reads
of already-held state — anything that computes registers a poller and reads a
signal. Hold both rules strictly and grandfather no private intervals: the
motivating future case is a dashboard (extensibility §9.1) — N cards each
wanting fresh data is exactly the "slow one contribution at a time" scenario,
and it is only affordable if every card refreshes through the one visibility-
paused, coalesced scheduler. Activation stays cheap by construction:
entrypoints are lazy imports (extensibility §3.1) and `activate()` must only
register — first real work happens on first use or first poll tick. Integration providers additionally
declare per-provider/per-connection budgets — outbound concurrency,
pagination caps, cached-item and context size limits, backoff floors — on
their descriptors, enforced by core ([integrations.md](./integrations.md)
§17). The heaviest resource of all — concurrent headless agents — is governed
separately: [agent-runtime.md](./agent-runtime.md) §2.3
(`MAX_CONCURRENT_HEADLESS` semaphore, per-step turn caps, and a fan-out depth
cap → safety-rail). There is deliberately **no cost dimension** — acorn runs
Claude/Codex on subscriptions, so per-call spend is moot
([agent-runtime-influences.md](./agent-runtime-influences.md) §3A). Workflow
**triggers** are not a fourth budget axis either: a trigger that starts a run
registers with `ctx.poll` like any other recurring work — coalesced,
visibility-paused, app-open-only — so scheduled/event-driven runs need no daemon
(agent-runtime §6.3).

**State performance: scoped, lazy, bounded.** The state model should make
navigation feel instant without keeping an unbounded app in memory.

- T4 containers are lazy: `ctx.state.task(id)` / `workspace(id)` / `pane(...)`
  allocate only on first use. Switching tasks should reactivate an existing
  container, not rehydrate from prefs or rebuild plugin state.
- T4 containers are bounded: core evicts on archive/removal immediately and may
  LRU-evict long-inactive unpinned scopes under memory pressure. Eviction is
  safe because T4 is session-only; T3 is the restore source for durable
  arrangement.
- Plugin subscriptions are scoped: a pane/plugin subscribes to the smallest
  scope it needs, and disposes with that scope. App-scope subscriptions are for
  genuinely global state only.
- State writes batch at the reducer/service boundary. High-frequency UI state
  (divider drag, scroll, selection) updates live T4/UI state synchronously, but
  T3 persistence is throttled and serialized after the interaction settles.
- Derived selectors stay cheap and synchronous. Anything that needs async work
  uses `ctx.query` or `ctx.poll`; it does not run inside `when`, badge, or
  layout predicates.

**Retention: every tier names its bound — starting with what has no bound.**
The app holds valuable local-only state; before any sweep or plugin migration
lands, the preservation stance is explicit. **Never deleted automatically:**

- active tasks and their worktree paths;
- workspace/repo assignments — including *ignored* repos (ignored ≠
  unassigned) — and repo path mappings;
- notes, accepted memory files, and pending memory proposals;
- user-created review notes, until an explicit archive/retention policy says
  otherwise;
- integration rows, unless the user disconnects.

Plugin/prefs migrations bias toward read-time normalization plus next-write
upgrade (§5.1a), never resets — a version bump must not cost the user their
arrangement or data.

For the prunable tiers, the tier table (§5.1) carries the retention column:
T1 mirror rows are prunable by definition (the child-table prune, review §5)
— with one carve-out: **viewed-file rows are app state (T2), not mirror
state**, and survive PR child pruning unless the PR row itself is deleted
deliberately. The blob store — which today has **no deletion path at
all** (`bindings.ts`) — gets a size-capped LRU sweep in the composition root's
`reconcile()` (blobs are content-addressed and re-fetchable, so eviction is
always safe; the cap is a named constant and evictions hit the observability
log). T2 archived tasks keep their rows (the audit trail is the point)
but their *children* age out — terminal-session and workflow rows for tasks
archived more than N days become part of the same reconcile sweep, noting
that **workflow runs are also an audit trail**: the retention constant is a
deliberate, documented choice, not a default. Memory retention is stricter than
mirror/cache retention: the `memories` index may be rebuilt or compacted
because it is derived, rejected/stale proposals may age out under a named
proposal policy, but accepted repo/private memory files are not deleted by
task archive, plugin disable, provider disconnect, or ordinary sweeps
([memory.md](./memory.md) §8). Superseded accepted memories compact only
through an explicit audited governance policy. One home (reconcile), one
policy constant per prunable table/store, greppable like the TTLs (§4.9). The
client-side IndexedDB cache is the fifth retention surface — its bound is the
persister filter + `maxAge` ([performance.md](./performance.md) §3.4,
implementation Phase 6); the filter excludes reconstructable payloads but
always keeps T3 slices.
