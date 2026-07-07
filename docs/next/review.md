# Architecture Review

**Date:** 2026-07-07 · **Scope:** `apps/desktop/src` (client, server, main, mcp, shared) · **Lens:** composability, extensibility, maintainability

This is a critical review. The strengths section at the bottom is real, but the body
is deliberately weighted toward what will hurt as the codebase grows. Every finding
carries file:line references so it can be verified or challenged.

> **Status (updated 2026-07-07):** this review is the motivating analysis; the
> findings and recommendations below have since been taken up, resequenced, and in
> places superseded by the rest of `docs/next`. [implementation.md](./implementation.md)
> is now the **authoritative build order** — where it and this review disagree on a
> detail, it wins. Where a finding's disposition has changed, this doc points forward:
> §1b/#7 → [integrations.md](./integrations.md) (the full provider contract subsuming
> the sketched `Provider` interface); §1c/#2 → the extracted sync engine
> ([contribution-points.md](./contribution-points.md) §4.9); §1d/#13 → the agent-tool
> projection (points §4.8); §1e/#10 → workflow-engine extensibility in
> [implementation.md](./implementation.md) Phase 8 plus the runtime corrections in
> [agent-runtime.md](./agent-runtime.md); §3/#3 → the transport collapse (technology
> change #1) rather than a typed IPC bus; §4 → [ui-state.md](./ui-state.md) (runtime
> reactions) and [ux.md](./ux.md) (shortcut/error surfaces); §5 →
> [performance.md](./performance.md) (retention + indexes); §6 →
> [testing.md](./testing.md) (the operative test plan; the coverage numbers stand).
> Exact counts throughout are authoritative in [inventories.md](./inventories.md).

## Verdict

