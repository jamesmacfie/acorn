# API gates: the cheap wins a sandbox cannot make

**Status: all three gates closed 2026-08-28**, in the security burn-down. `prefs`, `projects`, and
`workspaces` are mounted behind `requireDevice` in `packages/node-core/src/server/index.ts`, and
`packages/node-core/src/server/mountCoverage.test.ts` is the test this file asked for: every core
mount is device-gated, provider-gated, task-scoped, or on a named allowlist. `docs/security.md`
owns the behaviour. The file stays as the record of what the holes were and why the fixes were safe,
because the argument recurs whenever a new core route is added.

Part of [docs/future/sandbox/](./README.md). These were confirmed holes in the loopback API, each
reachable by a `task`-scoped agent token, each closed by one or two lines in the same file and the
same style as the seven gates already there. They come first in [phases.md](./phases.md) because a
sandbox runs these escalations straight through: they travel over the loopback API on the token that
has to be inside the box.

All three share one root cause: a core route that should be device-only was mounted at `requireUser`
only, because nobody wrote the line. The seven routes above them in
`packages/node-core/src/server/index.ts` each got a `requireDevice` and a comment. These did not.

## Gate 1 — prefs (the self-unlock)

**Severity: highest.** This one re-locks the control meant to contain a rogue agent, so it is the
first fix in the folder.

The tool-permission ceiling works. It lives in a prefs slice keyed `agentTools.perms`
(`packages/protocol/src/api.ts:221`), and `loadPerms`
(`packages/node-core/src/server/routes/agentTools.ts:22`) reads it and enforces it through
`isToolPermitted` (`packages/node-core/src/server/agentTools/registry.ts:54`) on every task-scoped
tool call. Turn the execute tier off and execute tools vanish from `tools/list` and are rejected on
direct invoke.

The hole: that prefs slice is keyed by the owner id, and a `task`-scoped internal token resolves to
the **same** owner id, because the machine has one owner and the internal principal inherits the
machine's bound identity (`packages/node-core/src/server/middleware/auth.ts`, `ownerId` in
`requireUser.ts`). The prefs write route (`packages/node-core/src/server/routes/prefs.ts:16`) sits
behind `requireUser` only. So an agent can issue one call over its own token:

```
PUT /v2/core/prefs   { "key": "agentTools.perms", "value": "{\"tiers\":{\"execute\":true,\"write\":true}}" }
```

and turn its own sharp tools back on. The ceiling designed to contain a rogue agent can be lifted by
the rogue agent.

**Fix.** Gate the prefs mount behind `requireDevice`, matching the seven mounts above it:

```ts
.use(`${CORE_NAMESPACE}/prefs`, requireDevice)
.use(`${CORE_NAMESPACE}/prefs/*`, requireDevice)
```

**Why it is safe.** Prefs are written only by the settings UI, through
`packages/client-core/src/settings/savePref.ts`, which authenticates as a paired device. The renderer
is always a device principal, so a device gate cannot lock it out. No agent tool and no task-scoped
path writes prefs over HTTP. The in-process `PrefService.write` used by
`plugins/agents/src/main/pricingStore.ts` does not touch this route and is unaffected.

## Gate 2 — projects (host code execution)

**Severity: high.** The project row holds `setupScript`, `devScript`, `devRestartScript`,
`teardownScript`, and `dbUrlScript` — host commands acorn runs later on worktree creation or a dev
run (`packages/node-core/src/main/runConfig.ts:229`, `taskWorktree.ts:326`).

The mount (`packages/node-core/src/server/index.ts:92`) is `requireUser` only. So a task token can:

```
GET  /v2/core/projects                  # enumerate every project on the node
PUT  /v2/core/projects/<any-id>/config  # rewrite any project's scripts
PUT  /v2/core/projects/<any-id>/run-targets
PATCH /v2/core/projects/<any-id>
```

The writes are handled at `routes/projects.ts:78`, `:85`, and `:92`. They are not task-addressed, so
`requireTaskScope` never applies and the write lands against any project id, not only the token's own
task.

The repo-config trust gate does not catch this. `readRepoConfigSnapshot`
(`packages/node-core/src/main/repoConfigTrust.ts:30`) hashes `.acorn/config.toml` and
`.acorn/workflows/*.toml` and nothing else. Its premise is that the checkout is untrusted input and
the database is trusted. That premise fails the moment a task token can write the database.

**Fix.** Gate the projects mount behind `requireDevice`:

```ts
.use(`${CORE_NAMESPACE}/projects`, requireDevice)
.use(`${CORE_NAMESPACE}/projects/*`, requireDevice)
```

**Why it is safe.** Project configuration is written only from the settings UI, through the frame
scope at `packages/client-core/src/plugins/frames/scopes.ts:94` and `:99`, on a device principal. No
agent tool writes it. If a future agent tool needs to read its own project's configuration, add a
task-addressed read route under `/v2/core/tasks/:id/...` rather than widening this gate.

See also [enterprise-policy.md](./enterprise-policy.md) § Trust the row, which extends the trust
snapshot to cover the project row as a belt behind this gate.

## Gate 3 — workspaces (destructive, lower stakes)

**Severity: moderate.** The workspaces mount (`packages/node-core/src/server/index.ts:93`) is
`requireUser` only. Create, patch, and delete (`routes/workspaces.ts:62`, `:74`, `:101`) are not
task-addressed, so a task token can rename or delete workspaces and shuffle projects between them.
Deleting a workspace reassigns its projects. Annoying and destructive, but not code execution and not
a self-unlock, which is why it ranks below the first two.

**Fix.** Same pattern:

```ts
.use(`${CORE_NAMESPACE}/workspaces`, requireDevice)
.use(`${CORE_NAMESPACE}/workspaces/*`, requireDevice)
```

**Why it is safe.** Workspace administration is a settings-UI action on a device principal. No
task-scoped path creates or deletes workspaces.

## A test to keep the gaps closed

The root cause is "nobody wrote the line," so the durable fix is a test that fails when a new
`requireUser`-only core route appears. Model it on the enumerated `child_process` allowlist in
`tools/arch/boundaries.test.ts:217`: assert that every mount under `CORE_NAMESPACE` is either
device-gated, provider-gated, task-scoped, or on a named allowlist of routes deliberately reachable
by a task token, each with its reason inline. Adding a route then becomes a decision rather than a
drift. This is the one piece of new machinery in this file, and it is worth it because the failure
mode is silent.

## Scope check performed

This audit covered `prefs`, `projects`, `workspaces`, the bare `worktree` router (its routes are
task-addressed, so `requireTaskScope` covers them), `tasks` (task-addressed), `harness` and
`taskContext` (task-addressed), `agentTools` (its projection requires an internal principal
explicitly at `routes/agentTools.ts:100`), and `dashboards` (read-only history). The three above are
the findings. A newcomer should still run the boundaries test from the paragraph above rather than
trust that this list stayed complete.
