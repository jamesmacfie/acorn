# Implementation guide — the extensibility work

**Status:** execution plan · **Sources:** [review.md](./review.md) (findings + prioritized
recommendations + technology choices) and [extensability.md](./extensability.md) (the plugin-platform
target and its §9 order of operations).

This doc turns those two documents into a build order. It does not restate their arguments — read
them first. Each phase below is **independently shippable**, leaves the app working, and is worth
doing even if the phases after it never happen. Citations like *(review #3)* refer to review.md's
recommendation table; *(ext §4.8)* to extensability.md sections.

## Decisions this guide bakes in

Three places the source docs offer alternatives; the choices here are made once so phases don't
re-litigate them:

1. **Transport: collapse to loopback HTTP + WebSocket, not a typed-IPC bus.** review.md offers both
   a typed IPC contract module (#3) and, in its technology section, moving the IPC surface onto the
   Hono server with a WS for PTY streams. Building the typed bus first would create an artifact the
   transport collapse then deletes. So: migrate request/response IPC to HTTP routes typed through
   `shared/api.ts` (the contract seam that already exists), add one WS for PTY output, and keep a
   *minimal* hand-typed IPC residue for true Electron-isms (dialogs, webContents binding). The typed
   IPC module is the fallback only if the transport collapse stalls.
2. **No runtime validation across the HTTP surface.** Per review.md's deliberate non-recommendation:
   compile-time linkage made mandatory (`satisfies`, shared types) is the right level for a
   single-user loopback app. zod stays at the two genuinely untrusted boundaries — SQLite JSON blobs
   written by older versions, and agent-supplied harness/tool inputs.
3. **Registries before foldering.** Every extension seam is opened in place (registries, event bus,
   projections) while features stay statically imported; the `core/` + `plugins/` folder move
   (ext §9 step 7) is the *last* step, when it degenerates to `git mv` plus lint rules.

---

## Phase 0 — Contract hygiene (small, mechanical, do first)

*(review #1, #6 — closes the server-drift half of review §3)*

- Add `satisfies Pull` / `PullDetail` / … to every `c.json` mapper, starting with the unchecked
  high-traffic ones: `toPublic` (`server/routes/pulls.ts`), `toPublicPull`/`readComposite`
  (`server/github/prMirror.ts`), `me.ts`.
- Add `ApiError` to `shared/api.ts` and one `respondError(c, status, code, detail?)` helper; sweep
  the ~191 ad-hoc `c.json({ error })` shapes onto it. Stop leaking GitHub's raw 422 prose
  (`prCreate.ts`) into fields that elsewhere carry machine codes.
- Add `requireUser` middleware on protected routers; delete the ~56 inline session guards. Add the
  shared mirror-repo lookup helper while in there.

**Done when:** a field added to a shared response type fails `pnpm lint` in every mapper that omits
it; all error responses share one shape. **Verify:** `pnpm lint`, `pnpm test`, plus new route tests
for one migrated router proving the envelope.

## Phase 1 — Composition root + lifecycle

*(review #4, review §2 — the precondition for everything that registers anything)*

- Create `main/bootstrap.ts`: build DB → construct each domain service (terminal, worktrees,
  knowledge, runtime, workflows, database) → install harness/context bridges → **then** start the
  HTTP listener. This kills the boot window where `/api/tasks/:id/notes` 503s.
- Shrink `terminal.ts` to the PTY engine: move the registration of knowledge/run/local-git/database
  IPC and tmux/worktree/workflow reconciliation out of `registerTerminalIpc` into the root.
- One coordinated `reconcile()` step: tmux resurrect, worktree prune, workflow resume run from the
  root, in order, in one place (ext §3.2's boot-time recovery).
- Add `will-quit` teardown: end pg pools (`main/database.ts`), clear the idle-watch interval,
  dispose anything the root constructed. Today there is no shutdown path at all.

**Done when:** `electron.ts` calls `bootstrap()` once; `terminal.ts` no longer imports the other
domains; quit runs a teardown you can log. **Verify:** launch, use a task end-to-end, quit cleanly;
grep proves no `set*Bridge` call happens after the listener starts.

## Phase 2 — The sync engine

*(review #2, ext §4.9 — the highest-leverage server refactor)*

- Extract `serveThenRevalidate(c, { resource, ttl, etag?, read, refresh })` owning the four-branch
  state machine (fresh-serve / stale-serve-and-refresh / cold-block / backoff) and `sync_state`
  bookkeeping.
- One cache-policy module holding every TTL constant; delete the duplicated `STALE_AFTER_MS`
  (`prMirror.ts` vs `pulls.ts`).
- Port the five divergent copies: `pulls.ts`, `pullDetail.ts`, `pullFiles.ts`, `repos.ts`, then the
  linear/rollbar variants. Unify the three cold-detection idioms. Add ETag revalidation to the
  repos list while porting it (free rate-limit savings noted in review §1c).

**Done when:** no route hand-implements serve-then-revalidate; TTLs are greppable data. **Verify:**
existing route tests + new engine unit tests (fresh/stale/cold/not-modified paths); manual check
that PR list, detail, files, and repos still background-refresh.

## Phase 3 — Transport collapse (IPC → HTTP + WS)

*(review technology change #1; supersedes review #3 per decision 1)*

- Inventory the ~69 `ipcMain.handle` channels. Classify: request/response (→ HTTP route on the
  loopback Hono server, typed in `shared/api.ts`), stream (PTY output only → one WebSocket), true
  Electron-ism (stays IPC: dialogs, `browser.bind` webContents IDs).
- Migrate domain by domain — editor, search, local-git, knowledge, run, database — each PR moving
  one domain's channels to routes and deleting its preload block and hand-declared client interface
  (`terminalClient.ts` siblings). Same-origin cookie auth applies unchanged.
- PTY: one WS endpoint carrying `term:out` frames with explicit flow control (xterm's standard
  pattern); attach/resize/kill become routes.
- End state: `preload.ts` shrinks to the Electron-ism residue; `dev:node` browser mode approaches
  full functionality (a good smoke test of the migration's completeness).

**Done when:** preload exposes only Electron-isms; every former channel has a typed route; the
terminal streams over WS with no visible regression under a busy TUI. **Verify:** `pnpm lint`,
`pnpm test`, then a live pass per docs/pg.md-style smoke tests for each migrated pane, plus
`dev:node` in a browser exercising whatever no longer needs Electron.

## Phase 4 — Agent-tool projection (the keystone)

*(ext §4.8, review #13, review §1d — depends on Phases 1 and 3)*

- Define `AgentToolContribution` — `{ name, description, input: zod, scope, when?, handler }` — and
  the projection: each declaration becomes an MCP tool (schema from `input`, availability
  re-evaluated with `tools/list_changed`, un-freezing the connect-time `hasRunTargets` snapshot), a
  harness HTTP route (`INTERNAL_TOKEN` auth, the `respond()` envelope), and optionally a typed
  renderer client method.
- Port notes / memory / run / browser tools onto it. This deletes `harnessWiring.ts`, the bridge
  setters in `harness.ts`, the per-tool bodies in `mcp/server.ts`, and the matching
  preload/`knowledgeIpc.ts` groups.
- Collapse the notes-channel semantic fork while porting: one store API where provenance
  (`author`, `sessionId`) comes from the channel's `scope`, so agent-created and UI-created notes
  can't drift again.
- Decide and state the loopback rule at the seam: tools call the app over HTTP except where the
  handler is explicitly marked in-process (today's `git_log`/`local_changes`/`local_diff`).

**Done when:** adding one agent verb is one object in one file, reachable via MCP, harness HTTP,
and (if exposed) the renderer. **Verify:** existing MCP tools listed identically before/after
(minus the availability fix); a harness route test per projected tool; a live agent session
exercising notes + run tools.

## Phase 5 — Client registries

*(review #5, #8; ext §9 step 1, §4.1/§4.3/§4.4/§4.6 — the biggest UX-side seam opening)*

- **Pane registry** `{ id, label, glyph, order, defaultChord, when?, component, keepAlive? }`
  driving `PANE_IDS`, `PANE_LABELS`, `PANE_ORDER`, the shortcut defaults, the switcher buttons, and
  `paneBody()`. Unknown persisted ids stay inert (generalize `isPaneId`). Fix the one contract
  breaker while here: the `pr` pane must take `{ task }` and stop reading `useParams()`
  (review §1a).
- **Command registry** feeding ⌘K: the hardcoded action list becomes contributions; run targets /
  recipes / workflows become palette item providers.
- **Keybinding registry** owning registration, conflict detection (replacing `RESERVED_CHORDS` +
  prose coordination), user remapping, and the help screen — the help renders the registry, so it
  cannot lie. Collapse the ten scattered `window` keydown listeners into one dispatcher.
- **Settings-page registry** replacing the `TABS` list in `SettingsModal.tsx`.
- **Client event bus** (`ctx.events` shape from ext §5): `task:archived` etc.; convert the three
  `evictPreviewWebview` call sites and the `pendingTerminalFocus` / `FILE_SCROLL_EVENT` mailboxes
  into subscriptions / `openPane(id, intent)`.

**Done when:** adding a pane is one file plus one registration line — prove it by re-adding
`search` or `database` as a registration; the help screen and palette derive from registries.
**Verify:** `pnpm lint`, `pnpm test` (the pure models keep their tests), a keyboard walkthrough of
every chord and palette row.

## Phase 6 — Startup restore pipeline

*(review #9; ext §8.3 — named the single riskiest piece; do it as its own phase, not as a side
effect of Phase 5)*

- Extract `createStartupRestore()` owning hydrate-then-persist with **explicit ordered phases**
  (`workspace` → `view` → `panes`), replacing App.tsx's effect-order/`defer`/`isRestoring()`
  choreography. Slices register into a phase; persistence arms only after `boot:restored`.
- Unify the two contradictory prefs write-back protocols (App's skip-invalidation vs
  TabRail/DiffView's invalidate) into one, and centralize the ~22 bare pref-key strings into a
  `PrefKeys` const.
- Port App.tsx slice by slice (theme, workspace restore, repo/path restore, task focus, the five
  hydrations, the seven persist effects); App.tsx ends as shell + composition.

**Done when:** App.tsx has no free-standing restore/persist effects; restore order is data, not
effect timing. **Verify:** relaunch restores last workspace/task/source/layout/editor tabs exactly
as before; kill-during-boot leaves prefs unclobbered (the race the guards existed for).

## Phase 7 — Providers and source contributions

*(review #7; ext §4.2 — the "before integration #3" deadline)*

- `Provider` interface (`validate(token)`, `fetchItems`, `fetchDetail`, `toIssue`) + one
  `forEachConnection` helper replacing the six hand-rolled decrypt-try-skip loops; express Linear
  and Rollbar as providers; the `integrations.ts` if-else becomes registry lookup.
- Source contributions (`ctx.sources.register`) replacing `SOURCE_IDS`/`availableSources`/the
  per-source `<Match>` in App.tsx/`ORIGIN_GLYPH`; issue reads become Phase-2 sync descriptors.
- Per-plugin codecs for `issues.data` blobs (decision 2's untrusted boundary): parse + validate at
  the read seam instead of `as LinearIssueDetail`.

**Done when:** the litmus test from ext §9 — a Sentry integration (source + pane + context section
+ linkifier) touches zero core files. Build it as the proof if there's appetite; otherwise dry-run
the file list. **Verify:** Linear + Rollbar connect/browse/pane/promote flows unchanged live.

## Phase 8 — Workflow and profile registries

*(review #10; ext §4.10, §4.11)*

- `Map<kind, StepHandler>` registry in `workflowRunner.ts` replacing the `executeStep` ladder;
  policy registry replacing the one-case `evaluatePolicy` switch (`checks-green` registered by the
  GitHub side — the layering ext §4.10 calls out). Replace `runJoin`'s nearest-preceding-fan-out
  index scan with an explicit `joins:` reference; unknown kinds/references surface as parse errors.
- Agent-profile contributions (`command`, `backendPreference`, `mcpRegistration`, `headlessArgv`,
  `resumeArgv`, `streamJson`) replacing `BUILTIN_PROFILES`, `PROFILE_MCP_FLAVOUR`, and the
  per-agent branches in `headless.ts` / `agents/model.ts`. Adding an agent = one small module.

**Verify:** existing workflow runner tests keep passing; a TOML workflow using every step kind runs
end-to-end; each profile still spawns/resumes/registers MCP.

## Phase 9 — Platform migrations

*(review technology changes #2–#4 — independent of the phases above; schedule opportunistically)*

- **`<webview>` → `WebContentsView`** for the preview pane: main-owned, bounds-managed, survives
  pane switches natively; composes with `browserService.ts`'s CDP binding. Pairs well with Phase 5's
  `keepAlive` slot (ext §8.2) — whichever lands second gets simpler.
- **better-sqlite3 → `node:sqlite`**, killing half the dual-ABI dance. Verify first, in a spike:
  Drizzle driver maturity, FTS5 in Electron's bundled build (the memory index needs it), and
  `db.batch`/transaction atomicity the mirror writes rely on. node-pty keeps the rebuild scripts
  alive regardless — this reduces, not removes.
- **`safeStorage` (not keytar)** for the planned keychain work — decided now, built when packaging
  matters.

## Phase 10 — Foldering

*(ext §9 step 7 — only after the seams exist)*

- `git mv` into `core/` + `plugins/` per ext §6's assembled layout; add lint rules: no
  plugin→plugin internal imports, no core→plugin imports; cross-plugin extension only through
  declared contribution points.

## Ongoing tracks (no phase gate)

- **Tests where the risk is** *(review #11, §6)*: route tests for `prActions`/`prCreate`/`harness`
  (the factories make them cheap); split IPC/route handler bodies from registration so main-process
  logic is testable without Electron; adopt Playwright's Electron driver for the restore
  choreography and terminal smoke tests — the one new dev-dependency worth taking.
- **Data-model hygiene** *(review #12, §5)*: prune the nine child tables alongside the PR-list
  prune; decide FK-vs-cascade-helper once and write it down.
- **Deduplication** *(review §7)*: one `atomicWrite`, one frontmatter parser, one
  last-stdout-line helper, one user-script execution policy; retire the `Env`/`BLOBS` Workers
  costume (`createApp(runtime)`, plain `readBlob`/`writeBlob`) *(review #14)*.
- **Observability**: JSON-lines log under `userData` with a settings-pane tail — the failure mode
  worth catching is "background refresh silently stopped".

## Sequencing summary

Phases 0–2 are pure wins with no design risk — start immediately, any order. Phase 3 unlocks
Phase 4; Phase 5 unlocks 6–8; Phase 9 is parallel; Phase 10 is last. If only three things ever
ship, ship 0, 1, and 2 — they close the highest-severity findings (review §§1c, 2, 3-server) while
staying invisible to the UI. The overall litmus test is unchanged from ext §9: a new integration or
a fourth agent profile touches zero core files.
