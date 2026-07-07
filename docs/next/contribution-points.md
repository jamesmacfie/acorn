# Contribution point catalog (§4)

**Status:** design proposal · **Date:** 2026-07-07 · **Part of:** the
[extensibility.md](./extensibility.md) design (this file is §4 of that design;
section numbers are preserved so citations like "§4.8" resolve here). Core
services and the state model are in
[state-and-policies.md](./state-and-policies.md) (§5).

Each point below names its consumer registry, its interface (abbreviated), and
the current code it replaces. The interfaces are the *design shape* — the
implementing phase owns the final signature, and where the two differ the phase
wins (update this file when that happens).

Every client-rendered contribution also carries capability metadata, even when
the abbreviated interfaces below omit it for readability:

```ts
type ClientCapabilityRequirement =
  | 'none'
  | 'desktop'
  | 'browser:bind'
  | 'native-dialog'
  | 'close-pane-ping'
```

The core capability registry consumes that field to keep degraded browser mode
explicit ([feature-parity.md](./feature-parity.md) §17): server-backed
contributions stay usable in `dev:node`, desktop-only contributions hide or
render inert with a visible reason, and no contribution directly probes
`window.acorn` to decide whether it exists. [implementation.md](./implementation.md)
Phases 3 and 5 land the probe and make registry renderers consume it.

**Index — every point, where it lands:**

| § | Point | Registry lives in | Lands in ([implementation.md](./implementation.md)) |
| --- | --- | --- | --- |
| 4.1 | Panes | client | Phase 5 |
| 4.2 | Sources | client | Phase 7 |
| 4.3 | Commands & palettes | client | Phase 5 |
| 4.4 | Keybindings | client | Phase 5 |
| 4.5 | API routes | server | Phase 0 (envelope/auth) + Phase 10 (mounting moves) |
| 4.6 | Settings pages | client | Phase 5 (registry) + data-model track (workspace config) |
| 4.7 | Context sections | server | Phase 4 (rides the projection work) |
| 4.8 | Agent tools | main + server + mcp | **Phase 4 (keystone)** |
| 4.9 | Mirrored resources | server | Phase 2 (engine) + Phase 7 (descriptors) |
| 4.10 | Workflow step kinds & policies | main | Phase 8 |
| 4.11 | Agent profiles | main | Phase 8 |
| 4.12 | Run targets & layout recipes | main (config loader) | exists; trust gate is an ongoing track |
| 4.13 | Themes, notifications, content links, status pollers | client | Phase 5 (notices) / opportunistic |
| 4.14 | Integration providers | server + client | Phase 7 (contract: [integrations.md](./integrations.md)) |

---

## 4.1 Panes

```ts
interface PaneContribution {
  id: string                        // 'github.pr', 'core.editor'
  label: string; glyph: string
  order: number                     // replaces PANE_ORDER
  defaultChord?: string             // 'meta+shift+e' — into keybinding registry
  requires?: ClientCapabilityRequirement // default 'none'; editor/terminal/database/preview need desktop
  when?: (task: Task) => boolean    // replaces hasPr()/linearLinks() switcher gating
  component: Component<{ task: Task }>
  keepAlive?: 'dom' | 'none'        // preview's persistent-webview contract
  minWidth?: number                 // px floor for resize; default 240 (ux §7)
}
```

Pane *management* — resize dividers, pinning, maximize, reorder — is owned by
the core pane host, not by contributions: a pane declares at most a `minWidth`
and gets modern layout behavior for free ([ux.md](./ux.md) §7). The layout
model widens accordingly (`TaskLayout` gains pane-id-keyed `weights` plus
`pinned`; the reducer gains `resize`/`pin`/`move`), which is why the reducer is
kept *pure*, not kept *verbatim*. Contributions do not own pinning, focus, or
resize behavior; the core host applies those uniformly so one pane cannot
invent incompatible layout semantics.

Replaces: the `PaneId` union + `PANE_LABELS` + `PANE_ORDER` + `PANE_IDS`
(`layout.ts:9-41`), the `paneBody()` ladder and hand-written switcher buttons
(`TaskView.tsx:172-262`), `PANE_SHORTCUT_DEFAULTS` (`paneShortcuts.ts:14`).
The palette's Show/Close-pane rows, the switcher, the shortcut defaults, and the
help screen all derive from this registry. Persisted layouts keep unknown ids
inert (generalizing `isPaneId`).

