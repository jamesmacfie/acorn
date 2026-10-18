# Phase 7: keep the machine awake while agents work

Date: October 18, 2026. Status: done on macOS, with the Linux and Windows inhibitors unproven until
phase 8.

## Completion note

Landed on October 18, 2026, on the `phase-7-keep-awake` branch.

What landed:

- `createKeepAwake` in `packages/node-core/src/server/power.ts` counts leases, starts the inhibitor on
  the first, stops it 60 seconds after the last, and stops it at the drain. `platformInhibitor` builds
  the macOS, Linux, and Windows child processes from this page's table. `bootNode` provides it as
  `core.keepAwake` (`NODE_KEEP_AWAKE`) before the plugins start, and a `keepAwake` drain step after the
  plugins stops it.
- `NodePower`, `KeepAwake`, `coreNodePowerRoute`, `KEEP_AWAKE_PREF_KEY`, and `NODE_KEEP_AWAKE` in
  `packages/protocol/src/transport/api/nodeAdmin.ts`. `GET /v1/core/node/power` in
  `routes/nodePower.ts`, behind the `requireDevice` mount on `/v1/core/node/*`.
- Agents: `holdAwakeWhileBusy` in `plugins/agents/src/server/sessions/keepAwake.ts` follows the
  session rows the engine broadcasts, using the same `managedState` the notifications read.
- Workflows: `WorkflowRunState.trackAwake` holds for a `running` or `cancelling` run and releases at any
  other status edge. The runner calls it from `tick` and `reconcile`, so every path that resumes a run
  holds.
- **Settings → Nodes**: `NodePowerSetting.tsx` on every Node's row. It writes the preference with
  `setPref` and reads the route.
- Docs: [keep the computer awake](../../node-distribution/keep-awake.md) (new), links from
  [Node distribution](../../node-distribution.md#operations) and
  [agent operations](../../managed-agents/operations.md#idle-stop), [core routes](../../api-reference/core-routes.md),
  [settings groups](../../frontend/settings-groups.md#node-management), and two site pages.
- Tests: `power.test.ts` covers the acceptance list with a fake inhibitor, plus a missing command, an
  inhibitor that exits on its own, and a stop that doesn't report itself. `keepAwake.test.ts` in the
  agents plugin covers working, blocked, and finished, then a deleted session. `keepAwake.test.ts` in
  the workflows plugin runs a real gate: one lease while running, none at the gate, one more until
  done. `apps/node/test/integration/nodePower.test.ts` covers the route, a change to the preference,
  and the device gate.

Checked on this Mac: the real inhibitor showed in `pmset -g assertions` as `PreventUserIdleSystemSleep`
from `caffeinate`, "asserting on behalf of" the test's process, and cleared when it stopped. A process
that started `caffeinate -i -w` on its own pid and was killed with `SIGKILL` cleared the listing within
a second.

Decisions and deviations:

- **A gated workflow run holds no lease.** This page says each active run holds one. `reconcile`
  restores gated runs on every boot, so a gate nobody answers would keep the computer awake for good.
  An agent waiting at a gate still holds through the agents plugin until the Node restarts.
- `hold()` takes no reason. The inhibitor runs once for every lease, so one lease's reason would
  mislabel it. Linux gets a fixed `--why`.
- The service reads the preference on each lease and on each read of the route, not only when a lease
  would start the inhibitor. `PUT /v1/core/prefs` can't notify, and the switch reads the route after it
  saves, so turning it off stops a running inhibitor at once.
- An inhibitor that ends on its own marks the Node unavailable until it restarts, with one warning,
  rather than spawning a failing `systemd-inhibit` on every lease. A platform with no inhibitor reports
  unavailable from the start.
- The agents plugin seeds no leases at boot. Provider processes die with the Node, so a session only
  holds again once the engine broadcasts its row.
- `power.ts` is a listed exception in the child process rule in `tools/arch/boundaries.test.ts`,
  because the broker runs only bounded commands.
- `@acorn/node-core` uses the last of its 67 export slots for `./server/power.ts`.
- The Node service's size ceiling rose from 1,880,900 to 1,884,400 bytes. The base commit measured
  1,879,917 bytes and this phase 1,882,364. The service has to exist before the plugins start, so
  loading it on first use would only add an async wrapper. The switch is on a lazy settings page, so
  the renderer's startup roster gains only the one-line `readNodePower`.
- `docs/node-distribution.md`, `docs/managed-agents/operations.md`, and
  `docs/api-reference/core-routes.md` were at the 200-line limit. Each kept it by re-wrapping a
  paragraph.

Verify before building, as answered:

- `caffeinate -i` from a test process creates an assertion `pmset` lists. A LaunchAgent and the
  desktop's helper child weren't checked.
- Whether `--what=idle` alone stops idle suspend on GNOME and on a headless Ubuntu server wasn't
  checked. GNOME's automatic suspend might need `--what=idle:sleep`, which also blocks a suspend the
  person asks for.
- Whether a hidden PowerShell process started from Node.js holds `ES_SYSTEM_REQUIRED`, and how long it
  takes to start, wasn't checked. The flag value is written in decimal, because PowerShell 5 reads the
  hex literal as a negative number.
- A compiled plugin takes a capability with `ctx.capabilities.get(id)`, and a core-provided id lives in
  `@acorn/protocol` so a plugin can import it.

Not seen working:

- Linux and Windows. No machine of either kind was available, so `systemd-inhibit --list` and
  `powercfg /requests` were never read.
- A real Node with a real agent. The leases are proven with the agents and workflows code under test,
  and the inhibitor with the real `caffeinate`, but not together in a `dev:agent` window.
- The switch in a desktop window.

Full suite: every package passes except `@acorn/site`, where "searching for Show workspace rail puts
/docs/settings/general/ first" fails. It fails the same way with this phase's site edits set aside.

For later phases:

- Phase 8: with an agent running, read `pmset -g assertions`, `systemd-inhibit --list`, and
  `powercfg /requests`, check each clears about a minute after the agent finishes, and kill the Node to
  see the listing clear. On Linux, find whether GNOME needs `sleep` as well as `idle`.


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
