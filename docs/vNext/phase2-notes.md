# Phase 2 — what shipped, what did not, and where it diverges

Phase 2 (plan.md § "Phase 2 — core services and the plugin host") is **partially complete**. This file
says exactly which parts, because the difference matters to whoever starts Phase 3.

Read [phase1-notes.md](./phase1-notes.md) first if you have not: two of its recorded divergences are
resolved here, and one of them was a change to the trust model rather than a bug fix.

## Status against the exit criteria

plan.md names four. Honestly assessed:

| Exit criterion | State |
| --- | --- |
| every plugin initializes through the plugin API with its own DB | **partial** — the mechanism ships and one plugin (changes) is through it; eleven are not |
| core services have direct unit/integration tests (confinement, env allowlists, kill trees, secret non-disclosure) | **done** — all four, plus the process-broker taxonomy |
| the terminal scope-shed is complete | **done** |
| boundary baseline shrinks to only the edges scheduled for phase 3 | **not started** — still the nine Phase 1 entries; the two Phase 2 was to remove need the UI-kit extraction |

So Phase 3 can start on the coupling map, but "every plugin initializes through the plugin API" is not
true yet, and the client half of the plugin host does not exist.

## What shipped

**The plugin host.** `NodePlugin` / `NodePluginContext`, a host that runs `init` in declaration order
and awaits it, a `CapabilityRegistry` and a `NodeEventBus`
(`packages/node-core/src/server/plugin/`). Both registries are owned by the service **runtime**, not
module singletons — the tests start `startServiceRuntime` three times in one process, and a shared
registry threw "capability already provided" on the second boot. They are also kept off `Env`,
because `c.env` reaches every route and capabilities are a plugin-composition seam, not something a
route handler should be able to enumerate.

**`agents.sessionExecute`, the first capability.** It paid for itself immediately:
`apps/node/src/wiring/managedWorkflowStep.ts` (234 lines) is deleted. Those lines lived in the app for
exactly one reason — workflows could not import agents — and the registry is what removes the reason.
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

`main/core/proc.ts` is now the one child-process path: allowlisted env with explicit
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

- **Eleven of twelve plugin databases.** Only `changes` owns its schema, chain and SQLite file. The
  other table-owning plugins (`agents`, `database`, `github`, `http`, `linear`, `memory`, `notes`,
  `rollbar`, `terminal`, `workflows`, plus `docker`/`editor`/`preview` which own no tables but still
  need converting) read core's `schema.ts` as before. The boundary test's schema-import ratchet records
  the remaining fourteen packages, so progress is measurable and cannot regress.
- **The cross-boundary reads that block the hard three.** Still outstanding: core's
  `agentTools/contextSections.ts` reads github's `repos`/`pull_requests`/`pr_files` and linear/rollbar's
  `issues`; `main/storageFootprint.ts` counts rows in four plugin tables; `routes/pins.ts` owns
  github-shaped `pinned_repos`; `db/cascade.ts` is one `db.batch` spanning four future databases; and
  agents' three `agent_* ⋈ tasks ⋈ workspace_repos` joins are the only real cross-DB joins in the
  codebase. `CoreServices.tasks.idsForWorkspace()` exists for that last one but has **no caller yet**.
- **Most of `apps/node/src/wiring/`.** `serverBridges.ts`, `contextSectionsWiring.ts`,
  `agentProfiles.ts`, `startupSecurity.ts`, `harnessWiring.ts`, `managedAgentsWiring.ts` and
  `workflowWiring.ts` all still exist. Only `managedWorkflowStep.ts` is gone.
- **The `tools` contribution point (W6).** `setAgentTools(list)` is still a whole-list swap, and
  `agentToolsWiring.ts` still defines all 30 tools in one app-layer file with a single
  `AgentToolsDeps` bag.
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

## Known gaps worth stating plainly

- **A task-scoped token is confined on the tool surface, not everywhere.** `canUseProviderCredential`
  gates `githubToken()`. Other credential paths were not audited route by route in this phase — the
  linear, rollbar, database and model-provider credential reads still resolve for any authenticated
  principal. `plugins/http`'s router was already `device`-only, which covers the worst of it.
- **The WS hub captures internal claims but enforces nothing on them.** An internal socket still gets
  `deviceId: null` and can address `term:*` frames for any session id. The claims are carried so a
  future sweep can close a task's sockets when the task ends; today they are inert there.
- **`spawn(process.execPath, [asarPath])` is still the one surface no test covers.** The packaging
  change in this phase (staging every migration chain, not just core's) was verified by
  `pnpm --filter @acorn/desktop build` printing both chains, **not** by a real DMG launch.

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
| the moved routes are GONE from the terminal plugin | `plugins/terminal/src/server/routes/terminal.test.ts` |
| the assembled mount table, including plugin-host-registered routes | `apps/node/test/integration/routeRegistry.test.ts` |
| a plugin owning its own migrated SQLite file, alongside core's | `plugins/changes/src/server/routes/reviewNotes.test.ts` |

`pnpm lint` 26/26, `pnpm test` 26/26, e2e 9/9 at every commit in the phase.
