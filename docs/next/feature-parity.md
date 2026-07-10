# Feature parity — the behavioural contracts the changeover must preserve

**Status:** proof obligation · **Date:** 2026-07-07 · **Companions:**
[extensibility.md](./extensibility.md) §7 (the coarse map this refines),
[implementation.md](./implementation.md) (the phases that verify these rows),
[testing.md](./testing.md) (how each contract is checked)

The parity map in [extensibility.md](./extensibility.md) §7 answers "does every
feature have a home". It is deliberately coarse — feature names to plugins.
That granularity is not enough to *protect* parity during a rewrite: "the
github plugin owns PR review" can pass review while dropping PR inheritance,
or the same-file re-scroll behaviour, or the closed-PR paged proxy. The shipped
app relies on small contracts at the joins between workspaces, tasks, panes,
bridges, local files, provider caches, and agent context.

This doc is the fine-grained proof obligation: **one checkbox per shipped
behaviour**, grouped by domain, each section naming its owner (plugin/core),
the phase(s) that move it, and how it is verified. "100% feature parity" means
preserving both the visible feature and the operational contract around it.

Rules of use:

- **The changeover does not begin until every row below is either owned or
  explicitly struck through as a non-goal** (with a dated one-line reason).
- **A phase PR that moves a domain re-verifies that domain's section** and
  ticks the rows it preserved — same discipline as
  [inventories.md](./inventories.md).
- The smoke suite ([testing.md](./testing.md) §1) is *not* this proof: it
  guards boot/restore/terminal/pane mechanics. Each section names its own
  verification method — live check, route test, unit test, or conformance
  suite.
- Citation form elsewhere in docs/next: *(parity §N)*.

## §1 Domain index

| § | Domain | Owner | Moved by (phases) | Verified by |
| --- | --- | --- | --- | --- |
| 2 | Workspace & task lifecycle | core | 5, 6, 7 | route tests + live matrix |
| 3 | Repo config & worktree lifecycle | core (config loader) | 8 + trust-gate track | unit tests + live |
| 4 | GitHub PR review | github | 2, 3, 5, 7 | route tests + live |
| 5 | Diff rendering performance | github | 5, 10 + decomposition track | marks + live on a large PR |
| 6 | Linear & Rollbar providers | linear / rollbar | 7 | provider regression tests |
| 7 | Database pane | database | 3 | route tests incl. security |
| 8 | MCP settings & registration | core + profiles-* | 3, 4 | live + `mcpRegister` tests |
| 9 | Terminal & agent sessions | terminal / agents | 3, 8 | smoke S4 + live TUI pass |
| 10 | Notes & memory boundary | notes / memory | 4 | conformance + route tests |
| 11 | Context assembly | context + contributors | 4 | route tests + live |
| 12 | Settings surfaces | core + plugins | 5 | live walkthrough per page |
| 13 | Preview / browser | preview | 9 | visual + agent-tool check |
| 14 | Editor, search & local git | editor / changes | 3 | route tests incl. security |
| 15 | Notifications & unread | core + contributors | 5 | live + unit tests |
| 16 | Auth & error vocabulary | core | 0, 3 | route tests |
| 17 | Degraded browser mode | core (capabilities) | 3 | `dev:node` pass |
| 18 | Dev / build / package | — (operational) | 9, 10 | script runs per README |

Data retention parity (what is never deleted automatically) lives in
[state-and-policies.md](./state-and-policies.md) §5.2 — it is a policy, not a
feature, but it gates the same changeover.

---

## §2 Workspace & task lifecycle contract

Owner: **core**. Moved by Phases 5 (will-phase), 6 (restore/prefs), 7
(source registry). Verified by: workspace/task route tests + a live matrix
pass over create/ignore/delete/promote/archive.

- [ ] **Ignored repos keep their `workspace_repos` membership.** They are
  excluded from the main UI, still visible in onboarding/settings, and skipped
  by Default-workspace bootstrap. A provider/source registry must not treat
  "ignored" as "unassigned" and must never delete the mapping.
