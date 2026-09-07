# The definition model after this programme

Part of [docs/future/workflows/](./README.md). Status: design, 2026-09-08. Phase 0 builds the
engine half; phases 1 and 3 read the rest.

Everything here is additive. A TOML file written before this programme parses to the same run it
always did, because every new field has a default that reproduces the old behaviour.

## The shape

```ts
type WorkflowDef = {
  name: string
  posture?: 'gated' | 'autonomous'
  trigger?: string
  tools?: ToolCeiling
  budget?: WorkflowBudget
  inputs?: WorkflowInput[]          // new
  steps: WorkflowStepDef[]
}

type WorkflowInput = {              // new
  name: string                      // [A-Za-z][A-Za-z0-9_]*
  description?: string
  required?: boolean                // default false
  default?: string
}

type WorkflowStepDef = {
  name: string                      // the identity; slug-shaped, unique in the definition
  kind?: string                     // default 'agent'
  after?: string[]                  // new: absent = the previous step; [] = a root
  isolation?: 'shared' | 'worktree' // new, agent kinds only; default 'shared'
  inputs?: 'append' | 'template' | 'none'  // new, agent kinds only; default 'append'
  configOptions?: Record<string, string>   // new, agent kinds only: provider option id → value
  profileId?: string
  model?: string
  prompt?: string
  schema?: object
  policy?: string
  maxIterations?: number
  requiresRun?: string
  childStep?: WorkflowChildStepDef
  joins?: string
  branches?: Record<string, string>
  with?: Record<string, unknown>
  tools?: ToolCeiling
  budget?: WorkflowBudget
}
```

`model` stays for the fallback path and for files already written. When both `model` and a
`configOptions.model` are present, `configOptions` wins, and the validator says so.

## TOML spelling

Snake case on the wire, as the loader already does for `max_risk` and `child_step`:

```toml
name = "Investigate an issue"
posture = "gated"

[[inputs]]
name = "issue"
description = "The bug report, as the tracker shows it"
required = true

[[inputs]]
name = "focus"
description = "Anything the reporter wants looked at first"

[[steps]]
name = "reproduce"
after = []
prompt = """
Reproduce the issue below and report exactly what you observed, with the commands you ran.
${inputs.issue}
${inputs.focus}
"""

[[steps]]
name = "recent-changes"
after = []
kind = "terminal:command"
[steps.with]
command = "git log --since='14 days ago' --stat -- src/"

[[steps]]
name = "history"
after = ["recent-changes"]
prompt = "Given the recent changes below, which are the likely causes of: ${inputs.issue}"
inputs = "append"

[[steps]]
name = "synthesise"
after = ["reproduce", "history"]
inputs = "append"
config_options = { model = "claude-opus-5", reasoning = "high" }
prompt = "Two investigators looked at the same issue. Write one explanation and a fix plan."

[[steps]]
name = "review"
kind = "gate-human"
```

Keys the loader gains: `after`, `[[inputs]]`, `isolation`, `inputs` (the mode), `config_options`.
Everything else is as today.

## Edges, and what `after` means

Edges are derived, never stored. Step B has an edge from A when A appears in B's `after`. A step
with no `after` key has one edge from the step declared before it, and the first step declared with
no `after` is a root. `after = []` is an explicit root.

The runner keeps one rule: a step is ready when every step in its `after` is `done`. Ready steps
start together, up to the existing headless semaphore. A step in `after` that ends `skipped` counts
as done for readiness, because `decide` skips are how a branch is not taken, and the join after a
decision has to run.

The old file, a plain list, becomes a chain of single edges and runs exactly as before.

## `decide` in a graph

A `decide` step's `branches` map a verdict to a step name. Each target must have the deciding step in
its `after`. When the verdict picks one target, every other target is marked `skipped`, and so is
every step whose only path back to a root passes through a skipped step. A step reachable from both
a skipped branch and a taken one stays pending and runs when its taken predecessors finish. The
`default` branch works as it does today.

## `fan-out` and `join`