The **pane contract must be uniform**: a pane receives `{ task }` and must not
read the router. This forces the one real fix the current code needs — the `pr`
pane's PullDetail/DiffView read `useParams()` and require global navigation
(`TaskView.tsx:174-186`, `activate.ts:11-15`). Under the plugin model the github
plugin's pane resolves owner/repo/number from `task` itself.

The full pane contract (what a pane may and may not do — no router reads, pure
model + thin view, error containment, the [ui-state.md](./ui-state.md) §3
reaction rules) is enforced by the conformance suite
([testing.md](./testing.md) §4), not by review comments.

**Pane content is keyboard-navigable by default** — this is a pane obligation,
not an opt-in flag (a flag for a mandatory default is speculative, and an
opt-*out* invites plugins to skip it). A pane's focusable content is reachable
and operable by keyboard: focus moves in/out cleanly, collections navigate by
arrow keys with a single tab-stop (roving focus), and focus entering the pane
marks it the focused surface ([ux.md](./ux.md) §7). Plugins get this by
composing the kit's focus primitives rather than hand-rolling `tabindex`/ARIA
(extensibility §3.5); pane-local chords register at `when: 'pane'` scope (§4.4).
The carve-out is the same as the chord system's: `keepAlive`/webview panes and
editor/terminal surfaces own their internal focus (Monaco, xterm), and the
default applies *around* them, not inside. The conformance suite asserts
keyboard reachability and focus-marks-surface ([testing.md](./testing.md) §4).

`keepAlive: 'dom'` is the honest generalization of the preview pane's
body-parented webview: the core owns an off-tree layer keyed by (pane, task) and
the positioning dance, instead of the plugin hand-managing `previewWebviews`.
(The `WebContentsView` migration — implementation Phase 9 — changes the layer's
mechanics but not this contract.)

## 4.2 Sources (rail entry + browse view + task origin)

```ts
interface SourceContribution<Item> {
  id: string                        // 'github', 'linear', 'rollbar'
  glyph: string; label: string
  when?: () => boolean              // 'integration connected' — replaces availableSources()
  browse: Component                 // LinearBrowse / RollbarBrowse / the PR three-pane
  originGlyph: string               // replaces ORIGIN_GLYPH
  defaultPane?: string              // pane to open when a task is promoted from this source
  promote?: {                       // typed promotion — replaces a loose seedTask
    canPromote(item: Item, ctx): PromotionMode   // incl. navigate-to-existing when already linked
    prepare(item: Item, ctx): Promise<TaskDraft> // title, branch seed, repo need, links at birth
    confirm?: Component<{ draft: TaskDraft }>
    create(draft: TaskDraft, ctx): Promise<TaskSeed>
    afterCreate?(task, item: Item, ctx): Promise<void>  // provider write-backs; failures → notices
  }
}
```

Promotion is where provider data crosses into core task state — worktree,
repo selection, branch naming, task links, default pane — so it is typed, not
a single `seedTask` callback. The integration-specific semantics each
provider answers through this contract (repo affinity, branch-seed dedupe,
attach-to-current-task as a distinct mode, already-linked handling,
write-backs on create) are pinned in [integrations.md](./integrations.md) §8.

Replaces: `SOURCE_IDS`/`isSourceId` (`tasks.ts:13-15`), `availableSources`
(`sources.ts:9`), the hand-written `<Match>` per source in `App.tsx:415-487`,
`ORIGIN_GLYPH` (`TabRail.tsx:28`), the per-source branch in `activateTaskSignals`
(`activate.ts:23`). Task `origin` becomes the contributing source's id (the
schema column is already free text). Adding a source drops from ~10 touch points
to one contribution.

`defaultPane` covers promotion, but first activation keeps its **fallback
ladder** for tasks with no promoting source *(parity §2)*: a task with a PR
opens `pr`; a PR-less task with Linear links opens `linear`; explicit
promotion can force a pane. The ladder lives in core activation and consults
source contributions — it is behaviour, not just data. Two more invariants
the registry must not disturb: **workspace selection stays derived from the
current repo** (there is no selected-workspace URL/state dimension — Linear
project browsing and Rollbar promotion navigate across repos and rely on
this), and **"ignored" is not "unassigned"** — ignored repos keep their
`workspace_repos` membership and are merely excluded from the main UI.

