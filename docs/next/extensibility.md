# acorn as a plugin platform

**Status:** design proposal · **Date:** 2026-07-07 · **Companion:** [review.md](./review.md)

This doc answers one question: *if everything in acorn were a plugin modifying an
extendable core, what would that core be, what extension points would it expose,
and can that model reach 100% parity with what ships today?*

It is grounded in a full inventory of what every pane and shell surface actually
consumes (routes, IPC channels, main-process modules, prefs, shortcuts, palette
entries, context contributions, lifecycle obligations). The parity map in §7
shows every current feature has a *home*: expressed as a plugin over the
contribution points, or explicitly kept in core with a reason. The
*behaviour-level* proof obligation is
[feature-parity.md](./feature-parity.md) — one checkbox per shipped behaviour.

> **This design spans four files** (split for navigability; section numbers are
> stable across the set, so a citation like "§4.8" is unambiguous):
>
> - **This file** — tenets (§1), the core (§2), the extension model (§3), the
>   assembled layout (§6), the parity map (§7), the hard parts (§8), and the
>   order of operations (§9).
> - **[contribution-points.md](./contribution-points.md)** — §4, the full
>   contribution-point catalog (§4.1–§4.14).
> - **[state-and-policies.md](./state-and-policies.md)** — §5, the core services
>   plugins consume, the state model (§5.1), and the runtime policies (§5.2).
> - **[integrations.md](./integrations.md)** — the integration-provider
>   contract (§4.14's full specification): connections/auth, capabilities,
>   link identity, lifecycle, error taxonomy, conformance. Cited as
>   *(integrations §N)*.
>
> The build order that turns this design into shipped code is
> [implementation.md](./implementation.md); this doc is the *target*, that doc
> is the *route*.

---

## 1. Design tenets

1. **The core owns mechanism; plugins own policy.** The core knows how to render
   a pane, sync a mirrored resource, spawn a PTY, register an MCP tool, persist a
   pref. It does not know what a "PR" or a "Linear issue" is.
2. **Contribution points are declarative data; hooks are imperative
   subscriptions.** A plugin *declares* panes, commands, tools, and settings pages
   as typed objects the core's registries consume. It *subscribes* to lifecycle
   events (task archived, session status changed) and returns disposables. Static
   things stay static so the core can index, list, and conflict-check them.
3. **A plugin spans processes.** acorn's features live in three runtimes (renderer,
   Hono server, Electron main) plus the MCP stdio process. A feature like
   "preview" is one plugin with a client part and a main part — not three
   fragments coordinated by convention. The plugin unit is the *feature*, not the
   process.
4. **Declare an agent capability once.** Today one agent verb costs five edit
   sites (preload, IPC, harness route, bridge, MCP tool — review.md §1d). In the
   plugin model a tool is declared once and the core *projects* it to MCP, to a
   harness HTTP route, and (optionally) to a typed renderer client.