- [ ] **Deleting a non-default workspace reassigns its repos to Default and
  drops its `workspace_projects` rows. Deleting Default is forbidden** — a
  route-level invariant (test it), and a will-phase case once Phase 5 lands.
- [ ] **Workspace selection is derived from the current repo.** There is no
  selected-workspace URL/state dimension. Plugin source browsing must preserve
  this derivation — especially Linear project browsing and Rollbar task
  promotion, which navigate across repos.
- [x] **`rail_order` is view state, deliberately separate from `tasks.sort`**
  (`railOrder.ts` — sort once derived dev-server ports). Phase 6 keeps
  `tasks.sort` as the server-side seed and `rail_order` as the user's
  arrangement, including the pin partition behaviour (pinned tasks order
  independently of unpinned).
- [ ] **First-activation pane defaults are behavioural**: a task with a PR
  opens `pr`; a PR-less task with Linear links opens `linear`; explicit
  promotion from a source can force a pane. Source contributions declare
  `defaultPane` ([contribution-points.md](./contribution-points.md) §4.2), but
  activation keeps this fallback ladder for tasks with no promoting source.
- [ ] **Local-first branch defaults**: branch name is slug-derived with
  dedupe suffixing until the user edits it; a user-edited branch is never
  regenerated. Worktree creation resolves the base ref as: pref
  `base_ref:<owner>/<repo>` → `origin/main` → `origin/master` → HEAD
  (`worktrees.ts:37`, `taskWorktree.ts:39-41`).
- [ ] **PR inheritance**: on a real open-PR list refresh, active tasks for
  that repo with a matching head branch and no `pullNumber` adopt the PR
  (`routes/pulls.ts:118-139`). This lives *inside the pulls mirror refresh* —
  when GitHub becomes a mirrored-resource descriptor (Phase 7), the descriptor's
  `persist` step keeps this side effect. Also stated in §4.
- [ ] **Archive semantics are layered**: the desktop path does guarded
  worktree teardown (dirty-check, session kill); the bridge-absent browser
  path is a plain status flip. Archive stamps `archivedAt` and keeps the row.
  The Phase 5 will-phase dialog informs the decision but must not collapse
  these two execution paths into one.

## §3 Repo config & worktree lifecycle contract

Owner: **core (run-config loader + worktree service)**. Moved by Phase 8
adjacency + the trust-gate track. Verified by: `runConfig`/`worktrees` unit
tests + a live worktree-creation pass.

The trust gate ([security.md](./security.md) §5) covers every *executable*
repo-layer command. Parity additionally requires the **non-executable** config
behaviour below — if Phase 8 lands the gate without this contract, worktree
creation and layout recipes can regress while run buttons still look correct.

- [ ] **Layer precedence**: repo `.acorn/config.toml` → user
  `~/.acorn/config.toml` → `repo_paths.runTargets` (DB) → workspace script
  fallbacks. Repo wins over user; user wins over DB. The DB fallback includes
  the workspace `devScript` as a base `dev` target.
- [ ] **Parse errors are visible**, surfaced as palette/config-error rows —
  malformed files are never silently ignored.
- [ ] **`[layout.<id>]` recipes** seed panes, start run targets, and set the
  preview browser URL.
- [ ] **`copy = [...]`** carries gitignored files from the source checkout
  into a newly created worktree; rejects absolute/traversal entries; skips
  missing files with warnings; never overwrites existing targets
  (`runConfig.ts:112-130`).
- [ ] **Setup/archive scripts exist in both repo/user config and the
  workspace DB fallbacks.** Setup runs only once, on fresh worktree creation,
  controlled by `setupScriptTrigger` (`'off' | 'created' | 'terminal'`,
  null → `'terminal'` — `schema.ts:279`).
- [ ] **Preview home URL priority**: recipe `browser = "run:<id>"` → default
  run target URL → workspace preview config → dev-server fallback. (Consumed
  by §13.)

## §4 GitHub plugin contract