One forward-looking caveat on the first invariant: "derived from the current
repo" is a derivation rule, **not** a guarantee that a workspace/repo is
*always* active. Carry the workspace context as a parameter of the current
view, not as a global always-present singleton the whole shell reads — a
future app-level surface with no workspace (a cross-workspace dashboard, ext
§9) is a new top-level view mode, and it should stay a purely additive change
rather than a shell refactor. Don't build it now; just don't wire "there is
always a current workspace" into core as load-bearing.

## 4.3 Commands & palettes

```ts
interface CommandContribution {
  id: string; title: string; category: 'action' | 'task' | 'workspace' | …
  when?: () => boolean
  run: (ctx) => void | Promise<void>
}
```

One command registry feeds ⌘K. The palette's hardcoded action list
(`CommandPalette.tsx:63-80`) becomes contributions from the owning plugins (New
terminal → terminal plugin; Archive → core tasks; New Claude Code → the
claude-code profile plugin). Run targets, layout recipes, and workflows already
arrive as *data*; they become palette **item providers** — a second, coarser
contribution for plugins that inject dynamic rows (`(query) => PaletteItem[]`).
The overlay mechanics (`createOverlayPalette`, the `activeClose` mutex) are core;
FilePalette/WorkspacePalette are plugins registering overlays with their own
toggle chords.

## 4.4 Keybindings

```ts
interface KeybindingContribution {
  id: string; chord: string
  when?: 'global' | 'task' | 'pane' | 'typing-exempt'
  pane?: string                     // required when when: 'pane' — the owning pane id
  command: string                   // command id — bindings bind commands, not closures
}
```

One registry owns: registration, conflict *detection* (replacing the
hand-maintained `RESERVED_CHORDS` denylist and the prose comments coordinating
TabRail vs TerminalPanel numerics), user remapping (generalizing the
`pane_shortcuts` pref machinery), and the help screen (replacing the third
hand-synced copy in `Shortcuts.tsx:17-31` — the help renders the registry, so it
cannot lie). The 9 global `window` keydown listener sites collapse into one core
dispatcher; the 4 component-local Esc handlers stay local because their focus
semantics are real UI boundaries. Editor/terminal handling also stays local
where focus semantics genuinely differ (Monaco ⌘S, xterm passthrough).
Conflict-resolution semantics and the remapping UX are specified in
[ux.md](./ux.md) §4.

The **`pane` scope** is the home for chords that fire only while their pane is
the focused surface — today's hand-rolled, typing-guarded `window` listeners
(`PullList.tsx:69` bare `j`/`k`, `DiffView.tsx:292` `⌘F` — inv §3b) that would
otherwise survive the collapse as more scattered listeners. The one core
dispatcher already knows the focused pane (pane focus is core-owned,
[ux.md](./ux.md) §7), so a pane-scoped chord is just a `when` predicate on it:
the binding is live only when `pane` matches the focused surface, and it
inherits conflict detection (a `pane` chord may reuse a chord another pane
owns; it must not collide with a `global`/`task` binding), remapping, and the
help screen — which shows pane-local chords when that pane is focused, for
free. Chords that must reach *inside* a focus black-hole (Monaco `⌘S`, xterm
passthrough) still stay component-local per the carve-out above; the `pane`
scope is for chords the pane host dispatches *around* its content, not keys the
content itself swallows.

## 4.5 API routes (server)

```ts
ctx.routes.mount('/api/linear', linearRouter)        // namespaced by convention
```

Server plugin parts mount routers exactly as `server/index.ts:31-58` does today
— that mechanism is fine; it just moves from one hand-edited file into plugin
activation. The core enforces the two things convention currently carries:
authenticated-by-default (a `requireUser` wrapper — review.md #6, implementation
Phase 0) and the shared error envelope (`ApiError` + `respondError`, same
phase). The `/api/repos` fan-in of 11 routers becomes internal structure of the
github plugin.

## 4.6 Settings pages

