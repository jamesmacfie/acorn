# Phase 2 — what shipped, what did not, and where it diverges

Phase 2 (plan.md § "Phase 2 — core services and the plugin host") is **partially complete**. This file
says exactly which parts, because the difference matters to whoever starts Phase 3.

Read [phase1-notes.md](./phase1-notes.md) first if you have not: two of its recorded divergences are
resolved here, and one of them was a change to the trust model rather than a bug fix.

## Status against the exit criteria

plan.md names four. Honestly assessed:

| Exit criterion | State |
| --- | --- |
| every plugin initializes through the plugin API with its own DB | **partial** — nine plugins are through it (changes, database, memory, docker, editor, terminal, http, notes, workflows). Four are not: agents, github, and linear/rollbar (which SHARE the `issues` table, so neither moves until that is decided) |
| core services have direct unit/integration tests (confinement, env allowlists, kill trees, secret non-disclosure) | **done** — all four, plus the process-broker taxonomy |
| the terminal scope-shed is complete | **done** |
| boundary baseline shrinks to only the edges scheduled for phase 3 | **partly** — the plugin→plugin ledger is 9 → 6. The UI-kit extraction removed `changes -> github` and `database -> editor` (the two Phase 2 owned); the `notes.store` capability removed `memory -> notes`, which plugins.md had listed as Phase 3's. The remaining six are Phase 3's. The schema-import ratchet went 14 → 4. |

So Phase 3 can start on the coupling map — its seven edges are exactly what is left — but "every plugin
initializes through the plugin API" is not true yet, and the client half of the plugin host
(`ClientPlugin`) does not exist at all.

## What shipped

**The plugin host.** `NodePlugin` / `NodePluginContext`, a host that runs `init` in declaration order,
awaits it, and disposes newest-first at teardown, plus a `CapabilityRegistry`
(`packages/node-core/src/server/plugin/`). The registry is owned by the service **runtime**, not a
module singleton — the tests start `startServiceRuntime` three times in one process, and a shared
registry threw "capability already provided" on the second boot. It is also kept off `Env`, because
`c.env` reaches every route and capabilities are a plugin-composition seam, not something a route
handler should be able to enumerate. (The same reasoning had to be applied to the route registry after
the review; it is still a module singleton, so the host now clears a plugin's contributions before
re-registering them.)

**`agents.sessionExecute`, the first capability.** `apps/node/src/wiring/managedWorkflowStep.ts` is
gone, but be precise about what that bought: the implementation MOVED into
`plugins/agents/src/main/sessionExecute.ts` (it is a rename in the diffstat), and it was replaced by two
new app-layer contract imports. **Net app glue removed is roughly zero.** What changed is ownership —
the code now lives in the plugin whose runtime it drives, and workflows resolves it without an import —
not line count. An earlier commit message claimed the deletion as the win; that was overstated.
The signature lives in `plugins/agents/src/contract/sessionExecute.ts`, restated as the narrow set of
fields the implementation reads rather than workflows' `RunStepOptions`, because plugins.md puts a
capability's signature in the *provider's* contract.

**CoreServices** (`packages/node-core/src/main/core/`): `fs`, `git`, `proc`, `secrets`, `tasks`. Four
of the six bullets plan.md names; the two absences are decisions, below.

Consolidating surfaced three real leaks, each now closed and tested:

- `plugins/terminal`'s `previewUrl` ran a repo-configured capture command through `execFile` with **no
  `env` option**, so it inherited the node's entire environment — `SESSION_ENC_KEY` and
  `INTERNAL_TOKEN` included — and had no output cap.
- `plugins/agents`' `claudeDriver` spawned with `{ ...process.env, ...options.env }`. Same leak, on
  every managed agent session.
- `plugins/docker` filtered secrets with a **denylist** of six names whose "keep in sync" comment
  pointed at `plugins/terminal/main/executionService.ts` — a file that no longer exists. A denylist
  leaks every binding nobody remembered to add to it.

