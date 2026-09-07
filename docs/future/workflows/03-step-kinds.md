# Step kinds: how a kind describes itself, and the four this programme adds

Part of [docs/future/workflows/](./README.md). Status: design, 2026-09-08. Phase 1 builds it.

## The problem

A contributed kind is `{ handler, validate? }`. The runner dispatches to the handler and the loader
calls the validator, and that is all the host knows. An editor asked to draw a form for
`http:request` has nothing to draw from, and the palette cannot say what a kind is in words.

## `describe`

`StepKindContribution` gains an optional `describe`. Optional so every contribution written before
this programme keeps loading; a kind without one appears in the editor as a name, a raw JSON field
for `with`, and a note that the plugin has not described it.

```ts
type StepKindContribution = {
  handler: StepHandler
  validate?: StepValidator
  describe?: StepKindDescription
}

type StepKindDescription = {
  label: string                     // "Run a command"
  description?: string              // one sentence
  icon?: string                     // a Lucide name or a brand: mark
  runsAgent?: boolean               // true for kinds that take profile, model, isolation, inputs
  fields: StepField[]               // what goes in `with`, or in named fields for a built-in
  output?: { description: string; schema?: object }
}

type StepField = {
  id: string                        // the key inside `with` (or the named field for a built-in)
  label: string
  type: 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'prompt'
  required?: boolean
  hint?: string
  placeholder?: string
  options?: { value: string; label: string; description?: string }[]  // a static select
  optionsRoute?: string             // a dynamic select: GET → { options: [...] }
  min?: number; max?: number        // number only
  templates?: boolean               // text/textarea/prompt: `${inputs.x}` and `${steps.x.output}` allowed; default true for prompt
}
```

A `prompt` field is a textarea with the reference chips and the template check turned on. A
`select` with `optionsRoute` names a route in the contributing plugin's own namespace; the host
substitutes `{taskId}` and `{projectId}` from the editor's context and refuses a route outside
`/v2/p/<the contributing plugin>/`. The route answers `{ options: { value, label, description? }[] }`.

Validation stays the kind's job. `describe` says what to draw; `validate` says whether what was
drawn is acceptable. The host applies `required` and `min`/`max` before calling `validate`, so a
validator can assume the shape and check the meaning.

### Built-in kinds described the same way

The workflows plugin describes its own seven kinds through the same type, with `fields` naming the
step's named fields rather than keys in `with`. The editor does not know which is which; a lookup
table in the plugin's shared folder says whether a field id lands on the step or in `with`.

