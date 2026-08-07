# Phase 3 — what shipped, what did not, and where it diverges

Phase 3 (plan.md § "Phase 3 — break the coupling map") is **complete against its exit criteria**, with one
criterion met only in part and said so plainly below.

Read [phase2-notes.md](./phase2-notes.md) first if you have not. One of its findings — the most serious thing
it left open — is fixed here, and it was a security hole rather than a coupling one.

## Corrections after review

An adversarial review of this phase found that **the security audit below was incomplete and this document
argued for some of the gaps rather than merely recording them.** Six of its claims were wrong. They are
corrected in place, and listed here because the wrong version of a security note is worse than no note:

1. **`wsHub`'s scope check covered only `term:` channels.** The generic channel dispatch and `wsBroadcast` had
   no principal check at all, which handed a task-scoped credential an interactive shell in any container.
   Fixed; see "The WebSocket half, missed the first time".
2. **`plugins/memory`'s proposal routes had no gate,** and this document said they needed none. The human
   review gate `memory_write` promises was bypassable.
3. **The `/workspaces/:wsId/notes*` reasoning was backwards** — "workspace-scoped, not task-scoped" was
   written as a reason to SKIP a gate, when a workspace holds many tasks and `global` holds all of them.
4. **Docker's gap was described as availability** ("can prune the daemon") when the sharper half is secret
   exfiltration through `GET /containers/:ref/inspect`, which returns every container's environment.
5. **"Verified non-vacuous" was itself vacuous for `pluginDisable.test.ts`.** Every failure it recorded landed
   on the host's self-report line, never on a contribution assertion — which could not fail.
6. **"The client half cannot be written in vitest at all" is false.** Measured; see that section.

Two smaller ones: the `'drawer'` slot's stated z-order justification was not true, and e2e S1 could not see the
rail reorder it was described as guarding.

## Status against the exit criteria

plan.md names three. Honestly assessed:

| Exit criterion | State |
| --- | --- |
| boundary-test baseline is zero — no plugin imports another outside `contract/` | **done.** All six edges gone. The rule is no longer a ratchet with a `BASELINE` array; it asserts `[]`, the same transition the schema rule made in Phase 2. Verified non-vacuous by reintroducing an edge and watching four rules fail. |
| disabling any non-required plugin at startup leaves the rest working (automated test cycles through each plugin disabled) | **node side done, client side NOT — but the reason given for the second half was wrong.** `apps/node/test/integration/pluginDisable.test.ts` boots the real fifteen-plugin list on a real temp data root once per optional plugin. Its first version asserted much less than this row claimed; see "What pluginDisable.test.ts was actually asserting". The client half is writable in vitest after all; see "The client-side cycling test". |
| per-plugin vitest suites pass against real temp data roots | **done.** Every table-owning plugin already had one through `makeTestPluginDb`. The three `profiles-*` packages had zero tests and now have argv suites — the spawn boundary, which is the only thing in a profile package worth pinning. |

Two things ride along that plan.md lists under Phase 3's *description* rather than its exit criteria, and both
are done: **item 1** (the shell stops importing feature UI) and **item 3** (the context sections registry).

## The security fix, done first

**The terminal plugin's HTTP routes had no task-scope check**, and neither did fifteen other plugin route
files. `requireTaskScope` was mounted over `/v2/core/tasks/:id*` and nowhere under `/v2/p`. phase2-notes.md
called this "the most serious thing left" and it was: `POST /v2/p/terminal/sessions/:sid/send` typed into a
PTY keyed on an opaque session id with no ownership check at all — arbitrary command execution as the owner
in another task's shell, which `wsHub.ts` refuses one directory away.

The fix is the one that file said it needed — a mount plus an audit, not one `if`:

- **One mount** in `packages/node-core/src/server/index.ts`:
  `.use('/v2/p/:plugin/tasks/:id', requireTaskScope)` and the `/*` form. `:plugin` is a wildcard on purpose —
  the invariant is "a task-addressed path under `/v2/p` is gated", not "these six plugins are gated" — so it
  covers changes, database, editor, memory, workflows and docker today and a plugin added tomorrow.
- **Three opaque-id families** resolve their own owner, because no mount can see a task that is not in the
  path: terminal's `/sessions/:sid/*` (plus `POST /sessions`, whose taskId is in the BODY), agents'
  `/sessions/:sessionId/*` + `/attachments/:attachmentId` + `/artifacts/:artifactId`, and workflows'
  `/workflows/runs/:runId/*`.
- **Two list surfaces are filtered, not gated**: terminal's session roster and agents' list/search. An
  unfiltered roster handed every agent the titles and task ids of every other task's sessions — the same shape
  of leak as an unguarded `/devices`.