```ts
interface SettingsContribution {
  id: string; label: string; group: 'general' | 'workspace'
  component: Component<{ workspace?: Workspace }>
}
```

Replaces the `TABS` list in `SettingsModal.tsx:23-31`. Appearance/shortcuts/
permissions are core pages; integrations, MCP inspector, workflows inspector,
terminal defaults, and the per-workspace script editors come from their plugins.
Workspace-scoped script fields (setup/dev/teardown/dbUrl) become **workspace
config contributions** — a plugin declares the fields it stores on the workspace
and the settings form renders them — so the `workspaces` table stops accreting
per-feature columns (`schema.ts:278-285`); the backing store is the
`workspace_config` table (extensibility §8.5).

Settings pages do not persist directly. A setting that belongs in T3 state
registers a `PersistedStateSlice` descriptor with `ctx.prefs` (state §5.1a);
workspace-owned durable configuration registers a workspace-config field with a
codec. The settings component only dispatches typed mutations through those
services. This keeps plugin preferences, workspace configuration, and transient
UI state from collapsing back into ad-hoc JSON writes.

Integration settings have a further split — provider metadata vs connection
config vs workspace/repo binding config vs view preferences, each writing
through its own store; credential forms in particular go through the
core-owned connect flow, never direct storage
([integrations.md](./integrations.md) §3, §6).

## 4.7 Context sections

```ts
interface ContextSectionContribution {
  id: string                        // 'pr' | 'issues' | 'notes' | 'memory' | …
  label: string                     // tray display
  defaultIncluded: boolean          // per-section, not global — memory's default differs from notes/issues
  assemble: (task: TaskRef) => Promise<ContextSection | null>   // server-side
  budget: {                         // declared size posture — no invisible global slice
    maxItems?: number
    maxBytesPerItem?: number
    overflow: 'truncate-tail' | 'index-only' | 'omit-with-marker'
  }
  jump?: (item: ContextItem) => PaneIntent   // tray row → openPane(id, intent)
}
```

Replaces the hardcoded `include=pr,issues,notes,memory` sections in
`taskContext.ts` and the `setContextNotesSource`/`setContextMemorySource` global
setters. The assembler route iterates the registry; the Context pane tray, the
`formatContextBlock` push path, and the MCP `task_context` pull path all follow
automatically. A future "recent CI failures" section is one contribution.

Current context assembly has product semantics beyond "iterate sections"
*(parity §11)* — the registry carries them, not just `assemble()`:

- **The tray curates the include set** and re-fetches with it before sending;
  the include keys are contribution ids.
- **Memory contributes index-only** in the compact block — agents call
  `memory_get` for bodies; that is its declared `overflow: 'index-only'`
  posture, not a truncation accident. This is also the memory contract in
  [memory.md](./memory.md) §7: plugins may contribute linked context, but they
  do not inject their own durable-memory blocks beside the core memory
  section. **Notes include bodies and slugs** so the tray can jump to the
  Notes pane (`jump`).
- **Sections declare their own size posture.** The invisible global slice in
  `knowledgeIpc` (2,000 chars × first 10 notes) already caused the workflow
  handoff bug ([agent-runtime.md](./agent-runtime.md) §2.1); a contribution
  must never inherit an undeclared budget.
- **Provider-cache staleness has a rule**: linked issues resolve from cached
  provider blobs — serve stale marked as stale; a missing blob yields an
  explicitly absent section, never a silent hole.
- **Provider shapes are formatted by their providers.** Core never guesses at
  `issues.data` shapes (`state?.name ?? status ?? level` is deleted); the
  linked-items section asks the provider registered for `link.providerId` to
  format its own cached rows via its `LinkContextFormatter` —
  [integrations.md](./integrations.md) §9.

## 4.8 Agent tools — the keystone point

```ts
interface AgentToolContribution {
  name: string                      // 'notes_append', 'browser_click'
  description: string
  input: ZodSchema
  scope: 'task'                     // receives { taskId, worktreePath, sessionId }
  risk: 'read' | 'write' | 'execute'  // tenet 8: what the tool can do, declared
  when?: (task) => boolean          // sync read of already-held state; async work rides ctx.poll
  handler: (input, scope) => Promise<unknown>   // runs in main
  exposeToRenderer?: boolean        // also project a typed renderer client method
}
```

