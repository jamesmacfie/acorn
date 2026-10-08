# Phase 04: confine and time-bound internal tokens

## Completion note: October 9, 2026

Status: implemented. HTTP principal resolution and both WebSocket upgrade paths accept an internal
token only when Node reports a loopback socket peer. Missing and remote peer addresses fail closed;
`Host` and forwarded headers grant nothing. A paired device bearer still authenticates from a remote
peer. Every minted internal token has a signed 48-hour expiry. Expired, malformed, and forged tokens
all produce the same null verification result. Scope, task, session, tool ceiling, signing key, and
HMAC algorithm keep their contracts.

Task children receive a token file under the data root with directory mode 0700 and file mode
0600. The Node atomically refreshes session files every 12 hours and at startup from the same signed
claims. It refreshes a workflow child file while that step runs and removes it when the step ends.
The MCP server, its loop hook, and the task CLI read the current file on each request. They use the
stable file path derived from the data root, task ID, and session ID when a pre-phase tmux shell has
no file variable. Terminal reconciliation writes a fresh file for a live tmux session and updates
tmux's session environment. A missing explicitly supplied file fails closed. A Node-owned service
call mints on demand. No renewal route or bearer-exchange endpoint was added.

Acceptance and scoped verification on Node 26.9.0:

- `pnpm --filter @acorn/node-core exec vitest run src/server/auth/internalTokens.test.ts
  src/server/auth/renewingEnv.test.ts src/server/middleware/auth.test.ts
  src/server/taskTokenReach.test.ts src/server/transport/wsHub.test.ts
  src/server/transport/wsHubSecurity.test.ts src/server/transport/tunnel.test.ts
  src/server/transport/listener.test.ts src/mcp/server.test.ts --maxWorkers=1`: 116 passed in
  nine files. These cover the real listener's peer binding, HTTP and WebSocket scope, remote and
  unknown peers, remote device bearers, expiry, renewal after the original token expires, and MCP
  reads before and after file replacement.
- `pnpm --filter @acorn/custody exec vitest run src/broker/taskConnection.test.ts
  --maxWorkers=1`: four passed, including per-request refresh, migrated shell discovery, and
  missing-file refusal.
- `pnpm --filter @acorn/node exec vitest run test/integration/auth/internalPrincipal.test.ts
  --maxWorkers=1`: 17 passed. `pnpm --filter @acorn/node exec vitest run
  test/integration/lifecycle/serviceSpawn.test.ts
  test/integration/plugins/workflowActivation.test.ts --maxWorkers=1`: four passed.
- `pnpm --filter @acorn/plugin-terminal exec vitest run src/server/terminalLifetime.test.ts
  --maxWorkers=1`: 29 passed, including reattach environment renewal.
  `pnpm --filter @acorn/plugin-agents exec vitest run
  src/server/sessions/acornMcp.test.ts src/server/sessions/runtimeStartup.test.ts
  --maxWorkers=1`: 21 passed. `pnpm --filter @acorn/plugin-workflows exec vitest run
  src/server/runs/workflowAgentSession.test.ts --maxWorkers=1`: nine passed.
  `pnpm --filter @acorn/plugin-notes exec vitest run
  src/server/seedTaskNotes.test.ts --maxWorkers=1`: three passed.
- Scoped `tsc --noEmit` passed for node-core, custody, node, plugin-api, agents, workflows, notes,
  and terminal.
  Scoped oxlint returned zero errors; it reported six unchanged `no-useless-spread` warnings in
  `wsHub.ts` and `terminalLifetime.test.ts`. `pnpm --filter @acorn/arch-tests exec vitest run
  --maxWorkers=1` passed all 87 tests in 12 files.

Limits: a process already running the pre-phase MCP code keeps its old environment token until the
harness restarts that MCP process. The tmux session and task data remain intact, and an MCP process
started afterward finds the refreshed file. A direct custom HTTP client that retains only
`ACORN_API_TOKEN` must read `ACORN_API_TOKEN_FILE` for sessions longer than 48 hours. The Node removes
session files untouched for 30 days while it is down; terminal reconciliation recreates a file for
each live tmux session. Later work can remove files promptly when a session ends. No full-repository
test or lint run was made. The initial sandboxed socket check could not bind a loopback fixture;
focused socket tests passed with local socket permission. An offline dependency install lacked the
locked `drizzle-kit` tarball and the registry was unavailable, so checks used this worktree's links
to the existing locked dependency installation. A later architecture run initially failed only in
`tools/arch/testFocus.test.ts`: its native-module preparation tried to `chmod` the read-only parent
`node-pty` copy. Copying that locked package into this worktree's ignored dependency directory repaired
the fixture; the final architecture run passed 87 of 87. Phase 03 runtime and CI pins remain
untouched.

Date: October 7, 2026. Status: proposed product requirements; implementation not started.
Source baseline: `823db58295b84ac9f9fb52f3f85b7a6550bd8761`.
Dependency: none.

