# Post-vNext architecture analysis

An architecture review of the completed vNext codebase, written for a future agent (or person) to
pick up. It answers one question: **is this system as simple as it can be, and are the seams in
place for what comes later** — multi-user support, a plugin marketplace, third-party plugins —
none of which exist yet, and none of which should require a disruptive rewrite when they arrive.

Method: the whole tree was read (apps, packages, plugins, tools, scripts, docs) with sizes, import
graphs, and every claim below verified against the working tree at the time of writing. File and
line references are anchors, not exhaustive lists. Beware: the project migration notes under
`docs/legacy/projects/` are historical and several of their "not done" items have since landed (provider-credential gating
via `requireProviderAccess`, the idempotency middleware). Trust this file and the code over the
legacy notes.

## Status ledger — 2026-08-08

The findings below are the original numbered registry; this ledger records what has landed since
the review and where the remaining work is being executed.

- **F2 landed:** `packages/protocol/src/ws.ts` now carries the open transport envelope, with
  channel payloads registered through `packages/client-core/src/wsChannels.ts`.
- **F3 landed:** node plugins broadcast through `NodePluginContext.events`; the plugin contract and
  `docs/plugins.md` describe broadcast as the client-notification mechanism.
- **F4 landed:** `tools/arch/boundaries.test.ts` enforces the reviewed `CORE_IMPORT_ROOTS` set and
  the testkit boundary.
- **F5 landed:** core owns `ACTIVE_IDENTITY` through `main/core/identity/identity.ts`; the architecture
  suite keeps other packages from writing it.
- **F7 landed:** capability IDs and signatures live in provider `contract/` modules, and app-to-plugin
  reach is guarded by the shrinking entrypoint/contract baseline.
- **F11 landed:** per-owner client state registers scope evictors through
  `client-core/registries/scopeEviction.ts`.
- **F12 landed:** direct child-process use is restricted to the reviewed `CHILD_PROCESS_OK` set in
  `tools/arch/boundaries.test.ts`.
- **F6 landed:** [WP-08](antislop/WP-08-late-binding-unification.md) moved runtime late binding to
  capability registries, removed the app wiring directory, and left only a justified test adapter.
- **F8 landed:** [WP-07](antislop/WP-07-core-plugin-data.md) kept core's deliberate shared read models
  while moving the notes write namespace and ownership boundary into the notes plugin.
- **F9 landed:** [WP-09](antislop/WP-09-composition-root-parity.md) made `apps/node` the shared graph,
  reconciliation, and drain composition layer for both hosts.
- **F10 landed:** [WP-03](antislop/WP-03-shell-source-registry.md) through
  [WP-06](antislop/WP-06-shell-css-migration.md) moved source, route, read, and feature-style ownership
  out of the shell.
- **F13 landed:** [WP-11](antislop/WP-11-mutation-validation.md) classified the JSON audit and added
  schemas at external control and persisted-data boundaries.

## Verdict

The architecture is in genuinely good shape. The plugin seam is real, not aspirational: across all
20 plugins there are exactly 10 cross-plugin import sites, forming 7 edges, and 100% of them go
through `contract/` entrypoints. Zero deep imports of another plugin's internals, zero plugin→app
imports, and the rules are enforced by a test rather than by convention. There are zero TODO/FIXME/
HACK markers and zero `@ts-ignore`/`@ts-expect-error` across the entire production tree, and the
comment discipline — every non-obvious decision carries a *why*, often with the incident that
motivated it — is the best defence this codebase has against regression.

The findings below are therefore not about rot. They are about **where the seams stop one step
short of the stated future**, plus a hygiene list. The headline: the single biggest obstacle to
third-party plugins is that plugin wire contracts live in core (`packages/protocol/src/api.ts`),
and the single biggest obstacle to multi-user is that a plugin writes the node's identity. Both are
fixable incrementally, and both get more expensive the longer new code accretes onto the current
shape.

## What is good and must be preserved

Named explicitly so a future cleanup pass doesn't mistake discipline for accident.

