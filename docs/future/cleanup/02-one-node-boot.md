# 02: One Node boot

This proposal moves the Node's boot sequence into one function that the supervised and standalone
entries both call. Each entry keeps only what is truly its own.

Date: October 11, 2026. Status: proposed. Depends on: [01: green the gate](./01-green-the-gate.md).
Part of the [cleanup programme](./README.md).

## Problem

Two files boot a Node:

- `apps/node/src/composition/runtime.ts` is the Node the desktop helper supervises.
- `apps/node/src/entries/standalone.ts` is `pnpm dev:node`, the packaged standalone Node, and the
  CLI's background service.

Each lists the same 15 or so steps by hand: open the data root, reconcile bundled packages, mint
internal credentials, build core services, start telemetry, assemble the plugin graph, create the
scheduler, start plugins, build the plugin-state bridge, set two core seams, wire agent tools, start
the listener, start the scheduler, reconcile, and drain. `apps/node/src/composition/composition.ts`
already shares the graph, the reconcile step, and the drain order, but the sequence that calls them
is written twice.

The two copies have drifted:

- The supervised drain closes task script waits, through `stopScriptWaits` in `runtime.ts`. The
  standalone drain doesn't. After a SIGTERM, a pending setup attempt is recorded as interrupted by
  `restart` on the next boot instead of `shutdown`, and open waits aren't aborted.
- Only the supervised Node checks the session key with `checkSessionKey`, re-registers the MCP
  server with `refreshAcornMcpRegistrations`, and starts the login shell PATH probe.
- The supervised Node reports its app version as the telemetry release. The standalone Node reports
  the protocol version.
- The supervised Node reconciles in the background and reports `ready` after it. The standalone Node
  awaits reconciliation before it prints its handshake.

Some of these may be deliberate, but neither file says which. The comments that tie the copies
together cite paths that no longer exist, `service/runtime.ts`, `server/standalone.ts`, and
`server/composition.ts`. `apps/node/test/integration/lifecycle/standaloneParity.test.ts` compares
the plugin graph, the drain step names, and the plugin-state inputs. It can't see what each drain
step does, so it missed the task script difference. Its own comment says the copies drifted once
before.

## Goal

One function owns the boot sequence and the drain. The two entries differ only where their hosts
differ, and each difference is a named option or a step the entry adds.

## Requirements

1. Add `bootNode()` in `apps/node/src/composition/boot.ts` (new file). It takes the data root, the
   runtime options, and the host differences as named options. It returns the listener, the
   endpoint identity, the core services, and one `stop()` that runs the drain.
2. Give every host difference a decision and a name. Default to the same behavior on both hosts
   unless there's a reason not to:

   | Difference | Proposed decision |
   | --- | --- |
   | Close task script waits on drain | Both. The standalone gap is a bug. |
   | Session key check | Both. The key file custody differs, but the check is the same question. |
   | MCP re-registration at boot | An option, on for both outside tests. |
   | Login shell PATH probe | An option: on for a packaged app, off for a Node started from a shell. |
   | Telemetry release | The app version on both. Fall back to the protocol version only when there's no app version. |
   | Background or awaited reconcile | An option, because the standalone handshake waits for it on purpose. |

3. Keep host-only work in the entries. The supervised entry keeps state reporting, installed-bytes
   telemetry, and preview rules. The standalone entry keeps enrollment, the pairing banner, the
   handshake, and signal handling.
4. Delete the duplicated sequence from both entries.
5. Replace the parity test's step-name comparison with a test that boots through `bootNode()` with
   each host's options and checks the drain's effects, including the task script close.

## Out of scope

The core seams set after plugins start belong to
[04: core seams at construction](./04-core-seams-at-construction.md). Do that proposal after this
one, so it changes one boot instead of two.

## Acceptance

- `runtime.ts` and `standalone.ts` call `bootNode()` and contain no step from the shared sequence.
- Each remaining difference appears once, as a `bootNode()` option or an entry-only step.
- A test proves a standalone SIGTERM records pending setup attempts as interrupted by `shutdown`.
- `pnpm test --filter=@acorn/node` and the desktop boot test pass.
