# Phase 2: an explicit persistent local Node

Status: proposed implementation handoff, 2026-09-27. Depends on Phase 1.

## Outcome and rationale

`acorn node start --background` starts a local Node that survives the command. `acorn node status`
shows which process owns the selected local data root, its health, protocol, address, and log path.
`acorn node stop` stops only a service the CLI explicitly started for that root. This gives scripts
a way to kick off work and exit while agents and workflows continue. The background process has
service ownership separate from the terminal client's attach-or-start lifetime.

This is a local service operation, not a remote `--node` operation. A CLI attaching to a desktop or
operator-started standalone Node has no authority to stop it through this command.

## Work to deliver

1. Reuse the standalone Node entry, data root, lock, startup health probe, shutdown drain, and
   signal handling. Add a small launcher/supervision adapter rather than a second Node runtime.
   Specify startup arguments and environment in one package-owned function so checkout and
   extracted artifact behave alike.
2. Use a private startup handshake to transfer the initial device token to custody. Choose a
   platform-compatible pipe or restricted file only after tracing the current standalone entry.
   Set restrictive modes before writing secrets. Never pass the token in argv, print it to logs, or
   return it from `status` in JSON.
3. Record CLI ownership with the data root and process identity, atomically enough to reject stale
   PID reuse. Treat the Node's root lock and authenticated health probe as liveness evidence. A
   second `start` for the same healthy root returns the existing service or a documented
   already-running status without spawning another. If another owner holds the root, report that
   owner and attach for ordinary commands without claiming service ownership.
4. Redirect stdout/stderr to a restricted log with a discoverable path and bounded size or rotation
   policy. Define startup timeout, health retry, clean stop timeout, and stale-record cleanup.
   `stop` requests graceful drain and waits; a forced kill requires its own explicit option and
   should never target a process that fails the ownership check.
5. Decide what a non-interactive first run does when the root lacks custody and a default
   workspace. `node start` may establish local device custody as part of the private handshake;
   workspace bootstrap remains a separate Node operation or clearly documented startup behavior.
   No general read or write command should create a service as a hidden side effect.

## Example contract

```sh
acorn node start --background --output json
acorn node status --output json
acorn workspace list --output json
acorn node stop --output json
```

The start response includes a stable `nodeId`, service state, and log path. Status distinguishes
`running`, `starting`, `stopped`, and `running-unowned` rather than inferring ownership from a PID.
`node stop` on a desktop-owned or externally started Node refuses with an ownership error. A script
can use `node info` from Phase 1 to inspect any selected Node without owning it.

## Tests and acceptance

- Launch from an empty temporary data root with stdin closed. The start command returns only after
  the authenticated health probe works; another CLI process can list workspaces or report an empty
  unbootstrapped root without pairing prompts.
- Two starts racing for the same root yield one Node, one valid ownership record, and no token leak.
  A crash before readiness leaves a clear error and no misleading `running` state.
- A command exits while the Node stays alive; subsequent agent and workflow phases can create work
  through it. TUI exit does not stop this CLI-owned service.
- `stop` drains the owned Node and clears its record. It refuses to stop a desktop-owned Node,
  a manually started standalone Node, a Node under another data root, or an unrelated process that
  reused a recorded PID.
- Run `start`, `status`, and `stop` from the extracted distribution on each supported platform,
  including a clean root and a root already locked by another host. Inspect file permissions and
  process arguments to verify the first token is absent.

## Verify before building

- Read `apps/node/src/entries/standalone.ts`, `packages/node-core/src/server/bindings.ts`,
  `packages/custody/src/`, `apps/tui/src/node/supervise.ts`, and the distribution script.
- Check the current lock and shutdown behavior before choosing ownership-record format or signals.
- After implementation run `pnpm lint`, the Node boot tests, and the service cases in
  [verification](./verification.md).