This PRD narrows what a leaked internal token can do when a node is reachable beyond loopback. Today a
node that advertises a host binds every interface and accepts internal tokens from any peer, and those
tokens never expire.

## Problem and outcome

A child process the node spawns holds no device token. It presents a scoped internal token in the
`x-acorn-internal` header, verified by HMAC in `packages/node-core/src/server/middleware/auth.ts`
against the key in `packages/node-core/src/server/auth/internalTokens.ts`. A `service`-scope token is
unbound and reaches provider reads and any task, as `packages/node-core/src/server/middleware/requireUser.ts`
grants. A `task`-scope token is bound to one task.

Two properties widen the blast radius of a leak:

- The verification does not care which peer sent the request. When `advertiseHost` is set,
  `packages/node-core/src/server/transport/listener.ts` binds `0.0.0.0`, so the internal-token path is
  reachable from the network, not only from loopback. The node's own children always reach it over
  loopback.
- Internal tokens never expire, by the design noted in `internalTokens.ts`. A `service`-scope token is
  owner-equivalent for orchestration. If one leaks, through a plugin, a log, a crash dump, or a shared
  continuous-integration environment, it stays valid for the life of the signing key and is usable from
  any machine that can reach the advertised port.

A LAN attacker still needs the token value, so this is not remote code execution on its own. The
exposure is the cost of a single leak once a node is advertised.

The outcome: the node refuses an internal token presented from a non-loopback peer, so a child's
credential is useless off the machine even when the listener is advertised. Internal tokens carry a
lifetime, so a leaked token stops working without a signing-key rotation that also breaks every live
child.

## Starting points and owners

Inspect these files and their tests:

- `packages/node-core/src/server/auth/internalTokens.ts` owns the token format, the claims, minting,
  and verification.
- `packages/node-core/src/server/middleware/auth.ts` owns principal resolution, including
  `internalPrincipal`, which reads the header and resolves the claims.
- `packages/node-core/src/server/transport/listener.ts` owns the bind host and the advertised-host
  logic.
- `packages/node-core/src/server/transport/advertise.ts` owns which hosts the node answers to.
- The internal env factory callers in `plugins/workflows`, `plugins/agents`, and `plugins/notes`, which
  mint tokens into child and loopback environments.

Read [transport and auth](../../security/transport-and-auth.md) and
[credential handling](../../security/credentials.md).

## Required behaviour

Refuse an internal token from a non-loopback peer. Resolve the internal principal only when the request
arrived over a loopback connection. The node's children reach the listener over loopback with full
certificate validation, which the listener comment already relies on, so this preserves every legitimate
internal caller. A device bearer is unaffected: a remote device authenticates with its paired token, not
an internal one.

Give internal tokens a lifetime. Add an expiry claim at mint time and enforce it at verification. Choose
a lifetime that outlives a normal child's work without being effectively permanent, and a renewal path
for a long-running child so a reattached session can refresh rather than carry a stale credential. State
the chosen lifetime and the renewal mechanism. Keep the uniform null return on any failure, so a caller
cannot tell an expired token from a forged one.

Preserve the scopes and their reach. A `service` token still warms mirrors and assembles context, a
`task` token still acts on its one task, and the existing minting sites keep working with the added
lifetime. A reattached long-running agent must not lose access silently: either its token lifetime
covers the reattach window or the renewal path restores it.

## Contracts and data flow

The token travels from a mint site into a child or loopback environment, then back on the
`x-acorn-internal` header. The loopback check belongs at principal resolution, where the connection's
peer is known. The expiry belongs in the claims and the verification, beside the existing scope and
task checks. Do not move the signing key or change the HMAC; this adds a peer condition and a time
condition, it does not change the credential's cryptography.

If the listener cannot see the peer address at the point principal resolution runs, carry the
loopback fact from where the connection is accepted rather than trusting any header.

## Acceptance and verification

Exercise these cases:

- A child over loopback with a valid, unexpired token authenticates and acts within its scope.
- The same token presented from a non-loopback peer is refused, with the uniform failure.
- An expired token is refused over loopback, with the same uniform failure as a forged one.
- A device bearer from a remote peer still authenticates, so the loopback rule does not catch devices.
- A long-running agent that reattaches after the original token would have expired still reaches the
  node, through the chosen lifetime or renewal path.

Run the full `@acorn/node-core` suite and the auth tests, the workflows, agents, and notes suites that
mint internal tokens, their consumers, and `pnpm lint`. Add regressions for the loopback refusal and the
expiry to the auth suite. Record any platform where the peer address is not available at resolution.

Update [transport and auth](../../security/transport-and-auth.md) and
[credential handling](../../security/credentials.md) to describe the loopback confinement and the token
lifetime.

## Verify before building

- Confirm that every internal caller reaches the listener over loopback, so the peer rule breaks no
  legitimate path.
- Confirm the longest-lived child's working window, so the token lifetime or renewal covers a reattach.
- Confirm where the connection's peer address is available relative to principal resolution.
- Confirm the uniform-null failure still holds for the new expiry branch, so it leaks no distinction.
