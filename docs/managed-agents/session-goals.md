# Session goals

An interactive session can hold one goal of up to 2,000 characters. Set it from the conversation or
the **Set session goal** palette command. If the session is idle, acorn queues the goal as its first
turn. Goal turns use the [normal queue](./operations.md#the-turn-queue) and count against the same
concurrency and usage limits.

After a turn settles and its queue drains, acorn checks the goal against the event ledger. The check
reads recent messages and shortened tool input and output, with a 12,000-character evidence limit.
It uses a one-shot call on the session's harness. Claude Code uses its `haiku` alias; other harnesses
use their configured default. A failed or invalid check blocks the goal and does not queue more work.

Only a verdict that says useful work remains queues another **Goal** turn. A goal stops after eight
continuations or two consecutive goal turns without a tool call or file change. **Stop** pauses an
active goal. **Resume** queues a turn to carry on. A restart interrupts an active provider turn and
pauses its goal, as does a provider disconnect during a turn. A dispatch failure blocks the goal.
An admission refusal also blocks the goal and queues no turn.
A completed turn whose check was interrupted is checked after startup. The session
row stores the objective, counters, status, and last verdict, so every client sees the same state.

The goal route is device-only: `PUT /v1/p/agents/sessions/:id/goal` accepts an objective or `null`
to clear it, and `POST /v1/p/agents/sessions/:id/goal/resume` resumes a paused goal. Workflow,
delegated, imported, terminal-controlled, and archived sessions cannot accept a goal.

A workflow step's completion condition uses the same judge, evidence limit, and continuation limits
(`judgeGoal` in `plugins/agents/src/server/sessions/sessionGoal.ts`), but the step owns it, not the
session. `agents.sessionExecute` checks it inside the step's operation and queues the continuations
itself, so interactive goal scheduling never sees a workflow session. Each verdict is an
`agent_operations` row keyed by the attempt's opening turn and the turns it read
(`workflow.goal.evaluate`), and the attempt's final state is one more (`workflow.goal`). A retry
opens a new turn, so its state starts clean. Startup doesn't restart a step's goal work. Only the
workflow runner's recovery and retry do. The run's own **Stop** and **Retry** control a workflow
session, which has no goal **Edit**, **Clear**, or **Resume**. For the step's side, see
[agent steps](../workflows/agent-steps.md#completion-conditions).
