# Contributed step kinds

Any plugin can add a step kind, a policy, or a trigger to workflows. This page covers how a kind is
named and configured, how it describes its own form, the kinds other plugins ship, and the progress
events a handler can emit. The contract is in `plugins/workflows/src/shared/`.

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
Built-in kinds do not use `with`. Their inputs are named fields, which is what keeps them checkable
by the host.

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

## Progress events

A handler's `emit` takes anything, and the run pane shows what it does not recognise as JSON. Four
shapes it does recognise (`plugins/workflows/src/shared/stepEvents.ts`):

| Event | From | Drawn as |
| --- | --- | --- |
| `{ type: 'managed-agent', … }` | agent kinds | State, last assistant text, cost |
| `{ type: 'stdout' \| 'stderr', text }` | `terminal:command` | A tail of the output |
| `{ type: 'progress', text }` | any kind | One line under the node |
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