- **`POST /workflows/triggers/poll` is refused outright** for a confined caller. It evaluates every task's
  triggers and STARTS runs; there is no task to narrow it to.

Two implementation notes worth keeping:

- `isTaskConfined(c)` was added beside `mayActOnTask`, and it is deliberately a **boolean** rather than "the
  task this principal is bound to". The id-returning form has to use `null` for "unconfined", which collides
  with a `task`-scoped principal carrying no taskId — and those two must produce opposite answers. Today
  `verifyInternalToken` rejects that token outright, so the collision is unreachable; a guard whose
  correctness rests on an invariant two files away is still the wrong shape. Both call sites were first
  written as `mayActOnTask(c, '')`, which is correct by accident and unreadable.
- Every guard lets a **missing bridge** through so `viaBridge` still answers 503. "The PTY engine is not
  wired" (`dev:node`) and "that is not your session" are different answers, and the client's degraded-mode
  handling keys on the former. Each suite pins it.

**Measured, and it changed the design:** Hono's trailing `/*` matches ZERO segments, so
`/sessions/:sessionId/*` already covers `/sessions/:sessionId` — and also matches the STATIC sibling
`/sessions/search`. Without an explicit skip the guard resolves a session literally named "search", gets null,
and 404s a legitimate query for every confined caller: a working feature broken by its own guard. Core's
`index.ts` registers both the bare and `/*` forms; that redundancy is harmless and pre-existing, and the new
code does not reproduce it.

### What the first pass missed

This section previously read "out of scope, named rather than quietly skipped". Two of its three entries were
wrong, and the third understated its own case. All three are closed now.

- **`plugins/docker`'s daemon-wide routes are device-only** (`server/routes/docker.ts`). The original note
  called this "a task-scoped agent can still prune the daemon", which is true and is the *smaller* half. The
  larger one is exfiltration: `GET /containers/:ref/inspect` returns `env: string[]` — every container's full
  environment — and `/containers` plus `/task-summary` enumerate what to ask for. A confined agent could read
  `POSTGRES_PASSWORD` and every API key in every container the owner runs, none of it related to its task. The
  fix is the docker-wide `requireDevice` the note said it would be, gated per subtree, with the two
  `/tasks/:id/*` routes left to core's mount. `docker.test.ts` walks the router's own route table and refuses
  any ungated non-task path, so a route added later cannot quietly miss the list.
- **`plugins/memory`'s proposal routes are gated.** "Workspace-scoped, not task-scoped" was written as though it
  answered the question; it did not. `POST /memory/proposals/:id/resolve` had no `/tasks/:id` in its path, so
  the mount never saw it and the router added nothing — an agent could approve its OWN proposal (which is the
  entire mechanism `memory_write`'s tool description promises), or approve any other task's pending proposal
  with an attacker-chosen `edited` body, which `knowledgeIpc.ts` then writes into that proposal's worktree. It
  is `requireDevice` now: a human reviewing is the point. `GET /memory/proposals` honoured `?task=` verbatim and
  returned every pending proposal on the node with bodies when omitted; it is confined the way
  `confineFilter` confines agents' session roster.
- **`/workspaces/:wsId/notes*` is device-only, and the original reasoning was backwards.** "Workspace-scoped,
  not task-scoped" was offered as a reason to skip a gate — but a workspace holds many tasks and `global` holds
  all of them, so this was the BROADEST surface in the router, not a narrower one. A task-scoped agent could
  create, overwrite, retitle or delete a note in any workspace or in `global`, and POST `included: true`; an
  included global or workspace note is assembled into every task's context block, and the sibling-note
  compatibility filter cannot stop it because that filter keys on `originTaskId`, which a non-task location has
  none of. It also walked past the `notes_write` tool-permission preference, enforced only on the agent-tool
  surface. An agent loses nothing: `notes_list`/`notes_read`/`notes_write`/`notes_append` reach all three
  scopes, resolve the workspace from the agent's own task rather than a caller-supplied id, and cannot set
  `included` at all (`plugins/notes/src/main/agentTools.test.ts` pins those properties as the counterweight).
- `plugins/http` needs nothing: it is already device-only at the router (`principal?.kind !== 'device'` → 403).
- **`PUT /v2/p/agents/pricing` is gated too**, found while checking the above. `ownerId(c)` is the same value
  for a device and an agent-spawned child, so nothing distinguished them, and a task-scoped agent could
  overwrite the cost table every usage figure in the app is computed against. The reads stay open.

Still NOT gated, and unchanged from Phase 2: the other providers' credential reads (linear, rollbar, database,
model-providers) — see [phase2-notes.md](./phase2-notes.md).

