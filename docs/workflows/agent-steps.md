# Agent steps

This page covers what an agent step is given, what happens when its turn ends without the result the
step asked for, and how a completion condition keeps it working. [Workflow execution](./execution.md)
covers the rest of the runner.

## What an agent step sees

A step that runs an agent, such as `agent`, `decide`, or `ci-loop`, takes
`inputs = "append" | "template" | "none"`, default `append`. With `append`, the runner renders the
prompt and then adds one "Output of <name>" item per incoming edge whose step finished `done`, in
`after` order. With `template`, nothing is added and the prompt places its own
`${steps.<id>.output}` references. With `none`, the step sees only its prompt. The handoff context
rides along in every mode as a "Task context" item, because that is a separate thing from the graph's
edges.

Those items are not written into the prompt. A managed session gets each one as a context part after
the prompt, so the model reads it as an `<acorn-context>` block, which marks it as information rather
than instructions. The transcript draws only the step's prompt and lists the items in its
**Context manifest** fold. A diff or a ticket body pasted into the prompt used to fill the turn's
bubble, and a heading inside it read the same as the prompt's own. Past the 512 KiB per-turn context
cap, the blocks go inline in the prompt text instead, so a step with a large diff upstream still runs.
The headless fallback takes one string, so it gets each item under a `## <label>` heading, and the
step's recorded inputs in the run pane use that same form.

All four kinds assemble that prompt through one function, which they did not until 2026-09-09. Only
`agent` read the incoming edges, so a `decide` step was sent its prompt and nothing else: the editor
offered it the upstream output control, defaulted it to append, and the runner dropped the output it
was meant to judge. `ci-loop` pays for the upstream output and the context block on the turn that
opens its session and not on the resumed turns, which already hold both.

**Which harness, and what that decides.** A step names one with `profile`, and a step that names none
runs on the node's default, `claude-code`. The editor's Harness select says as much: its blank option
is "The workflow default". The runner resolves that word once, in `runHeadless`, and hands the answer
to the step in `opts.profileId`, because four readers have to agree on it: the step row the run pane
draws, validation, the managed session, and the headless fallback. They did not agree until
2026-09-09: the managed call read the definition instead of the resolved value, so a step whose
harness was left blank asked for a session under no profile at all, got told there was no managed
driver for it, and ran as a bare CLI process with no session and no transcript. Every workflow
authored in the app was in that state, because the select only writes `profile` when somebody picks
one.

So a profile is now what decides which of the two paths a step takes, and nothing else does. A profile
with a managed driver, meaning `claude-code`, `codex`, or a harness a plugin contributes, runs the
step as a managed session with a durable transcript ([managed-agents.md](../managed-agents.md)). The
profile names its driver in `managedProvider`. A profile without one runs it headless:
a one-shot process, its stream captured into the step's events, and no session for the run pane to
draw. Each child workflow resolves its own step profile from the frozen definition.

One narrowing on top of that: a `decide` step needs a profile with a one-shot structured mode, which
validation tests for on the profile itself rather than against a list of names, so both `claude-code`
and `codex` qualify and a profile with no such mode is refused when the file is saved. A harness a
plugin contributed as manifest data passes that check too, because it declares the same one-shot mode
to appear in the Generate lists ([plugin-authoring.md](../plugin-authoring.md) § Harnesses). One whose
stdout is read as plain text has no way to answer with a verdict object, so the step fails while it
runs rather than when the file is saved. A `decide` step that has to work names a code-tier profile.

An agent step also takes `config_options`, a table of provider option ids to values as the provider
advertises them, such as `model` and `reasoning`. The runner hands them to the agents plugin, which
applies them to the session after the provider reports its option list and before the turn is
enqueued. A value the provider does not offer is dropped and recorded in the transcript rather than
failing the step. Where a step sets both `model` and `config_options.model`, validation refuses the
file. Effort names don't mean the same amount of thinking on every model: Anthropic measured
`medium` on Opus 5.5 matching `high` on Opus 5, so a `reasoning` value carried over from Opus 5 runs
longer and costs more than it did.

## A turn that ends early

Managed execution flushes accepted buffered deltas, then captures every retained canonical event belonging to the step's target turns
before parsing the final assistant response. It reads pages of 500 rows in one SQLite transaction,
with a fixed committed session sequence ceiling. A later turn cannot extend that read. Ordinary
client snapshots retain their page cap. Workflow result parsing retains the complete response
instead of applying the delegation summary's text bound. The assistant message's established
replacement, append, and outer-whitespace trimming rules still apply.