Owner: **github plugin**. Moved by Phases 2 (sync engine), 3 (routes), 5
(pane registry), 7 (descriptors). Verified by: route tests (fetch-stubbed) +
a live PR-review pass. This is where broad "pane contribution" language is
most likely to hide parity loss; pin each row in the plugin spec and tests.

**Lists and detail:**

- [ ] Open PR list is **mirrored and ETag-revalidated**; the closed PR list is
  a **paged proxy** — a different cache path, not the mirror. The two must not
  be unified by accident during descriptor extraction.
- [ ] PR detail is a **GraphQL composite plus REST files**; the
  files/patch/blob-body fallback chain and immutable SHA-keyed blob caching
  survive the sync-engine extraction.
- [ ] Batch prefetch (`pullsBatch`) keeps its per-resource freshness
  decisions.
- [ ] Labels and `mentions` support stay — `mentions` feeds @mention
  autocomplete in diff comment composers.
- [ ] Viewed-file state is app state (T2), not mirror state, and survives PR
  child pruning (retention: [state-and-policies.md](./state-and-policies.md)
  §5.2).

**Mutations and their mirror behaviour** (each mutation's mirror effect is
part of its contract — test them individually):

- [ ] Some mutations update mirror rows directly; some bust the PR's
  `sync_state`; create-PR busts open-pulls state; rerun-failed has **no**
  mirror update. Enumerate these in the plugin spec; don't collapse them to
  one invalidation policy.
- [ ] **`nodeId` absence produces the current conflict behaviour** for
  GraphQL-only mutations (auto-merge, draft toggle) — the `node_id_unknown`
  machine code survives the `ApiError` sweep (§16).
- [ ] Create-PR keeps the compare preview (branches/commits ahead view).

**In-pane behaviours:**

- [ ] **`ChecksPanel` is an overlay inside PR review, not a pane.** Job logs
  use the signed-redirect fetch *without* GitHub auth headers.
- [ ] Linear links in PR content are **URL-scanned** (`linear.app` URLs only)
  and open the issue panel; bare `ENG-123` matching is intentionally not
  shipped (also §6).
- [ ] The file list, the `?file=` param, and the explicit file-scroll event
  let **re-selecting an already-active file scroll again**. Whatever replaces
  the `FILE_SCROLL_EVENT` mailbox (`openPane(id, intent)` or the event bus —
  Phase 5) must preserve "same target still acts".
- [x] PullDetail's collapsible-section state lives in `localStorage`
  (`PullDetail.tsx:42-49`), outside the prefs model — as do comment drafts
  (`comments/draftState.ts`). Phase 6's audit classifies each as T3/T4 or
  deliberately leaves it in localStorage; either is fine, but it is a recorded
  decision, not an accident.
- [ ] **PR inheritance** (§2) is part of this plugin's mirror-refresh
  contract.

## §5 Diff rendering performance contract

Owner: **github plugin**. At risk from Phase 5 (pane split), Phase 10
(foldering), and the component-decomposition track. Verified by: the
[performance.md](./performance.md) §2 marks + a live pass on a 100+ file PR.

The diff pipeline is the best-engineered path in the app
([performance.md](./performance.md) §1.7); it has a *performance* contract,
not just a UI contract. A "pure model + thin view" refactor can preserve
screenshots while regressing responsiveness. Preserve exactly:

- [ ] Shiki **dual-theme tokenization with hard patch-size cutoffs**
  (`HIGHLIGHT_MAX_PATCH_CHARS`/`_LINES`) and the plain-tokenizer fallback.
- [ ] **Idle hydration**: batch size, idle/yield timing, visible-file
  prioritisation, and the generation/abort guards re-checked after every
  await.
- [ ] **Separate unified and split virtualizers** with rAF-batched
  measurement.
- [ ] **Row identity key stability** across hydration, gap expansion, and
  thread changes — remeasure churn is the regression this prevents.
- [ ] **Thread edits rerender without reparsing files.**
- [ ] **Gap expansion fetches the immutable head blob by `sha`** (cache-safe
  by construction).
- [ ] **Split-mode band construction stays cold while unified mode is
  active.**

## §6 Integration provider contracts (Linear, Rollbar)

