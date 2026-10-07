# Session meter

A loaded acorn plugin that shows what a task's agent sessions are doing, on any harness: running and
finished tool calls, how full the context is, and the subagents each session started. It also cycles a
session's reasoning effort. It's the consumer for the [activity
feed](../../../../managed-agents/session-events.md#activity) and [session
control](../../../../managed-agents/session-control.md).

## What it does

Open **Session meter** from a task's pane menu. For each of the task's four newest live sessions it
shows:

- The context fill as a meter, from the harness's own count.
- The last eight tool calls the session made itself, with their status. A command shows as
  `Command`, because the feed never carries a command line.
- Each subagent, with the last eight calls it made.
- The session's reasoning effort, with a **Cycle effort** button.

**Session meter: cycle reasoning effort** in the palette does the same for the newest session while
the pane is open. Either way, the meter picks the next value the harness advertised, wrapping round,
and the session's transcript says "… changed to … by acorn-session-meter". A harness that advertises
no effort option shows none.

## How it works

- `node.js` answers `GET /v1/p/acorn-session-meter/activity?taskId=…` from `agents.sessions` and
  `agents.activity.v1`, and `POST /v1/p/acorn-session-meter/cycle-effort` with `agents.sessionControl`
  `setConfig`. `meter.js` holds the rules.
- `client.js` is a hand-written tree, from the advisor's, because the package has no build step. It
  reads the rebuilt state once, subscribes to `plugin:agents:activity`, and applies each frame for its
  task, so a pane opened mid-session starts from the same state the frames lead to. A frame for a
  session it hasn't read makes it read again.

The manifest asks for `plugin:agents:activity`, `agents.sessions`, `agents.activity.v1`, and
`agents.sessionControl`. The trust prompt marks the last one high, because it changes what a session
spends.

## Install

The package has no build step and no dependencies. Post
`{ "source": { "path": "<checkout>/docs/future/pi/packages/session-meter" } }` to
`POST /v1/core/plugins/install`, or use **Settings > Plugins > Install…** and choose this folder.
Restart the Node, and accept the trust prompt.

## Check the rules

```sh
node --test
```

Run it from this folder. `meter.test.mjs` covers the effort cycle and which sessions the pane reads.