### The WebSocket half, missed the first time

The audit above was an audit of HTTP routes, and `wsHub.ts` was cited in it as the thing doing the right thing
already ("which `wsHub.ts` refuses one directory away"). It was doing the right thing for exactly one channel
family.

`main/wsHub.ts`'s scope check sat INSIDE `if (frame.channel.startsWith('term:'))`. Everything else fell through
to `channelHandlers.get(...)?.onFrame(...)` unchecked — and `plugins/docker/src/main/wsChannel.ts` answers
`docker:exec:open` by spawning `docker exec -it <ref> sh -c 'exec bash'` in a real PTY, with `docker:exec:in`
writing arbitrary bytes into it. An agent holds `ACORN_API_TOKEN`, `ACORN_DATA_DIR` (→ `node.json` → the port)
and `NODE_EXTRA_CA_CERTS`, so it can open this socket itself: an interactive shell in any container on the
machine, one directory from the guard that exists to stop that.

`wsBroadcast` was the same class of bug in the other direction — it fanned every frame to every connection, so
`workflow:step:event` (another task's raw agent stream: assistant text and tool results) and `workflow:notice`
(other tasks' titles) reached task-scoped sockets while the HTTP side had just started 404ing a foreign run.

Both are fixed with one rule, `isConfined(conn)` — the socket-level twin of `isTaskConfined`:

- **Every non-`term:` channel is refused** for a task-confined socket, mirroring the posture workflows'
  node-wide trigger poll already took. Docker browse and exec are a renderer surface with no agent consumer, so
  a per-channel opt-in would have had no takers and the wrong default for a channel added later.
- **A task-confined socket receives no broadcast at all.** Not one broadcast frame is task-addressed, so there
  is nothing to narrow to. Filtering per channel on a payload taskId was considered and rejected: only
  `workflow:notice` has one, runId and sessionId would each need a lookup through a plugin the hub must not
  know about, and the default for a new channel would silently be "leak it". Its own attached stream still
  reaches it through the per-session sink, which never went through `wsBroadcast`.

## The six edges, and what each one actually was

The useful finding of this phase is that **four of the six were not feature coupling at all.** They read as
entanglement and were something cheaper. Recording the split because the next reader will find edges that look
like the hard kind and mostly are not.

**Three were a file in the wrong package, reaching nothing of the plugin they were imported from:**

| Edge | What it was | Where it went |
| --- | --- | --- |
| `context -> notes` | `requestNoteOpen`, a one-line wrapper over client-core's own `openPane` + the `notes:open` PaneIntent | inlined at the call site |
| `preview -> terminal` | `runClient.ts`, a fetcher for `/v2/core/tasks/:id/run*` — **core's** routes since Phase 2's scope-shed | `packages/client-core/src/tasks/` |
| `workflows -> agents` | `workflowClient.ts`, a fetcher for **workflows' own** routes that happened to live in agents | `packages/client-core/src/tasks/` |

**One was a surface that was too wide.** `agents -> terminal` needed `create`; importing
`client/terminalClient.ts` also handed it `write`, `attach`, `kill` and `resize`. Terminal published the
client twin of its existing `terminal.sessions` node capability
(`plugins/terminal/src/contract/sessionsClient.ts`, create + list only). The other two uses turned out not to
be terminal's at all: the null-probe was `capabilities().terminal` and `onStatus` was client-core's
`wsOnStatus`.

**Two were real UI composition**, and each got the contribution point plugins.md already named:

- `context -> memory` → the **client context-section registry**
  (`packages/client-core/src/registries/contextSections.ts`). `ContextPane` rendered `MemorySection` by
  importing it, and a hardcoded `section.id === 'memory'` decided both where it went and which section stayed
  visible when empty. Both are registry lookups now. This also gave memory its first `ClientPlugin` — "has
  client code but nothing registrable" was the whole reason it had none.
- `github -> linear` → `scanLinearRefs` to linear's `contract/` (a pure function over strings, so it names
  nothing internal), and the panel through a **providerId-keyed ref-panel registry**
  (`registries/refPanels.ts`). The point is not the indirection: a PR body can reference any provider's item,
  and the plugin that reviews pull requests should not gain a dependency per provider.

### The one that could not go where the plan said

`workflowClient.ts` was supposed to move into `plugins/workflows/src/contract/`. **It cannot**: workflows
already imports agents' `sessionExecute` contract on the node side, so an `agents -> workflows` edge closes a
package **cycle**. `boundaries.test.ts` rejects that outright and turbo's `topo` transit node needs an acyclic
graph to order tasks at all. Contract status does not help — the acyclicity rule reads the raw package graph,
as it must.

So it sits in client-core beside `runClient`. The residual **ownership** question is stated in that file and
is not closed: plugins/agents' task sidebar still fetches workflow runs and steps to merge into its own
roster, which plugins.md puts in a task-activity slot both plugins contribute to. That is slot work; the
fetcher's location is what stands in for it meanwhile. The poller agents was registering on workflows'
behalf (`workflows.triggers` — its id already said whose it was) did move.

## The shell stops importing feature UI (plan item 1)

`App.tsx` named `PullList`, `PullDetail`, `CreatePullForm`, `ComparePreview`, `DiffView`, `TerminalPanel` and
`OnboardingModal`. It now names none of them.

**GitHub became an ordinary source, and that was the substance of it.** `client-core/tabs/sources.ts`
hardcoded `{ id: 'github' }` ahead of the registry while every other Source went through `sourceRegistry` +
`<Dynamic>` — which is *why* the shell had to render the three-pane browse itself, in its `<Switch>` fallback.
The layout moved verbatim to `plugins/github/src/client/GithubBrowse.tsx` (panes, headers, the two
force-refresh handlers, the `+ New PR` affordance), github registers it as a source, and the fallback became
what it always should have been: no source selected and no task open. The two force-refresh handlers were
**copied rather than moved** — they sat unreferenced in App.tsx afterwards, holding the shell's last four
imports of github query keys, and are deleted now.

Two consequences a reader should know:

- **`SourceContribution.order` decides the rail, not the plugin list.** Phase 3 shipped this the other way:
  rail order was `sourceRegistry.entries()` unsorted, so `githubClientPlugin` had to stay first in
  `apps/desktop/src/app/client/plugins.ts` and the rule was stated only in a comment. **e2e S1 could not check
  it.** `availableSources` hides a provider-gated source with no connected integration and the e2e fixture
  connects none, so linear and rollbar — github's two immediate neighbours in that list — never appeared in
  S1's `['GitHub','Docker','API','Agents']` at all; moving them changed nothing it could observe. `order` is a
  required field now, sorted with an `id` tiebreak, which is the same move the node side makes with
  `SECTION_ORDER` and for the same recorded reason. That was the last client registry whose visible order
  depended on a declaration list, so `plugins.ts` is alphabetical and nothing reads its order.
- **`SourceContribution.promotion` is now optional.** github's browse creates tasks inline from its PR list
  rather than through `PromoteToTaskModal`, so declaring one would be a required field satisfied by dead code.

**The terminal drawer** is a contribution into a new `'drawer'` `UiSlotId`, with `activeTask` added to
`UiSlotContext`.

Why not `overlay`: the justification first recorded here — "the drawer sits below the routed surface in document
order and the overlay host sits after it, so merging them would put the drawer above every dialog" — **was not
true.** `TerminalPanel` renders through a `<Portal>`, so where its host sits in App.tsx's document order decides
nothing about stacking, and the drawer is below a modal by z-index anyway (`--z-drawer: 50` vs `--z-modal: 100`).
The genuine reason is the one stated second and is worth keeping: `when: (ctx) => ctx.terminalOpen` means an
unrendered contribution never mounts, so xterm is not constructed for a closed drawer — the property the shell's
`<Show>` had. Overlay contributions decide their own visibility inside the component, which would build a
terminal for every task view and throw it away.

**`onClose` is `closeTerminal`, not `toggleTerminal`.** It shipped as the toggle with a comment arguing the two
were equivalent because `when` guarantees the drawer is open while the contribution is mounted, so the toggle
could only go open → closed. That does not survive `TerminalPanel.closeTab`, which decides to close the drawer
after two `await`s: close the last two tabs in quick succession and both continuations see an empty roster, so
`onClose` fires twice — the first toggle closes the drawer and the second reopens it, into an empty drawer where
`onMount` auto-launches the rail's default profile. `UiSlotContext` carries an idempotent `closeTerminal`
alongside the toggle; the shell already used the mirror form for its own open affordance.

**Onboarding** got a `ClientPlugin` once the first-run GATE moved into the plugin
(`OnboardingOverlay.tsx`). App.tsx owned a five-clause `<Show>` reading two of its own queries to decide when
another plugin's modal appears; every input was client-core's, so the shell contributed nothing but the place.

One thing did not survive the move intact: the `dismissed` signal went INSIDE the component, and this
contribution renders through the overlay slot host, which sits inside App.tsx's
`<Show when={nodeReady() && !isRestoring()}>`. So a brief node blip unmounted the subtree, disposed the signal,
and the first-run modal reappeared over the work of someone who had already closed it. It is at module scope now
— per renderer instance, which is per window, which is the session, so "session-only" is preserved rather than
widened.

**The palette** got a row-source registry (`registries/paletteRows.ts`) — the `palette` member Phase 2 left
out for having no consumer. The split that makes it not-a-second-command-registry: a **command** is a known
action registered at component mount (still nine sites, still correct); a **row source** is a query whose
results happen to be actionable, fetched per task from repo config and therefore unknowable until the palette
opens. Terminal contributes run + layout rows, workflows contributes workflow rows, and `composeItems` no
longer knows what a run target or a workflow is. Config parse errors are still hoisted to the top, and that
stayed core's rule rather than each source's, because it is a property of the whole list.

The row-building that moved out of `composeItems` into two plugin files arrived with no tests of its own, and it
carried a bug: terminal's layout branch checked that the cached fetch belonged to the task being invoked
(`lastLayouts?.taskId === taskId`) and its **run branch checked nothing**, taking the target id out of the row
id and the running flag off `item.running` — a value as old as the last palette render. A stale "Stop: dev" row
left on screen after switching tasks called `stop` in the NEW task with the OLD task's idea of what was running.
One cache with one key now serves both branches, and the running state comes from the fetch rather than the row.
Both plugins' row sources have suites, and so does `paletteRowSources()`'s sort — which nothing asserted, despite
being the only thing holding the run → layout → workflow order after the split.

## The context sections registry (plan item 3)

`setContextSections(buildContextSections({ notes, memory, pullRequest }))` was ONE slot that had to be filled
with every source at once, which is why `apps/node/src/wiring/contextSectionsWiring.ts` existed and why
neither notes nor memory could own its own half. It is a per-owner contribution point now, shaped exactly like
`registerAgentTool`, and **that file is deleted**.

- `github` registers `pr`, `notes` registers `notes` (absorbing the three-scope walk, the empty-note skip and
  the workspace-note compatibility filter verbatim), `memory` registers `memory`, and core keeps `issues` —
  `task_links` and `issues` are core's tables, and the two provider plugins reach them through the
  `ExternalItemStore` seam rather than owning them.
- **Core's `issues` is registered at MODULE SCOPE in `contextSections.ts`**, and getting that wrong was a
  shipped regression. It was registered from `apps/node/src/wiring/agentToolsWiring.ts`, reached only from
  `service/runtime.ts` — so `apps/node/src/server/standalone.ts`, which calls `initPlugins` and never
  `wireAgentTools`, booted without it. On `pnpm dev:node` (and, per that file's own header, on the node a client
  pairs with over the LAN) the Linked-issues row silently vanished from the context pane, the assembled send
  block and the launch injector. Nothing errored. Before this phase the registry self-seeded all four sections,
  so the regression arrived WITH the contribution point — and `pluginDisable.test.ts` then baked the
  three-section result in as its expected baseline. Module scope is right for this one only: it closes over no
  dependency (the `db` handle arrives per `assemble` call), so it is the same object on every boot. The paired
  `removeContextSections('core')` was deliberately not carried over — a module body runs once, so it would be a
  permanent no-op documenting a problem that no longer exists.
- **A plugin section cannot see core's database handle.** `PluginContextSection.assemble` takes
  `Omit<AssembleArgs, 'db'>` and `asContextSection()` is where the handle is dropped. It costs nothing: of the
  four sections, only core's own `issues` ever touched `db`.
- **Order is declared, not registration-derived.** `SECTION_ORDER` is the assembled block's wire order, which
  every existing prompt and the client's Manifest preview assume; sorting on registration would have made the
  plugin list's order load-bearing, which `host.ts` explicitly refuses.
- One behaviour trap caught in review: the notes closure originally used
  `CoreServices.tasks.workspaceId`, which **throws** where the wiring's `workspaceIdForRepo` returned null.
  That would have failed prompt assembly for a repo not yet in a workspace — a degraded section becoming a hard
  error. The first fix was `.catch(() => null)`, and that was too wide: `workspaceId` throws for "task not
  found", for "no membership" AND for any genuine database failure, so a broken query read as "this task has no
  workspace" and every included workspace note dropped out of the prompt with nothing logged. A prompt quietly
  missing its context is worse than a section that errors. `CoreServices.tasks.workspaceIdOrNull` now returns
  null for exactly the two real cases and lets a failure propagate.

## What pluginDisable.test.ts was actually asserting

The status table above claimed this file asserted "the other plugins' routes, tools, sections and SQLite files
are untouched", verified non-vacuous by neutering the host's disabled check. Both halves were overstated, and
the second one is instructive: neutering the disabled check makes `expect(reduced.skipped).toEqual([name])`
fail, which is the host's own self-report. **Every recorded failure landed on that line, so the contribution
assertions were never exercised at all.** A non-vacuity check has to break the thing the assertion is about.

What the assertions were: `lostRoutes.every((id) => id.startsWith(name))`, which is vacuously TRUE on an empty
array; no "did anything vanish" check for tools or sections; `snapshot.databases` built and never compared;
and the three PROVIDER registries — the *entire* contribution of linear, rollbar and model-providers — never
snapshotted, so three of the ten cases asserted nothing whatsoever about the plugin they disabled. Four
mutations survived it: the host clearing the registries after the disabled check instead of before, all ten
optional plugins registering nothing, a disable dropping a sibling's tool and a context section, and a disable
dropping the provider registrations.

The rewrite states what each optional plugin OWNS as data (an `OWNED` ledger, derived once by diffing a full
boot against each disabled boot, then frozen) and compares each registry with ONE exact equality:
`reduced === full − owned[name]`, by multiset subtraction so a duplicate disappearing is visible — which
matters, because eleven of github's routers share the key `github/repos`. That says both directions at once:
the disabled plugin's entries are gone, everyone else's survive byte for byte and in order, and nothing
appeared. `owned > 0` is asserted per plugin, so a plugin that contributes nothing fails loudly. Each boot now
gets its OWN data root, without which the two `databases` lists were identical by construction and could not
have differed. All four mutations above now fail; the first two fail every case.

## The client-side cycling test

This section previously said the client half "cannot be written in vitest at all", called the reason structural
rather than lazy, and recorded two escapes as tried and rejected. **That is wrong, and it was wrong when
written.** Measured:

- `vite-plugin-solid` is **already a devDependency** of both `apps/desktop` and `packages/client-core`. Adding
  it to `apps/desktop/vitest.config.ts` transforms the plugin entrypoints' `.tsx` imports fine.
- `window is not defined` then comes from **one call**: Solid's `delegateEvents(names, document = window.document)`,
  which runs at module scope and needs `window.document.addEventListener`. A stub object satisfies it. **No DOM
  environment is required**, so the `jsdom` / `happy-dom` question — the one this document deferred to the owner
  — never had to be asked.

Probed end to end: with `solid()` in the config and a **20-line setup file**, `initClientPlugins(clientPlugins)`
over the REAL sixteen-plugin list runs, and so does one pass per optional plugin disabled. Three globals are
needed, and two of them are findings rather than plumbing:

- `window.document.addEventListener` — Solid's `delegateEvents`, above.
- `localStorage` — **`plugins/http`'s init reads it synchronously** (`purgeStoredHttpDrafts`).
- `fetch` returning `{ sessions: [] }` — **`plugins/agents`' init issues an HTTP request**
  (`activateManagedAgentNotifications` → `managedStore.loadAll`).

Those last two contradict `ClientPluginContext`'s own documented claim that init "attaches listeners rather
than performing I/O", which is the stated reason `ClientPlugin.init` is synchronous. That is a real defect in
two plugins, not a gap in the test, and it is why the test is worth having: it is the only thing that would
notice a third plugin doing I/O at activation.

**The test is deliberately still NOT written**, because landing it means adding a plugin and a setup file to a
config seven existing suites share, and injecting three globals into them — a change the owner should make on
purpose rather than inherit from a test. The recipe above is the whole of it and the node-side file is the
template.

Meanwhile the client half is covered where it is: `registries/plugin.test.ts` pins the host's disable, required
and re-activation semantics against a synthetic list, and e2e S1 asserts the four ungated rail sources render.
**What is still NOT proven is that sixteen real client plugins survive a hole in the list.**

## Deliberate divergences from the docs

**`runClient` is core's, not a `terminal.runTargets` capability.** plugins.md still says "terminal exports a
`runTargets` capability". That design predates Phase 2's scope-shed, which moved every run route to
`/v2/core/tasks/:id/run*`. A capability here would wrap core's own routes and add an indirection with no owner.

**The ref-panel registry is keyed on `providerId`, not a github-named slot.** plugins.md describes "linear
registers a panel into github's PR-detail slot". Keying on the provider means github asks *who renders this
ref?* rather than hosting a hole named after one plugin. It has exactly one contributor today and
`plugins/rollbar` deliberately does **not** register: its panel is rendered only by its own pane and browse
view, so a registration would be a contribution with no host.

**PullDetail's Integrations section stays github's.** plugins.md's full shape has linear contributing the
ref-row list too. It renders refs, not Linear internals, and its data comes from client-core's
`linearIssuesOptions` — so moving it was not needed to reach baseline zero. Not done, on purpose.

**`ClientPluginContext` has a `contribute(registry, entry)` escape for a PLUGIN-published registry.** There is
one: plugins/github's `contentLinkRegistry`, which decides which hrefs in rendered markdown acorn opens itself.
It cannot be a named member, because client-core would have to import the plugin's type — the dependency
direction the plugin API exists to prevent. Phase 3 shipped it as a direct `contentLinkRegistry.register(...)`
call, so the host held **no disposable**: Phase 4's disable could not take it back, and a re-activation would
hit the registry's duplicate-id throw (which is what the `if (!get(id))` probe around the call site was really
papering over). It routes through the same `own()` path as every named point, so the provider-ownership rule and
disposal both apply. `ContentLinkContribution.providerId` was dropped in the same change: nothing read it, and
`'linear'` on a contribution registered by github is exactly what that rule refuses.