One declaration; the core projects it three ways:
- an **MCP tool** (schema straight from `input`; availability re-evaluated, with
  `tools/list_changed` on transitions);
- a **harness HTTP route** (`POST /api/tasks/:id/tools/:name`, `INTERNAL_TOKEN`
  auth, the `respond()` envelope) — so non-MCP agents and tests hit the same
  surface;
- optionally a **renderer client method** (over loopback HTTP post-Phase-3).

This collapses the five-edit-site pipeline (preload → knowledgeIpc → harness
route → bridge → MCP tool) into one object, and structurally prevents the
semantic forks the current channels have already grown (agent-vs-UI note
creation differing in frontmatter/provenance — review.md §1d): there is one
handler, and provenance (`author`, `sessionId`) comes from `scope`, supplied by
the channel.

Replaces: all of `harness.ts`'s bridge types + setters, `harnessWiring.ts`, the
per-tool bodies in `mcp/server.ts`, and the notes/memory/run/browser groups in
`preload.ts`/`knowledgeIpc.ts`.

The `risk` tier is the taxonomy the tool surface currently lacks: today
`notes_append` and a run-target execution are the same kind of thing to every
channel. The core permissions settings page (§4.6) renders the registry grouped
by tier — `read` tools always available, `write`/`execute` tools toggleable
per tier or per tool, persisted as a prefs slice the projection consults in
`when` evaluation. This is data-driven policy, not sandboxing (tenet 5): its
job is to give the user one honest page saying what agents can do, and one
switch to narrow it. The page's UX is specified in [ux.md](./ux.md) §3; what
the tier does and does not defend is [security.md](./security.md) §4.

Memory tools keep one extra invariant: `memory_write` is a write-tier tool
because it creates a **proposal**, not because it can write accepted memory.
The accepted repo/private memory file is still created only by a human action
in the memory UI. Plugins and integrations that want durable knowledge use
memory candidate contributions/proposals, not a private accepted-write API
([memory.md](./memory.md) §4/§9).

## 4.9 Mirrored resources (server sync descriptors)

```ts
interface MirroredResource<Row> {
  id: string                        // 'github.pulls', 'linear.issues'
  ttlMs: number                     // today: 45s / 300s / 600s / 120s, centralized at last
  etag?: boolean
  fetch: (key, prior: SyncState) => Fetched<Row> | NotModified
  persist: (tx, key, rows: Row[]) => void      // atomic delete-then-insert inside db.batch
}
```

The `key` is **provider-defined and opaque to the engine**. Every key today is
repo-scoped, but the type carries no such assumption on purpose: a user-scoped
feed keyed by connection/user identity — a future dashboard's "PRs assigned to
me across all repos", an inbox — is the same descriptor with a different key.
Keep the engine and `sync_state` (`(resource, key)`) repo-agnostic so that
surface stays purely additive (ext §8.5 for the matching user-scoped table
rule, ext §9 for the future seam).

The core sync engine owns the four-branch serve/revalidate/cold state machine,
`sync_state` bookkeeping, background-refresh tracking, and rate-limit backoff —
in one place instead of five divergent copies (review.md §1c; implementation
Phase 2 extracts the engine, Phase 7 expresses providers as descriptors). The
github plugin registers pulls/detail/files/repos descriptors; linear and
rollbar register theirs. TTL constants live on the descriptor: the caching
policy becomes greppable data.

For integration providers, descriptors carry additional invariants the engine
can't infer — the summary/detail merge rule (a list fetch never clobbers
detail), per-connection dedupe/backoff, tombstones, and cache-schema codecs —
all specified in [integrations.md](./integrations.md) §7.

## 4.10 Workflow step kinds & policies

```ts
ctx.workflows.registerStepKind('ci-loop', ciLoopHandler)      // Map<kind, StepHandler>
ctx.workflows.registerPolicy('checks-green', checksGreenEval) // github plugin contributes

interface StepHandlerContext {
  run: RunRow
  step: StepRow
  def: WorkflowStepDef
  renderedPrompt: string
  tools: EffectiveToolSet
  signal: AbortSignal
  emit(event: WorkflowStepEvent): void
}

type StepHandlerOutcome =
  | { status: 'done'; result?: unknown; structured?: unknown; sessionId?: string | null }
  | { status: 'failed'; error: string }
  | { status: 'safety-rail'; error: string }
  | { status: 'waiting-gate' }

type StepHandler = (ctx: StepHandlerContext) => Promise<StepHandlerOutcome>
```

