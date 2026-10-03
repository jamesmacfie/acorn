# Events

This page covers how a node half hears core's events and another plugin's events, the first-party
events that ship, and what's deliberately not an event. It's part of the
[plugin reference](../plugins.md). [Events and
capabilities](../plugin-authoring/events-and-capabilities.md) has short working examples.

Events are invalidation over the authenticated WebSocket. There's no durability, no replay, and no
delivery guarantee, so a listener reads stored state again after startup, reconnect, or a gap. Use a
capability when the caller needs a result.

## Hearing a core event

`ctx.events.on(event, listener)` is the receive side. It fires whether or not a client is attached,
which matters on a Node nobody is using. The event must be one core publishes, listed in
`NODE_EVENT_CHANNELS` in `packages/protocol/src/transport/nodeEvents.ts`. A loaded plugin must also
name it in `permissions.events`, the same grant list its frames subscribe with, so there's one trust
sentence per grant. Disposal follows unload, as a route registration does.

Core publishes 11 events: `plugins:changed`, `tasks:changed`, `workspace:changed`,
`workspace-projects:changed`, `connection:changed`, `head:changed`, `run:changed`,
`agent-session:changed`, `project:changed`, `terminal:sessions-changed`, and
`worktree:status-changed`.

Two of them are worth knowing:

- `terminal:sessions-changed` says a session was created, exited, or flipped between working and
  idle. It's the one core event that fires at machine speed, so hear it only if you draw a session
  list.
- `worktree:status-changed` says something under a task's worktree changed, and carries the `taskId`.

After your plugin writes under a worktree, drop the Node's coalesced `git status` for the path, then
announce the change:

```js
import { invalidateWorktreeStatus } from '@acorn/plugin-api/node'

await writeFile(join(root, path), text, 'utf8')
invalidateWorktreeStatus(root)
ctx.events.worktreeStatus(taskId)
```

The order matters. The announcement makes every client read again, and they must not get the answer
from before your write ([worktree status reads](../workspaces-and-tasks/worktrees.md#worktree-status-reads)).

## Hearing another plugin

The same `on` takes `plugin:<id>:<verb>` when the producer declared the verb: a loaded plugin under
a top-level `emits` key in its manifest, a compiled one through `NodePlugin.emits`. The subscriber
names the channel in its own `permissions.events`, and the trust prompt draws one host-owned sentence
per producer, such as "Receive live updates from the github plugin".

A running producer that didn't declare the verb makes the subscription throw. A producer that isn't
running delivers nothing and raises no error, which works because payloads carry state and the
consumer reads again on receipt. Init order isn't a contract, so a consumer that subscribes before its
producer's init has run is admitted even for an undeclared verb. The frames never arrive, so the
contract holds, and only the error is lost.

The frame side honors the same grant through the broker. It doesn't consult the producer's `emits`,
because a producer's frames reach every socket anyway, and the Node-side check is the one that holds.

### Shipped first-party events

Every row is an invalidation over durable or Node-owned state. A payload carries only enough current
state or scope to avoid an unneeded broad read.

| Producer event | Payload | Read again from |
| --- | --- | --- |
| `plugin:workflows:run-changed` | Task, run, durable run status | Workflow run routes |
| `plugin:workflows:gate-changed` | Task, run, step, human-gate status | `workflows.gates` |
| `plugin:workflows:child-changed` | A dispatched child run's durable state | Workflow run routes |
| `plugin:workflows:completed` | A run that reached a terminal status | Workflow run routes |
| `plugin:agents:turn-changed` | Task, session, turn, source, status, attempt | `agents.turns` |
| `plugin:agents:request-changed` | Task, session, request, kind, status | `agents.requests` |
| `plugin:agents:sessions-changed` | Task, session, present, archived | `agents.sessions` |
| `plugin:agents:usage-refreshed` | The cached plan usage snapshot was refreshed | Agent usage routes |
| `plugin:terminal:completed` | A task agent terminal exited | Terminal session routes |
| `plugin:github:repos-changed` | None | User-scoped repositories from `github.mirror` |
| `plugin:github:pulls-changed` | Repository scope | GitHub mirror routes |
| `plugin:github:checks-changed` | Repository, pull, current head | GitHub mirror routes |
| `plugin:github:pr-synced` | Repository, pull, current head | GitHub mirror routes |
| `plugin:browser:captures-changed` | Task | `browser.captures` |
| `plugin:changes:review-notes-changed` | Task, total count, unsent count | Task-confined review-note routes |
| `plugin:memory:memories-changed` | Project or private scope | `memory.library` |
| `plugin:preview:url-changed` | Task, nullable URL, resolution source | `preview.urls` |

The browser plugin also sends `capture-created` for one compatibility period, and new consumers use
the collection event. The loaded http, linear, and rollbar packages declare `navigate` for their own
frames. Core's `agent-session:changed` stays the deliberately coarse event for completion and
attention, and the agents plugin's events don't repeat its transcript stream. The provider's
`contract/` directory holds the read capability when a listener needs more than the payload.

### What earns a place

An event is admitted only if all four hold:

1. Core, or the emitting plugin, is the only possible observer.
2. It's human-scale, such as per commit, not machine-scale, such as per keystroke or per container
   health check.
3. It carries state, not a delta, so a missed frame heals on the next read.
4. One honest host-owned sentence describes it in the trust prompt.

Rule 2 is partly a property of the pipe. `wsBroadcast` walks every open socket with no subscription
filter and no backpressure, so a frame every few seconds is a stream. Streams stay with the one plugin
that owns `ctx.events.streams`. Every new channel costs a `SUBSCRIBABLE_CHANNELS` entry and a sentence.

## What is not an event

These are refused by name:

- **File opened or saved.** A plugin that wants this wants a file watcher on its node half.
- **Terminal output and other owned streams:** PTY output, Docker logs and stats, and the agent token
  stream. The lifecycle event is the event, and the stream stays with its owner.
- **Anything per keystroke, selection, render, or agent step.**
- **Cache mechanics,** such as Docker's health-check ping, GitHub's 304 refreshes, and per-step
  workflow writes. The event is the completed sync or the final state.
- **Generic process and port lifecycle.** Declared run targets changing state is the exception.
- **Raw user activity.** An idle or active signal is the most surveillance-shaped thing a third-party
  surface could carry.
- **Request and query payloads,** such as an HTTP request sent or a database query run. They're the
  user's private data and can carry resolved secrets.
- **Compose up and down.** Another plugin can ask `docker compose ps`.

Three events stay conditional. `http:variables-changed` ships only with a concrete consumer and a
capability that exposes redacted metadata, never names, values, commands, or secrets.
`agents:delegation-changed` waits for a task-authorized durable read model. `preview:navigated` waits
for an authoritative Node-side current-URL read and a rule for redacting sensitive query values. None
is emitted.
