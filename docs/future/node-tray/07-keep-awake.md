# Phase 7: keep the machine awake while agents work

Date: October 18, 2026. Status: proposed.

## Goal

While an agent works or waits for its owner, or a workflow runs, the Node asks the operating system
not to sleep when idle. When nothing runs, it lets go. A remote client keeps reaching a laptop in tray
mode, or a Node-only machine, for as long as there's work on it. One Node preference turns it off.

## Starting point

- Nothing in acorn holds a power assertion.
- Agents and Terminal map each session to one of five states in
  `packages/protocol/src/agents/attention.ts`. `working` means the agent is doing something, and
  `blocked` means it waits on the owner for a permission, a question, or a workflow gate. The managed
  adapter is `plugins/agents/src/contract/attention.ts`
  ([states and edges](../../notifications/states-and-edges.md)).
- The workflow engine in `plugins/workflows/src/server` knows which runs are active.
- Compiled plugins reach core services through the capability registry in
  `packages/node-core/src/server/pluginHost/capabilities.ts`.
- The Node reads its own preferences the way telemetry does: `core.prefs.read` with the active
  identity and a key (`packages/node-core/src/server/telemetry/collector.ts`).

## Design

### Leases

Core gets a `keepAwake` service in `packages/node-core/src/server/power.ts` (new), offered to compiled
plugins as a capability. `hold(reason)` returns a release function. The service counts leases:

- When the count goes from zero to one, it starts the platform's inhibitor.
- When it goes from one to zero, it waits 60 seconds and stops the inhibitor if the count is still
  zero. The wait keeps the gap between two agent turns from flapping the assertion.
- The Node's drain stops the inhibitor.

These hold leases:

- The agents plugin holds one for each session while its state is `working` or `blocked`. A blocked
  session counts because the person who answers it is often on the other machine.
- The workflows plugin holds one for each active run.
- Terminal sessions hold none. A long command in a terminal is the person's to manage.

### The inhibitors

Each is a child process the Node starts. Each ends when the Node releases it or the Node dies, so a
crashed Node never leaves a machine awake:

| Platform | Inhibitor | How it ends with the Node |
| --- | --- | --- |
| macOS | `caffeinate -i -w <node pid>` | `-w` exits when the Node's process ends |
| Linux | `systemd-inhibit --what=idle --who=acorn --why=<reason> --mode=block sh -c 'read _'` | The shell's `read` returns when the Node's end of stdin closes |
| Windows | A hidden PowerShell process that calls `SetThreadExecutionState` with `ES_CONTINUOUS` and `ES_SYSTEM_REQUIRED`, then blocks on stdin | Same as Linux |

`caffeinate -i` stops idle sleep only. A Mac still sleeps when its lid closes or when someone chooses
**Sleep**. The Windows call keeps the system awake but lets the display turn off.

When an inhibitor can't start, such as on Linux without logind, the Node logs one warning and reports
the state as unavailable.

### The preference

`power.keepAwake` is a Node preference with two values: `while-busy`, the default, and `never`. The
service reads it when a lease would start the inhibitor. **Settings → Nodes** shows it on each Node's
row as **Keep this computer awake while agents work**, with "Unavailable on this computer" when the
inhibitor can't start. A remote client can change it, because it's an ordinary owner preference.

`GET /v1/core/node/power` answers `{ "setting": "while-busy", "available": true, "held": 2 }` for that
row. It needs a device principal.

## Steps

1. Write the `keepAwake` service with an injectable inhibitor, and register its capability.
2. Write the three inhibitors.
3. Hold leases in the agents plugin from session state changes, and in the workflows plugin from run
   start and end.
4. Add the preference, the read route, and the row in **Settings → Nodes**. Update the route snapshot.
5. Document it in [Node distribution](../../node-distribution.md) and the agents operations page.

## Acceptance

- Unit tests with a fake inhibitor: the first lease starts it, the last release stops it after the
  wait, a lease inside the wait cancels the stop, `never` starts nothing, and the drain stops it.
- An agents test: a session that goes `working`, then `blocked`, then `finished` holds one lease and
  releases it once.
- By hand, with an agent running:
  - macOS: `pmset -g assertions` lists `caffeinate`.
  - Linux: `systemd-inhibit --list` lists acorn.
  - Windows: `powercfg /requests` lists the PowerShell process under **SYSTEM**.
- After the agent finishes, each listing clears within about 60 seconds.
- Killing the Node with `SIGKILL`, or ending its task on Windows, clears the listing.

## Risks

- A laptop on battery stays awake through a long agent run. That's the point of the feature, and the
  preference turns it off.
- `systemd-inhibit` under a user service can be refused by polkit for a session that isn't active.
  Then the Node reports the state as unavailable, and a server that never sleeps loses nothing.

## Verify before building

- Check that `caffeinate -i` from a LaunchAgent and from the desktop's helper child both create an
  assertion `pmset` lists.
- Check whether `--what=idle` alone stops idle suspend on GNOME and on a headless Ubuntu server, or
  whether `sleep` is needed too.
- Check that a PowerShell process started hidden from Node.js can hold `ES_SYSTEM_REQUIRED`, and
  how long it takes to start.
- Read how a compiled plugin takes a capability in `packages/node-core/src/server/pluginHost/capabilities.ts`
  before you name the capability.