Live forwarding subscribes before enqueue and holds events until the accepted turn ID is known.
It forwards each canonical sequence once. Final capture supplies the complete event list to the
outcome and does not replay it through the callback. Cancellation and timeout capture committed
partial text and tool events. Usage and cost reflect the last target turn at capture time; execution
does not wait for missing provider usage. Later usage remains in the durable ledger, and a usage
event explicitly bound to a turn updates that turn without mutating an already returned capture.

A managed step is a turn, and the step's result is that turn's final message. A model can end a turn
on a progress report instead of the finished work, so acorn guards the step three ways
(`plugins/agents/src/server/sessions/sessionExecute.ts`):

1. The Node saves attendance on each turn. Gated workflow steps are supervised; autonomous steps
   are autonomous. Both receive the turn-ending instruction before their prompt on Claude, Codex,
   and contributed ACP harnesses. Autonomous turns must make reversible assumptions or end with a
   `BLOCKED:` line naming the decision needed. Interactive turns receive neither instruction.
2. If the turn ends without the result the step needs, meaning no message at all or no `json` block
   that matches the step's schema, acorn sends one more turn telling the agent to finish or say what
   blocks it. It does that twice at most, then the step is `malformed` as before. The transcript
   labels these turns **Acorn**, and the step's own prompt **Workflow**. The step's events, usage,
   and cost cover every turn, with Codex's cumulative totals taken from the last.
3. A turn the model declined, with the stop reason `refusal`, fails the step with that reason and is
   never sent again. A final message starting with `BLOCKED:` also fails the step with that line as
   its reason, without a continuation.

## Completion conditions

A valid final message doesn't mean the work is done. A plain `agent` step, and the agent in a
**For each**, can take a `goal`: what must be true before the step is finished. The editor calls it
**Completion condition** and shows it after **Prompt**. A step without one runs as before.

```toml
[[steps]]
id = "fix-login"
name = "Fix login"
prompt = "Investigate and fix the supplied login regression."
goal = "The regression is fixed, the login tests pass, and the fix is committed."
```

On an agent step the goal takes the same `${inputs.x}` and `${steps.x.output}` references as the
prompt. On a For each agent it's plain text, like that agent's prompt. The runner renders it once,
checks it's 1 to 2,000 characters, and saves it as `goal` in the step's `inputs_json`. A retry keeps
that saved condition, even when the retry edits the prompt. Other kinds refuse the field. The step's
harness must run managed sessions and have a one-shot mode, because the check runs through it.
Validation refuses any other harness. At run time, a step with a goal never falls back to a headless
process: it fails with an error that says why.

The agents plugin runs the loop in `agents.sessionExecute`
(`plugins/agents/src/server/sessions/sessionExecute.ts` and `stepGoal.ts`):

1. The opening prompt carries the condition after the work request and before the result contract.
2. Once the step's turns and any joined notes settle, a judge reads the evidence from this attempt's
   turns only. It's the same judge, evidence builder, verdict format, and model choice as
   [session goals](../managed-agents/operations.md#session-goals). Each check gets at most 30
   seconds, and never more than the time left in the step.
3. The verdict is saved against the exact turns it read. If a turn or note joined while the judge
   ran, the verdict is dropped and the loop looks again.
4. If useful work remains, acorn queues a goal continuation in the same session, with the condition,
   the judge's reason, and the result contract. Any other verdict fails the step with the judge's
   reason. A check that can't run, times out, or answers in the wrong shape fails the step with
   "Unable to check completion" and its diagnostic.
5. After the condition is met, the final message must still match the schema. A repair turn can fix
   that, and then the condition is checked again.
6. The review window opens once, after the condition is met. A correction it sends is checked again.
   It doesn't open a second window.

A refusal, a `BLOCKED:` line, a failed turn, a timeout, or a cancellation ends the step for its own
reason, with no goal continuation. A cancelled step with a goal never publishes a result, even if its
turn had already finished. Goal continuations and result repairs share a limit of eight automatic
turns per attempt, and repairs keep their own limit of two. The step also stops after two goal
continuations in a row with no tool call or file change.

The run pane shows the condition, where its checks stand (**Checking completion** and **Continuing
toward goal** while it works), the number of goal continuations and repairs, the last check's
reason, and its evidence summary. The standalone Agent pane doesn't show the goal. The state is in
the step row's `goal_json`, apart from the step's output, so no binding can read it. A For each puts
each item's goal status, continuation count, and reason in its `children` summary.

### Budgets

Every turn the session queues by itself, a goal continuation or a result repair, first reserves a
turn against the same budgets as the step's opening turn. A step with `max_turns = 1` can't take a second turn. A completion check takes no
turn, but it must fit the cost and token budgets. Each check's reported tokens are added to the
step's usage. The opening admission row holds the step's usage so far. Each update replaces it rather
than adding to it, so settling the step charges every turn and check once. A refused reservation ends
the step at the safety rail. One deadline covers the whole step, including checks and the review
window.
