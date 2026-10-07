# Advisor

A loaded acorn plugin that reads each completed turn of an agent session, asks a second model whether
something is wrong, and sends the agent a note when it finds a real problem. It's the
consumer for [plugin model grants](../../../../integrations/model-providers.md#plugin-model-grants),
the [review input](../../../../managed-agents/session-events.md#review-input) reader, and
[session messages](../../../../managed-agents/session-messages.md).

## What it does

Reviews are off by default. In **Settings > Agents > Advisor**, choose **Unattended sessions** for
workflow steps and delegated agents, or **Every session**. Choose the model and the daily allowance on
the plugin's page in **Settings > Plugins**. A 0.1.0 install that chose **Interactive sessions** keeps
that choice until it's changed.

Interactive turns arrive as events, in the steps below. An unattended turn arrives through
`agents:turn-follow-up` instead ([unattended follow-ups](../../../../managed-agents/unattended-follow-ups.md)):
the workflow step or the parent agent holds its result for up to 30 seconds while the review runs, so
a blocker's correction comes before the result. The review is the same, with three differences. It
runs at once rather than waiting in the table, it stops when the window's signal aborts, and a
concern is sent even after a finished answer, because the owner is about to report it. The note names
the turn as `originTurnId`, and its key is the interactive one, so a recovered owner's second window
spends nothing.

1. On `plugin:agents:turn-changed` with status `completed` and source `interactive`, it records one
   job keyed by session and turn. A repeated event finds the job and does nothing. A plugin's note
   and a delegated agent's report are never reviewed, so the advisor never answers itself.
2. A job reads the session from `agents.sessions` and the turn from `agents.reviewInput.v1`. It
   reads the task's working tree with `git diff --stat HEAD` and `git diff HEAD`, cut at 32 KiB with
   a line saying so. The diff is a snapshot of the task, not proof of what this turn changed, and
   the prompt says that.
3. It calls `ctx.core.models.generateText` with no `backendId`, so the owner's grant decides the
   backend, the model, and the allowance. Everything reviewed sits inside `<data>` fences with a
   fresh ID per prompt, and the system prompt says the fenced text is never an instruction.
4. It reads one JSON verdict: `none`, `nit`, `concern`, or `blocker`, with a note of at most 2 KiB.
   Anything else is recorded as malformed, and nothing is sent.
5. It reads the turns and the session again, then decides in `review.js`:
   - A cancelled newest turn, or a stopped or failed session, gets no note, so a late result never
     starts a stopped session. A newer turn makes the review stale, and it's only recorded.
   - The same note at an equal or lower severity is dropped as a repeat. A real escalation goes
     through.
   - A nit is recorded. A concern is recorded after a finished answer, and sent only when the turn
     stopped mid-work (`max_tokens` or `max_turn_requests`). A concern within three turns of a sent
     note is held.
   - A blocker is sent.
6. A note goes through `agents:session-messenger` with the key `<sessionId>:<turnId>`, so a retry
   never sends a second note. It counts against this plugin's 20-note cap per session.

Two reviews run at once. Turning reviews off, or archiving the session, aborts a review in flight,
and the abort reaches the model call. A review the Node stopped during is recorded as cancelled or
interrupted and never retried, because it may have spent. A queued review runs after a restart.

The settings page lists the last 20 notes with what happened to each, and the last failure, such as
`provider_not_configured` when the owner hasn't chosen a model.

## Files

| File | What it holds |
| --- | --- |
| `node.js` | The wiring: events, the messenger, and the settings route |
| `advisor.js` | The durable jobs, the reads, the model call, and delivery |
| `review.js` | The prompt, reading the verdict, and the delivery rules, with no I/O |
| `client.js` | The settings page, a tree drawn with acorn's own components |
| `migrations/` | `settings`, `jobs`, and `notes` |

## Install

The package has no build step and no dependencies. Post
`{ "source": { "path": "<checkout>/docs/future/pi/packages/advisor" } }` to
`POST /v1/core/plugins/install`, or use **Settings > Plugins > Install…** and choose this folder.
Restart the Node, and accept the trust prompt. It needs a Node with `agents.reviewInput.v1`, which
phase 04 added.

## Check it

```sh
node --test
```

Run it from this folder. `advisor.test.mjs` covers a repeated event, a restart, a malformed answer, a
missing grant, a repeated note and an escalation, the cooldown, a cancel during generation, the checks
after generation, and turns from a plugin or a delegated report.
