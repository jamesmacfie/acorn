# Task checks

This page covers task checks, the only way anything gets into the archive dialog. It's part of the
[plugin reference](../plugins.md). The authoring steps are in
[contributions](../plugin-authoring/contributions.md#task-checks).

## Task checks

A plugin that knows something about a task the owner is about to archive says so through a task
check:

```text
GET  /v1/p/<id>/archive/check?taskId=…   → { concern } | { concern: null }
POST /v1/p/<id>/archive/apply            ← { taskId }
```

There are two carriers and one registry. A compiled plugin calls
`ctx.taskChecks.register({ id, check, apply? })`. A loaded plugin declares `contributions.taskChecks`,
and the host builds the same registration over its two routes. The registry is
`packages/node-core/src/server/pluginHost/taskChecks.ts`, and the dialog it feeds is
`packages/client-core/src/host/registries/shell/willPhase.tsx`.

A concern is plain data:

```ts
{ id, message, severity: 'warn' | 'danger', details?: string[], detailsMore?: number,
  action?: { label, checked } }
```

`details` is listed under the message, at most five entries, and `detailsMore` counts the rest so the
host draws "+7 more". `action` draws a checkbox. The cleanup behind it is `apply`, which the archive
runs after the repository's teardown script and before the worktree is removed. The dialog shows
`message` beside a warning icon without the plugin's name, so write it to say what it's about: "2
terminals are still running", not "2 active".

There's no callback in that shape. The action is a route declared once, where the Node can confine
it to the plugin's own namespace and check it again on every dispatch.

The host binds the plugin id on every concern, the qualified id
`<pluginId>:<checkId>:<concernId>` the client hands back to name a cleanup, the route namespace, and
the deadlines. `severity` is the plugin's to declare, because "danger" here is a claim about the
plugin's own data.

## Deadlines

Every deadline is a race, not only an abort. The `AbortSignal` a check receives is a courtesy, and the
host stops waiting either way:

- A check has two seconds, because a person is watching.
- A cleanup has sixty seconds, because the dialog is gone by then.

A check that's slow, throws, or answers with something unusable adds no row, the same as one that
found nothing, so a broken plugin never blocks an archive. A cleanup that fails names its plugin in the
archive result. `ok` stays true, because the task is archived, and the owner is told what didn't
happen.

## Limits and trust

A plugin may declare at most four checks. Both routes are confined to the plugin's own namespace at
parse and at every dispatch. A manifest declaring a check with no `node` half is a parse error.

A check adds a line under **Declared** in the trust dialog. `cleansUp` is part of the recorded grant,
so a version that starts offering to change something where it used to only warn reads as newly
requested.

## Checks that exist

Three plugins ship a check:

- Docker reports running containers and offers a `compose down` cleanup.
- Changes reports uncommitted files, naming the first five paths. It only advises, because committing
  or discarding on the owner's behalf is what a confirmation exists to avoid.
- Terminal reports running terminals as a disclosure, because core stops them itself.

`registerWillHandler` on `@acorn/plugin-api/ui/host` is the client-side seam core uses for the two
moments with no Node meaning: the app quitting and a workspace being removed. No plugin should use it.
