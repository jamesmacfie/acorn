---
title: Steps, gates, and budgets
description: Every step kind a workflow can use, with examples, and how steps wait for each other, branch, pass typed results, wait at gates, retry, and stay inside a budget.
sources:
  - docs/workflows/execution.md
  - docs/workflows/agent-steps.md
  - docs/workflows/polling-gates.md
  - docs/workflows/typed-data.md
  - docs/workflows/child-runs.md
  - docs/workflows/step-kinds.md
  - plugins/workflows/src/shared/stepFields.ts
  - plugins/terminal/src/server/workflowSteps.ts
  - plugins/database/src/server/workflowSteps.ts
  - plugins/http/src/server/workflowStep.ts
checked: dd67cf0fd
---

This page covers what each kind of step does, and how steps fit together: the order they run in,
branches, typed results, gates, retries, and limits. The examples are workflow files. The editor sets
the same things with forms ([Write a workflow](/docs/automation/write-a-workflow/)).

## The step kinds

The **Add step** menu groups them as below. In a file, `kind` names one. A step with no `kind` is
**Ask an agent**.

| In the editor | `kind` | What it does |
| --- | --- | --- |
| **Ask an agent** | `agent` | Runs an agent turn and hands its answer to the steps after it. |
| **Ask AI to decide** | `decide` | Asks an agent for one verdict, and takes the branch it names. |
| **Fix the checks** | `ci-loop` | Waits for CI on the task's pull request, and asks an agent to fix what fails, a set number of times. |
| **Find records** | `find-records` | Runs a query over a data source and keeps every record it selects. |
| **Get record details** | `get-record-details` | Reads one record's full details. |
| **For each** | `workflow-map` | Runs an agent, or a saved workflow, once for each item in a list from an earlier step. |
| **If / otherwise** | `if` | Compares values and takes a branch, without a model. |
| **Check a policy** | `gate-policy` | Asks something outside acorn, such as CI, and waits while it says not yet. |
| **Run a workflow** | `workflow` | Starts a saved workflow in a child task, and waits for its result. |
| **Wait for a person** | `gate-human` | Stops the run until you approve. |
| **Write dataset** | `write-dataset` | Writes rows from an earlier step to a dataset, such as for a dashboard. |
| **Run a command** | `terminal:command` | Runs one shell command in the task's worktree and hands on its output. |
| **Start a run target** | `terminal:run-target` | Starts one of the project's run targets and reports its address. |
| **Run a query** | `database:query` | Runs a saved query or SQL against the task's database, read-only. |
| **Generate and run a query** | `database:generate` | Has a model write the SQL from your words, then runs it the same way. |
| **Call an HTTP endpoint** | `http:request` | Sends one request through the project's variables and hands on the response. |

A kind from a plugin, such as `terminal:command`, is named with the plugin's ID, and takes its settings
under `[steps.with]`. Its step can't run while that plugin is off.

## The order steps run in

Each step lists the steps it waits for in `after`. A step starts once all of them are done, so a step
that waits for two others is where their paths join. Two steps that wait for the same one run at the
same time.

- A step with no `after` waits for the step above it, so a plain list runs top to bottom.
- `after = []` starts a step straight away.
- A cycle is refused, and the error names it, such as `a → b → a`.

## Pass typed results

An agent step with `schema_json` must answer with JSON of that shape. Later steps then read fields from
it, rather than prose. If the agent's answer doesn't match, acorn asks it to finish, up to twice, before
the step fails.

`${steps.<id>.output}` puts a step's whole answer into a prompt. A step can read an earlier step's
answer only if that step is certain to finish first.

By default, an agent step also gets the answer of each step it waits for. `inputs = "template"` sends
only what its prompt names, and `inputs = "none"` sends nothing.

## Branch on a result

**If / otherwise** compares typed values, with no model involved. Each branch names the step it leads
to, and every branch's step must wait for the `if` step. The branch not taken is skipped, and so is
every step that only that branch leads to.

```toml
[[steps]]
id = "assess"
name = "Assess the bug"
prompt = "Read the failing test and say how risky a fix is."
schema_json = '{ "type": "object", "properties": { "risky": { "type": "boolean" }, "summary": { "type": "string" } }, "required": ["risky", "summary"] }'

[[steps]]
id = "check"
name = "Is it risky?"
kind = "if"
after = ["assess"]
condition_json = '{ "kind": "comparison", "left": { "address": { "from": "step", "stepId": "assess", "pointer": "/risky" } }, "operator": "eq", "right": { "address": { "from": "literal", "value": true } } }'

[steps.branches]
true = "approve"
otherwise = "fix"

[[steps]]
id = "approve"
name = "Approve the plan"
kind = "gate-human"
after = ["check"]

[[steps]]
id = "fix"
name = "Fix it"
after = ["check"]
prompt = "Fix the bug. ${steps.assess.output}"
```

**Ask AI to decide** branches on an agent's verdict instead. Its branches name the verdicts:

```toml
[[steps]]
id = "route"
name = "Bug or feature?"
kind = "decide"
prompt = "Is this a bug or a feature request? ${inputs.issue}"

[steps.branches]
bug = "fix"
feature = "plan"
```

## Keep an agent working until it's done

A finished turn doesn't always mean finished work. `goal`, which the editor calls **Completion
condition**, says what must be true:

```toml
[[steps]]
id = "fix-login"
name = "Fix login"
prompt = "Investigate and fix the login regression."
goal = "The regression is fixed, the login tests pass, and the fix is committed."
```