- **`tools/arch/boundaries.test.ts`** (603 lines, 22 rules at this review pin) is the load-bearing artifact of the
  repository. Filesystem-derived package list (a new package is covered the day it appears), an
  anti-vacuity guard (asserts ≥20 packages, >2000 edges, >500 cross-package edges, so a broken
  scanner fails loudly instead of passing empty), transitive contract-purity (rule 12: a plugin's
  `contract/` may not reach its own `client/`/`server/`/`main/` even indirectly), acyclicity,
  client/node split, protocol-as-pure-sink, an Electron allowlist of exactly 4 files, and a
  shrinking baseline already driven to zero (`SCHEMA_BASELINE: []`). Extend it; never weaken it.
  Most recommendations below end with "add a rule here" — that is the enforcement mechanism this
  codebase has already proven works.
- **Token custody.** The renderer never holds a device token: `apps/desktop/src/app/main/fleetStore.ts`
  projects nodes through an explicit allowlist ("so a field added to FleetNode cannot leak by
  default"), and `nodeBroker.ts:125` strips the token again at the IPC boundary. The renderer's
  CSP has `connect-src 'self'` — it cannot open a network connection at all.
- **One `QueryClient` per node** (`packages/client-core/src/node/fleet.ts:15-28`). UUID collision
  across nodes is impossible by construction rather than by convention, and IndexedDB partitioning
  falls out for free. The written trade-off analysis there is exemplary.
- **The registry pattern** (`packages/client-core/src/registries/`): everything sorts on declared
  `order` (never registration order), duplicate IDs throw, registration returns a `Disposable`,
  contributions carrying a `providerId` must name their own plugin or registration throws. The
  two-phase plugin lifecycle (`init` = pure registration, `activate` = side effects, host-owned
  disposal) exists because two plugins once did I/O against half-empty registries — keep it.
- **`capabilityId<T>()`** (`packages/node-core/src/server/plugin/capabilities.ts`, 68 lines): a
  typed Map key, deliberately not a DI container, per-runtime rather than a module singleton so
  the runtime can boot twice in one process. This is the right size for the problem.
- **Security seams that are mounted, not per-route.** `packages/node-core/src/server/index.ts:56-102`
  gates by mount path (both `/x` and `/x/*` forms), so a route added later inherits its gate.
  Uniform-null auth failures (tokens, pairing codes refuse to be status oracles). A single error
  envelope built in exactly one place (`server/respond.ts`). The process broker's env allowlist and
  kill-tree (`main/core/exec/proc.ts`). `SecretService.use()`'s scrub-on-throw
  (`main/core/security/secrets.ts`).
- **Meta-tests that iterate the system instead of hardcoding it**: the provider conformance suite
  (`apps/node/test/integration/conformance.test.ts`) walks the registry and holds every provider to
  the same obligations; `standaloneParity.test.ts` scans both composition roots; the two-node e2e
  (`apps/desktop/e2e/twoNode.spec.ts`) boots a real second node over real TLS and exercises
  revocation mid-session.
- **Build-time guards**: renderer startup budget (1.25 MB scripts / 200 KB styles), emitted-bundle
  syntax checks, staged migration chains with the past failure documented in the config.

## Findings

Ranked by how much each threatens the stated future, not by effort. Tier 1 items should be done
before (or as part of) any work that builds toward multi-user or external plugins, because every
new feature written against the current shape deepens them.

### Tier 1 — structural

**1. `packages/protocol/src/api.ts` is a 701-line mixing bowl, and it is the single largest
blocker to third-party plugins.** One core file contains: wire types for a dozen plugin domains
(GitHub's `Repo`/`Pull`/`Review`/`Check`, Linear, Rollbar, editor, memory, terminal, workflows…),
**route URL builders for nine plugins' namespaces** (`workflowGateRoute`, `databaseRowsRoute`,
`memorySearchRoute`, `rollbarItemsRoute`…), and **33 TanStack query-key builders** — a pure client
concern in the shared protocol package. Meanwhile docker, database, http, and editor own their
route literals and types locally in their own `shared/` — so the codebase currently demonstrates
two contradictory conventions for the same thing, and only the second one is available to a plugin
that doesn't get to edit core.

*Recommendation:* migrate per-plugin route builders, domain types, and query keys into each
plugin's `shared/` (and `contract/` where another plugin needs them), following the docker/http
convention. `@acorn/protocol` keeps what is genuinely shared: the error envelope, node identity,
pairing, the broker schema, the service protocol, WS envelope, and core-resource types
(workspaces/tasks/devices/audit/backup). This is mechanical, independently landable per plugin,
and finishes with a boundary rule: protocol may not mention a plugin name.

Two adjacent facts belong to the same finding. First, the "Zod schemas are the single source of
truth for wire types" claim (architecture doc) is only ~14% true: Zod appears in 4 of 20 protocol
files (`serviceProtocol`, `broker`, `node`, `errors`); everything else on the HTTP wire is plain
TS types with no runtime validator. Second, node-side request validation is split accordingly —
roughly 10 route files parse with Zod, several hand-roll `typeof` checks (`routes/tasks.ts`,
`routes/workspaces.ts`, `routes/integrations.ts`). Decide the rule once (Zod at every mutation
boundary is the defensible one) and note it in docs; don't chase full request/response codegen.

**2. The WS channel space is closed in core.** `packages/protocol/src/ws.ts` is a discriminated
union that enumerates every channel — including 11 docker-specific ones (`docker:exec:open`,
`docker:logs:attach`…) — and imports `DockerStatsSample` from a docker file inside protocol. On
the client, `packages/client-core/src/wsClient.ts:106-126` hardcodes the dispatch table for
`term:*`, `workflow:*`, `agent:*`, `docker:*`. The node side already has the right seam
(`registerWsChannelHandler(prefix, handler)` in `main/wsHub.ts:44`) but the frame type it serves
is the closed union. A new plugin with a stream cannot exist without editing two core packages.

*Recommendation:* protocol keeps only the transport envelope (channel string + payload + seq);
per-channel payload types move to the owning plugin's `shared/` (agents and docker already keep
payload internals there — finish the job). Client-core gets a channel-prefix registry mirroring
the node's, and the docker/terminal/workflow/agent entries become registrations from those
plugins' `client/index.ts`.