5. **Trusted, in-tree, compiled-in.** This is an architecture for *this* codebase,
   not a marketplace. Plugins are TypeScript modules in the repo, type-checked
   against the core API, loaded by a static registry. No sandboxing, no dynamic
   loading, no version negotiation. (A dynamic loader can be layered on later —
   nothing below precludes it — but designing for hostile third-party code now
   would tax every interface for a user that doesn't exist.)
6. **Unknown contributions degrade, never crash.** The codebase already has the
   right instinct (`isPaneId` filtering persisted layouts, `availableSources`
   hiding unconnected providers). Generalize it: persisted state referencing a
   pane/source/command from a disabled plugin is retained but inert.
7. **IDs are namespaced strings.** `github.pr-pane`, `linear.issue-pane`,
   `core.terminal-drawer`. The closed unions (`PaneId`, `SourceId`,
   `WorkflowStepDef.kind`) that today leak into 18 files become registry-validated
   strings with branded types at the edges.
8. **Plugins are trusted; the repo is not.** Tenet 5's trust extends to code in
   this repository — not to data that arrives *from a cloned repo*.
   `.acorn/config.toml` contributes run targets and workflow definitions that
   execute shell commands, which makes every checkout a config source with the
   VS Code "trusted workspace" problem. Repo-sourced executable config requires
   a one-time acknowledgment (§4.12); agent tools declare a risk tier (§4.8).
   The security posture of the whole loopback surface — what these gates defend
   and what they deliberately don't — is written down in
   [security.md](./security.md).

---

## 2. The core (what is *not* a plugin)

The core is the part that would remain if you deleted every feature. It is
deliberately boring: identity, storage, process plumbing, and empty UI sockets.

### 2.1 Client core

- **The shell**: window chrome, auth gate, the region layout (top bar, left rail,
  main area, bottom drawer socket, right panel socket, overlay layer) — each
  region exposing **slots** (§3.3) that plugins fill. Today's `App.tsx` is the
  shell *plus* ten features fused together; the core shell is App.tsx with the
  features extracted. Keep the region layout parameterized on the current
  workspace context rather than assuming a workspace is always active — an
  app-level view with no workspace is an anticipated future surface (§9).
- **The Workspace → Task model and stores**: `tasks`, `taskLinks`, workspace
  membership, the active-task/selected-source signals, the layout reducer
  `applyLayoutAction` (kept pure and pane-agnostic, but not verbatim: `PaneId`
  widens from a union to validated strings, and the model grows pane-id-keyed
  weights, pins, and move/resize actions for modern pane management —
  [ux.md](./ux.md) §7).
- **The data layer**: the TanStack Query client, IndexedDB persistence, the
  `readJson`/`writeJson` client, and the **prefs service** (namespaced key-value
  with hydrate-once/persist semantics — the ordered startup-restore pipeline from
  review.md §4 becomes a core service plugins register slices into, instead of
  effects hand-ordered in App.tsx). Persisted plugin state goes through
  versioned descriptors/codecs (state §5.1a), not raw `writeJson`.
- **Registries + the event bus** (§3).
- **Capability detection**: `desktop` / bridge-present flags; plugins declare
  which capabilities their parts require and the core gates activation.

### 2.2 Server core

- The Hono `createApp()` factory, session (encrypted cookie, OAuth flow),
  CSRF/host-guard middleware, the Drizzle/SQLite connection, migrations, the
  prefs routes, and the **sync engine** — the serve-then-revalidate state machine
  (TTL + ETag + atomic delete-then-insert via `db.batch`) extracted once (this is
  review.md recommendation #2, promoted to a core service that source plugins
  configure with resource descriptors, §4.9).
- The **harness gateway**: tool-route projection, `INTERNAL_TOKEN` auth, the
  single `respond()` error envelope.
- GitHub *authentication* stays core (it is the app's identity provider — the
  session's `user_id` is the GitHub login). GitHub *PR review* does not (§7).

### 2.3 Main-process core

- A real **composition root** (review.md §2): builds the DB, constructs core
  services, activates plugin `main` parts in dependency order, wires the harness,
  *then* starts the HTTP listener; owns `will-quit` teardown by disposing
  everything it activated, and runs each plugin's registered `reconcile()` on
  boot.
- **The PTY engine**: spawn/attach/kill/resize/status, tmux persistence, the
  session table — today's `terminal.ts` stripped of its composition-root role and
  its knowledge of profiles (profiles become contributions, §4.11).
- **The worktree service**: `taskWorktree.ts` unchanged — the taskId-as-capability
  model (`resolveTaskCwd`/`resolveInRoot`) is already the best boundary in the
  codebase and becomes the core primitive every plugin gets file access through.
- **The transport**: per [implementation.md](./implementation.md) decision 1,
  the request/response surface between renderer and main collapses onto the
  loopback HTTP server (typed through `shared/api.ts`), with one WebSocket for
  PTY/step streams and a *minimal* hand-typed IPC residue for true Electron-isms
  (dialogs, webContents binding). Plugins never touch `ipcMain`/`ipcRenderer`
  directly: a plugin's "main part" exposes its surface as server routes or agent
  tools, and the residue channels are core-owned. (An earlier draft of this
  design proposed a typed IPC bus as a core service; the transport collapse
  supersedes it — the bus survives only as the fallback plan if the collapse
  stalls.)
- **The run-config loader**: the layered `.acorn/config.toml` → `~/.acorn` → DB
  merge (`runConfig.ts`) — already the most plugin-shaped thing in the app; it
  becomes the core's *file-configurable contribution* mechanism (workflows and
  run targets already live here; §4.10, §4.12).

### 2.4 MCP core

- The stdio server skeleton, task scoping from `ACORN_*` env, the loopback HTTP
  client, and the tool registry that agent-tool contributions (§4.8) project
  into. Tool availability becomes dynamic (`tools/list_changed`) instead of
  frozen at connect.

---

## 3. The extension model

### 3.1 The plugin unit

```ts
// plugins/<name>/index.ts
export const plugin: AcornPlugin = {
  id: 'linear',
  requires: [],                    // hard deps on other plugin ids
  enhances: ['github'],            // soft deps: activate after, degrade without
  capabilities: { main: false },   // which parts need the desktop bridge
  client: () => import('./client'),// per-process entrypoints, lazy
  server: () => import('./server'),
  main:   () => import('./main'),
}
```

Each entrypoint exports an `activate(ctx)` receiving that process's typed
context, and returns contributions + disposables:

```ts
// plugins/linear/client.ts
export function activate(ctx: ClientPluginContext) {
  ctx.panes.register(linearIssuePane)
  ctx.sources.register(linearSource)
  ctx.settings.register(linearSettingsSection)
  ctx.contentLinks.register(linearIssueLinkifier)     // extends other plugins' rendered content
  return ctx.disposables
}
```

`ctx` is the whole core API surface for that process — registries (§4), core
services (§5), and the event bus. Nothing is imported from another plugin's
internals; cross-plugin extension happens through contribution points the
*extended* plugin itself declares (§3.4).

**Contract:** `activate()` only registers. No I/O, no network, no filesystem —
first real work happens on first use or first poll tick (§5.2). This is what
keeps activation cheap as plugins multiply, and it is testable: the plugin
conformance suite ([testing.md](./testing.md) §4) asserts it.

### 3.2 Activation & lifecycle

- Static registry (`plugins/index.ts` lists them; a pref can disable one).
- Order: core services → plugins in `requires`-topological order → shell render →
  HTTP listener. This kills the half-wired-API race by construction.
- Every registration returns a `Disposable`; deactivation (or app quit) disposes
  in reverse. The three-call-site `evictPreviewWebview` obligation becomes one
  `ctx.events.on('task:archived', …)` subscription inside the preview plugin.
- Boot-time recovery: a `main` part may register `reconcile()` (tmux resurrect,
  worktree prune, workflow resume); the composition root runs them in one place,
  **after** the window is up — reconcile work grows with accumulated state and
  must stay off the boot critical path ([performance.md](./performance.md) §3.6).

### 3.3 UI slots

The shell's regions, made explicit. Each slot is an ordered registry of
contributions with a `when` predicate (reactive):

| Slot | Today filled by | Contribution shape |
| --- | --- | --- |
| `topbar.left` | collapse toggle, WorkspacePicker, RepoPicker, breadcrumb | component + order |
| `topbar.right` | NotificationBell, terminal toggle, AccountMenu | component + `when` |
| `rail.sources` | GitHub/Linear/Rollbar source buttons | from source registry (§4.2) |
| `rail.taskRow.badges` | checks dot, dirty ✎, needs-you ‼, unread, missing ⚠ | `(task) => Badge \| null` |
| `main.view` | browse views + task view + PR three-pane | from source/pane registries |
| `task.paneRow` | the 10 panes | from pane registry (§4.1) |
| `task.switcher.extra` | run ▶ buttons, agents ⠿, terminal >_ | button + `when` |
| `drawer.bottom` | TerminalPanel | singleton socket |
| `panel.right` | AgentsPanel | singleton socket |
| `overlay` | palettes ×4, settings modal, onboarding, shortcuts help | overlay registry |
| `settings.pages` | 8 general tabs + per-workspace pages | §4.6 |

The task-row badge slot is worth calling out: today `TabRail.tsx:287-304`
hardcodes five badge computations that belong to four different features
(checks → github, dirty → changes, unread → notifications, working-spinner →
terminal). Badge contributions make the rail feature-blind.

### 3.4 Cross-plugin extension

Some of today's best UX is one feature reaching into another: Linear IDs
linkified inside the PR description (`contentLinks.ts` consumed by
`PullDetail.tsx`), review notes sent to an agent PTY, the context pane jumping to
the notes pane. The rule: **the extended plugin declares the point.**

- `github` declares `contentLinks` (pattern → resolver) — `linear` contributes.
- `core` declares `sendToAgent` (the PTY paste channel) — changes/context/editor
  plugins consume it as a service, not by importing the terminal feature.
- Pane-to-pane navigation goes through the layout dispatcher plus a typed
  `openPane(paneId, intent)` — replacing the `noteToOpen` / `requestTerminalFocus`
  one-shot mailbox signals with one core mechanism.

### 3.5 UI composability inside contributions

Slots make the *shell* composable; they say nothing about the UI plugins put in
them. Three rules keep contributed UI coherent — without them the plugin model
delivers a consistent frame around inconsistent content:

1. **Core UI kit.** The core exports the primitive vocabulary: the token layer
   (already theme-contributed, §4.13) plus the small widget set every pane
   currently re-invents — list rows, badges, empty states, section headers,
   toolbars, tooltip, and the `QueryGate` loading/error primitive
   ([ui-state.md](./ui-state.md) §2.5). Today the shared layer is a handful of
   loose components (`CopyButton`, `UserAvatar`, `Picker`) and consistency is
   single-author discipline; under plugins it must be structural. Plugin
   components compose core primitives and consume core tokens. CSS follows the
   same rule: styles are namespaced per plugin — today's per-feature `.css`
   files share one global class namespace, which two plugins will eventually
   collide in.

   **Kit scope is grounded in what ships today — not a general component
   library.** No speculative catalog (no `Table` — the app renders zero
   `<table>` elements; lists are div-based, covered by "list rows" above). The
   kit is exactly what is already duplicated across features:

   - **Form controls, currently raw native + per-feature CSS.** `<button>` is
     used ~198 times, plus `<input>` (~42), `<textarea>` (~13), `<select>`
     (~13), and disclosure (`<details>`/`<summary>`). The duplication is real,
     not anticipated — these become kit components (`Button`, `TextField`,
     `Select`, `Disclosure`) so a plugin's button is *the* button. This is the
     highest-value extraction and the one most exposed to drift.
   - **The two custom interactive primitives already shared:** `Picker` (the
     filterable dropdown, ~18 uses) and the tooltip. Promote them from
     feature-local to kit; they are also the accessibility-hard ones (focus,
     keyboard nav, ARIA, click-outside).
   - **The existing small composed bits:** `CopyButton`, `UserAvatar`.
   - **Overlays/modals/palettes stay core**, not kit — they are the overlay
     slot's mechanics (§3.3, §4.3), and dialogs are already div-over-overlay,
     not native `<dialog>`.

   **Own the skin, adopt the behavior.** "Our own library, not someone else's"
   splits cleanly: the styling and tokens are ours and in-tree (tenet 5), but
   the *accessible behavior* of the hard controls — the dropdown/`Picker`, the
   tooltip, any focus-trapped surface — is not worth hand-rolling per control
   (focus management and ARIA are where a11y bugs breed). Wrap a headless Solid
   primitive there and style it through our tokens — the shadcn model (headless
   behavior + owned styling), not a from-scratch widget set. Native controls
   that are already accessible (`button`, `input`, `select`) just get a styled
   wrapper and need no headless layer.

   **Focus and keyboard navigation are kit primitives, not per-plugin code.**
   The pane contract requires keyboard-navigable content by default (§4.1), and
   that only holds if the navigable behavior is the path of least resistance.
   Three conventions, same "adopt the behavior, own the styling" rule:
   - a **list-navigation primitive** (`createListNavigation` hook + `use:`
     directive) — roving tabindex (one tab-stop per collection, arrows/`j`/`k`/
     Home/End move within), `role`/`aria-activedescendant` wiring, and the same
     typing-exempt guard the chord dispatcher uses so it never hijacks keys
     inside an input. Adopt it from the headless primitive lib (Kobalte's
     listbox/roving), don't hand-roll focus + ARIA per pane;
   - a **`use:paneFocus` directive** applied by the core pane host: mark the
     focused surface on `focusin`, not only click — so tabbing into a pane
     activates it for maximize/move ([ux.md](./ux.md) §7), closing the
     keyboard-vs-pointer gap;
   - a **focus-scope/trap primitive** for the overlay layer (dialogs, palettes)
     — the [ux.md](./ux.md) §8 "keyboard-first dialogs" invariant needs it and
     it is the same adopt-headless call.
   These live in `client/ui/` beside the control wrappers; pane-local chords
   ride the `when: 'pane'` keybinding scope (§4.4), so movement, activation, and
   pane-scoped shortcuts are three sides of one keyboard story, not per-plugin
   reinvention.

2. **Render failure is contained at the slot.** Tenet 6 covers *unknown*
   contributions; a *throwing* one is worse — there is currently zero
   `ErrorBoundary` usage, so one bad pane render takes down the shell. The slot
   renderer wraps every contribution in an error boundary degrading to an inert
   placeholder (a pane shows "failed" + plugin id; a badge simply disappears).
   This extends tenet 6 from persisted state to runtime.

3. **Pure model + thin view inside panes.** The plugin model bounds features;
   it does not decompose them (§8.1). The existing discipline — `layout.ts`,
   `diff/model.ts`, `palette/model.ts` — *is* the intra-pane composability
   story, and the contract new panes are held to: logic in a testable model
   module, the component a thin reactive view over it. This is also the Solid
   mitigation review.md's technology section leans on. The companion rules for
   how contributed UI *reacts* — failure surfaces, latest-wins refreshes,
   derive-don't-effect — are [ui-state.md](./ui-state.md) §3 and bind equally.

---

## 4. Contribution point catalog

Moved to **[contribution-points.md](./contribution-points.md)** (§4.1–§4.14,
numbering preserved). The catalog names, for each point, its consumer registry,
its interface, the current code it replaces, and the implementation phase that
lands it. The integration-provider point (§4.14) has its own full contract
doc, [integrations.md](./integrations.md).

## 5. Core services, state, and runtime policies

Moved to **[state-and-policies.md](./state-and-policies.md)** (§5, §5.1, §5.2,
numbering preserved): the `ctx` service table, the event bus and will-phase
consent, the state tier/scope/ownership model, and the concurrency/budget/
retention policies.

---

## 6. What the app looks like assembled

```
core/
  client/   shell, slots, registries, layout reducer, prefs pipeline, event bus
  server/   createApp, session/auth, sync engine, harness gateway, prefs routes
  main/     composition root, PTY engine, worktree service, IPC residue, config loader
  mcp/      stdio skeleton, tool projection

plugins/
  github/          source (browse three-pane) · pr pane · mirrored resources ·
                   PR mutations · checks badge + poller · 'checks-green' policy ·
                   create-PR flow · mentions/labels · contentLinks host
  linear/          integration provider · source + browse · issue pane ·
                   issues context section · linkifier · comment mutation
  rollbar/         integration provider · source + browse · item pane
  editor/          editor pane · file palette overlay · editor routes · autosave
  changes/         changes pane · local-git routes · review notes (+ routes) ·
                   dirty badge · review-prompt sendToAgent
  notes/           notes pane · NotesStore · notes context section ·
                   notes_* agent tools · note seeding
  memory/          memory tray · memory index/proposals · memory context section ·
                   memory_* agent tools · review trigger
  context/         context pane (tray UI over the section registry)
  preview/         preview pane (keepAlive) · WebContentsView layer · browser_* agent tools ·
                   CDP driver · url resolution over run targets
  database/        database pane · pg pools · db routes · dbUrl workspace config
  terminal/        bottom drawer · sessions store · session-edge notices ·
                   term WS/routes surface · run-target execution (RuntimeService)
  agents/          right panel · roster model · stream-json adapters
  profiles-claude/ agent profile (+ mcp registration flavour)   [tiny]
  profiles-codex/  agent profile                                 [tiny]
  profiles-aider/  agent profile                                 [tiny]
  workflows/       step-kind registry + runner · TOML defs · gates ·
                   workflow palette items · inspector settings page · notices
  onboarding/      first-run modal
```

Boot: composition root → core services → plugins (topo order) → listener
starts → shell mounts slots → restore pipeline hydrates plugin slices in
phase order → `boot:restored` fires → persistence arms.

---

## 7. Parity map

Every shipped feature, its plugin, and the contribution points it uses. ✅ = no
open design question; ⚠ = named hard part (§8).

> **This map is deliberately coarse** — it proves every feature has a home.
> Many rows are whole feature clusters ("PR detail + conversation + reviews",
> "Settings modal (all pages)") and a row here can pass review while a small
> contract at a join is dropped. The fine-grained proof obligation —
> per-behaviour checkboxes with owners and verification methods — is
> **[feature-parity.md](./feature-parity.md)**; the changeover doesn't begin
> until every row there is owned or explicitly struck as a non-goal.

| Current feature | Plugin | Points used | |
| --- | --- | --- | --- |
| PR list / browse three-pane | github | source, mirrored resources, commands (`c` create-PR, `[`/`]`, `j`/`k`) | ✅ |
| PR detail + conversation + reviews | github | pane, routes, mutations | ✅ |
| Diff rendering + viewed files + inline comments | github | pane (within pr pane), blobs service | ✅ |
| Checks panel + rerun + rail checks dot | github | pane section, badge slot, poller | ✅ |
| Create PR flow | github | commands, routes | ✅ |
| PR context section + `pr_current`/`pr_changed_files` tools | github | context section, agent tools | ✅ |
| Linear connect/browse/pane/comments | linear | integration provider (§4.14), source, pane, mutations | ✅ |
| Linear linkification in PR body | linear → github | contentLinks (reference resolver — integrations §13) | ✅ |
| Rollbar connect/browse/pane | rollbar | integration provider (§4.14), source, pane | ✅ |
| Issues context section + `linked_issues` | linear/rollbar | context section, link context formatter (integrations §9), agent tool | ✅ |
| Editor pane + tree + autosave + ⌘P file finder | editor | pane, overlay, routes, prefs slice | ✅ |
| Changes pane + stage/commit/push + review notes | changes | pane, routes, badge | ✅ |
| `local_changes`/`local_diff`/`git_log` tools | changes | agent tools (in-process handler, no loopback hop) | ✅ |
| Notes pane + global notes + included-flag | notes | pane, agent tools, context section | ✅ |
| Memory tray + proposals + FTS index | memory | context section, agent tools, settings | ✅ |
| Context pane + send-to-agent | context | pane, `ctx.terminal.sendToAgent` | ✅ |
| Preview pane + persistent webview | preview | pane (`keepAlive`), events (`task:archived`) | ⚠ §8.2 |
| Agent-drivable browser (`browser_*`) | preview | agent tools + CDP driver | ✅ |
| Database pane + pools + dbUrl script | database | pane, routes, workspace config contribution | ✅ |
| Terminal drawer + tabs + tmux persistence | terminal | drawer socket, PTY service, prefs | ✅ |
| Run targets + ▶ buttons + `run_*` tools + recipes | terminal | config sections, palette provider, agent tools (`when:` un-freezes availability) | ✅ |
| Agents panel + roster + resume | agents | panel socket, profile registry, workflow read API | ✅ |
| Agent profiles (claude/codex/aider) + MCP registration | profiles-* | agent profile | ✅ |
| Workflows: TOML defs, runner, gates, inspector, notices | workflows | step kinds, policies (github contributes `checks-green`), palette provider, settings page, notification kinds | ✅ |
| Notification bell + OS toasts + rail unread | core + contributors | notification kinds, badge slot | ✅ |
| ⌘K/⌘P/⌘L palettes + `/` finder + `?` help | core + plugins | commands, palette providers, overlays | ✅ |
| Pane chords + remapping + reserved chords | core | keybinding registry | ✅ |
| Settings modal (all pages) | core + plugins | settings pages, workspace config contributions | ✅ |
| Themes (12) + follow-system | core + theme contributions | themes | ✅ |
| Workspaces/tasks/rail/drag-order/⌘1-9 | core | — | ✅ |
| Worktree lifecycle + archive + setup/teardown scripts | core + plugins | events, workspace config | ✅ |
| Auth/session/OAuth/permissions | core | — | ✅ |
| Onboarding modal | onboarding | overlay | ✅ |
| MCP server + INTERNAL_TOKEN + task scoping | core | tool projection | ✅ |
| Offline mirror + ETag/TTL + blob cache | core (engine) + github (descriptors) | mirrored resources | ✅ |
| Startup restore (last repo/task/source, layouts, editor tabs, filters, notices) | core pipeline + plugin slices | prefs slices | ⚠ §8.3 |

Nothing in the inventories lacks a home. The parity claim holds *if* the four
hard parts below are resolved as described.

---

## 8. The hard parts (named honestly)

**8.1 The github plugin is enormous.** ~60% of the server and the two largest
client components land in one plugin. That is fine — plugin ≠ small — but it
means the plugin model alone doesn't fix review.md's DiffView/PullDetail
concern-fusion; that decomposition is internal to the github plugin and still
worth doing. The test of the architecture is not github's size but whether
*linear* stays small (it does: ~6 contributions) and whether github can be
disabled leaving a working local-task app (it can, if auth stays core — which is
why it must).

**8.2 keepAlive panes leak platform details into the core.** The preview
webview must survive pane switches and be positioned over a host rect; the core
layer that provides `keepAlive: 'dom'` has to own reparenting, z-index vs
overlays, and eviction. This is genuinely intricate (the current implementation
is subtle for good reasons) but it is *one* plugin's requirement generalized —
and centralizing it is still better than the module-level `previewWebviews` Map
with three manual eviction call sites. The `WebContentsView` migration
([implementation.md](./implementation.md) Phase 9) changes the mechanics —
main-owned, bounds-managed — but not the contract: whichever of the two lands
second gets simpler.

**8.3 The restore pipeline is ordering-sensitive.** Slices are not independent:
workspace restore must precede task activation, which must precede pane focus;
`isRestoring()` gates fetches. The core pipeline must make phases explicit
(`restore: 'workspace' | 'view' | 'panes'`) rather than pretending slices are
order-free — otherwise the plugin model just re-scatters today's App.tsx race
into fifteen plugins. This is the single riskiest piece of core to build; do it
first and port slices one at a time. ([implementation.md](./implementation.md)
Phase 6 is this, as its own phase, gated on the smoke suite.)

**8.4 Typing without closed unions.** `PaneId` as a union gives exhaustiveness
checks the registry model gives up. Mitigations: branded `PaneId` strings minted
only by `panes.register`; registry lookups return `Option`, never throw;
persisted-state parsers already tolerate unknowns. Where exhaustiveness
genuinely matters (the layout reducer), the logic is already id-agnostic. The
trade is real but small — and today's "union + 4 parallel hand-synced lists" is
exhaustiveness theater anyway (`PANE_IDS` can silently drift from `PaneId` now).

**8.5 The data model under plugins.** `task_links.provider`, `issues.provider`,
task `origin` are provider strings owned by source plugins but stored in core
tables. Rule: core owns generic tables keyed by contribution id; plugins own
their private tables and contribute migrations. The `issues.data` JSON blob gets
a per-plugin codec (parse + validate at the boundary) instead of today's
cast-and-hope. Two integration-specific corollaries (full contract in
[integrations.md](./integrations.md) §5): the denormalized `provider` column
becomes **derived** — core stamps it from the connection on every task-link
and binding write, never trusting a caller-supplied string — and link
identity generalizes to `ExternalRef` (display id, canonical external id,
locator, URL, connection id), with `task_links.identifier` remaining the
display id and a nullable `refJson` carrying full refs for providers that
need locators.

The schema itself is in good shape for this — the mirror/app-state split maps
1:1 onto tiers T1/T2 (§5.1), and `tasks`/`task_links`/`integrations`/`issues`
are already provider-generic. Four things that are convention today must become
declared rules:

- **Scope is declared, not implied.** Two identity scopes coexist: user-scoped
  (mirror tables, `prefs`, `integrations`, `issues` — keyed to the GitHub login)
  and machine-scoped (`tasks`, `workspaces`, `repo_paths`, `terminal_sessions`,
  `workflow_*`, `review_notes`, `memories` — they own local filesystem/process
  resources). A plugin table declares which; the rule: derived from a provider
  identity → user-scoped; owns machine resources → machine-scoped. The subtle
  seam is that repo identity is *dual* — mirror tables key by the GitHub numeric
  `repoId`, machine tables by `(owner, name)` strings — so a repo rename
  silently strands machine-scoped rows. `repo_paths.githubRepoId` is the
  partial bridge; make it the stated one. The rule already covers the
  anticipated repo-less case (§9.1): a user-scoped *feed* table (a dashboard's
  "assigned to me", an inbox) is derived from a provider identity → user-scoped,
  keyed by connection with no repo column — the same rule, no new category.
- **Parent lineage is declared.** Task-scoped tables (`task_links`,
  `review_notes`, `terminal_sessions`, `workflow_runs`) declare their parent
  column in the table contribution, and core derives the cascade
  (retiring the hand-maintained `db/cascade.ts` list), the prune pass (the
  nine orphaned PR child tables — review §5), **and a secondary index on the
  declared parent column** ([performance.md](./performance.md) §3.5) from the
  registry — one declaration, three artifacts — instead of a comment saying
  "remember to extend this".
- **Workspace config gets a table.** §4.6's workspace config contributions land
  as one generic `workspace_config (workspaceId, key, value)` row store —
  `prefs`' shape at workspace scope, values validated by the contributing
  plugin's codec. The nine per-feature columns on `workspaces` (setup/dev/
  restart/teardown/dbUrl scripts, previewMode/previewValue) fold into it; the
  table stops accreting and ends as identity + ordering + appearance.

  This is a migration risk, not just a data-model move — the values are
  machine-local and drive shell execution, database connection resolution,
  and preview URLs. The compatibility contract:

  - **One-time migration, not lazy.** A single Drizzle migration copies
    `setupScript`, `setupScriptTrigger`, `devScript`, `devRestartScript`,
    `teardownScript`, `dbUrlScript`, `previewMode`, and `previewValue` into
    `workspace_config` rows and drops the columns; the code switches to the
    new store **in the same PR**. No transition window means no split-brain:
    old columns and new rows are never both live writers, and settings pages
    only ever see one store.
  - **What stays on `workspaces`:** identity, ordering, and appearance —
    `name`, `isDefault`, `sort`, `icon`, `color`. These are core workspace
    fields, not plugin config.
  - **Codecs preserve today's validation**, not just the values: blank
    strings normalize to null, port-mode preview values are validated,
    `setupScriptTrigger` is validated against `'off' | 'created' |
    'terminal'` (null → `'terminal'`), and the existing error codes survive
    (§16 of [feature-parity.md](./feature-parity.md) — standardize shape,
    keep vocabulary).
  - **Workspace deletion clears `workspace_config` rows** alongside
    `workspace_projects` — derived from the declared parent lineage above,
    not a second hand-maintained cascade list.