| Kind | `runsAgent` | Fields |
| --- | --- | --- |
| `agent` | yes | `prompt` (prompt, required), `schema` (textarea, JSON), `requiresRun` (select from run targets) |
| `decide` | yes | `prompt` (prompt, required), `branches` drawn by the editor as verdict → step rows, `schema` (textarea) |
| `gate-human` | no | none |
| `gate-policy` | no | `policy` (select from the catalog's policies) |
| `ci-loop` | yes | `prompt` (prompt), `maxIterations` (number, 1 to 8) |
| `fan-out` | yes | `prompt` (prompt, required), `childStep.prompt` (prompt), `childStep.profileId` (select), `childStep.model` (select) |
| `join` | no | `joins` (select from preceding fan-out steps, drawn by the editor) |

The agent-kind common fields (profile, model, reasoning and the other config options, isolation,
inputs mode, tools, budget) are not in `fields`. The editor draws them for every kind with
`runsAgent: true`, from the provider descriptors, so a plugin that contributes an agent-running kind
does not restate them.

## The catalog route

`GET /v2/p/workflows/catalog?projectId=<id>` answers, for the editor and the palette:

```ts
type WorkflowCatalog = {
  kinds: { id: string; pluginId: string | null; describe: StepKindDescription | null }[]
  policies: { id: string; pluginId: string | null }[]
  profiles: { id: string; label: string; managed: boolean; structured: boolean }[]
}
```

`pluginId` is `null` for a built-in. `structured` says the profile has a one-shot structured mode,
which `decide` requires. Provider config options are not in the catalog; the editor reads them from
`GET /v2/p/agents/providers`, which already lists them, and the workflows plugin does not copy that
surface.

The catalog is resolved per request from the extension point, never cached at init, for the reason
`WorkflowRunner.validationCatalog()` already gives: the plugin that fills the point may init after
workflows does.

## The kinds this programme adds

### `terminal:command`

Owned by `plugins/terminal`, because the process runner's environment rules and the checkout
resolution live there.

| Field | Type | Notes |
| --- | --- | --- |
| `command` | textarea, required, templates | Run as `/bin/sh -c` in the task's checkout. |
| `timeoutMs` | number, 1000 to 600000 | Default 120000. |
| `allowFailure` | boolean | A non-zero exit becomes an answer instead of a failure. |
| `env` | textarea | `KEY=value` per line, added to the allowlisted environment. Never a secret; the hint says so. |

Runs `ctx.core.proc.runProcess({ file: '/bin/sh', args: ['-c', command], cwd, env, timeoutMs,
signal })` with `cwd` from `core.tasks.resolveCwd`. Streams stdout and stderr chunks through
`ctx.emit` as `{ type: 'stdout' | 'stderr', text }` events so the run pane can tail them. Output is
`structured: { exitCode, stdout, stderr, truncated }` and `result: { durationMs }`. A non-zero exit
without `allowFailure` fails the step with the last 300 characters of stderr as the error. A timeout
fails it. A signal abort cancels it.

Trust: a repo-authored command is executable configuration and the existing snapshot hash covers
the file. A database-authored command is owner-typed. Both run as the node's owner in the task's
checkout, the same as a run target.

### `terminal:run-target`

Also `plugins/terminal`. The `requiresRun` path, as a node of its own so a later step can wait on it.

| Field | Type | Notes |
| --- | --- | --- |
| `target` | select, required, `optionsRoute` `/v2/p/terminal/tasks/{taskId}/run-targets` | A declared run target of the project. |
| `waitForUrl` | boolean | Default true: the step is done when the target reports a URL, or fails after 60 s. |

Output `structured: { targetId, sessionId, url }`. The run pane's detail for this node offers "Open
terminal", which calls `requestTerminalFocus(taskId, sessionId)`.

### `database:query`

Owned by `plugins/database`, a loaded plugin. It contributes through `ctx.extensionPoints.handle`
with the point spelled as the string `'workflows:step-kind'`, because a plugin does not import
another plugin's module and the string is the contract.

| Field | Type | Notes |
| --- | --- | --- |
| `savedQueryId` | select, `optionsRoute` `/v2/p/database/projects/{projectId}/saved-queries` | One of the two. |
| `sql` | textarea, templates | The other. Inline SQL. |
| `maxRows` | number, 1 to 200 | Default 200. |

Exactly one of `savedQueryId` and `sql` must be set; the validator says which is missing. Runs
through a `database.query` capability the database plugin provides from a `contract/query.ts`
(new): `{ query(taskId, sql, { maxRows, signal }) → { columns, rows, rowCount, truncated } }`. The
capability is the bridge's `query` with the row cap applied, and it exists so the step handler and
the route share one path. Output `structured: { columns, rows, rowCount, truncated }`, and the
handler refuses a result over 256 KB of JSON with a failure that says so, because a step's output is
interpolated into prompts.

Read-only: the handler refuses a statement the bridge classifies as a write. `database:write` is
deferred; the argument is in [refused.md](./refused.md).

### `database:generate`

Also `plugins/database`.

| Field | Type | Notes |
| --- | --- | --- |
| `prompt` | prompt, required | What to ask for, in words. |
| `connectionId` | select, `optionsRoute` `/v2/p/database/tasks/{taskId}/model-connections` | Which model connection writes the SQL. |
| `maxRows` | number, 1 to 200 | Default 200. |

Calls the existing prompt builder in `plugins/database/src/server/generateSql.ts` over
`core.models.generateText`, strips the fences, and runs the SQL through the same `database.query`
path with the same read-only refusal. Output `structured: { sql, columns, rows, rowCount, truncated
}`. A generated statement that is not read-only fails the step and the error carries the SQL so the
person can see what was asked for.

### `http:request` gains a `describe`

No behaviour change. `method` (select, the eight methods), `url` (text, required, templates),
`headers` (textarea, `Name: value` per line), `bodyMode` (select), `body` (textarea, templates),
`auth` (select over the modes the send input accepts). The validator in
`plugins/http/src/server/workflowStep.ts` stays.

## Streaming events per kind

`StepHandlerContext.emit` already exists. This programme gives the event a small vocabulary the run
pane understands, in `plugins/workflows/src/shared/stepEvents.ts` (new):

| Event | From | Drawn as |
| --- | --- | --- |
| `{ type: 'managed-agent', ... }` | agent kinds, already | State, last assistant text, cost |
| `{ type: 'stdout' \| 'stderr', text }` | `terminal:command` | A tail, last 4 KB kept on the client |
| `{ type: 'progress', text }` | any kind | One line under the node |
| `{ type: 'rows', count }` | database kinds | "n rows" while running |

Anything else is kept and shown as JSON under a disclosure. The client holds the last 200 events per
step and re-reads the row when it opens a run, as `contract/notices.ts` already promises.