Unchanged. A `join` names a preceding `fan-out` through `joins`, and validation keeps that rule.
Their `after` follows the normal rule. This programme does not turn fan-out children into graph
nodes; they stay child rows under the fan-out step.

## Inputs

A run starts with `inputs: Record<string, string>`. The start route refuses a run that misses a
required input without a default and refuses a value for a name the definition does not declare.
`${inputs.<name>}` renders anywhere `${steps.<name>.output}` renders: a prompt, a child prompt, and
every string value inside `with`, one level deep. A contributed kind receives its `with` already
rendered, so `terminal:command` sees the substituted command and never the template.

The item menu (phase 5) prefills inputs from the rail item. The rule is by name: an input named
`issue`, `item`, or `context` gets the item's title and body joined by a blank line; an input named
`link` or `url` gets the external link; anything else is left for the person. That list is in the
workflows plugin, not in each integration, so a new integration gets it for free.

## The agent node's upstream inputs

With `inputs = "append"`, the runner renders the prompt, then appends one block per incoming edge
whose step is `done`, in `after` order:

```
## Output of reproduce

<the step's structured JSON, or its final text>

## Output of history

...
```

With `inputs = "template"`, nothing is appended and the prompt is expected to place references
itself; a prompt that references none of its incoming edges is a validation warning, not an error.
With `inputs = "none"`, the node sees only its prompt. The `${steps.<name>.output}` reference keeps
working in every mode.

## Isolation

`isolation = "worktree"` on an agent kind makes the runner create a child task through
`core.tasks.createChild` with a branch derived from the run name and the step name, run the step on
that task, and record `childTaskId` in the step's `inputsJson`, the same field fan-out children use so
`cancelRun` finds it. The step's agent session lives on the child task and the run pane says so. A
`shared` step runs on the run's own task. Two `worktree` steps in the same run get two child tasks.

## Model and thinking level

`configOptions` is a map of a provider option id to a value, as the provider advertises them
(`model`, `reasoning`, `mode`, `permission`, or whatever the descriptor lists). The runner passes it
to `AGENTS_SESSION_EXECUTE`, which patches the session's config after the provider reports its
options and before the turn is enqueued. A value the provider does not advertise is a validation
error at load time when the catalog knows the provider, and a recorded diagnostic at run time when it
does not.

## Validation rules

Kept from today: a name per step, unique; a known kind; ceilings and budgets narrow; `gate-policy`
names a known policy; `join` names a preceding `fan-out`; an autonomous posture has a ceiling.

Added:

- `after` names exist and are not the step itself.
- The graph is acyclic. The error names the cycle.
- A `${steps.<name>.output}` reference points at a transitive predecessor of the step. "Preceding
  in the list" is no longer enough, because two roots are not ordered.
- A `${inputs.<name>}` reference names a declared input.
- Every `branches` target has the deciding step in its `after`.
- `isolation`, `inputs`, and `configOptions` appear only on agent kinds (`agent`, `ci-loop`,
  `fan-out`, `decide`, and a contributed kind whose `describe` says it runs an agent).
- An input name matches `[A-Za-z][A-Za-z0-9_]*`; a step name matches `[A-Za-z0-9][A-Za-z0-9_-]*`
  and, for a sub-workflow expansion, may carry one `:` prefix as it does today.

## What renders where

| Reference | Prompt | Child prompt | `with` string values | Anywhere else |
| --- | --- | --- | --- | --- |
| `${inputs.x}` | yes | yes | yes, one level deep | no |
| `${steps.x.output}` | yes | yes | yes, one level deep | no |

## The worked example

The TOML above is the owner's first workflow with a command node folded in. Its graph:

```
reproduce ─────────────────┐
                           ├─▶ synthesise ─▶ review
recent-changes ─▶ history ─┘
```

`reproduce` and `recent-changes` start together. `history` starts when the command finishes and
sees its stdout appended. `synthesise` waits for both investigators, sees both outputs appended, and
runs on the model and reasoning level the file names. `review` is the human gate, and the bell row
for it opens the run pane at that node.
