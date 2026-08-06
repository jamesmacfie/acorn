# Phase 3 — what shipped, what did not, and where it diverges

Phase 3 (plan.md § "Phase 3 — break the coupling map") is **complete against its exit criteria**, with one
criterion met only in part and said so plainly below.

Read [phase2-notes.md](./phase2-notes.md) first if you have not. One of its findings — the most serious thing
it left open — is fixed here, and it was a security hole rather than a coupling one.

## Status against the exit criteria

plan.md names three. Honestly assessed:

| Exit criterion | State |
| --- | --- |
| boundary-test baseline is zero — no plugin imports another outside `contract/` | **done.** All six edges gone. The rule is no longer a ratchet with a `BASELINE` array; it asserts `[]`, the same transition the schema rule made in Phase 2. Verified non-vacuous by reintroducing an edge and watching four rules fail. |
| disabling any non-required plugin at startup leaves the rest working (automated test cycles through each plugin disabled) | **node side done, client side NOT.** `apps/node/test/integration/pluginDisable.test.ts` boots the real fifteen-plugin list on a real temp data root once per optional plugin — ten cases, each asserting the other plugins' routes, tools, sections and SQLite files are untouched. Verified non-vacuous: neutering the host's disabled check fails all ten. The client half cannot be done in vitest at all; see "The client-side cycling test" below. |
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

### Out of scope, named rather than quietly skipped

- **`plugins/docker`'s daemon-wide routes** (`/prune`, `/containers/:ref/action`, `/volumes/:ref/remove`) are
  not task-scoped at all, so `mayActOnTask` has nothing to check. **A task-scoped agent can still prune the
  daemon.** That is a real hole and a different shape of fix — a docker-wide `requireDevice`, or
  task-attributed containers — and bolting an `if` on would have looked like a fix without being one.
- `plugins/http` needs nothing: it is already device-only at the router (`principal?.kind !== 'device'` → 403).
- `plugins/memory`'s `/memory*` and `/workspaces/:wsId/notes*` are workspace-scoped, not task-scoped.

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
what it always should have been: no source selected and no task open.

Two consequences a reader should know:

- **`githubClientPlugin` must stay FIRST in `apps/desktop/src/app/client/plugins.ts`.** Rail order is
  registration order, and github's position is now guaranteed by nothing else. e2e S1 is the only check.
- **`SourceContribution.promotion` is now optional.** github's browse creates tasks inline from its PR list
  rather than through `PromoteToTaskModal`, so declaring one would be a required field satisfied by dead code.

**The terminal drawer** is a contribution into a new `'drawer'` `UiSlotId`, with `activeTask` added to
`UiSlotContext`. Not `overlay`: the drawer sits below the routed surface in document order and the overlay
host sits after it, so merging them would put the drawer above every dialog. `when: (ctx) => ctx.terminalOpen`
keeps the property the shell's `<Show>` had — xterm is not constructed for a closed drawer.

**Onboarding** got a `ClientPlugin` once the first-run GATE moved into the plugin
(`OnboardingOverlay.tsx`). App.tsx owned a five-clause `<Show>` reading two of its own queries to decide when
another plugin's modal appears; every input was client-core's, so the shell contributed nothing but the place.

**The palette** got a row-source registry (`registries/paletteRows.ts`) — the `palette` member Phase 2 left
out for having no consumer. The split that makes it not-a-second-command-registry: a **command** is a known
action registered at component mount (still nine sites, still correct); a **row source** is a query whose
results happen to be actionable, fetched per task from repo config and therefore unknowable until the palette
opens. Terminal contributes run + layout rows, workflows contributes workflow rows, and `composeItems` no
longer knows what a run target or a workflow is. Config parse errors are still hoisted to the top, and that
stayed core's rule rather than each source's, because it is a property of the whole list.

## The context sections registry (plan item 3)

`setContextSections(buildContextSections({ notes, memory, pullRequest }))` was ONE slot that had to be filled
with every source at once, which is why `apps/node/src/wiring/contextSectionsWiring.ts` existed and why
neither notes nor memory could own its own half. It is a per-owner contribution point now, shaped exactly like
`registerAgentTool`, and **that file is deleted**.

- `github` registers `pr`, `notes` registers `notes` (absorbing the three-scope walk, the empty-note skip and
  the workspace-note compatibility filter verbatim), `memory` registers `memory`, and core keeps `issues` —
  `task_links` and `issues` are core's tables, and the two provider plugins reach them through the
  `ExternalItemStore` seam rather than owning them.
