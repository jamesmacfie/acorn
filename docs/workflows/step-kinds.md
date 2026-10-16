# Contributed step kinds

Any plugin can add a step kind, a policy, or a trigger to workflows. This page covers how a kind is
named and configured, how it describes its own form, the kinds other plugins ship, gate policies, and
the progress events a handler can emit. The contract is in `plugins/workflows/src/shared/`.

## Contributed step kinds

The built-in kinds are `agent`, `gate-human`, `gate-policy`, `ci-loop`, `decide`, `if`,
`find-records`, `get-record-details`, `workflow`, and `workflow-map`. Workflows opens three node extension points
([node-side extension points](../plugins/node-side-extension-points.md)) and any plugin may fill them:

| Point | What it adds | Named in a file as |
| --- | --- | --- |
| `workflows:step-kind` | a kind the runner dispatches to | a step's `kind` |
| `workflows:policy` | a verdict source for `gate-policy` | a step's `policy` |
| `workflows:trigger` | something that decides which workflows should start | nothing; the sweep asks it |

**A contributed kind is addressed by its qualified id, a built-in by a bare word.** `kind = "agent"`
is the built-in; `kind = "http:request"` is the http plugin's. That is deliberate: the file says which
package will run the step, and two plugins can both call their entry `request` without either
shadowing the other.

A contributed kind's inputs go in `[steps.with]`, an opaque table the runner passes through unread.
The contributing plugin validates it at load time, so a bad step is a red row in the workflow list
rather than a run that starts and fails on its third step, and reads it again in its handler.
Built-in kinds keep their own inputs in named fields, which is what keeps them checkable by the host.
The one built-in that uses `with` is `gate-policy`, which passes it to its policy as settings.

A handler's `with` arrives rendered. `${inputs.x}` and `${steps.x.output}` are substituted one level
deep before the handler runs, so `terminal:command` is handed the command it will run and never a
template.

## A kind describes its own form

A kind provides a `describe` with a label, icon, description, fields, and output description. The
host draws that form on desktop and in the terminal, so a plugin adds an editable step kind without
shipping a component. An output schema and semantic validator are optional. Workflows excludes a
contributed kind with incomplete metadata from the catalog, validation, and dispatch, and logs the
rejected kind and missing fields. The plugin's other contributions remain active.

A saved workflow keeps a missing kind's qualified ID and `with` settings. The editor identifies the
contributing plugin, allows raw JSON editing, and reports why the workflow cannot run. Admission
refuses a new run. An active run fails if its next step requires a kind that has disappeared. When the
same kind returns, validation runs again against its current contract; a valid definition becomes
runnable without rewriting the saved step.

A field is `text`, `textarea`, `number`, `boolean`, `select`, or `prompt`. A `prompt` field is a
textarea that accepts template references. A `select` either lists its `options` or names an
`optionsRoute` in the contributing plugin's own namespace, which answers
`{ options: [{ value, label, description? }] }`.

The host applies `required`, `min`, `max`, and a static select's membership before it calls the
kind's `validate`, and skips `validate` when any of those fail. So a validator can assume the shape
is right and check only the meaning. A field with an `optionsRoute` is not checked at load time,
because the node reading the file may have no way to reach the project the route needs.

The ten built-in kinds describe themselves through the same type, with the fields naming a step's
own keys rather than keys in `with`
(`plugins/workflows/src/shared/stepFields.ts`). The editor does not need to know which is which: it
asks `fieldHome(kind, fieldId)`. A kind whose description says `runsAgent` may also take `isolation`,
`inputs`, and `config_options`, and that is the only way a contributed kind gets them.

`GET /v1/p/workflows/catalog` answers the whole vocabulary: every kind with its description, every
policy, and every agent profile with whether it has a managed driver and a one-shot structured mode.
It is resolved per request rather than cached, because the plugin that fills the point may start
after workflows does.

## The kinds other plugins contribute

| Kind | Owner | What it does |
| --- | --- | --- |
| `http:request` | [http-client.md](../http-client.md) | One HTTP request through the project's variables. |
| `terminal:command` | [terminal.md](../terminal.md) | One shell command in the task's checkout, streamed and captured. |
| `terminal:run-target` | [terminal.md](../terminal.md) | Starts a declared run target and reports its URL. |
| `database:query` | [database.md](../database.md) | A saved query or inline SQL, capped and read-only. |
| `database:generate` | [database.md](../database.md) | A model writes the SQL, then the same read runs it. |

Each lives with the code that already knows how to do the thing safely, which is the rule for
admitting a kind at all. The command kind sits beside the process broker's environment allowlist, the
HTTP kind beside the scheme check that runs after interpolation, the database kinds beside the
connection resolution and the row cap.

## Gate policies