- **One migration journal while plugins are in-tree.** Plugins own their schema
  *files* (drizzle-kit merges multiple schema paths) but there is one drizzle
  project and one linear migration history. Per-plugin journals with ordering
  negotiation is dynamic-loader territory (§9 step 8) — pure tax today, per
  tenet 5.

---

## 9. Getting there (order of operations)

This is a direction, not a rewrite. Each step is independently shippable and
most are already recommended in review.md for non-plugin reasons.
**[implementation.md](./implementation.md) is the authoritative build order** —
it resequences these steps, resolves the alternatives, and adds gates; the
mapping is noted per step below.

1. **Registries in place, same code** — pane registry (review.md #5), command
   registry, keybinding registry, settings-page registry. Hardcoded ladders
   become registry iteration; features still statically imported. This alone
   delivers most of the extensibility win. *(→ implementation Phase 5.)*
2. **The event bus + composition root** (review.md #4) — kill the global-setter
   wiring, the boot race, the manual eviction trio; add `will-quit`.
   *(→ implementation Phases 1 and 5.)*
3. **The typed IPC bus** (review.md #3) — *superseded*: implementation.md
   decision 1 collapses the transport onto loopback HTTP + WS instead
   (Phase 3); the typed bus is the fallback only if that stalls.
4. **Agent-tool projection** (§4.8) — collapse harness/MCP/IPC into one
   declaration; port notes/memory/run/browser tools onto it.
   *(→ implementation Phase 4.)*
5. **The sync engine** (review.md #2) — extract, then express github/linear/
   rollbar reads as descriptors. *(→ implementation Phases 2 and 7.)*
6. **The restore pipeline** (§8.3) — phased core service; port App.tsx effects
   slice by slice. *(→ implementation Phase 6.)*
7. **Foldering** — only now move code into `core/` + `plugins/`; the seams
   already exist, so this step is `git mv` plus lint rules (no plugin→plugin
   internal imports, no core→plugin imports). *(→ implementation Phase 10.)*
8. **Optional endgame** — a dynamic loader and out-of-tree plugins, if a real
   need appears. Everything above is worth it even if this step never happens.

The litmus test for done: adding a Sentry integration (source + pane + context
section + linkifier) or a fourth agent profile touches **zero** core files.

### 9.1 Anticipated future surfaces (don't foreclose, don't build)

Named here so the phases above avoid decisions that would make them a rewrite
later. Neither is planned; both stay purely additive if the seams below hold.

- **A dashboard** — per-workspace, and/or a cross-workspace surface above all
  workspaces, where each plugin contributes cards for "what the user should
  know": PRs assigned to or awaiting review, assigned Linear issues, a
  Dockerfile-check status, eventually an email inbox. Architecturally this is
  **an aggregating consumer over the source registry** — what the context pane
  (§4.7) is to context sections — not a new mechanism. Its card point would be
  a sibling of context sections (§4.7) and badges/pollers (§4.13): a component +
  a data source + `scope` + `when` + an item→action, with cards refreshing
  through `ctx.poll` (state §5.2) and rows acting through promotion (§4.2). No
  new state axis is needed — app/workspace scope already covers it (state
  §5.1). Two things must not be foreclosed before then: (1) the sync engine's
  resource key stays **opaque/connection-keyed, not repo-typed** (§4.9,
  implementation Phase 2), so a user-scoped feed ("assigned to me across all
  repos", an inbox) is the same descriptor with a different key, backed by a
  user-scoped table (§8.5); and (2) the shell must not treat "a workspace is
  always active" as load-bearing (§2.1, §4.2), so an app-level view with no
  workspace is a new view mode rather than a shell refactor. The provider
  capability set (integrations §4) stays open so a `userFeed`-style capability
  slots in as data. Guard those and the dashboard is additive.
- **A dynamic loader** — §9 step 8 above.
- **An external-control principal** — a CLI, an external agent, or a companion
  tool authorized to drive acorn over the loopback surface the transport
  collapse already builds ([implementation.md](./implementation.md) Phase 3).
  This is *not* a new API: after Phase 3 the whole control surface is loopback
  HTTP behind one guard, so enabling an authorized non-browser caller reduces to
  the guard recognizing a new principal kind — provided the auth guard is
  principal-based (not cookie-based), runtime/session events are serializable and
  wire-reachable, the stream WebSocket is a typed multi-channel multiplexer,
  mutation provenance derives from the principal, and control mutations land as
  routes rather than preload residue. The threat model deliberately *blocks*
  unauthorized local callers today ([security.md](./security.md) §1); the five
  seams that keep an authorized one additive-not-a-rewrite are
  [security.md](./security.md) §9. Don't build it; keep those seams open.
