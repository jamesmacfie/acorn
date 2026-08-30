# Implementation phases

Part of [docs/future/sandbox/](./README.md). The consolidated pickup guide. Phases are ordered by the
folder's governing rule: close the gaps a sandbox cannot fix before building the sandbox, because a
wall you can walk around is one you will wrongly trust. Each phase is independently shippable and names
its acceptance criterion.

A note on ordering that looks backwards: the biggest security win is the sandbox (phase 3), but the
cheapest and most urgent work is the API gates (phase 1), and the layer a buyer evaluates (phase 4)
can be demonstrated before the sandbox exists. So the sequence optimizes for shippable value at each
step, not for building the largest piece first.

## Phase 1 — Close the loopback-API gaps

The detail is in [api-gates.md](./api-gates.md). One or two lines each in
`packages/node-core/src/server/index.ts`, matching the seven `requireDevice` mounts already there.

**Shipped 2026-08-28** in the security burn-down; `docs/security.md` owns it.

- [x] Gate `prefs` behind `requireDevice`. Highest priority: it re-locks the tool ceiling a rogue
      agent can otherwise self-unlock.
- [x] Gate `projects` behind `requireDevice`. Closes host code execution via the project row's
      scripts.
- [x] Gate `workspaces` behind `requireDevice`. Destructive, lower stakes.
- [x] A test asserting every `CORE_NAMESPACE` mount is device-gated, provider-gated, task-scoped, or
      on a named task-reachable allowlist with a reason:
      `packages/node-core/src/server/mountCoverage.test.ts`.

**Acceptance.** A task-scoped internal token receives 403 on `PUT /v2/core/prefs`,
`PUT /v2/core/projects/:id/config`, and workspace create/delete. The renderer, on a device principal,
is unaffected. The new test fails if a `requireUser`-only core route is added.

**Cost.** Hours, not days. No new machinery beyond the one test.

## Phase 2 — Trust the project row

Detail in [enterprise-policy.md](./enterprise-policy.md) § Trust the row. The belt behind phase 1's
projects gate.

**Shipped 2026-08-28.** `PROJECT_ROW_FIELDS` in `packages/node-core/src/server/repoConfigTrust.ts`
folds the row's executable fields (and `runTargets`) into the hashed snapshot.

- [x] Extend `readRepoConfigSnapshot` to include the project row's `setupScript`, `devScript`,
      `devRestartScript`, `teardownScript`, and `dbUrlScript` in the hashed snapshot.
- [x] `docs/security.md` says the untrusted input is repo config **and** the project row.

**Acceptance.** Changing a project's `devScript` produces a `needs-trust` review before the script
runs, the same way a changed `.acorn/config.toml` does.

## Phase 3 — Per-task OS isolation

Detail in [sandbox.md](./sandbox.md). Do the spike before the seam.

- [ ] **Spike.** An `AgentProfileContribution` with `command: "sbx"`,
      `launchArgs: ["run", "claude"]`. Zero host changes. Live with it a week; decide on the
      round-trip and the port story.
- [ ] Add an execution target to the task: `host` or a sandbox id.
- [ ] Build the resolver seam: map an execution target to a `(command, cwd, env)` transform, honored
      by the broker (`core/proc.ts`) and the PTY spawn (`plugins/terminal/src/server/terminal.ts:411`).
- [ ] Docker Sandboxes backend, direct-mount only, reattach by task id, teardown on archive.
- [ ] Linux backend (Landlock plus namespaces, or a container) for standalone nodes.
- [ ] Preview and dev-server port publishing per task.
- [ ] Make the Docker plugin sandbox-aware (`DOCKER_HOST` per sandbox).
- [ ] Move the HTTP pane send inside the sandbox for non-host execution targets.
- [ ] Default-deny egress wired from the task's allowed-host set into the sandbox network policy.

**Acceptance.** A task with a sandbox execution target runs its agent, terminal, and dev server inside
the sandbox; the editor, diff, search, and git still read the worktree with no code change; a task
with no available backend reports `host` and says so.

**Guardrail for review.** If any change in this phase starts requiring the editor, diff, search, or
git to route through the sandbox, the design has regressed. Only processes cross the boundary.

## Phase 4 — Managed policy and audit export

Detail in [enterprise-policy.md](./enterprise-policy.md). Buildable in parallel with phase 3; the
resolved-policy view can be demoed with execution target still `host`.

- [ ] The managed configuration layer above device prefs, the project row, and `node.json`, delivered
      to a protected path by MDM, merged **most-restrictive-wins**.
- [ ] The resolver **short-circuits when no managed layer is present** — absent, not
      permissive-by-default. This is the solo-developer guarantee; treat it as a test, not a comment.
- [ ] The fixed policy vocabulary: execution target, egress, filesystem, tool tiers, model allowlist,
      MCP servers, telemetry sink.
- [ ] A resolved-policy view: for a task, "what is allowed and who decided."
- [ ] OTLP export of the `audit` table to the managed telemetry sink.
- [ ] The tool-dispatch audit trail at the registry seam (`docs/agent-tools.md` § Rich results),
      keyed by task, exported the same way.

**Acceptance.** With a managed layer present, a local pref can lower the tool ceiling but not raise it
above the managed ceiling; with no managed layer, the resolver does not execute and behavior is
byte-for-byte the un-governed path. Audit rows reach the configured OTLP endpoint.

## Phase 5 — Plugin containment rung 2

The design is owned by `docs/security.md § The containment ladder`, rung 2, and the same work is
gate 1 in [ecosystem/blockers.md](../ecosystem/blockers.md) and phase 2 in
[ecosystem/work-plan.md](../ecosystem/work-plan.md). It is listed here, not restated, because it is a
launch requirement for the enterprise offering rather than a follow-up: it is the first question a
security review asks. [enterprise-policy.md](./enterprise-policy.md) § The plugin containment rung
says what the managed layer adds on top.

- [ ] Run each loaded plugin's node half as a child process holding a plugin-scoped internal token
      whose scope is its manifest, enforced in the auth middleware
      (`packages/node-core/src/server/middleware/auth.ts`).
- [ ] Under a managed policy, refuse to load a plugin that cannot run out of process.

**Acceptance.** A loaded plugin's node half cannot open `core.sqlite` or another plugin's database;
the enforcement is server-side, not cooperative.

## Dependency order

```
Phase 1 ──▶ Phase 2
   │
   └──▶ Phase 3 ──┐
                  ├──▶ (enterprise offering)
Phase 4 ──▶ Phase 5 ┘
```

Phases 1 and 2 are shipped, so phases 3 through 5 no longer build on a boundary an agent walks
around. Phases 3 and 4 are independent of each other. Phase 5 depends on phase 4's managed layer for its
enforcement switch. The enterprise offering needs 1, 4, and 5 at minimum; 3 is the security
centerpiece but a policy-only deployment on the `host` target is a coherent first sale.