**`disabledPlugins` is on the service start config now.** Both hosts honoured a `disabled` list and nothing
plumbed it; `serviceStartConfigSchema` carries it so Settings → Plugins (Phase 4) is a list rather than a
refactor. Per NODE, not per client: which plugins a node runs decides which routes exist and which SQLite
files open.

## A gotcha that cost a red suite, now documented in the test

`boundaries.test.ts`'s scanner **does not strip comments.** A comment containing
`` `lazy(() => import('@acorn/plugin-x/…'))` `` — the natural way to describe code you just moved — becomes a
phantom import edge, and with a placeholder path it fails the resolver rule. Left as is deliberately: stripping
comments means parsing, the false positive is loud and immediate, and the opposite failure (missing a real edge
hidden after a `//`) is worse. The rule now says so at the regex.

## Not done

- **Per-endpoint `Idempotency-Key`.** Unchanged from Phase 2 and for the same reason: `RouteContribution`
  carries no declaration and no client call site sends a key, so declaring routes `required` breaks create-PR,
  post-comment and send-agent-turn immediately. The declaration and the call sites land together.
- **The client-side disabled-plugin cycle.** Writable in vitest — see above for the measured recipe. Not landed
  because it changes a config seven other suites share.
- **Two client plugins do I/O in `init`**, found while probing that: `plugins/http` reads `localStorage` and
  `plugins/agents` issues a `fetch`. `ClientPluginContext` says activation "attaches listeners rather than
  performing I/O", and that is the stated reason `ClientPlugin.init` is synchronous — so this is a real
  divergence, not a documentation nit. It is also why the cycling test is worth landing: it is the only thing
  that would notice a third plugin joining them.
