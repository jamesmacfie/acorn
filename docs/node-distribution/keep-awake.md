# Keep the computer awake while agents work

A Node keeps its computer from sleeping when idle while an agent works or waits for its owner, or a
workflow runs. When nothing runs, it lets go. A client on another machine keeps reaching a laptop in tray
mode, or a Node-only machine, for as long as there's work on it. This page is part of
[Node distribution](../node-distribution.md).

## Leases

Core's keep-awake service (`packages/node-core/src/server/power.ts`) counts leases. Compiled plugins
take one through the `core.keepAwake` capability, `NODE_KEEP_AWAKE` in `@acorn/protocol/api.ts`, whose
`hold()` returns the release.

- The first lease starts the operating system's inhibitor.
- When the last lease goes, the service waits 60 seconds and stops the inhibitor if no lease came back.
  The wait keeps the gap between two agent turns from flapping it.
- The Node's drain stops it.

These hold leases:

- The agents plugin holds one for each session whose [attention state](../notifications/states-and-edges.md)
  is `working` or `blocked` (`plugins/agents/src/server/sessions/keepAwake.ts`). A blocked session
  counts, because the person who answers it is often on another machine.
- The workflows plugin holds one for each run that's `running` or `cancelling`. A run at a gate lets go,
  because a gate nobody answers would keep the computer awake across every restart. An agent waiting at
  the gate still holds through the agents plugin.
- Terminal sessions hold none. A long command in a terminal is the person's to manage.

The agents plugin learns states from session rows as it broadcasts them, so a session that was working
when the Node stopped holds nothing until it changes again.

## The inhibitors

Each inhibitor is a child process that ends when the Node releases it or the Node dies, so a crashed Node
never leaves a computer awake.

| Platform | Inhibitor | How it ends with the Node |
| --- | --- | --- |
| macOS | `caffeinate -i -w <node pid>` | `-w` exits when the Node's process ends |
| Linux | `systemd-inhibit --what=idle --who=acorn --mode=block sh -c 'read _'` | The shell's `read` returns when the Node's end of stdin closes |
| Windows | A hidden PowerShell process that calls `SetThreadExecutionState` with `ES_CONTINUOUS` and `ES_SYSTEM_REQUIRED`, then reads stdin | Same as Linux |

`caffeinate -i` stops idle sleep only. A Mac still sleeps when its lid closes or when someone chooses
**Sleep**. `pmset -g assertions` lists it as `PreventUserIdleSystemSleep`. The Windows call keeps the
system awake but lets the display turn off, and `powercfg /requests` lists it under **SYSTEM**.
`systemd-inhibit --list` lists the Linux one as acorn.

When an inhibitor exits on its own, such as on Linux without logind or when polkit refuses a session
that isn't active, the Node logs one warning, reports the state as unavailable, and doesn't try again
until it restarts. Other platforms have no inhibitor and report unavailable from the start.

## The setting

`power.keepAwake` is a Node preference with two values: `while-busy`, the default, and `never`. Each
Node's row in **Settings → Nodes** shows it as **Keep this computer awake while agents work**, with
"Unavailable on this computer" when the inhibitor can't run. A client on another machine can change it,
because it's an ordinary owner preference written through `PUT /v1/core/prefs`.

The service reads the preference whenever a lease arrives and whenever `GET /v1/core/node/power` is read.
The switch reads that route after it saves, so turning it off stops the inhibitor at once. The route
needs a device principal and answers `{ "setting": "while-busy", "available": true, "held": 2 }`, where
`held` counts the live leases.