- **A plugin section cannot see core's database handle.** `PluginContextSection.assemble` takes
  `Omit<AssembleArgs, 'db'>` and `asContextSection()` is where the handle is dropped. It costs nothing: of the
  four sections, only core's own `issues` ever touched `db`.
- **Order is declared, not registration-derived.** `SECTION_ORDER` is the assembled block's wire order, which
  every existing prompt and the client's Manifest preview assume; sorting on registration would have made the
  plugin list's order load-bearing, which `host.ts` explicitly refuses.
- One behaviour trap caught in review: the notes closure originally used
  `CoreServices.tasks.workspaceId`, which **throws** where the wiring's `workspaceIdForRepo` returned null.
  That would have failed prompt assembly for a repo not yet in a workspace — a degraded section becoming a hard
  error. It is caught, and the catch is the behaviour rather than defensive noise.

## The client-side cycling test, and why it is not there

The exit criterion asks for an automated test cycling each plugin disabled. **The node half exists and is
thorough. The client half cannot be written in vitest**, and the reason is structural rather than lazy:

`apps/desktop/src/app/client/plugins.ts` imports every plugin's `client/index.ts`, several of which statically
import a `.tsx` module (a contribution carries a component). This repo's vitest configs deliberately run in a
bare Node environment with no Solid transform, so that import fails outright.

Both escapes were tried and rejected:

- **Adding `vite-plugin-solid` to `apps/desktop/vitest.config.ts`** fixes the transform and then fails at
  module scope on `window is not defined` — Solid's `delegateEvents` runs on import.
- **A DOM environment** (`jsdom` / `happy-dom`) would fix that, and neither is a dependency of this repo. That
  is a documented stance — "vitest cannot render Solid components; the e2e suite is the only real check" — and
  reversing it is a decision for the owner, not a side effect of a test.

So the client half is covered where it can be: `registries/plugin.test.ts` pins the host's disable, required
and re-activation semantics against a synthetic list, and e2e S1 asserts the real rail order — which is the
one client registry whose visible order is registration order, and therefore the one a disable could reorder
rather than merely shorten. **What is NOT proven is that fifteen real client plugins survive a hole in the
list.** If the jsdom question is answered yes, `initClientPlugins(clientPlugins, { disabled: [name] })` over
the real list is a short test and the node-side file is the template.

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
- **Docker's daemon-wide routes** — see above. The one real security gap left open, stated rather than fixed
  badly.
- **The client-side disabled-plugin cycle** — see above.
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
| every non-required node plugin can be disabled with the other fourteen's routes, tools, sections and databases intact | `apps/node/test/integration/pluginDisable.test.ts` (all ten cases fail when the host's check is neutered) |
| context sections order by the wire contract not registration order; duplicate ids throw naming both owners; an owner's sections come out as a unit; a plugin section never receives `db` | `packages/node-core/src/server/agentTools/contextSections.test.ts` (2 fail when the sort and the handle-drop are neutered) |
| no plugin imports another outside `contract/` — as an invariant, not a baseline | `tools/arch/boundaries.test.ts` (reintroducing one edge fails four rules) |
| the palette's list order survives rows arriving pre-built from contributions | `packages/client-core/src/palette/model.test.ts` |
| an ungated source is always shown; provider-gated ones need a connected integration | `packages/client-core/src/tabs/sources.test.ts` — github is a registered fixture now, not a hardcoded literal |
| the three agent-profile argv builders, including codex's schema-to-file divergence and aider's deliberate absence of a headless surface | `plugins/profiles-{claude,codex,aider}/src/main/*.test.ts` — three packages that had zero tests |
| the rail renders four contributed sources in order with github first, and the GitHub browse renders through the source registry on a real repo route | e2e S1 + S8 (both fail if github's source registration is removed) |

`pnpm lint` 26/26, `pnpm test` 26/26, `node scripts/db.mjs check` 9/9 chains, `pnpm --filter
@acorn/arch-tests test` 14/14, e2e 9/9.

## For Phase 4

The two mechanisms Phase 4's Settings → Plugins needs are in place and tested: `disabledPlugins` on the
service start config, and a node-side proof that disabling works. What it will need on top is the client-side
equivalent — which means answering the jsdom question above, because the shell's tolerance of a missing plugin
is currently unproven.