Owner: **linear / rollbar plugins**. Moved by Phase 7. Verified by:
**provider-specific regression tests that land before the Sentry dry run** —
the dry-run file list proves extensibility; these tests prove the two shipped
providers still behave exactly as before. (Contract obedience — codecs,
stamped provider ids, lifecycle, capability obligations — is the separate
integration conformance suite, [integrations.md](./integrations.md) §18;
this section is only the behaviours the generic contract doesn't express.)

**Linear:**

- [ ] Multi-connection identifier resolution is **first-hit-wins for bare
  IDs**; project browsing carries an explicit `integrationId`.
- [ ] **Project links are workspace-scoped, not repo-scoped**; one workspace
  may link projects from several Linear connections.
- [ ] Project browse lists **active issues only**; branch defaults use
  `LinearProjectIssue.branchName` where present (feeding §2's branch ladder).
- [ ] `POST /issues/:identifier/comments` supports **threaded replies via
  `parentId`**.
- [ ] Markdown rendering stays **XSS-safe with validated links** (a security
  behaviour, not a rendering nicety).
- [ ] PR linkification scans **`linear.app` URLs only** (see §4).

**Rollbar:**

- [ ] Recent items are cached into the generic `issues` table, and **stale
  cached rows beat nothing** when a live call fails.
- [ ] Item identity is the **visible counter string**, not an internal id.
- [ ] Promotion prompts for repo and branch; **attaching to the current task
  via `+task` is a core flow**, not an optional nicety.

## §7 Database pane contract

Owner: **database plugin**. Moved by Phase 3 (IPC → HTTP). Verified by:
route tests **including security tests** — this surface runs SQL and mutates
databases; when its 9 IPC channels become HTTP routes it is a high-risk route
set, not transport bookkeeping.

- [ ] **Connection URL resolution**: workspace `dbUrlScript` → worktree `.env`
  `DATABASE_URL` → `process.env.DATABASE_URL`. The URL is **never
  persisted**.
- [ ] **One `pg.Pool` per task, keyed by task id** (`database.ts:25`);
  disconnected on pane cleanup/reconnect; ended on quit (Phase 1's teardown).
- [ ] Table browsing **excludes system schemas, caps rows at 500**
  (`ROW_CAP`, `database.ts:27`), orders by primary key when available, and
  reports total count.
- [ ] Generated update/insert/delete SQL **validates identifiers against the
  introspected schema and parameterizes values**; the SQL editor's arbitrary
  queries intentionally run verbatim (`Cmd/Ctrl+Enter` to run).
- [ ] The UI surface is the combined table browser + result grid + row detail
  editor + insert/delete + Monaco SQL editor — one pane, all five.

Phase 3 route tests for this domain: 401 without session, malformed-body
rejection on every mutating route, and an assertion that generated SQL
identifier validation rejects a non-introspected identifier.

## §8 MCP settings & registration contract

Owner: **core (tool projection) + profiles-\* (registration flavour) + the
MCP settings page**. Moved by Phases 3 (`mcp:*` channels) and 4 (projection).
Verified by: existing `mcpRegister` tests + a live inspect/register pass.

Phase 4's tool projection must not absorb all MCP attention and leave the
settings/inspection surface behind — it is a distinct settings-page
contribution (§12) and part of Phase 3's channel checklist
(*inv §1a* `mcp:inspect`, `mcp:createStarter`).

- [ ] Settings → MCP inspects **`.mcp.json`, `.cursor/mcp.json`, and
  `~/.claude.json` only** — a deliberate closed list.
- [ ] The inspector **parses multiple server shapes** and surfaces invalid
  JSON as visible rows, not silence.
- [ ] **Secret masking happens before data crosses to the renderer.**
- [ ] `createStarter(taskId)` seeds a starter `.mcp.json` in the task
  worktree.
- [ ] Register/unregister buttons **call agent CLIs**; acorn does not edit
  agent config files directly.
- [ ] **Auto-registration** happens when Claude/Codex terminal sessions
  launch.
- [ ] Packaged and unpackaged registration names differ (`acorn` vs
  `acorn-dev`), and **`ACORN_MCP_NAME`** makes the stdio server self-report
  the launched registration name (`mcp/server.ts:32`, pinned by
  `mcpRegister.test.ts`).

## §9 Terminal & agent session contract

Owner: **terminal / agents plugins + PTY core**. Moved by Phases 3 (WS) and 8
(profiles). Verified by: smoke S4, a live busy-TUI pass, and unit tests on
`sendToAgent`/edge detection. [agent-runtime.md](./agent-runtime.md) adds
runtime *controls*; nothing there relaxes these existing operational
contracts.

- [ ] **`node-pty` shell sessions die with the app; tmux-backed agent
  sessions survive restart** and are reconciled from `terminal_sessions` at
  boot.
- [ ] **tmux absence degrades profile availability with a visible hint**;
  missing agent commands disable their launch rows (never hidden silently).
- [ ] **Terminal output is not persisted** — attach replay comes from the
  in-memory ring only. If `@xterm/addon-serialize` is ever adopted, the
  privacy/retention contract stays "no terminal output on disk".
- [ ] **Shift+Enter maps to a bare newline** for Claude-style multiline
  input.
- [ ] **`sendToAgent` has three modes**: `now`, `after-ready`, `draft`.
  `after-ready` queues until the busy→idle edge and clears on session exit.
  Payloads are bracketed-paste wrapped; embedded paste-end markers are
  stripped from the payload.
- [ ] The **agent state vocabulary is shared** (`working`, `idle`, `blocked`,
  `done`, …) and its current heuristic ceilings are accepted — refactors keep
  the vocabulary and don't silently re-tune the heuristics.
- [ ] **Agent session edge detection feeds notices and the rail's
  unread/working markers**; viewing a task marks it read (§15).
- [ ] **`Cmd/Ctrl+W` close-pane** stays a main→renderer ping
  (`acorn:close-pane`, IPC residue) with focus containment for both editor
  and terminal — ⌘W must never close the window while a pane has focus.

## §10 Notes & memory boundary contract

Owner: **notes / memory plugins**. Moved by Phase 4 (tool projection).
Verified by: conformance + route tests on the projected tools; a live
proposal-accept/reject pass.

The next docs collapse duplicated *channels*; they must not flatten these
*domain* boundaries. "One store API with provenance" for notes is right;
"one knowledge store" would be a regression. Migration invariants:

- [ ] **Notes are global/workspace/task, gitignored, disposable context.** Humans
  create `scratch`; agents and workflows create `plan`/`finding`/`handoff`;
  agent/workflow notes group separately and render read-only in the Notes
  pane.
- [ ] **Task-scoped notes** live under `notes/task/<taskId>/`, are what the PR
  description/comment and linked-ticket **seeds** land in, and are **removed when
  the task is deleted** (global/workspace notes persist —
  [state-and-policies.md](./state-and-policies.md) §retention). Agent
  `plan`/`finding`/`handoff` writes **default to the current task's scope**;
  `workspace`/`global` are explicit opt-in. This is what keeps one task's PR notes
  and workflow handoffs off its siblings — storage location, not a soft filter
  (contrast the pre-migration bug, [agent-runtime.md](./agent-runtime.md) §2.1).
- [ ] **Memory is durable repo/private knowledge. Files are truth; SQLite +
  FTS5 are a derived index.** Repo memory commits through the worktree;
  private memory lives under `~/.acorn`.
- [ ] **Agent memory writes are proposals only.** Direct silent memory writes
  remain impossible by construction — no tool projection may add one.
- [ ] **Memory proposals are JSON files, human-gated**, optionally generated
  at task boundaries from diff + transcript tail. Accept writes the file and
  reconciles the index; reject leaves no trace.
- [ ] **`MEMORY.md` index files and launch-time memory injection** stay part
  of agent ergonomics (the compact context block carries the index — §11).
- [ ] **`review_notes` are neither notes nor memory**: anchored inline
  annotations on local changes with `sentAt` semantics, owned by the changes
  plugin.

**Note scope contract (canonical — other docs reference this, never restate it):**

```ts
type NoteScope = 'global' | 'workspace' | 'task'
type NoteLocation =
  | { scope: 'global' }                              // <dataDir>/notes/global/
  | { scope: 'workspace'; workspaceId: string }      // <dataDir>/notes/<workspaceId>/
  | { scope: 'task'; taskId: string }                // <dataDir>/notes/task/<taskId>/
```

The note store keys by `NoteLocation`, **not** a bare `workspaceId` — a bare string can't
disambiguate a task uuid from a workspace uuid; the union does. `task/` is a reserved subtree that
cannot collide with a workspace uuid or the `global` key (the same trick that lets `global` be a
well-known key), so **no migration** of existing notes is required. Notes are files, not a SQLite
table — there is nothing to alter in Drizzle. `originTaskId` frontmatter survives only as
**provenance** ("which task seeded this note"), no longer as the scoping mechanism. `run` handoff
notes are task-scoped notes with a `workflow-handoffs-<runId>` slug (§2.1 of
[agent-runtime.md](./agent-runtime.md)) — a refinement *within* task scope, not a fourth peer.

## §11 Context assembly contract

Owner: **context plugin (tray) + section contributors**. Moved by Phase 4.
Verified by: `taskContext` route tests + a live curate-and-send pass.

The section registry ([contribution-points.md](./contribution-points.md)
§4.7) must carry these product semantics, not just an `assemble()` iteration:

- [ ] Include keys are `pr`, `issues`, `notes`, `memory` today; the Context
  pane lets the user **curate the include set and re-fetches with it** before
  sending.
- [ ] **Defaults differ per section** — memory's default inclusion differs
  from notes/issues; the registry's `defaultIncluded` is per-contribution
  data, not a global.
- [ ] The compact context block includes the **memory index only** and
  expects agents to call `memory_get` for bodies (§10).
- [ ] **Notes sections include bodies and slugs** so the Context pane can
  jump to the Notes pane (a declared jump intent post-Phase 5).
- [ ] **The notes section merges the active task's three scopes** — `task/<taskId>`
  + `<workspaceId>` + `global` (§10 `NoteLocation`) — grouped task → workspace →
  global. Sibling tasks' PR/handoff notes are excluded by *storage location*, so
  the assembler no longer leans on the `originTaskId` soft-filter to keep them out.
- [ ] **Linked issues resolve from cached provider blobs**; the stale/missing
  cache rule is: serve stale marked as stale; a missing blob yields an
  explicitly absent section, never a silent hole.
- [ ] **Sections declare their own size/truncation posture.** The invisible
  global slice in `knowledgeIpc` (2,000 chars × first 10 notes) already
  caused the workflow-handoff bug ([agent-runtime.md](./agent-runtime.md)
  §2.1); contributions must not inherit an undeclared budget.

## §12 Settings surface parity

Owner: **core (modal + page registry) + owning plugins per page**. Moved by
Phase 5. Verified by: a live walkthrough of every page. Phase 5 treats
settings as a **page registry plus typed settings services**
([contribution-points.md](./contribution-points.md) §4.6), not a tab list;
every page below has a named parity owner before its move.

- [ ] **Appearance** (core): 12 themes, follow-system, separate light/dark
  theme prefs.
- [ ] **Integrations** (providers): multi-connection provider cards; the
  GitHub row is synthesized and non-disconnectable; token-validation copy.
- [ ] **MCP** (core/profiles): inspector, starter, register/unregister — the
  full §8 contract.
- [ ] **Workflows** (workflows plugin): read-only inspector of file
  definitions and parse errors.
- [ ] **Terminal** (terminal plugin): default profile for the terminal rail
  button (`term_rail_default`).
- [ ] **Shortcuts** (core): pane chord capture plus the full global shortcut
  reference (Phase 5 generalizes; [ux.md](./ux.md) §4).
- [ ] **Permissions** (core): re-request GitHub OAuth access. **Separate from
  the new agent-tool permissions page** ([ux.md](./ux.md) §3) — the new page
  must not replace the existing OAuth flow.
- [ ] **Workspaces** (core + contributing plugins): assignments, hidden
  (ignored) repos, repo path picker, workspace identity, workspace projects,
  scripts, preview config, database URL script.
- [ ] **Onboarding** (onboarding plugin): shares the repo-assignment body
  with settings; `onboarded` pref.

## §13 Preview / browser parity

Owner: **preview plugin + core keepAlive layer**. Moved by Phase 9
(`WebContentsView`) and Phase 5 (keepAlive slot). Verified by: **visual
verification and agent-tool verification** — a blank or unbound preview can
still pass pane-registry tests.

- [ ] **Human browser chrome**: back, forward, reload/stop, home, editable
  URL, loading state.
- [ ] **Home URL resolution priority** per §3 (recipe `browser=run:<id>` →
  default run target URL → workspace preview config → dev-server fallback).
- [ ] **One kept-alive browser per task**; pane and task switches preserve
  page, scroll, and form state.
- [ ] **Archive eviction** and the overlay z-index interactions (overlays
  render above the preview surface).
- [ ] `will-attach-webview` currently restricts attached content to http(s);
  **`WebContentsView` needs an equivalent navigation/attachment policy** —
  the migration carries the restriction, not just the rendering.
- [ ] **`browser:bind` stays IPC-only** — `webContents` ids are capability
  handles ([security.md](./security.md) §3).
- [ ] **CDP browser tools (`browser_*`) operate on the task's preview
  surface**, not a separate hidden browser — what the agent drives is what
  the user sees.

## §14 Editor, search & local-git contract

Owner: **editor / changes plugins**. Moved by Phase 3. Verified by: route
tests including the security scenarios below + a live edit/search/commit
pass.

- [ ] **File access is task-id scoped** through `taskRoot`/`resolveInRoot`,
  including the symlink-ancestor realpath guard — the taskId-as-capability
  model survives the route migration byte-for-byte.
- [ ] **Editor tabs persist per task**; preview tabs promote on
  edit/double-click; a **single Monaco instance is reused** across tabs and
  tasks.
- [ ] **Clean models reload on focus; dirty models are never clobbered**
  (composes with the autosave mtime guard —
  [state-and-policies.md](./state-and-policies.md) §5.2).
- [ ] **Autosave flushes on debounce, blur, tab switch, and close.**
- [ ] **Search is ripgrep-backed** with substring/case/whole-word/regex
  toggles and debounced execution (and the explicit-path stdin gotcha stays
  respected).
- [ ] **Search result clicks open the editor beside search and reveal the
  line** (the `pendingEditorReveal` mailbox's semantics survive its Phase 5
  replacement).
- [ ] **Changes pane local diffs use whole-file context**, staged/unstaged
  groups, stage/unstage/discard (item and all), commit staged, push, inline
  review notes, and send-to-agent prompt generation.

Phase 3 route tests for these domains must cover: **path traversal, symlink
escape, missing worktree, and stale-buffer** scenarios — plus the standard
401/malformed-body cases ([testing.md](./testing.md) §2.4).

## §15 Notification & unread contract

Owner: **core (notices) + contributing plugins**. Moved by Phase 5. Verified
by: unit tests on notice identity/read rules + a live idle/exit pass.

The notification registry ([contribution-points.md](./contribution-points.md)
§4.13) defines notice identity, persistence, association, read/ack, toast
eligibility, and action invalidation. The product-visible semantics:

- [ ] **Notices persist in prefs with a bounded history.**
- [ ] **Agent idle/exit and workflow notices can raise OS toasts** (per-kind
  toast policy).
- [ ] **Task rows show unread "needs you" and working-spinner markers** fed
  by session edge detection (§9).
- [ ] **Selecting a notice navigates to the relevant task and marks it
  read.**
- [ ] **Activating a task also marks it read.**
- [ ] Background mutation failures become notices
  ([ui-state.md](./ui-state.md) §3), but **not every foreground error is a
  bell item** — foreground actions fail inline ([ux.md](./ux.md) §5).

## §16 Auth & error-vocabulary parity

Owner: **core**. Moved by Phases 0 and 3. Verified by: route tests
(parameterized 401 + per-code assertions).

The `ApiError` envelope standardizes the **shape**, never the **semantic
vocabulary** — the sweep must not erase meaningful machine codes.

- [x] A GitHub `401` from upstream maps to **`reauth`** and the client
  bounces to login. *(Phase 0: `ghError` unchanged; envelope preserves the code.)*
- [x] **SAML SSO, rate-limit, forbidden, and private-repo-not-found foldings
  keep their current meanings** (`sso`, `rate_limited`, and friends). *(Phase 0: codes byte-identical.)*
- [x] `node_id_unknown` (§4), `validation_failed`, and provider reauth codes
  survive as stable codes. *(Phase 0: preserved; `validation_failed` is the create-PR 422 code, prose in `detail`.)*
- [x] **`/auth/*` stays outside `requireUser`**; internal-token routes never
  inherit a GitHub token (`token: ''`). *(Phase 0: `/auth` mounts before the `/api/*` chain — tested; internal identity unchanged.)*
- [x] **The GitHub token never reaches renderer or agents**
  ([security.md](./security.md) §2 invariant 1). *(Phase 0: `/api/me` still projects public fields only — tested.)*
- [ ] **GitHub OAuth permissions re-request stays a settings feature** (§12),
  distinct from the agent-tool permissions page.
- [ ] **Integration tokens stay encrypted with the session root key** until
  the `safeStorage` migration; **list responses never expose tokens**.
- [ ] `SameSite=Lax`, the host guard, CSRF, and the exact WS-Origin check are
  **tested on the new routes**, not assumed ([security.md](./security.md)
  §7).

## §17 Degraded browser mode

Owner: **core capability detection**. Moved by Phase 3 (which *improves* it).
Verified by: a `dev:node` browser pass — already Phase 3's completeness smoke
test.

The bridge-absent story is currently implicit; the parity requirement is that
it becomes *stated*, not that it changes:

- [ ] Every pane/tool/surface declares its desktop-bridge requirement
  (capability gating, [extensibility.md](./extensibility.md) §2.1); absent
  bridge means hidden-or-degraded, never broken.
- [ ] The known degraded behaviours keep working: server-backed surfaces (PR
  review, mirrors, workspaces/tasks, prefs) function; **archive falls back to
  the plain status flip** (§2); desktop-only surfaces (terminal, editor,
  preview, database, local git) gate out cleanly.
- [ ] `dev:node` remains a supported first-class dev mode and **improves**
  after the transport collapse (near-full browser mode) — it must not become
  second-class during Phases 3–10.
- [ ] Each row in this doc that has a distinct bridge-absent behaviour says
  so in its own section; a row whose bridge-absent behaviour is unknown is an
  unresolved gap, not a pass.

## §18 Dev / build / package operational contracts

Owner: **operational (scripts + docs)**. Touched by Phases 9 and 10. Verified
by: running the package scripts per README/CLAUDE.md after each phase that
touches them. Lower priority than product parity, still part of
maintainability:

- [ ] **Electron/Node ABI rebuild scripts** (`node:rebuild`,
  `electron:rebuild`, self-healing `pnpm test`) keep working for every native
  dep that remains; Phase 9's `node:sqlite` spike shrinks this, `node-pty`
  keeps it alive. Documented rebuild/test expectations stay in CLAUDE.md.
- [ ] **The app pins `127.0.0.1:4317` as a stable storage origin** (IndexedDB
  and cookies key off it), with `ACORN_PORT` override. Changing startup order
  (Phase 1) must preserve stable-origin storage.
- [ ] **The smoke-browser script, packaging config (`electron-builder`), and
  the `ELECTRON_RUN_AS_NODE` MCP launcher** are operational contracts —
  foldering (Phase 10) updates their paths in the same PR.
- [ ] After Phase 10, [docs-overhaul.md](./docs-overhaul.md)'s pass says
  where each of these concerns lives in the `core/`+`plugins/` layout.