`main/core/proc.ts` is **intended** as the one child-process path, and is not yet: roughly sixteen
`node:child_process` call sites remain (`main/profiles.ts`, `main/archive.ts`, `main/tls.ts`,
`main/mcpRegister.ts`, `main/headless.ts`, the terminal engine's PTY spawn, `plugins/database`,
`plugins/docker`'s exec/spawn, all four agent drivers, `plugins/http`'s send, `plugins/editor`'s
search). Docker and the agent drivers adopted `brokerEnv` only, so they get the env allowlist but
neither the output cap nor the group kill. What did land: allowlisted env with explicit
`passthrough: ['DOCKER_*']`-style declarations, process-group kill with SIGTERM→SIGKILL escalation
(exactly one of ~16 sites did this before), and bounded capture that truncates without killing.
`main/core/git.ts` adds two things no individual git site had: `GIT_TERMINAL_PROMPT=0`, so an expired
credential fails fast instead of hanging until the timeout, and `SSH_AUTH_SOCK` in the passthrough,
without which every push would have broken once git went through the broker.

**The terminal scope-shed.** Eleven routes moved from `/v2/p/terminal/*` to `/v2/core/*`:
`task-statuses`, `repos/path{,/run-targets,/config}`, and
`tasks/:id/{preview-url,on-created,use-checkout,archive,mcp,mcp/starter}`
(`packages/node-core/src/server/routes/worktree.ts`). The engines were already core's; only the routes
and the bridge object lived in the plugin, so disabling terminal would have taken worktree management
with it. Archive is the one handler that genuinely needs a PTY — the running-session guard, killing a
task's sessions, streaming teardown into a "Teardown" tab — so it goes through a four-method slot that
is exactly `archiveTask`'s existing dep bundle; an unfilled slot answers 503, which is the degraded
mode `dev:node` already had.

Route paths were also de-doubled, which `apps/node/src/server/routes.ts` had deferred to "the
route-declaration phase": `/v2/p/terminal/sessions`, not `/v2/p/terminal/terminal/sessions`.

**Per-plugin SQLite, as a working mechanism.** `main/pluginStorage.ts` opens
`<data-root>/plugins/<name>.sqlite` with the same hardening as `openDb`; `main/pluginMigrations.ts`
resolves a chain from the *plugin's* module; `scripts/db.mjs` discovers every package with a
`drizzle.config.ts`, so a new plugin DB needs no edit to the tooling. `makeTestPluginDb` gives a plugin
test its own migrated file — deliberately not "makeTestDb with extra tables", because a plugin test
that could still see core's schema would keep passing after the plugin started reading a table it no
longer owns.

**Scoped internal tokens** — see the next section; this is the largest single change in the phase.

## Resolved from phase1-notes.md

**"Internal tokens are still V1's single persisted token, not scoped and expiring."** Resolved, except
for expiry (below). `packages/node-core/src/server/auth/internalTokens.ts` mints a stateless HMAC token
carrying `{ scope, taskId?, sessionId? }`. `INTERNAL_TOKEN` is now the signing **key**, not the
credential.

**"The internal principal can now reach GitHub — a posture change, not an oversight."** Reversed, on
purpose, and this is a **breaking change to the trust model**. A `task`-scoped credential — everything
injected into a PTY, an agent session, a workflow step or an MCP server — gets `''` from
`githubToken()`. The `service` scope, used only for the node's own loopback calls, keeps full reach.

Phase 1 recorded two objections to gating this and both are answered by scope rather than argued away:
one guard could not tell the service from an agent (so gating broke `seedTaskNotes` on a cold mirror —
the `service` scope fixes that), and an agent has a shell in the worktree with the owner's git
credentials anyway (still true, and still not a reason for the node to hand it a token it never needs).
`apps/node/test/integration/internalPrincipal.test.ts` flipped from pinning the divergence to pinning
its fix.

The concrete escalation this also closes: `routes/agentTools.ts` takes the `taskId` from the **URL**, so
before the credential carried one, a token handed to task A's agent could invoke task B's tools.

## Deliberate divergences

**No `packages/plugin-api`.** plugins.md names one. Phase 0 shipped without it and every plugin already
depends on `@acorn/node-core`, so a fourth package would add a manifest and nothing else. The
interfaces live in `packages/node-core/src/server/plugin/`.

**No `http` allowlist service.** plan.md lists "http allowlists" as a CoreServices bullet. What a
per-plugin host allowlist would defend is already defended by construction: every provider's base URL
is a hardcoded module constant (`api.github.com`, `api.linear.app/graphql`, `api.rollbar.com`), so the
allowlist and the code would be the same fact stated twice. The one genuinely user-supplied outbound
URL — an agent webhook target — already has a *stronger* guard than a hostname list: `webhookService`
resolves DNS and rejects non-loopback addresses over plain http, rejects credentials in the URL, and
enforces https. A registry of allowlists protecting constants is the speculative machinery this phase
is meant to remove.