**3. The node has no event bus, though the docs and the plugin types both promise one.**
`docs/plugins.md` lists event subscriptions as a contribution point and
`server/plugin/types.ts:3` names "events" as a collaboration mechanism — but `NodePluginContext`
has no `events` member and no emitter exists in node-core. The real mechanism is `wsBroadcast` /
`broadcastStatus` in `main/wsHub.ts` / `main/notify.ts`, which six plugins reach by **deep import**
(agents, docker, terminal ×7 call sites, changes, memory, workflows).

*Recommendation:* pick one, deliberately. Either (a) add a minimal `ctx.events`
(publish/subscribe, in-process, fanned to WS — no durability, per the vNext non-goals), or
(b) bless broadcasting as the only mechanism, expose it on `NodePluginContext`, and fix the docs.
Option (b) is smaller and honest about what exists; option (a) is worth it only if a concrete
consumer (e.g. memory's session-completed hook) needs plugin-to-plugin notification without a
capability call. Either way the deep imports stop, and a boundary rule can then forbid plugin
imports of `main/wsHub.ts`.

**4. Nothing curates what plugins may import from core.** Every package declares
`"exports": { "./*": "./src/*" }` — there is no encapsulation at the module-system level, only
what `boundaries.test.ts` chooses to forbid, and today it does not constrain plugin→packages
imports at all. In practice plugins import ~50 distinct `@acorn/node-core/*` paths and ~60
distinct `@acorn/client-core/*` paths. Worse, three **test helpers live in production `src/` and
are imported by plugins** — `server/routes/testDb.ts` (30 references), `testAuth.ts`,
`testIntegration.ts`.

*Recommendation:* do **not** resurrect a `plugin-api` package (it was dropped for good reasons —
the current package and boundary docs are the source of truth). Instead: (a) move the three test helpers to an
explicit `testkit/` path so the intent is visible in every import; (b) add a boundary rule that
lists the core module roots plugins may import (`server/middleware/`, `server/respond.ts`,
`main/pluginStorage.ts`, `main/core/`, `server/plugin/`, `testkit/`…), seeded from today's actual
usage and run as a ratchet like `SCHEMA_BASELINE`. That converts "everything is public" into "the
public surface is a reviewed list" without a build step, versioning, or a new package. When
third-party plugins become real, that list *is* the draft API to harden.

**5. A plugin owns the node's identity — the one multi-user blocker worth fixing now.**
`Principal.userId` for every authenticated request comes from `ACTIVE_IDENTITY`
(`server/middleware/auth.ts:43,60`), a single string stored in `<dataRoot>/active-identity` — and
its **only writer is `plugins/github/src/server/routes/deviceAuth.ts:109`**, which sets it to the
GitHub integration label after device auth. Core's answer to "who is the user" is set by a
feature plugin as a side effect of connecting one provider.

The *other* single-user assumptions are fine to leave: they are explicit, documented in place
(`db/schema.ts:17` "single-user app", `deviceTokens.ts:14` "no per-token scopes because this is
single-owner software", tasks, project configuration, and terminal sessions machine-scoped with no
`user_id`), and
adding user scoping later is a schema migration plus a device→user mapping — real work, but
contained, and speculative columns now would be worse. The identity write is different: it is an
inverted dependency that every future identity feature would have to unwind first.

*Recommendation:* core owns identity (a small `identity.set/clear` on CoreServices or a core
route); github calls it like any consumer. Cheap now, structural later.

### Tier 2 — consistency and inverted dependencies

**6. [Resolved by WP-08] Three parallel late-binding mechanisms on the node.** (a) The capability registry — the
intended seam. (b) Nine module-global bridge slots in `server/bridge.ts` and friends
(`setConfigTrustBridge`, `setPluginsBridge`, `setRunBridge`,
`setOnTaskCreated`, `setOnWorktreeCreated`, `setStreamHandlers`,
`setWorktreesRoot`). (c) Two surviving `wireX()` functions in the app wiring layer from the
mechanism the plugin host explicitly replaced (`host.ts:4`). Three of the bridge slots are core
code shaped for a specific first-party plugin — `setRunBridge` and `setOnTaskCreated` for terminal — which is a core→plugin dependency wearing a
disguise. New contributors cannot tell which mechanism a new edge should use.

*Recommendation:* converge on capabilities for anything plugin-provided; a bridge slot is
acceptable only for app-composition concerns (worktrees root, stream handlers). Kill the
plugin-shaped slots by replacing each with a capability the plugin provides and core consumes.

**7. Capability IDs live in the wrong place three times out of ten.** `AGENTS_RUNTIME`
(`plugins/agents/src/main/runtime.ts:486`), `MEMORY_KNOWLEDGE`
(`plugins/memory/src/main/knowledgeIpc.ts:65`), `WORKFLOWS_RUNNER`
(`plugins/workflows/src/main/workflowRunner.ts:74`) are declared in `main/` instead of
`contract/`. Consequence: the composition roots deep-import plugin internals to get them, and
`apps/node/src/service/runtime.ts:216-220` documents a workaround where the root resolves a
capability *on terminal's behalf* because importing the ID directly would create a plugin→plugin
edge. Move the three IDs (and their types) to `contract/`, delete the workaround, and add a
boundary rule: apps import plugins only via `node/index.ts`, `client/index.ts`, `main/index.ts`
entrypoints or `contract/`.

**8. Core owns plugin-shaped data and policy.** The core schema holds `issues` and
`issueResources` (Linear's and Rollbar's cached items); `db/cascade.ts` is a manual cascade list
whose own comment says "if you add one, delete its rows below" — a correctness trap for every new
provider; `server/sync/policy.ts` hardcodes per-plugin staleness TTLs; `contextSections.ts:299`
hardcodes `SECTION_ORDER = ['pr','issues','notes','memory']` (plugin-owned IDs ordered by core)
and also *implements* the pr/notes/memory sections; and `TaskContext` carries a dual shape —
`sections[]` plus legacy top-level `pr/issues/notes/memory` kept alive by `budgetLegacy()`.

*Recommendation:* the generic external-item projection (`itemStore.ts`) is a reasonable core
service — keep it — but TTLs should ride the provider contribution, section order should be a
declared `order` on the section contribution (the client registries already prove this pattern),
and the legacy context shape should get a removal date. The cascade list should become either
real foreign keys within core tables or a per-provider cleanup hook on the integration
contribution.

**9. The two composition roots duplicate each other.** `apps/node/src/service/runtime.ts` (364
lines, Electron-supervised) and `apps/node/src/server/standalone.ts` (196 lines, headless)
duplicate the ~50-line `NodePluginDeps` bag, the reconcile sequence and its ordering constraints,
the drain list, and the wiring calls; the only genuine deltas are Electron capabilities and the
handshake. The guard is `standaloneParity.test.ts`, which scans source text for five needles —
it catches a *removed* call, not divergent arguments or ordering. (`runtime.ts` also contains the
same explanatory comment block twice, at :164-181 and :191-199.) Extract a shared
`bootNode(deps)`; the parity test then shrinks to asserting the genuine deltas.

**10. The shell is GitHub-shaped.** The client's entire URL space is `/:owner/:repo/:number`
(four routes, all rendering `noop` — they exist to feed `useParams`); `App.tsx:337` hardcodes
`setSelectedSource('github')`; the topbar renders an owner/repo/#number breadcrumb with a
hardcoded github.com link; `tasks/tasks.ts:19` special-cases `'github'` beside the registry
lookup; and `plugins/github/src/client/contentLinks.ts` ships the **Linear** URL recogniser with
a closed `InAppTarget` union of `linear | pr | repo` — a third provider cannot participate in
link resolution without editing github. Related domain leaks in shared client code: ~20
GitHub/Linear/Rollbar query factories in `packages/client-core/src/queries.ts`, and
`styles.css:24-32` eagerly imports GitHub/Linear pane CSS (including a 538-line
`pull-detail.css`) into the shell manifest for every user, plugins enabled or not, against the
200 KB style budget.

*Recommendation:* task-origin plugins should contribute route patterns / link recognisers /
breadcrumb rendering through the existing registries; the query factories move out with finding
1; the CSS moves to per-plugin imports loaded by `client/index.ts`. This is parity-preserving
mechanical work.

**11. Client state lives in three mechanisms with two node-keying conventions.** Server data in
TanStack (partitioned per node — good), UI state split between module-level Solid signals (18
files in client-core, 12 in plugins) and the `persistedStateRegistry` slice system. Which
mechanism holds a given fact is not derivable from the fact. Node-keying is done two ways: the
manual evictor list in `apps/desktop/src/app/client/scopedEviction.ts` (whose own comments admit
the pattern's limits — every new module signal must remember to add itself; nothing enforces it)
versus hand-built keys like `tasks.ts:31`'s `` `${activeNodeId()}/${workspaceId}` ``. There is
also an ad-hoc retained-intent mailbox inside `registries/clientEvents.ts` working around
mount-order races.

*Recommendation:* one registry-based eviction hook (`onNodeScopeEvicted(cb)`) that plugins and
core state owners register with — the existing registry infrastructure makes this ~30 lines —
and a short decision rule written into `docs/state.md` (persisted slice vs signal vs query).
Don't unify the three mechanisms; each is right for its job. Just make membership legible and
eviction impossible to forget.

**12. "All child processes go through the process broker" is stated but not enforced.**
`main/core/exec/proc.ts:1` quotes the security doc's universal claim, yet 18 modules import
`node:child_process` directly, 10 of them in plugins (agents drivers, docker CLI, editor search,
database, http send, terminal). Several are legitimately outside the broker's model (long-lived
streaming children, PTYs), but nothing distinguishes a sanctioned exception from an unmigrated
call site.

*Recommendation:* add a boundary-test allowlist of files permitted to import `child_process`
(ratchet), and correct the sentence in `docs/security.md` to say what is true: short-lived task
work goes through the broker; the listed long-lived engines own their children under the same
env-hygiene rules.

### Tier 3 — hygiene sweep (cheap, low-risk, do opportunistically)

Dead code:
- `packages/client-core/src/agentToolsClient.ts` — zero references.
- The GitHub client id/secret no longer belong to `RuntimeBindings`; the optional GitHub plugin reads
  its client id from its own runtime configuration.
- Unused `timingSafeEqual` import in `server/middleware/auth.ts:1`.
- `apps/node/src/server/routes.ts` — now `export {}`, kept alive as a parity-test anchor.

Stale references (fix the pointer or the code):
- `client-core/src/capabilities.ts:61` references `node/nodeSocket.ts`, which does not exist.
- `server/bridge.ts:5-9` references `main/bootstrap.ts` and `app/main/serverBridges.ts` — neither exists.
- Root `CLAUDE.md`/`AGENTS.md` point at the tracked `docs/architecture-overview.md` and topic docs.
- `docs/plugins.md` says required plugins are "GitHub, terminal, and agents" — the code requires
  five: agents, github, memory, notes, terminal (both sides agree with each other, not with the doc).
- `docs/http-client.md` and `docs/plugins.md` name a core HTTP service; `CoreServices` has no
  `http` member and `plugins/http/src/server/send.ts:268` calls bare `fetch()` — there is no
  central outbound-request guard or host allowlist. Either build the small service (it earns its
  keep the day a third-party plugin can make outbound requests) or fix the docs; today the docs
  describe a control that does not exist, which is worse than not having it.
- Docs imply a scheduler; retention (`pruneAudit`, idempotency cleanup) runs at boot only, with
  the reasoning written in `server/audit.ts`. Fine — but say so where the scheduler is promised.

Oddities:
- Notes' HTTP surface was served under **memory's** namespace at review time. WP-07 now serves the
  current `/v2/p/notes` namespace from `plugins/notes/src/server/routes/notes.ts`; the old memory
  route remains a compatibility alias for one release.
- `apps/node/package.json` lists `@acorn/node-core` and every plugin under `devDependencies`.
  Works because vite bundles; misdescribes the graph.
- The `profiles-*` packages were not plugins in the host sense — each was a bare
  `AgentProfileContribution` object (11–48 lines of source under 3 config files each, 9 files of
  boilerplate for 95 lines total), registered by the app wiring layer. WP-08 folded that
  registration into `plugins/agents/src/main/index.ts`, making the first-party ownership explicit.
  Meanwhile everything that actually encodes Claude/Codex knowledge — drivers (296–325 lines
  each), normalizers, usage probes, pricing tables — lives hardcoded inside `plugins/agents`, and
  `plugins/agents/src/node/index.ts:27-32` registers `'claude'`/`'codex'` drivers by literal.
  So the visible seam (add a profiles package) does not actually let anyone add an agent CLI; a
  third-party provider needs a PR into plugins/agents. Either fold the three profiles into a
  single package (or into agents) and accept that agent providers are first-party, or make the
  driver registry a real contribution point. The current shape advertises an extensibility that
  isn't there.
- `parseLinkInput` (`server/routes/tasks.ts:41-46`) accepts dual field names
  (`connectionId`/`integrationId`, `providerId`/`provider`), leaking naming history through the
  wire type.
- `plugins/context` and `plugins/onboarding` are client-only, and `model-providers` node-only —
  fine, but `docs/plugins.md`'s package-shape description doesn't mention the pattern.

Tooling gaps:
- `lint` runs oxlint followed by `tsc --noEmit` in every package. Oxlint is intentionally narrow —
  it catches the repository's agreed dead-code and `node:` protocol issues without turning style
  disputes into noise; broader lint coverage remains a separate decision.
- No test for `apps/desktop/src/app/main/bootstrap.ts` — the crash/restart/quit interlock state
  machine (five mutable flags coordinating three restart paths) is the only main-process file
  without one, and it is the file where a mistake shows up as "the app won't die" on a user's
  machine. Extracting the state machine from Electron wiring would make it testable.
- `main/pluginStorage.ts` (the per-plugin DB factory, 42 inbound references) has no direct test,
  though integration suites exercise it incidentally.
- No coverage thresholds anywhere — acceptable given the meta-test culture, noted for completeness.

## Readiness vs the stated future

| Capability | Already in place | What blocks it | Verdict |
| --- | --- | --- | --- |
| **Remote/fleet** | Done and tested (broker, pinning, per-node caches, two-node e2e, revocation) | — | Shipped |
| **Multi-user** | Device identity, principal plumbing, audit trail, per-scope tokens structurally ready | Finding 5 (plugin writes identity); machine-scoped tables with no `user_id`; single-owner token semantics — the latter two documented and deferrable | "Refactor later" is realistic **if finding 5 is done now**; otherwise identity unwinding comes first and touches auth middleware, github, and every principal consumer at once |
| **Third-party plugins / marketplace** | The contract seam, capability registry, boundary enforcement, per-plugin DBs/migrations, per-node disable UI, conformance-test pattern | Findings 1, 2, 4 (wire contracts, WS channels, core surface all require editing core); plus, acceptable to defer: compile-time registration, non-namespaced contribution IDs (`pr`, `notes` are global — two plugins claiming one is a boot throw), `parity.test.ts` hardcoding the 13 panes, `plugin.ts` deliberately not catching init throws, no versioned plugin API, no sandboxing | Findings 1–4 decide whether this is "some refactoring" or "major and disruptive." Do them while the plugin count is 20 and every author is in this repo |

## What NOT to do

The system's simplicity is earned; these would spend it:

- **No `plugin-api` package resurrection.** The interfaces live in `node-core/server/plugin/types.ts`
  and `client-core/registries/plugin.ts` and that is fine; finding 4's import allowlist gives the
  same clarity without a package, a build, or a version.
- **No runtime plugin loading, sandboxing, signing, or manifest machinery** until third-party
  plugins are actually scheduled. The vNext non-goals list was right.
- **No DI container.** The capability registry's own comment says it is deliberately not one.
- **No durable event bus / event sourcing.** The event stream is an invalidation channel; clients
  refetch after a gap. That decision is load-bearing and correct.
- **No speculative `user_id` columns or per-token scopes** ahead of a real multi-user design.
- **No OpenAPI/codegen pipeline.** Every consumer is TypeScript; Zod-at-the-boundary (finding 1)
  is as far as it needs to go.
- **No component-render test infrastructure.** The "vitest can't render Solid; e2e is the UI
  proof" split is documented and consistent — adding jsdom half-measures would create false
  confidence.

## Suggested sequencing for a future agent

Each item is independently landable and each ends with an enforcement step (boundary rule, test,
or doc correction) so it cannot regress. Order within tiers is by leverage.

1. **Finding 5** — move identity ownership to core. Small, unblocks the multi-user story.
2. **Finding 1** — evacuate `protocol/src/api.ts` plugin-by-plugin (start with rollbar or linear,
   the smallest core-owned sets; github last). End state: protocol never names a plugin; boundary
   rule added.
3. **Finding 7 + 6** — capability IDs to `contract/`; replace the three plugin-shaped bridge
   slots with capabilities; entrypoint rule for apps→plugins imports.
4. **Finding 3** — decide the event story (recommend: bless broadcast on `NodePluginContext`),
   stop the `wsHub` deep imports, fix docs.
5. **Finding 2** — open the WS envelope, client channel registry, move channel payloads out.
6. **Finding 4** — testkit split + core-import allowlist ratchet.
7. **Finding 9** — extract `bootNode()`; shrink the parity scan.
8. **Finding 10** — de-GitHub the shell via existing registries; move CSS and query factories.
9. **Finding 8** — TTLs and section order onto contributions; retire the legacy context shape.
10. **Finding 11** — eviction hook; state-placement rule in `docs/state.md`.
11. **Finding 12** — child-process allowlist; correct `docs/security.md`.
12. **Tier 3 sweep** — dead code, stale pointers, doc corrections, and the `bootstrap.ts` test.

Run `pnpm lint`, `pnpm test`, and `pnpm --filter @acorn/arch-tests test` after every item; the
arch suite must stay at zero plugin→plugin violations and its baselines may only shrink.