Replaces the `executeStep` if-ladder (`workflowRunner.ts:189-250`) and the
one-case `evaluatePolicy` switch. Note the layering this reveals:
`checks-green` needs the GitHub mirror, so the *policy* belongs to the github
plugin while the *engine* is the workflows plugin — exactly the dependency the
current code hides inside `workflowWiring.ts`. Step kinds named in
`.acorn/workflows/*.toml` resolve against the registry; unknown kinds surface as
parse errors (the loader already does this well). Handlers do not write
`workflow_runs` or `workflow_steps` directly; the engine owns persistence,
status transitions, live events, cancellation, and reconcile. The full runtime
contract — statuses, `joins`, branch semantics, tool ceilings, and cancellation
races — is [agent-runtime.md](./agent-runtime.md) §4.1.

This registry is where the near-term additions from the agentfield study land
([agent-runtime-influences.md](./agent-runtime-influences.md) §3–4): a **`decide`/branch
step kind** (a one-shot structured, tool-free routing call, whose `structuredJson.verdict`
selects the next forward step via `WorkflowStepDef.branches`), a **per-run/step
tool allowlist or risk ceiling** (workflow-level and step-level ceilings
intersect, then global user permissions apply), and — later — a **typed
failure-recovery** outcome on the `StepHandler` contract. The cheap `decide`
tier reuses the profile registry via a new one-shot structured mode on
`AgentProfileContribution` (§4.11, an `aiArgv?`/single-turn variant beside
`headlessArgv`/`resumeArgv`), not a new transport. Triggers that *start* a run
are a separate seam — source/integration contributions evaluated by `ctx.poll`,
never a daemon (influences §3E).

## 4.11 Agent profiles

```ts
interface AgentProfileContribution {
  id: string                        // 'claude-code', 'codex', 'aider', 'shell'
  command: string; backendPreference: 'tmux' | 'node-pty'
  mcpRegistration?: (spec: LauncherSpec) => RegisterArgv   // replaces PROFILE_MCP_FLAVOUR
  headlessArgv?: (opts) => string[]                        // replaces headless.ts branches
  resumeArgv?: (sessionRef) => string[]                    // replaces resumeCommandFor
  aiArgv?: (opts) => string[]                              // one-shot structured decide calls
  streamJson?: StreamJsonAdapter                           // agents-panel activity parsing
}
```

Replaces `BUILTIN_PROFILES` (`profiles.ts:21-26`), `PROFILE_MCP_FLAVOUR`
(`terminal.ts:356`), the per-agent branches in `headless.ts:30` and
`agents/model.ts`. Each agent (claude-code, codex, aider) becomes a small plugin;
adding one no longer edits four files. The deferred `agent_profiles` table
(`profiles.ts:4`) becomes unnecessary — file-based plugins *are* the
user-editable registry.

## 4.12 Run targets & layout recipes — already there

`.acorn/config.toml` (`runConfig.ts`) is the existing proof that acorn's
contribution model works: run targets, recipes, and workflows are declarative,
layered (repo → user → DB), validated with surfaced errors, and consumed by
several subsystems (palette, preview, MCP, TaskView) without those consumers
knowing each other. The plugin architecture keeps this mechanism as-is and adds
one thing: plugins may register **config sections** (schema + parser) so a new
plugin can extend the TOML without editing `runConfig.ts`. "As-is" is a
contract, not a mood — the exact layer precedence, parse-error surfacing,
`[layout.<id>]` recipes, `copy = [...]` semantics, setup/archive triggers, and
preview home-URL priority are pinned in
[feature-parity.md](./feature-parity.md) §3.