acorn is a well-disciplined codebase with an **extension problem**. The type hygiene
is excellent (zero `as any`, zero `@ts-ignore` in production code), the pure-logic
extraction and test discipline around it are genuinely good, and several seams
(`taskWorktree`, `workflowRunner`'s DI, the query-key factories) are exemplary.

But the growth axes the product is actually growing along — **new panes, new
integrations, new mirrored GitHub resources, new agent capabilities, new workflow
step kinds** — are all closed for extension. Each one is an if-ladder, a hand-copied
state machine, or a four-layer edit spanning preload/IPC/HTTP/MCP. The cost of the
*n+1th* thing is the central architectural weakness, and it shows up in every layer
the same way: the first two instances were built bespoke, the pattern was never
extracted, and the third instance will be a copy of a copy.

The second-order theme is **wiring by mutation**: the HTTP routes, the context
assembler, and the harness surface are stitched to the main process through
module-global setters installed during boot, with `terminal.ts` acting as the
accidental composition root for the entire main process. It works, but the
architecture is only knowable by reading the boot sequence.

---

## 1. Every extension seam is closed (HIGH)

The same shape recurs in five places. Individually each is defensible; together they
define the cost curve of the product.

### 1a. Adding a pane touches ~6 sites across 4 files

A new `PaneId` requires: the union (`client/features/tasks/layout.ts:9`),
`PANE_LABELS` (:22), `PANE_ORDER` (:36), **and** `PANE_IDS` (:41) — the last being a
hand-maintained runtime duplicate of the type union with nothing enforcing they
match. Then `PANE_SHORTCUT_DEFAULTS` (`paneShortcuts.ts:14`), the `paneBody()`
if-ladder (`TaskView.tsx:230-281`), and a hand-written switcher button
(`TaskView.tsx:297-334`). The command palette derives its rows from `PANE_ORDER`
(the one table-driven consumer); everything else is manual. Forget the switcher
button and the pane exists but is unreachable. The evidence this bites: the
`database` and `search` panes were added and `docs/panes.md` still says there
are eight panes (code has ten — `panes.md:6,16` vs `layout.ts:9`).

**Fix shape:** one pane registry — `{ id, label, order, shortcut, render(task) }` —
that `PANE_IDS`, the shortcut defaults, the switcher, and `paneBody()` all derive
from. One file per new pane, one registration line.

The `pr` pane also breaks the pane contract: every other pane takes
`task={props.task}`, but `pr` renders PullDetail + DiffView which read
`useParams()` directly (`TaskView.tsx:231-243`), so rendering a task's PR pane
requires driving global navigation first (`activate.ts:11-15`). The pane interface
is not actually uniform.

### 1b. Adding an integration touches ~8 sites

There is no provider abstraction. Linear and Rollbar are fully bespoke: a third
provider (Sentry, say) costs a new `server/<provider>/` client, a new route file, a
mount in `server/index.ts:44-46`, a new branch in the literal linear/rollbar
if-else in `integrations.ts:41-73`, a new TTL constant, a `db/cascade.ts` entry,
new `shared/api.ts` types + route builders, and the provider string added by
convention (no constraint) to three tables (`integrations.provider`,
`issues.provider`, `taskLinks.provider`). The multi-connection
decrypt-try-skip fetch loop is meanwhile hand-rolled six times
(`linear.ts:49,122,181`, `rollbar.ts:57`).

**Fix shape:** a `Provider` interface — `validate(token)`, `fetchItems`,
`fetchDetail`, `toIssue` — before the third integration lands, plus one shared
`forEachConnection` helper. The generic `issues`/`integrations` tables already
anticipated this; the code layer never followed.

### 1c. Adding a mirrored GitHub resource re-derives the sync state machine

The serve-then-revalidate flow (read `sync_state` → fresh: serve → stale: serve +
background refresh → cold: block on refresh) is reimplemented independently in
`pulls.ts:178-195`, `pullDetail.ts:44-78`, `pullFiles.ts:55-77`, `repos.ts:16-32`,
and differently again in `linear.ts`/`rollbar.ts`. The copies have already
diverged: `pullDetail` detects cold via `cached.pull` truthiness (:67), `pulls` via
`sync` existence (:186), `repos` via `cached.length` (:24) — same intent, three
detections. `STALE_AFTER_MS = 45_000` is exported from `prMirror.ts:16` and
independently re-declared in `pulls.ts:14`. ETag revalidation exists on the pulls
list (`pulls.ts:76`) but not the repos list (`repoMirror.ts:68`) — the most
ETag-eligible resource leaves free rate-limit savings on the table.

**Fix shape:** extract `serveThenRevalidate(c, { resource, ttl, read, refresh })`
and a caching-policy module holding the TTL constants. This is the
single highest-leverage server refactor: it deletes the divergence and makes the
next mirrored resource a config entry.

### 1d. Adding an agent capability costs four layers

Notes/memory/run/browser each traverse: an Electron IPC handler for the UI
(`knowledgeIpc.ts:172-263`), a Hono harness route (`harness.ts:97-170`), a bridge
injected into that route by module-global setter (`harnessWiring.ts:24-87`), and an
MCP tool that HTTP-calls the route (`mcp/server.ts:134-232`). All four live in one
process — an agent's `notes_append` goes MCP tool → loopback fetch → Hono →
bridge → `NotesStore`, a round-trip out to HTTP and back into the same process.
One new verb = five edit sites (preload, knowledgeIpc, harness route, bridge
type + impl, MCP tool).

Worse, the channels have already forked semantically: the UI's `notes:write`
silently creates a missing note with empty frontmatter (`notes.ts:156-161` via
`knowledgeIpc.ts:246`) while the harness path creates it with `author: 'agent'`
(`harnessWiring.ts:27-32`). Two channels, two create-if-missing behaviors for the
same verb; provenance stamping only exists on one path.

The "MCP calls the app's own HTTP API" *principle* (`mcp/api.ts:1-8`) is right for a
multi-channel app — it's the number of layers per capability that hurts, not the
loopback. The principle is also not consistently followed: `mcp/server.ts:11`
imports `gitLog/localChanges/localDiff` straight from `main/localDiff` and runs
them in-process, so three tools bypass HTTP while everything else treats the app
as a remote API, and the rule is unstated at the seam.

### 1e. The workflow engine and MCP tool set are closed at the core

`executeStep` (`workflowRunner.ts:189-250`) is a hardcoded kind ladder
(`gate-human` → `gate-policy` → `ci-loop` → `fan-out` → `join` → agent); a new step
kind edits the engine core plus the `kind` union. `evaluatePolicy`
(`workflowWiring.ts:77-84`) is a string switch with one case. For an engine whose
whole point is extension, a `Map<kind, StepHandler>` registry is the missing seam.
Also: `runJoin` (`workflowRunner.ts:322-329`) binds a join to "the nearest
preceding fan-out" by index scan — positional coupling with no explicit reference;
reordering steps silently rebinds joins.

MCP tool availability is frozen at connect: `hasRunTargets()` is resolved once at
startup (`mcp/server.ts:240-249`), so a repo that gains run targets mid-session
never exposes `run_*` tools until the agent process restarts.

---

## 2. Wiring by global mutation, and an accidental composition root (HIGH)

The deepest structural coupling in the system: the HTTP route layer depends on the
main process reaching in and mutating module-level globals at boot.

- `harness.ts:54-57` exposes `setNotesBridge`/`setMemoryBridge`/`setRunBridge`/
  `setBrowserBridge`; `taskContext.ts:20-25` exposes
  `setContextNotesSource`/`setContextMemorySource`. All are installed by
  `harnessWiring.ts` and `knowledgeIpc.ts` during boot.
- The server starts listening **before** any of that wiring runs
  (`electron.ts:117` → `:118`). In the window between them, `/api/tasks/:id/notes`
  503s and `/api/tasks/:id/context` returns empty notes/memory. The 503 fallback
  makes it degrade politely, but nothing enforces or documents the ordering beyond
  two sequential `await`s in `electron.ts`.
- `registerTerminalIpc` (`terminal.ts:392-660`) is the de-facto `main()` for
  everything non-HTTP: it registers knowledge IPC, the runtime service, harness
  bridges, workflow IPC, local-git IPC, database IPC, and runs tmux/worktree
  reconciliation (`terminal.ts:397-418,657-658`). The lowest-level concern (PTYs)
  owns application bootstrap. Adding any new IPC domain means editing the terminal
  file. `electron.ts:118` reads as "start the terminal" but actually starts the
  entire main-process surface.
- `terminal.ts` itself carries module-level mutable wiring (`memoryInjector` :92,
  `internalApiEnv` :96, `memoryReviewTrigger` :100) reassigned inside the
  registrar, plus the global `sessions` map (:79). It must be registered exactly
  once, in order, and cannot be instantiated twice or tested as a unit.

**Fix shape:** a neutral `main/bootstrap.ts` composition root that builds the DB,
constructs each domain service, wires the harness bridges, *then* starts the HTTP
listener. `terminal.ts` shrinks to the PTY engine; the setter-injection pattern can
stay (it's testable) but installation moves to one place with an explicit order.

Related lifecycle gaps: there is **no shutdown path at all** — no
`before-quit`/`will-quit` handler in `electron.ts`; pg pools (`database.ts:25`) are
never ended on quit, the idle-watch interval (`terminal.ts:241`) is never cleared.
Startup reconciliation is likewise scattered — `reconcileTmux` (`terminal.ts:366`),
`reconcileWorktrees` (`taskWorktree.ts:61`), `workflowRunner.reconcile()`
(`workflowWiring.ts:147`) — each hooked wherever its registrar happens to run, with
no coordinated "resume durable state" step for the fourth subsystem to join.

---

## 3. The contract is opt-in, and the IPC seam has no contract at all (HIGH)

`shared/api.ts` is the stated contract ("mirrored TypeScript, not a runtime RPC
client" — `docs/architecture-overview.md:61`), but enforcement is discipline, not
architecture:

- **Server → type link is opt-in.** `satisfies <Type>` appears in ~9 `c.json` sites
  (`workspaces.ts:92,222`, `linear.ts`, `rollbar.ts:88`, …). The highest-traffic
  path — `toPublic` (`pulls.ts:211`), `toPublicPull` (`prMirror.ts:233`),
  `readComposite` (`prMirror.ts:250`) — has inferred return types never checked
  against `Pull`/`PullDetail`. Add a field to the shared type and these mappers
  silently omit it with the compiler green. `me.ts:8` returns a bare literal.
- **Client validates nothing.** `readJson<T>` (`apiClient.ts:14-19`) is a cast; the
  caller supplies `T`, asserting the contract into existence. `zod` is a dependency
  but is used only for MCP tool *inputs*; request bodies server-side are
  `(await c.req.json().catch(() => ({}))) as Partial<X>` with hand-rolled field
  checks (`tasks.ts:52`, `harness.ts:100-128`, `prefs.ts:18`).
- **No error envelope.** ~191 `c.json({ error: ... })` sites with ad-hoc shapes —
  `{error}`, `{error, status}`, `{error, detail}`, `{error, kind}` — and no error
  type in `shared/api.ts`; `prCreate.ts:122` leaks GitHub's raw 422 prose into a
  field that elsewhere carries stable machine codes.
- **The IPC seam is the worst drift surface in the codebase.** Every contract
  exists in three hand-synced copies: the preload implementation
  (`main/preload.ts`, every return `Promise<any>` via `ipcRenderer.invoke`), the
  client's hand-declared `TerminalApi`/`EditorApi`/etc.
  (`terminalClient.ts:5-136` + siblings), and 67 `ipcMain.handle` (plus 3
  `ipcMain.on`) string-keyed `ipcMain.handle('run:targets', …)` registrations in
  main (exact counts: inv §1). Nothing links the
  channel string in preload to the one in main, nor a handler's actual return to
  the client's declared type. A typo or shape change fails only at runtime — and
  this is also the least-tested layer (§6).
- **SQLite JSON blobs are cast straight to shared types** with no validation or
  migration: `JSON.parse(row.data) as LinearIssueDetail` (`linear.ts:175,229`),
  `as RollbarItem` (`rollbar.ts:65-118`), and `taskContext.ts:97-99` does
  cross-provider shape-guessing (`data.state?.name ?? data.status ?? data.level`)
  because the blob has no schema. Rows written under an old shape are trusted
  under the new one. The client-side prefs blobs are inconsistently hardened: the
  good ones parse to `unknown` then normalize (`layout.ts` `normalizeLayout`), the
  bad ones cast to a concrete type (`ShortcutsSettings.tsx:25`).

**Fix shape:** three moves close most of this. (1) `satisfies` on every
`c.json` mapper — mechanical, an afternoon. (2) Collapse request/response IPC
onto the loopback HTTP contract, with one WS for streams and only true
Electron-ism channels left in preload; the typed IPC bus is now only the
fallback if that collapse stalls. (3) An `ApiError` type in `shared/api.ts`
plus one `respondError` helper. Full runtime validation (zod on bodies) is
worth it only at the genuinely untrusted boundaries; for a single-user
loopback app, compile-time linkage is the right level — but it has to be
*mandatory*, not opt-in.

---

## 4. Client: a god-component boot sequence and scattered cross-cutting policy (HIGH)

### App.tsx is a hidden state machine

`App.tsx` (526 lines) holds ~10 unrelated global concerns as free-standing
`createEffect`s sharing closure state: auth gating, first-run bootstrap, theming,
workspace-restore navigation (:122-144), task auto-focus, repo/path restore
(:184-194), a one-shot `restored()` hydration of five subsystems (:200-214), and
seven persist effects (:219-246). Startup correctness depends on the relative
firing order of three effects, an `{ defer: true }`, an `isRestoring()` guard, and
the `restored` signal gating persistence — a distributed state machine whose
invariants live in comments (:117-121, :178-194) that exist because prior races
already happened. Every new persisted view-state slice edits App in at least two
places. **Fix shape:** extract a `createStartupRestore()` composable owning the
hydrate-then-persist lifecycle with an explicit ordered pipeline, and move each
concern (theme, restore, persistence) into its own composable.

### Cross-cutting client policy is scattered

- **Keyboard shortcuts:** 13 `window` keydown listener sites (global-chord sites
  plus 4 component-local Esc handlers; inventory §3b has the authoritative list)
  with
  conflict-avoidance by a hand-maintained denylist
  (`paneShortcuts.ts:31 RESERVED_CHORDS`) and prose comments
  (`TerminalPanel.tsx:106-111`). The help screen (`Shortcuts.tsx:17-31`) is a third
  hand-synced copy that lies the moment a binding is added without updating it.
  **Fix shape:** one shortcut registry that owns binding, conflict detection, and
  the help display.
- **Invalidation:** `refreshCurrentPull` (`App.tsx:302-309`) hand-lists five keys
  including a raw literal `['files', owner, repo, number]` instead of `filesKey`
  and `['linear-issues']` string literals instead of the exported factories;
  `PullDetail.refresh()` (:120-123) invalidates a different subset. There is no
  single "what refetches after a PR mutation" definition; the raw key drifts
  silently.
- **Prefs write-back has two contradictory protocols:** App's persist effects
  deliberately skip `prefsKey` invalidation to avoid a write→refetch loop
  (`App.tsx:216-218`), while `TabRail.saveOrder` (:48), `DiffView.setViewMode`
  (:94), and `toggleCollapsed` (`App.tsx:261`) *do* invalidate — triggering the
  app-wide reactive fan-out the first protocol was designed to avoid. Pref keys
  themselves are 20 bare string literals with no central `PrefKeys` const (full
  key list + tier split: inv §3a).
- **One-shot mailbox coupling:** four ad-hoc pub/sub channels invisible at the
  call site — `pendingTerminalFocus` (`sessions.ts:41-46`, written by
  CommandPalette, read-then-cleared by TerminalPanel), the `FILE_SCROLL_EVENT`
  window CustomEvent (`fileNavigation.ts:1,13` → DiffView), `noteToOpen`
  (`notesClient.ts:28-31`, ContextPane → NotesPane), and `pendingEditorReveal`
  (`editorState.ts:68-73`, Search → EditorPane). (This review originally named
  only the first two; inv §3f is the complete list — four instances, not two.)
  Four instances is a pattern; it deserves either a named event bus or props.

### Feature isolation is cosmetic

`features/` implies bounded contexts, but there are ~65 cross-feature import edges
and `features/tasks/tasks.ts` is an app-global store imported by nine modules —
hub-and-spoke, not isolation. `evictPreviewWebview` must be manually called on
every task-teardown path (`TabRail.tsx:211`, `TaskView.tsx:215`,
`CommandPalette.tsx:201`) — a leak-by-omission API; a fourth teardown path that
forgets it strands a webview. Centralize cleanup by reacting to task removal in
one place.

### Concern-fused large components

`DiffView.tsx` (598 lines) coordinates four queries, the hydrator, two
virtualizers, six timing-coupled measure/scroll effects (:301-327, with rAF-order
hazards documented at :193-197), thread reconciliation, and both unified+split
render trees — effectively untestable except end-to-end. `PullDetail.tsx` (513)
mixes eight mutation flows with imperative innerHTML post-processing
(:100-107); `TaskView.tsx` (395) mixes layout dispatch, four resources, keyboard
handling, and the close-task teardown dialog. The pure-model extraction that
already exists (`features/diff/model.ts`, `layout.ts`) is the right pattern —
these components just stopped short of it.

---

## 5. Data model: invariants by convention (MEDIUM)

- **Zero foreign keys** (`db/schema.ts` throughout). `db/cascade.ts` is a manually
  maintained delete list whose own comment instructs future devs to remember to
  extend it. Every referential invariant is reviewer discipline.
- **Orphaned child rows:** the PR-list prune (`pulls.ts:171`) deletes stale
  `pull_requests` rows but none of the nine child tables (reviews, comments,
  checks, threads, labels, commits, files, review requests, viewed files). Nothing
  cascades and nothing GCs — unbounded growth on a local single-user DB. Not a
  read-correctness bug today, but it's storage rot with no owner.
- **Split column ownership of `pull_requests`:** the list route and `mirrorPr` each
  own a disjoint column subset via carefully scoped `onConflictDoUpdate.set`, and
  `pulls.ts:112-115` must include `autoMergeEnabled: false` as a row key purely so
  the batch chunker's per-row param count doesn't desync — a batching
  implementation detail leaking into the row shape.
- **GitHub wire shapes leak into every route** with no anti-corruption layer: the
  PR is modeled twice (REST `GitHubPull` `pulls.ts:17` vs GraphQL `GqlPull`
  `prMirror.ts:49`) with two separate public mappers; `prCreate`, `repoLabels`,
  `actions` each re-declare their own payload types and snake→camel mapping.
- **JSON-blob columns** (`issues.data`, `integrations.meta`,
  `repo_paths.runTargets`, `workflow_steps.*Json`) hide structure — see §3 for the
  cast-without-validation consequence.

Also worth naming: the mirror vs app-state split itself (`schema.ts`,
`docs/architecture-overview.md`) is a genuinely good data-model decision,
consistently applied. The problems above are all at the enforcement layer, not the
conceptual one.

---

## 6. Testing is misaligned with risk (MEDIUM)

Where the code is pure, coverage is excellent (~40 test files over shared/, main
pure modules, client pure models, and the workflow runner). The architecture
makes route testing cheap — `createApp()` factory, `getDb(c.env)` DI,
`makeTestDb` — yet:

- **18 of 26 route files are untested**, including the highest-risk ones:
  `prActions.ts` (merge/close/comment against GitHub), `prCreate.ts`, `pulls.ts`,
  `pullDetail.ts`, `integrations.ts` (token encrypt/store), and the entire
  `harness.ts` agent surface.
- **The main-process IPC wiring is untested** (`terminal.ts`, `runIpc.ts`,
  `localGitIpc.ts`, `knowledgeIpc.ts`, `harnessWiring.ts`) — precisely the layer
  §3 identifies as the largest silent-drift surface. This is partly structural:
  those files bind `ipcMain` handlers inside their registrars, so the pure logic
  can't be exercised without Electron. Splitting handler bodies from registration
  (the pattern `runtime.ts`/`runConfig.ts` already follow) would make them
  testable.
- **Zero component tests** (`*.test.tsx` count: 0). Acceptable given the pure-model
  discipline, but the App.tsx restore choreography (§4) is exactly the kind of
  wiring that pure-model tests can't cover and has already had races.

---

## 7. Vestigial Workers-era abstractions (LOW-MEDIUM)

The migration kept the app design and some of the costume:

- `Env` as a global merged per-request from `Partial<HttpBindings>` + a runtime
  object built once at startup (`env.d.ts:9-11`, `server.ts:50`) — the Workers
  `c.env` mental model preserved where a `createApp(runtime)` argument would be
  honest. The `Partial` is the tell that the abstraction no longer fits.
- `BLOBS` is a KV-shaped `get/put` interface wrapping two `fs` calls
  (`bindings.ts:54-74`); a caller can't tell it's the local filesystem.
- `db.batch` is a D1-compat monkey-patch bolted on via `as unknown as`
  (`bindings.ts:119-122`) so D1-era call sites stay untouched — though it does
  currently deliver the atomicity the mirror writes rely on.

None of these are urgent, but each makes the real runtime harder to see, and
they're the kind of indirection that gets cargo-culted into new code.

Minor duplication in the same spirit: `atomicWrite` copied verbatim between
`notes.ts:100-109` and `memory.ts:116-125` alongside two hand-rolled frontmatter
parsers; "last non-empty stdout line" URL parsing implemented three times
(`terminal.ts:525`, `database.ts:63`, `runtime.ts:27-32`); user-script execution
with four different shell/timeout policies (`/bin/sh -c` @10s, `bash -lc` @15s,
`/bin/sh -c` @15s, `$SHELL -lc`).

---

## Strengths worth preserving

These are the patterns the fixes above should copy, not replace:

- **`taskWorktree.ts`** — the taskId-as-capability model
  (`resolveTaskCwd`/`resolveInRoot`, :86-130): one path-resolution and confinement
  policy shared by every surface. The clearest module boundary in the codebase.
- **`workflowRunner.ts`'s skeleton** — rows as durable checkpoints, re-entrant
  `tick()`, full DI (`RunnerDeps`), policy gates that re-derive verdicts in main
  and ignore step output. The step-kind ladder (§1e) is the only closed part.
- **The query layer** — centralized key/route factories in `shared/api.ts` with
  documented cache-poison-avoidance versioning, uniform options builders,
  disciplined `staleTime`.
- **Pure-model extraction + tests** — `layout.ts`'s `applyLayoutAction` reducer,
  `palette/model.ts`, `diff/model.ts`, `sources.ts`, `railOrder.ts`; defensive
  parsing (`normalizeLayout`, `isPaneId`) that tolerates schema evolution.
- **`harness.ts:82 respond()`** — one bridge-resolve/error-map helper replacing 18
  repeated handlers; the abstraction the rest of the server layer is missing.
- **Atomic re-mirror via `db.batch`** (`mirrorPr`, `refreshRepos`) — all-or-nothing
  upsert+prune+sync-bump so a mid-refresh failure leaves the prior mirror intact.
- **`ghError`/`ghGraphQLResult`** — a single, well-documented GitHub status
  taxonomy.
- **Auth/session design** — sealed stateless cookie, per-run `INTERNAL_TOKEN`
  rotation for agents, tokens never in the browser, `encryptSecret` at rest.
- **Type hygiene** — zero `as any`/`@ts-ignore` in production source; `ServerMsg`
  as a real discriminated union.
- **The capability accessor pattern** (`terminalApi()` returning `null` off
  desktop) — a clean degradation seam, even if the `if (!api)` guard repeats.

---

## Prioritized recommendations

Ordered by leverage per unit of effort.

| # | Change | Closes | Effort |
|---|--------|--------|--------|
| 1 | `satisfies` on every `c.json` mapper; add `ApiError` to `shared/api.ts` + one `respondError` helper | §3 server drift, error envelope | S |
| 2 | Extract `serveThenRevalidate()` + a cache-policy constants module; delete the duplicated `STALE_AFTER_MS` | §1c divergence | M |
| 3 | ~~Typed IPC contract module linking the preload/main/client channel copies~~ — **superseded by technology change #1** (collapse request/response IPC onto loopback HTTP + one WS for streams; keep only true Electron-ism residue), which closes §3's IPC drift structurally. The typed bus survives only as the fallback if that collapse stalls. | §3 IPC drift (the top risk) | M |
| 4 | Neutral `main/bootstrap.ts` composition root; wire bridges before the listener starts; add a `will-quit` teardown | §2 entirely | M |
| 5 | Pane registry (`id/label/order/shortcut/render`) driving `PANE_IDS`, shortcuts, switcher, `paneBody` | §1a | M |
| 6 | Require-user middleware on protected routers (delete the 56 inline guards); shared mirror-repo lookup helper | server boilerplate | S |
| 7 | Provider abstraction before integration #3 — this minimal `Provider` interface (`validate`/`fetchItems`/`fetchDetail`/`toIssue` + `forEachConnection`) is **subsumed by the fuller `IntegrationProviderContribution`** now specified normatively in [integrations.md](./integrations.md) (points §4.14); the "before integration #3" deadline stands (integrations §19) | §1b | M |
| 8 | Client shortcut registry owning bindings, conflicts, and the help screen | §4 shortcuts | M |
| 9 | Extract App.tsx restore/persist into an ordered `createStartupRestore()` composable; unify the prefs write-back protocol | §4 App.tsx | M |
| 10 | Step-handler registry in `workflowRunner`; explicit `joins:` reference | §1e | S |
| 11 | Route tests for `prActions`/`prCreate`/`harness` (the factories already make this cheap) | §6 | M |
| 12 | Child-row prune alongside the PR-list prune; use declared parent lineage as the cascade/prune/index source of truth | §5 rot | S |
| 13 | Collapse the notes/memory channel fork (one store API with provenance params, both channels call it) | §1d semantics | M |
| 14 | Retire the `Env`/`BLOBS` costume: `createApp(runtime)`, plain `readBlob/writeBlob` | §7 | M |

Items 1–5 are the structural core: contract enforcement, the sync abstraction, the
transport collapse (technology change #1, superseding #3), the composition root, and
the pane registry. Everything after is compounding hygiene.

One deliberate non-recommendation: do **not** add runtime validation (zod) across
the HTTP surface. This is a single-user loopback app; compile-time linkage made
mandatory (items 1, 3) is the right cost/benefit. Save runtime validation for the
two places data genuinely arrives untrusted: SQLite JSON blobs written by older
app versions, and anything an agent can send through the harness.

---

## Technology choices

Follow-up analysis (2026-07-07), Electron taken as fixed. The stack is current —
Electron 42, Vite 8, TS 6, zod 4, nothing rotting — and most choices are right.
The through-line: the riskiest tech exposure is not any library going stale; it
is the two places the app fights its platform (`<webview>`, dual-ABI natives)
and the one place it has three of something it needs one of (transports).

### Changes to make, ranked

**1. Collapse the three transports toward one — move the IPC surface onto the
loopback server, WebSocket for streams.** Almost everything on Electron IPC is
request/response that could be plain HTTP routes on the Hono server already
running in the same process. The only thing that genuinely needs a streaming
channel is PTY output (`term:out:<id>`), and a WebSocket on the loopback origin
covers it — same-origin cookie auth works unchanged. Gains: one auth story, one
typed contract seam instead of three (§3's worst drift surface disappears
structurally rather than by discipline), a preload that shrinks to almost
nothing, `dev:node` browser mode approaching full functionality, and the plugin
model's "main parts" mostly becoming "server parts" — the agent-tool projection
in [contribution-points.md](./contribution-points.md) §4.8 gets its transport for free.
Trade-offs to respect: PTY output needs explicit flow control over WS (xterm has
a standard pattern; IPC currently gives backpressure semi-for-free), and a
minimal IPC residue stays for true Electron-isms (dialogs, `browser.bind`'s
webContents IDs). This is now the executed path (it supersedes recommendation
#3's typed-IPC bus) — [implementation.md](./implementation.md) Phase 3. Two
docs add conditions this analysis didn't carry: the post-collapse threat model
([security.md](./security.md) §3 — every migrated route behind `requireUser`,
WS upgrade must verify Host + session cookie + exact loopback `Origin`, PTY
input treated as a privileged write), and the requirement that a perf baseline
land first so Phase 3's "no regression under a busy TUI" is verifiable, with the
WS coalescing reframed as a throughput win ([performance.md](./performance.md)
§3.3).

**2. Migrate the preview pane from the `<webview>` tag to `WebContentsView`.**
Electron's docs have discouraged the `webview` tag for years (guest-view
internals, explicitly subject to change/removal) — and the code is already
fighting it: the body-parented `previewWebviews` Map, the position-over-host-rect
dance, and the three-call-site eviction obligation all exist because a
DOM-embedded guest dies with its DOM node. `WebContentsView` is main-owned and
bounds-managed — surviving pane switches is its natural behavior, not a hack —
and it composes directly with `browserService.ts`'s CDP binding. This is the one
place the app is built on an API with a stated deprecation trajectory.
Scheduled for [implementation.md](./implementation.md) Phase 9, paired with
Phase 5's `keepAlive` pane slot (whichever lands second gets simpler).

**3. Plan the exit from better-sqlite3 to `node:sqlite`.** The ABI
double-rebuild dance is the most-documented gotcha in the repo, and
better-sqlite3 is the module that needs *both* ABIs (Electron for the app, Node
for tests/`dev:node`/migrate). Electron 42's bundled Node ships `node:sqlite`
stable; a built-in kills half the native-module problem outright. Verify first:
Drizzle's `node:sqlite` driver maturity, FTS5 availability in the bundled build
(the memory index depends on it), and the `db.batch`/transaction semantics the
mirror writes rely on. node-pty has no non-native alternative, so the dance
doesn't fully die — but two dual-ABI natives becoming one is a real reduction.
Decided as **spike-first** ([implementation.md](./implementation.md) Phase 9):
a time-boxed PR proves the driver/FTS5/`db.batch` questions before any
migration; any one failing parks it.

**4. Secrets: Electron `safeStorage`, not keytar, for the planned packaged-build
keychain work.** keytar is archived/unmaintained; `safeStorage` is built in and
needs no native rebuild. **Decided** — built when packaging matters, with
`SESSION_ENC_KEY` moving first ([implementation.md](./implementation.md) Phase 9;
[security.md](./security.md) §6).

### Keep, with eyes open

- **SolidJS — keep, but keep the framework surface thin.** The right runtime
  model for this workload: fine-grained reactivity with no VDOM churn under live
  terminals and virtualized diffs. The risks are ecosystem-shaped — second-tier
  TanStack/tooling support, no component library (hand-rolling costs little given
  the flat design language), and, genuinely relevant for an agent-workspace
  product built with agents, LLMs write React more reliably than Solid (the
  destructured-props and effect-semantics traps). The mitigation is already
  half-built: the pure-model discipline (`layout.ts`, `diff/model.ts`,
  `palette/model.ts`). Keep pushing logic out of components and the framework
  stays a thin view layer. A migration would never pay for itself; the
  discipline does.
- **Hono + loopback HTTP — keep; it's the load-bearing asset** and the reason
  change #1 is possible. Optional consideration: Hono's RPC client (`hc`) would
  make the server↔client contract structural instead of opt-in `satisfies`, at
  the cost of constraining route-authoring style (chained definitions). Reach
  for it only if the mandatory-`satisfies` convention (recommendation #1 above)
  proves leaky in practice.
- **Monaco — keep.** CodeMirror 6 is lighter and more modular, but that would
  mean running two editors (Monaco's SQL support and model/marker APIs do real
  work in the database pane), and bundle weight is a non-issue in a desktop app.
- **xterm.js — keep, and adopt `@xterm/addon-serialize` with a headless
  terminal for attach-replay.** Cashes in the TODO already in `terminal.ts`: the
  raw ring-buffer + Ctrl-L repaint nudge is the known-lossy hack and this is the
  standard fix. Load-bearing for agent TUI panes — the highest-value small tech
  adoption on this list.
- **tmux as the durability backend — keep.** Unusual but earning its keep
  (sessions survive app restarts with zero custom daemon code). Costs an
  external binary and macOS/Linux coupling — fine for a personal macOS app;
  first thing to revisit if Windows ever matters.
- **Turborepo — neutral hold.** One app in the workspace means turbo adds
  nothing today, but if the plugin architecture lands and plugins become
  workspace packages, the task graph starts paying rent.
- **Drizzle + SQLite, TanStack Query + IndexedDB persistence, jose, smol-toml,
  pg, shiki, idb-keyval** — all fine, all current, no action.

### Gaps where there is no tech at all

- **E2E testing:** the riskiest untestable surface (§6 — the App.tsx restore
  choreography, the IPC wiring) is exactly what unit tests can't reach.
  Playwright's Electron driver is the standard answer and the only meaningful
  new dev-dependency worth adding. *Now planned* as a five-test smoke suite
  (S1–S5) gating Phases 3/5/6 — [testing.md](./testing.md) §1.
- **Observability:** `console.error` into the void (§21 in the server findings).
  Not pino-scale — JSON lines to a file under `userData` with a settings-pane
  tail would do — but *some* persistent log matters for an app whose failure
  mode is "background refresh silently stopped." *Now scoped* as the
  observability track ([performance.md](./performance.md) §3.1 baseline marks;
  [security.md](./security.md) §6 — log route + status + timing, never request
  bodies or headers).
- **Auto-update:** electron-builder is fine; add electron-updater + notarization
  only when distribution beyond one machine becomes real. Not before.