A `gate-policy` step asks a policy whether something outside Acorn has happened yet, such as CI
finishing or a reviewer commenting ([polling gates](./polling-gates.md)). A policy is a
contribution with the same shape as a step kind (`PolicyContribution` in
`plugins/workflows/src/shared/workflowContracts.ts`):

```ts
type PolicyContribution = {
  evaluate(ctx: PolicyContext): Promise<PolicyVerdict>
  describe: PolicyDescription // label, description, icon, fields, and an optional minIntervalMs
  validate?: (settings: Record<string, unknown>) => string[]
}
type PolicyContext = { taskId: string; with: Record<string, unknown>; since: number; previous?: PolicyVerdict; signal: AbortSignal }
type PolicyVerdict = { verdict: 'pass' | 'wait' | 'fail'; detail?: string; value?: unknown }
```

`with` is the gate's rendered `[steps.with]` table. `since` is when the wait started, kept across a
restart. `previous` is the last answer. `detail` is one line for the run pane, and `value` is
structured data a later step can bind to. The host checks the settings against `describe.fields`
before it calls `validate`, the same way it checks a kind's fields. Settings always live in `with`,
even when one shares a name with a gate field, such as a command's `timeoutMs`. A throw is a failed
poll, which the gate retries at its next interval.

| Policy | Owner | Answers |
| --- | --- | --- |
| `github:ci-settled` | [GitHub](../github-integration/mirror.md#checks-and-workflow-policies) | `wait` while a check runs, `fail` when one failed, `pass` when all passed. |
| `github:review-received` | [GitHub](../github-integration/mirror.md#checks-and-workflow-policies) | `pass` once someone other than the author or a bot reviews or comments after `since`. |
| `terminal:command-check` | [terminal](../terminal/run-targets.md#workflow-steps) | A command's exit code: 0 passes, 75 waits, anything else fails. |
| `agent` | workflows | A one-shot agent turn with read-only tools answers. |
| `checks-green` | workflows | Asks the `ci-settled` policy of the task's code host. |
| `review-received` | workflows | Asks the `review-received` policy of the task's code host. |

A code host that supports CI files a policy with the entry id `ci-settled`, and one that supports
reviews files `review-received`, so the host mints `<plugin>:ci-settled` and
`<plugin>:review-received`. That's a naming convention, with the ids in `CODE_HOST_POLICY` in
`plugins/workflows/src/contract/extensions.ts`. A `ci-settled` policy answers with a `value` shaped
like `CiSettledValue` from the same file, which `ci-loop` reads the failing checks from.

`checks-green`, `review-received`, and `ci-loop` find the task's primary change request when they ask,
and call the policy its code host filed ([code hosts](../plugins/code-hosts.md#workflow-ci)). A task
with no pull request, or a code host with no such policy, fails closed with a message that says which.
New workflow files should use the neutral names. A file that names `github:review-received` keeps
asking GitHub, even on a task whose pull request is somewhere else.

The built-in `agent` policy runs a fresh one-shot turn per poll, as `decide` does, with a fixed
`{ verdict, reason }` schema. It gets read-only tools so it can notice a change, and its last answer
as context so it can say what changed. Its settings take one `prompt`, the condition to ask about.
Each poll takes an agent slot and adds to the run's budget, so its minimum interval is 300,000 ms and
`max_cost_usd` stops a wait that costs too much. Prefer a cheaper policy when one can see the
condition.

A plugin that workflows depends on can't import the workflows package, so it keeps a copy of the
type. The terminal plugin's copy is beside its step kinds, and a test in the workflows plugin holds it
against the real type. Other plugins, GitHub included, import the types from the workflows contract.

## Progress events

A handler's `emit` takes anything, and the run pane shows what it does not recognise as JSON under
**Events**. Four shapes it does recognise (`plugins/workflows/src/shared/stepEvents.ts`):

| Event | From | Drawn as |
| --- | --- | --- |
| `{ type: 'managed-agent', … }` | agent kinds | State, last assistant text, cost |
| `{ type: 'stdout' \| 'stderr', text }` | `terminal:command` | A tail of the output |
| `{ type: 'progress', text }` | any kind | One line under the step's header, the latest only |
| `{ type: 'rows', count }` | database kinds | "n rows" while it runs |

The worked example is `http:request`, contributed by the http plugin, where the post-interpolation
scheme check, the 5 MB response cap and the project's variable layers already live
([http-client.md](../http-client.md)):

```toml
[[steps]]
name = "notify"
kind = "http:request"

[steps.with]
method = "POST"
url = "{{deploy_hook}}"
body = '{"ref": "{{branch}}"}'
```

4xx and 5xx are *answers*, not failures: the step succeeds so a later `decide` can branch on the
status. Only a transport failure, a bad URL, or a smuggled scheme fails the step. An unattended send
writes an audit row ([audit](../security/audit.md#the-vocabulary-is-closed-and-a-plugin-can-add-to-it)) carrying the target's
origin and not the URL, because a query string is where a token ends up when someone puts one there.