One correction while here (tenet 8): the repo layer of this merge is
*repo-authored executable config* — run targets and workflow steps are shell
commands committed by whoever wrote the repo, and today nothing gates them.
The fix is an acknowledgment gate, not a sandbox: `runConfig.ts` hashes the
repo-layer config on load; the first execution of anything from an
unacknowledged hash (run ▶, workflow start, `run_*` agent tools) shows the
commands and records the hash in a machine-scoped `config_acks (repo, hash,
ackedAt)` row. Unchanged config never asks again; an edited config re-asks
showing the diff. The user layer (`~/.acorn`) and DB layer are user-authored
and exempt. (Threat analysis: [security.md](./security.md) §4; dialog UX:
[ux.md](./ux.md) §2.)

## 4.13 Themes, notifications, content links, status pollers

- **Themes**: `{ id, label, css }` contributions replacing the `THEMES` array +
  hand-edited `tokens-layout.css` blocks (the existing test that guards
  list-vs-CSS becomes a registry invariant).
- **Notification kinds**: `{ kind, glyph, toastPolicy }` replacing the
  `NoticeKind` union and `KIND_GLYPH`; anyone can `ctx.notices.push(...)`. Edge
  detection (`detectEdges`) stays in the terminal plugin; workflow notices in the
  workflows plugin. Notices are also the app's one background-error surface
  ([ui-state.md](./ui-state.md) §3 rule 1) — a failed background write is a
  notice, not an `alert` and not silence. The registry owns the full notice
  contract *(parity §15)*, because the semantics are product-visible:
  **identity** (kind + task association + dedupe key — pushing twice is one
  row), **persistence** (a prefs slice with a bounded history, per the
  `core:notices` codec in state §5.1a), **read/ack rules** (selecting a
  notice navigates to its task and marks it read; activating a task marks its
  notices read), **OS-toast eligibility** per kind (agent idle/exit and
  workflow notices may toast; not every background failure does), and
  **action invalidation** — a notice whose target task/source/pane no longer
  exists renders inert, never throws. And the converse of rule 1: not every
  foreground error is a bell item — foreground actions fail inline
  ([ux.md](./ux.md) §5).
- **Content links**: pattern + resolver + in-app navigation target
  (generalizing `contentLinks.ts`), consumed by any plugin that renders rich text.
- **Task status pollers**: the rail's dirty/checks poll becomes per-plugin
  contributions feeding the badge slot, instead of `term:task:statuses` carrying
  a fixed shape. All recurring polls register with `ctx.poll`
  ([state-and-policies.md](./state-and-policies.md) §5.2) — coalesced,
  visibility-paused, rate-limit-aware.

## 4.14 Integration providers

```ts
interface IntegrationProviderContribution {
  id: string                         // 'github', 'linear', 'rollbar', 'sentry'
  label: string
  kind: 'identity' | 'issue-tracker' | 'error-tracker' | 'doc-system'
      | 'observability' | 'generic'
  connection: ConnectionContract     // credential fields, validate, normalize, test
  externalIds: ExternalIdContract    // identifier ↔ ExternalRef mapping
  capabilities: ProviderCapabilities // browse/promote/comments/repoAffinity/…
  resources: MirroredResource[]      // §4.9 descriptors
  codec: CachedItemCodec             // issues.data parse/version/migrate
  taskContext?: LinkContextFormatter
  refs?: ReferenceResolver           // detect/resolve/linkify external refs
  mutations?: ProviderMutation[]
  budgets?: ProviderBudgets
  lifecycle?: ProviderLifecycleHooks
}
```

The one contribution that says "this plugin is an integration provider" — the
descriptor every other integration-related registration (source, pane, context
section, settings page, content link, agent tool) is validated against at
activation. It subsumes review.md #7's minimal `Provider` interface
(`validate`/`fetchItems`/`fetchDetail`/`toIssue` live inside
`connection`/`resources`/`codec`). Replaces: the hardcoded provider metadata
in `IntegrationsSettings.tsx`, the per-provider if-else in `integrations.ts`,
the six decrypt-try-skip loops, and `taskContext.ts`'s provider shape-guessing.

**The full contract is [integrations.md](./integrations.md)** — connection
and auth model, capability model, `ExternalRef` link identity and write
integrity, scope bindings, cache/codec invariants, promotion semantics,
context formatting, pane intents, mutations, error taxonomy, reference
resolution, lifecycle (disconnect ≠ disable ≠ reauth ≠ rotate), the webhook
seam, agent-tool scoping, budgets, and the conformance suite. This catalog
entry is the registration shape; that doc is normative for behaviour.