**No scheduler service.** All four periodic jobs on the node (wsHub's revocation sweep, terminal's idle
watch, the MCP refresh interval, agents' durable-event flush) already `unref` their timers and already
clear them on teardown — `disposeWsHub` calls `clearInterval`, and the composition root holds
terminal's handle. A `Scheduler` class was written and then deleted: it would have replaced four
working, drained timers with an abstraction whose only new property (a re-entrancy guard) no current
job needs. The consumer that would justify it is moving workflow trigger polling from the *client* to
the node so a trigger fires with no window open — a behaviour change, not this phase's.

**Internal tokens do not expire.** protocol.md asks for expiring tokens. An agent pane runs under tmux
and is reattached after a restart, keeping the environment of the boot that spawned it — which is why
the old token was deliberately persisted. An expiry short enough to matter would break that reattach;
one long enough not to would buy nothing. What actually bounds these tokens is scope. Rotating the
signing key invalidates every outstanding token at once, and that is the revocation lever that exists.

**No `operations`, `audit`, `settings` or `secrets` tables.** data.md lists all four for the core DB.
None has a Phase 2 consumer. In particular, losing `cascade.ts`'s cross-DB atomicity does **not**
require `operations`: the schema declares no foreign keys anywhere, so the orphan rows a partial sweep
leaves are inert by the same argument `schema.ts` already makes about `http_requests.taskId`.

**Core keeps a DROP-table migration rather than resetting its chain.** Moving a plugin's tables out of
`schema.ts` makes drizzle-kit generate a `DROP TABLE` for core. Resetting the 39-file chain to a single
`0000` would be tidier but breaks every existing dev data root; the DROP is generated, works, and keeps
an existing root opening.

## Not done

These are Phase 2 scope that has **not** landed. Do not assume any of it.

- **Three plugin conversions.** Converted with their own schema, chain and SQLite file: `changes`,
  `database`, `memory`, `terminal`, `http`, `workflows`. Converted with no database because they own no
  tables — the honest outcome, not a gap: `docker`, `editor`, `notes` (notes are markdown files with a
  frontmatter block under `<data-root>/notes/`, so there is nothing to migrate and deliberately no
  `dispose`). Outstanding: `agents` (ten tables and the only real cross-DB joins in the codebase),
  `github` (twelve mirror tables, and core's `contextSections.ts`/`storageFootprint.ts` read them), and
  `linear` + `rollbar`, which SHARE the `issues` table — that shared ownership needs deciding before
  either can move, and it is the reason they are last rather than a matter of effort. The schema-import
  ratchet records the remaining four packages, so progress is measurable and cannot regress.
- **The cross-boundary reads that block the hard three.** Still outstanding: core's
  `agentTools/contextSections.ts` reads github's `repos`/`pull_requests`/`pr_files` and linear/rollbar's
  `issues`; `main/storageFootprint.ts` counts rows in four plugin tables; `routes/pins.ts` owns
  github-shaped `pinned_repos`; `db/cascade.ts` is one `db.batch` spanning four future databases; and
  agents' three `agent_* ⋈ tasks ⋈ workspace_repos` joins are the only real cross-DB joins in the
  codebase. `CoreServices.tasks.idsForWorkspace()` exists for that last one but has **no caller yet**.
- **Part of `apps/node/src/wiring/`.** `managedWorkflowStep.ts` and `harnessWiring.ts` are gone, and
  `serverBridges.ts` is down to a single bridge (agents' usage service) with a comment saying it is
  deleted rather than kept as an empty hook when agents converts. Still present:
  `contextSectionsWiring.ts`, `agentProfiles.ts`, `startupSecurity.ts` (one call left — github's mirror
  prune), `managedAgentsWiring.ts`, `workflowWiring.ts`.
- **Part of the `tools` contribution point (W6).** The mechanism landed: `setAgentTools(list)` is gone,
  replaced by an incremental `registerAgentTool(owner, tool)` exposed as `ctx.tools` and cleared per
  boot beside `removePluginRoutes` (a duplicate name throws, so without that a second
  `startServiceRuntime` in one process would fail the whole boot). Twelve tools moved to the plugins
  that own them — `local_*`/`git_log` to changes, `memory_*` to memory, `run_*` to terminal. Sixteen
  remain in `apps/node/src/wiring/agentToolsWiring.ts` (437 → 246 lines), each with a real blocker:
  `task_*`/`pr_*`/`linked_issues`/`repo_info` are **core's own** and have no plugin to move to;
  `browser_*` needs `plugins/preview` to have a node-side part at all — today it is Electron-main only,
  so moving them is a process-boundary change, not a tool move. The `notes_*` blocker is closed: notes
  owns its tools now.
- **Per-endpoint `Idempotency-Key` (the other half of phase1-notes' second item).** `RouteContribution`
  still carries no idempotency declaration. This was deliberately not half-landed: **no client call
  site sends an idempotency key today** (`postJson` accepts one; nothing passes it), so declaring
  routes `required` would break create-PR, post-comment and send-agent-turn immediately. The route
  declaration and the client call sites have to land together.
- **The shared UI kit and `ClientPlugin` (W8).** The diff viewer and Monaco setup are still in
  `plugins/github` and `plugins/editor`, so the `changes -> github` and `database -> editor` boundary
  edges remain. `apps/desktop/src/app/client/activate.ts` is unchanged, and contributions that belong
  to plugins are still defined in the app (`taskPaneContributions.tsx` contains a whole `LinearTaskPane`;
  `providerContributions.tsx` contains linear/rollbar promotion logic).

## Fixed after an adversarial review

A hostile review of the phase found twenty issues, six of them holes in the very posture the
scoped-token commit claimed. Worth recording because the pattern is instructive: the *mechanism* was
sound and the *enforcement* was applied at one site each time.

- **A task-scoped token could drive any task's PTY.** `authorize()` verified the token and returned its
  claims; `onConnect` built the connection without them, so they were discarded at the door and
  `term:*` frames routed purely by session id. Confirmed by probe: attach to another task's session,
  then `term:input` a shell command into it — arbitrary execution as the owner in another task's shell.
  Fixed with `mayDriveStream` + `StreamHandlers.streamTaskId`, and the guard is verified non-vacuous.
- **`canUseProviderCredential` guarded one plugin of five.** A task-scoped token still reached
  `/v2/core/integrations` (list, rotate, test, DELETE the owner's connections), `/v2/p/linear/*`,
  `/v2/p/rollbar/*` and the database plugin's AI-SQL route, spending the owner's keys. Now gated by
  mount — `requireProviderAccess` over the integrations router and inside the provider projection, so a
  newly registered provider is covered the day it is added.
- **`mayActOnTask` guarded one router of six.** `POST /v2/core/tasks/<other>/preview-url` gave arbitrary
  shell execution in another task's worktree (confirmed by probe), and config-trust could be
  self-acknowledged. Now a `requireTaskScope` middleware mounted over `/v2/core/tasks/:id*`, so a new
  task-scoped route inherits the gate instead of forgetting it.
- **`codexDriver` still spread `process.env`,** handing every Codex session `SESSION_ENC_KEY` — with
  which an agent decrypts every stored credential directly, bypassing the whole use-scoping design.
  `claudeDriver` had been converted in the same commit; Codex was missed. Also removed
  `ANTHROPIC_*`/`CODEX_*` credential globs from the passthrough.
- **The process broker corrupted UTF-8** at pipe chunk boundaries, because each chunk was decoded
  independently where `execFile` had used a `StringDecoder`. Confirmed: 40 000 box-drawing characters
  came back with three replacement characters — silent corruption of `git show` file bodies and `git
  diff` patches over 64 KiB, in a function whose comment promised byte-exactness. Now accumulates bytes
  and decodes once; the cap is enforced on bytes so it can no longer be exceeded, and `.end()` is
  deliberately not called so a cut trailing sequence is dropped rather than flushed as U+FFFD.
- **The SIGKILL escalation was cancelled by `settle()`** — exactly when it was needed, since the direct
  child exiting is what leaves a TERM-ignoring group member behind. The existing kill-tree test used a
  grandchild that dies on SIGTERM, so the escalation path was never exercised: the "kill trees" exit
  criterion was passing vacuously.
- **`scrub()` could become the leak.** Assigning to a frozen Error's `message` throws a `TypeError`
  whose own message embeds the original error's stringification — the secret — from inside `use()`'s
  catch where no caller can intercept it. A circular `cause` chain blew the stack. Both confirmed, both
  fixed.
- **The packaged build would have migrated the plugin database with core's chain.** `extraResources`
  still shipped only `packages/node-core/migrations`, so `pluginMigrationsFolder` found no
  `<resources>/migrations/<plugin>` and fell back to its ancestor walk. Masked by the next item.
- **`review_notes` existed in both databases** — core's chain was never regenerated, so no `DROP TABLE`
  was emitted and `pnpm db:check` passed happily. The two bugs hid each other.
- **Archive lost `await bootReconciled`.** The move to core left the await inside `runTeardown`, which
  runs *after* the running-session guard, so `skipTeardown` (or a repo with no teardown script) let the
  guard pass vacuously and a live tmux session could survive its deleted worktree.
- **Plugin databases were never closed,** violating the composition root's own stated invariant about
  dropping the data-root lock only after SQLite is closed. `NodePlugin.dispose` now exists.
- **The route registry appended on every boot,** so a second `startServiceRuntime` in one process would
  serve requests from the first boot's closed database handle. Same class of bug the capability registry
  was already made per-runtime to avoid.
- **Both new boundary ratchets were bypassable.** The contract-purity rule checked only direct edges, so
  one hop through `shared/` defeated it; the schema ratchet's regex missed named table imports and
  namespace access. Both widened, and the schema ratchet now excludes test files so it can actually
  reach zero.
- **Env allowlists dropped legitimate configuration** — proxy variables, GPG for signed commits, cloud
  credential helpers for ECR/GCR. Inverting a denylist means naming what tools need, and the first pass
  named too little.

Also removed as speculative: the `NodeEventBus` (threaded through the host, the context and both
composition roots, with zero publishers and zero subscribers) and `CoreServices.tasks.idsForWorkspace`
(written for the agents joins, but agents is not converted, so it had no caller).

## Two things the plugin conversions surfaced

**`pluginMigrationsFolder` was migrating every plugin database with CORE's chain.** The ancestor walk
checked the bare `<dir>/migrations` before `<dir>/migrations/<plugin>`, and in the BUILT layout the walk
starts at `out/main/`, whose parent holds both — so every plugin database got core's 42 migrations and
none of its own: 46 core tables, zero plugin tables. It failed silently, because a plugin only notices
when it first touches one of its own tables, and nothing in the e2e suite touches `changes`,
`database` or `memory` data. `http` is what turned it into a visible boot failure, because its init
queries its own rows before the listener binds. The packaged path was already plugin-scoped, which is
why packaging was correct and the unpackaged build was not. Fixed by checking the plugin-scoped
candidate first at every level, pinned by `pluginMigrations.test.ts`.

**`dev:node` now serves workflow routes too.** `standalone.ts` never called `registerWorkflowIpc`, so
every workflow route answered a flat 503. The shared plugin list means it runs the engine now, with a
`workflows.runner` reconcile pass before `reconciled` resolves — the sweep-ordering invariant has to hold
there as much as in the supervised root, because reconcile moves every `running` step back to `pending`.

**The standalone node's agent-tool surface changed.** `standalone.ts` never called `wireAgentTools`, so
`dev:node` answered a flat 503 for every tool. Now that changes/memory/terminal register their own in
`init`, it serves those twelve and 404s the rest. Consistent with the terminal change below, but it is a
behaviour change, not a no-op.

Related, and deliberate: an EMPTY tool registry is now treated as the old null registry — the three
projections answer 503 `bridge-unavailable` rather than `{tools: []}`. An agent cannot distinguish a
surface that failed to assemble from one that is deliberately empty, and the MCP proxy's degradation is
keyed on that status.

**`dev:node` now runs a real terminal engine.** `terminal` is `required`, and a required plugin ignores
the disabled list by design, so the "PTY bridge unfilled → clean 503" degraded mode that
phase1-notes.md described for a standalone node is **gone**. `standalone.ts` gets the same deps as the
supervised root plus a `reconcileTmux()` pass before `reconciled` resolves — without that, archive's
running-session guard would pass vacuously against an empty session map, which is the exact hazard
`TaskSessionsBridge.ready()` exists to prevent.

## The notes/memory split, and why it was the real work

plugins.md lists `memory -> notes` under Phase 3 ("notes owns its storage; memory consumes `notes.read`
capability"). It came out in Phase 2 instead, because the entanglement was not an import — it was that
the `NotesStore` INSTANCE was constructed by memory's `registerKnowledgeIpc`, and one shared instance
served the notes pane, the `notes_*` agent tools and core's context assembler.

Notes' `init` now builds the one instance and publishes it as `notes.store`
(`plugins/notes/src/contract/store.ts`). Named `store`, not plugins.md's `read`: three of the five
consumers write, so a read-only id would have left the write path exactly where it was — in an app-layer
dep bag. Memory resolves it through a thunk per call rather than caching at init, because plugin init
order is undefined and caching could capture `undefined`.

Two things this did NOT finish, both stated rather than glossed:

- **The notes HTTP routes still answer under memory's namespace** (`/v2/p/memory/tasks/:id/notes`,
  `/workspaces/:wsId/notes`), with memory's `KnowledgeBridge` now a pass-through onto the capability.
  Moving them to `/v2/p/notes/*` changes `api.ts`'s route builders, the client and the mount table — a
  wire-surface change. It is the one thing left between this and memory not depending on notes at all.
- **`contextSectionsWiring.ts` still fills one slot with both seams at once**
  (`setContextSections(buildContextSections({ notes, memory }))`). That is core's side, not a plugin's:
  until context sections become a per-section contribution point, neither plugin can fill its own half.

## Known gaps worth stating plainly

- **The credential gates are mounted, not audited.** `requireProviderAccess` covers the integrations
  router and the provider projection; the database plugin's AI-SQL route is gated explicitly. A
  route-by-route audit of every credential path was not done, so a plugin that starts spending a
  credential from a route outside those mounts would not be covered.
- **Internal tokens still do not expire, and there is no per-session revocation.** `sessionId` is
  carried in the claims and nothing enforces on it. Rotating the signing key is the only revocation.
- **`spawn(process.execPath, [asarPath])` is still the one surface no test covers.** The packaging fixes
  in this phase were verified by `pnpm --filter @acorn/desktop build` and by simulating
  `pluginMigrationsFolder`'s resolution, **not** by a real DMG launch. Do that before trusting the
  packaged plugin-database path.

## What is covered by tests

| Claim | Where |
| --- | --- |
| env allowlist: no `ACORN_*`/`SESSION_ENC_KEY`/`GITHUB_CLIENT_*` in a real child's env | `packages/node-core/src/main/core/proc.test.ts` (verified non-vacuous by removing the group kill and the allowlist) |
| process-group kill reaps a grandchild the direct child left behind | same file — the test fails if `process.kill(-pid)` becomes `child.kill()` |
| bounded capture truncates without killing, per stream | same file |
| confinement rejects lexical traversal, a symlinked directory, and a symlinked leaf | `packages/node-core/src/main/core/fs.test.ts` |
| secret non-disclosure through the failure path (message, stack, nested cause, thrown string), error class preserved | `packages/node-core/src/main/core/secrets.test.ts` |
| capability registry: late binding, duplicate-provider refusal, optional-by-default | `packages/node-core/src/server/plugin/host.test.ts` |
| plugin host: declaration order, awaited init, disabled vs required, duplicate names, init failure | same file |
| internal tokens: round trip, base64url separator, wrong key, tampered payload/signature, unknown scope | `packages/node-core/src/server/auth/internalTokens.test.ts` |
| a task-scoped credential is denied GitHub and confined to its own task; service scope keeps reach | `apps/node/test/integration/internalPrincipal.test.ts` |
| the moved worktree routes: repo-config validation, preview capture + env hygiene, MCP masking, archive 503 without the PTY slot | `packages/node-core/src/server/routes/worktree.test.ts` |
| a task-scoped socket cannot attach to or type into another task's PTY; unknown stream ids fail closed | `packages/node-core/src/main/wsHub.test.ts` (verified non-vacuous by neutering the guard) |
| SIGKILL escalation reaps a group member that ignores SIGTERM | `packages/node-core/src/main/core/proc.test.ts` (verified by restoring the `clearTimeout`) |
| multi-byte characters survive pipe chunk boundaries; the byte cap is never exceeded | same file |
| `scrub` cannot leak through a frozen error or loop on a circular cause | `packages/node-core/src/main/core/secrets.test.ts` |
| plugins dispose newest-first, and one failure does not strand the others | `packages/node-core/src/server/plugin/host.test.ts` |
| the moved routes are GONE from the terminal plugin | `plugins/terminal/src/server/routes/terminal.test.ts` |
| the assembled mount table, including plugin-host-registered routes | `apps/node/test/integration/routeRegistry.test.ts` |
| the full 28-tool agent manifest is unchanged by the W6 split, has no duplicates, and each moved group has exactly one owner | `apps/node/src/wiring/agentToolsWiring.test.ts` (calls the real builders, asserts against an explicit list — a dropped tool fails it) |
| a plugin owning its own migrated SQLite file, alongside core's | `plugins/changes/src/server/routes/reviewNotes.test.ts` |

`pnpm lint` 26/26, `pnpm test` 26/26, e2e 9/9 at every commit in the phase.
