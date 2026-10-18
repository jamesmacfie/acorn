# Node boot

This page covers how the Node's boot reaches telemetry: the `node.boot` span, its marks, and when
they're sent. Read it when you add a boot step, or when you read a launch's boot in a vendor. It's
part of [telemetry](../telemetry.md), and the Node's other seams are in
[Node seams](./runtimes.md#node-seams).

## The account

The Node prints each step of its boot as a `[service:boot]` line, unconditionally
([timing a cold start](../local-development/profiling.md#timing-a-cold-start)).
`apps/node/src/composition/bootTimer.ts` also keeps those marks, and turns them into one `node.boot`
span with a `node.boot.mark` child per mark. Each child carries `mark` and is measured from the mark
before it. It's the shape of the helper's `helper.boot`.

The spans go out once, after the boot's cleanup has taken its last mark and collection is on,
whichever comes last. Collection is off for most of the boot, because the switch is a preference the
boot reads partway through, so a span built where its mark was taken would be dropped. A boot that
never turns collection on sends nothing.

## Marks worth knowing

- `process` comes first. It runs from process start to the boot timer's start, which covers spawning
  the process and evaluating the service bundle. The printed lines leave it out.
- `login-shell.settled` marks when the login-shell `PATH` probe finished, which is when spawns were
  released. It lands wherever the probe finishes, and only a packaged macOS build runs the probe. The
  spans wait for it, so a cleanup that finishes first doesn't lose it.
- `reconcile.agents.<step>` times each step of the agents cleanup: `unsettled`, `subagents`,
  `steering`, `commands`, `background`, `followups`, `attachments`, `skills`, `webhooks`, and
  `goals`. `reconcile.agents` still covers the whole cleanup, measured from the mark before its first
  step, so older boot lines compare.
