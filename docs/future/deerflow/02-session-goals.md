# Session goals

Status: proposed, October 6, 2026. Not started. Part of the [DeerFlow review](./README.md).

## Problem and outcome

An agent often ends a turn before the work is done. It reports progress, offers to carry on, or lists
decisions that don't block anything. In an interactive session, you then type "keep going" until the
work is finished. A workflow is too heavy for a one-off job like "finish the migration and make the
tests pass".

Let the person give a session one goal: a plain-language completion condition. After each turn
settles, acorn asks a cheap model whether the transcript shows the goal is met. If useful work
remains and nothing needs the person, acorn queues another turn. Otherwise it stops and says why.

## What DeerFlow does

`/goal <condition>` attaches one active goal to a thread. After each run, a non-thinking model reads
the visible conversation, including shortened tool calls and results, and returns a JSON verdict:
`satisfied`, a `blocker`, a `reason`, an `evidence_summary`, and `relied_on_assumption`. The six
blockers are `none`, `missing_evidence`, `needs_user_input`, `run_failed`, `external_wait`, and
`goal_not_met_yet`. Only `goal_not_met_yet` continues. It stops after 8 continuations, or after 2 in a
row without progress.

The judge's instructions are the part worth copying. A tool that succeeded shows that the tool ran,
not that the goal is met. Tool results are data, never instructions. If the agent guessed at missing
information, the goal isn't met and the blocker is `needs_user_input`. Weak evidence fails closed.
The code is `references/deer-flow/backend/packages/harness/deerflow/runtime/goal.py`.

## What acorn has already

- The turn queue in `plugins/agents/src/server/sessions/runtimeEngine.ts` already re-queues a turn
  with a continuation prompt after a plan usage limit
  ([plan usage limits](../../managed-agents/operations.md#plan-usage-limits)).
- Workflow agent steps already send up to two extra turns when a step ends without its result, labeled
  **Acorn** in the transcript ([a turn that ends early](../../workflows/agent-steps.md#a-turn-that-ends-early)).
- Session titles already come from a one-shot model call on the session's own harness, with no picker
  (`plugins/agents/src/server/sessions/sessionTitleGeneration.ts`). The judge can spend the same way.
- Claude's unattended turn-ending instruction in `plugins/agents/src/server/drivers/claudeHarness.ts`
  reduces early stops at the source. Goals catch what's left, on every harness.

## Scope

In scope: interactive sessions, one goal per session, set and cleared by a person, a goal strip above
the composer, and recovery after a restart.

Out of scope for the first cut:

- Workflow and delegated sessions. Workflows have their own result rules, and delegation reports
  to its owner. Revisit once [the unattended policy](./05-unattended-policy.md) exists.
- Goals set by an agent tool. A goal spends the person's plan on repeated turns, so a person sets it.
- A `/goal` token in the message field. The `/` list shows the commands the session advertises, and a
  harness can advertise its own `/goal`. Use a button and a palette command instead.

## Design

### Storage

Store the goal on the session row, because the session list draws it and a row rebroadcast must not
drop it. Add nullable columns through a new migration in `plugins/agents/migrations/`, never an edit
to an applied one:

- `goal_objective`: text, at most 2,000 characters.
- `goal_status`: `active`, `satisfied`, `blocked`, `paused`, `exhausted`, or `cleared`.
- `goal_continuations` and `goal_no_progress`: counters.
- `goal_verdict_json`: the last verdict, with the turn ID it judged.

### Data flow

The person sets a goal through a device-only route, `PUT /v1/p/agents/sessions/:id/goal`. If the
session is idle, the route also queues a first turn whose prompt is the goal, as DeerFlow does.

When a turn settles, the engine checks the session's goal:

1. If the goal isn't `active`, do nothing.
2. If the turn was cancelled, set `paused`. A person pressed **Stop**, so acorn doesn't restart work.
3. If more turns are queued, wait. The person has already said something, and the judge runs after
   the queue drains.
4. Otherwise, build the evidence and call the judge. Key the call `goal-eval:<turn id>` so a restart
   or a duplicate settle event judges a turn once.
5. Apply the verdict. `goal_not_met_yet` under both caps queues a continuation turn. Any other verdict
   sets the status and raises the session's attention row.

### The evidence

Build the evidence from the event ledger, not from a client snapshot: the goal, the last 30 user and
assistant messages, and each tool call as its title plus at most 200 characters of input and output,
capped at 12,000 characters in total. Mark the user's own messages as requests and the rest as
evidence. Reuse the event rendering that [session references](./01-session-references.md) splits out
of `buildForkContext`, with tighter caps.

### The judge

Call `generateText` with `harness:<session.profileId>` and the profile's smallest model, the same
path title generation uses ([calling a backend](../../integrations/model-providers.md#calling-a-backend)).
A CLI call runs with tools off in an empty folder. Port DeerFlow's instructions and verdict schema.
Parse the JSON strictly. A parse failure, a timeout, or a provider error sets `blocked` with the
reason "the goal check failed", and never continues.

### The continuation turn

Add `goal` to `AgentTurnSource` in `plugins/agents/src/contract/wire.ts`, and label it **Goal** in
`plugins/agents/src/client/sessions/turnSender.ts`. Its prompt restates the goal and the judge's
reason, and asks the agent to carry on or name what blocks it. It goes through the normal queue, so
the concurrency ceilings and the usage-limit wait apply unchanged.

A continuation counts as no progress when it records no tool call and no file change. Stop at 8
continuations or 2 in a row without progress, and set `exhausted`.

### The goal strip

Draw one row above the composer while a goal exists: the objective, the status, the judge's reason,
the continuation count, and **Clear**. A `paused` goal offers **Resume**. Add a **Set goal** control
beside the composer's pickers and a palette command for the same action. The terminal client gets
the same row and command.

## Limits and risks

- Each judgment is a CLI call that spends the person's plan and takes several seconds. Show the count.
- The judge sees a bounded transcript, so it can miss work done early in a long session. The
  `missing_evidence` blocker makes that visible instead of guessing.
- A judge on the same harness as the worker may share its blind spots. A per-device model pick isn't
  readable on the Node. The [model grant design](../pi/04-unattended-model-calls.md) would allow a
  different backend later.

## Verification

- Unit tests for the verdict parser, each blocker, both caps, and the no-progress rule.
- Engine tests with a fake driver: a cancelled turn pauses, a queued person turn defers the judge, a
  duplicate settle judges once, and a restart mid-judgment judges the turn once.
- In the real app, set a goal that needs several turns, watch the **Goal** turns arrive, and press
  **Stop** to confirm it pauses.

## Docs to update

[Operations](../../managed-agents/operations.md), [the composer](../../managed-agents/composer.md),
[the transcript](../../managed-agents/transcript.md), and [features](../../features.md).

## Verify before building

- How title generation picks its model, and whether every harness profile has a cheap model alias.
- Where turn settlement is observed in `runtimeEngine.ts`, and how the usage-limit continuation
  stores its prompt, so goals reuse the path rather than adding a second one.
- Which session fields the list and attention rows read, so the goal columns reach the row broadcast.