- **Other providers' credential reads are still ungated** (linear, rollbar, database, model-providers), exactly
  as phase2-notes.md left them. Docker's daemon surface, memory's proposals and the workspace note surface are
  no longer on this list.
- **plugins/agents' task sidebar owning workflow data.** The last ownership question with no import behind it.
- **`forEachConnection` still has zero callers** and `storageFootprint` still does not measure the
  `plugins/*.sqlite` files. Both were named in phase2-notes.md as cleanup; neither is a defect and neither
  moved.

## What is covered by tests

| Claim | Where |
| --- | --- |
| a task-scoped credential cannot drive, kill, resize, spawn into or enumerate another task's PTYs; unknown session ids fail closed; 503 still beats 404 without an engine | `plugins/terminal/src/server/routes/terminal.test.ts` (verified non-vacuous by neutering all three guards — 4 of 9 fail) |
| the same for agent sessions, attachments, artifacts, create/import, and list/search pinning; `/sessions/search` stays reachable despite colliding with `/sessions/:sessionId` | `plugins/agents/src/server/routes/managed.test.ts` — a new file; this router had no route test at all (5 of 9 fail when neutered) |
| the same for workflow runs, plus the node-wide trigger poll refused | `plugins/workflows/src/server/routes/workflow.test.ts` (2 fail when neutered) |
| the plugin-namespace mount confines both real mount shapes, and does NOT reach an opaque-id route | `apps/node/test/integration/internalPrincipal.test.ts` — asserted through a SYNTHETIC plugin, because the invariant is the mount, not the plugin list (2 fail when the mount is removed) |
| every non-required node plugin can be disabled with every other plugin's routes, tools, sections, PROVIDERS and SQLite files byte-identical, and each disabled plugin's own contributions gone | `apps/node/test/integration/pluginDisable.test.ts` — verified against four mutations the previous version survived: clears moved after the disabled check (10 fail), all ten optional plugins registering nothing (11 fail), a disable dropping a sibling's tool + a section (4 fail), a disable dropping the provider registrations (4 fail) |
| core's `issues` section exists on a standalone-shaped boot (`initPlugins`, no `wireAgentTools`) | same file (2 fail when the module-scope registration is removed) |
| a task-scoped credential cannot use ANY non-`term:` WS channel — docker's `exec` shell above all — and receives no broadcast, while a device and the `service` scope are unaffected | `packages/node-core/src/main/wsHub.test.ts` (2 fail when either guard is removed) |
| the memory proposal gate needs a device; the proposal list is confined to a confined caller's own task; the whole `/workspaces/:wsId/notes*` subtree is device-only | `plugins/memory/src/server/routes/knowledge.test.ts` (3 fail when the three guards are removed) |
| an agent still reaches all three note scopes through `notes_*`, with the workspace resolved from its own task, provenance stamped, and no way to set `included` | `plugins/notes/src/main/agentTools.test.ts` — a new file, the counterweight to the gate above |
| every daemon-wide docker route 403s a task-scoped credential and 200s a device — enumerated from the router's OWN route table, so a new ungated route fails the suite | `plugins/docker/src/server/routes/docker.test.ts` (1 fails when any single `use` is removed) |
| `PUT /agents/pricing` needs a device; the usage reads stay open | `plugins/agents/src/server/routes/usage.test.ts` (1 fails when the gate is removed) |
| `workspaceIdOrNull` answers null for "unknown task" and "no membership" but PROPAGATES a database failure | `packages/node-core/src/main/core/tasks.test.ts` (1 fails if it is written as `workspaceId(...).catch(() => null)`) |
| a stale palette run row from another task is dropped rather than acted on, and the fetched running state beats the row's flag; both plugins' row mapping; `paletteRowSources()` sorts on `order` | `plugins/terminal/src/client/paletteRowSource.test.ts`, `plugins/workflows/src/client/paletteRowSource.test.ts`, `packages/client-core/src/registries/paletteRows.test.ts` (1 fails per mutation) |
| a plugin-published registry written through `ctx.contribute` is disposed on disable and replaced on re-activation, and still obeys the provider-ownership rule | `packages/client-core/src/registries/plugin.test.ts` (2 fail when it bypasses `own()`) |
| context sections order by the wire contract not registration order; duplicate ids throw naming both owners; an owner's TWO sections come out as a unit; a plugin section never receives `db` | `packages/node-core/src/server/agentTools/contextSections.test.ts` (2 fail when the sort and the handle-drop are neutered; the remove case now also fails if `remove` stops after the first match, which one section could not detect) |
| no plugin imports another outside `contract/` — as an invariant, not a baseline | `tools/arch/boundaries.test.ts` (reintroducing one edge fails four rules) |
| the palette's list order survives rows arriving pre-built from contributions | `packages/client-core/src/palette/model.test.ts` |
| an ungated source is always shown; provider-gated ones need a connected integration; and the rail sorts on the DECLARED `order` with an id tiebreak, not on registration | `packages/client-core/src/tabs/sources.test.ts` — github is a registered fixture now, registered LAST while declaring the lowest order so registration order cannot explain the result (3 fail when the sort is removed) |
| the three agent-profile argv builders, including codex's schema-to-file divergence and aider's deliberate absence of a headless surface | `plugins/profiles-{claude,codex,aider}/src/main/*.test.ts` — three packages that had zero tests. The no-options invocations are pinned as WHOLE ARRAYS now: the original `toContain` checks never asserted claude's `-p` or `--verbose` (dropping either breaks the headless runner) and an inserted `--dangerously-skip-permissions --add-dir /` survived them. All three mutations now fail |
| the rail renders the four UNGATED contributed sources through a real Electron render, and the GitHub browse renders through the source registry on a real repo route | e2e S1 + S8 (both fail if github's source registration is removed). S1 is membership, NOT order: `availableSources` hides linear and rollbar when no integration is connected, and the fixture connects none — so it never saw github's two neighbours. Order lives in the vitest case above |

`pnpm lint` 26/26, `pnpm test` 26/26, `node scripts/db.mjs check` 9/9 chains, `pnpm --filter
@acorn/arch-tests test` 14/14, e2e 9/9.

## For Phase 4

The two mechanisms Phase 4's Settings → Plugins needs are in place and tested: `disabledPlugins` on the service
start config, and a node-side proof that disabling works — a real one now, rather than one that failed on the
host's self-report line.

What it will need on top is the client-side equivalent. That is a **20-line setup file and one plugin in
`apps/desktop/vitest.config.ts`**, not a jsdom decision — the earlier claim that it was impossible is corrected
above. Two things should be fixed alongside it, because a disable/re-enable cycle is exactly when they bite:
`plugins/http` and `plugins/agents` both perform I/O inside a synchronous `init`. The shell's tolerance of a
missing plugin is still unproven.