After each turn, acorn checks the condition against what the agent did. While useful work remains, it
asks the agent to carry on, up to eight extra turns, and the run pane shows **Checking completion** and
**Continuing toward goal**. The step fails with the reason if the condition can't be met. An agent can
also stop a step by answering with a line that starts `BLOCKED:`, naming what it needs.

## Wait for a person

**Wait for a person** stops the run, rings the bell, and shows **Approve** and **Reject** in the run
pane. Rejecting fails the run. A gate can carry a form of up to 20 fields, filled in from earlier steps,
for you to check and change before you approve:

```toml
[[steps]]
id = "approve"
name = "Approve the note"
kind = "gate-human"
after = ["draft"]

[[steps.form.fields]]
name = "title"
label = "Title"
required = true
schema_json = '{ "type": "string" }'

[steps.form.values.title]
binding_json = '{ "address": { "from": "step", "stepId": "draft", "pointer": "/title" } }'
```

Steps after the gate read what you approved, at `/values/title`. While a run waits at a gate, its
worktree is free, so you can commit and push from the Git pane.

A workflow with `posture = "autonomous"` passes every **Wait for a person** without asking, refuses
agents' permission requests, and cancels their questions. It must set a tool limit.

## Wait for something outside acorn

**Check a policy** asks a policy for a verdict: pass, fail, or not yet. With `timeout_ms`, it keeps
asking every `interval_ms` until it gets an answer or the time runs out. Without `timeout_ms`, it asks
once, and not yet counts as a failure.

```toml
[[steps]]
id = "ci"
name = "Wait for CI"
kind = "gate-policy"
policy = "checks-green"
interval_ms = 60000
timeout_ms = 3600000

[steps.branches]
pass = "ship"
fail = "fix"
```

| Policy | Passes when |
| --- | --- |
| `checks-green` | Every check on the task's pull request passed. It fails as soon as one fails. |
| `review-received` | Someone other than the author or a bot reviewed or commented. |
| `terminal:command-check` | A command exits 0. Exit 75 means not yet, and anything else fails. |
| `agent` | An agent, with read-only tools, says the condition in its `prompt` is true. It asks at most every 5 minutes, and each ask costs a turn. |

`checks-green` and `review-received` ask the plugin for the code host that has the task's pull request,
such as GitHub. Each code host also offers the same policies under its own name, such as
`github:ci-settled` and `github:review-received`. A task with no pull request, or a code host that
doesn't offer the policy, fails the step.

The interval is at least 30 seconds, and 60 by default. With `branches`, each answer, `pass`, `fail`,
or `timed-out`, leads to its own step. Without them, anything but pass fails the step. Three failed
asks in a row, such as the code host not answering, fail the step.

**Fix the checks** combines the two: it waits for CI, and on a failure asks an agent to fix the failing
checks, then waits again, up to `max_iterations` rounds:

```toml
[[steps]]
id = "green"
name = "Fix the checks"
kind = "ci-loop"
prompt = "CI is failing on this pull request. Fix it and push."
max_iterations = 3
```

## Run other workflows

**Run a workflow** starts a saved workflow in a child task, and waits for its result:

```toml
[[steps]]
id = "review"
name = "Review"
kind = "workflow"

[steps.child_workflow.ref]
source = "repo"
path = ".acorn/workflows/fix-and-review.toml"

[steps.child_workflow.inputs.issue]
binding_json = '{ "address": { "from": "literal", "value": "The login page times out." } }'
```

**For each** runs once per item in a list from an earlier step: an agent session in this task, or a
saved workflow in a child task for each item.

```toml
[[steps]]
id = "each"
name = "Fix each test"
kind = "workflow-map"
after = ["list"]
item_key = "/name"

[steps.items]
step = "list"
pointer = "/tests"

[steps.agent]
prompt = "Make this test reliable."
on_failure = "continue"
```

Each agent gets its item without being told. With `on_failure = "continue"`, one item failing doesn't
stop the others, and the step says **This step finished with failures**.

Child workflows can nest four levels deep. A whole run may start 100 child runs, or up to 500 with
`max_descendants`.

## Budgets and tool limits

A budget stops a run before it costs too much or takes too long. Set it for the whole workflow under
`[budget]`, or for one step under `[steps.budget]`:

```toml
[budget]
max_cost_usd = 10
max_wall_time_ms = 7200000

[tools]
max_risk = "write"
```

| Key | Limit |
| --- | --- |
| `max_wall_time_ms` | How long, in milliseconds. Without a time limit, each agent turn has 10 minutes. |
| `max_cost_usd` | How much the agents may spend. |
| `max_input_tokens`, `max_output_tokens` | How many tokens they may use. |
| `max_turns` | How many agent turns, counting the ones acorn sends to finish a step. |

`[tools]` sets the riskiest tool an agent may use, `read`, `write`, or `execute`, and `allow` can list
the only tools it may use. A step's limits can be tighter than the workflow's, never looser. A run that
reaches a limit stops at it, and the run pane says which.

At most four agent turns run at a time on a Node, across every run. `max_concurrency` lowers that for
one workflow.

## Retry a step

When a step fails, the run stops, and the step shows **Retry**. An agent step also has **Edit prompt and
retry**, which sends your new prompt as another turn in the same session. Steps that were skipped
because of the failure come back too. A retry counts against the same budget, so a run stopped by its
budget stops again.

Only you can retry or answer a gate. An agent inside the run can't.

## Limits

- Restarting the Node starts a step that was running again from the beginning. A gate keeps waiting.
- A step can't read the answer of a step beside it, only of steps certain to finish before it.
- A run keeps the definition it started with. A workflow it starts as a child is fixed when the run
  starts.
