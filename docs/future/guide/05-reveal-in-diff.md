# Phase 5: jump from a guide step to the code

Date: October 30, 2026. Status: not started. Needs phase 3.

## Goal

Let a person click a hunk in the guide and land on that file and line in the task's full change
request diff, where they can comment and see the surrounding code.

## Starting point

Checked against `main` at `e3d8d1e69`. Recheck before you start.

- A loaded plugin's `openPane` bridge operation takes only a pane ID. It's in
  `packages/protocol/src/plugin/bridge.ts`.
- A diff scrolls to a file through `presentation:file-scroll`, a client-local event with `routeKey`
  and `path` and no line. It's declared in
  `packages/client-core/src/host/registries/commands/clientEvents.ts`, and GitHub emits it from
  `plugins/github/src/client/fileNavigation.ts`. Only compiled code can emit it.
- In browse, the file comes from `?file=` instead ([diff review threads and
  marks](../../diff-rendering/review.md#review-threads-and-state)). The guide only runs in a task, so
  this phase needs only the event path.

## In scope

- A bridge operation, for example `revealChangeRequestLine`, taking `path`, an optional `line`, and an
  optional `side` (`old` or `new`). The host opens the task's primary change request pane and scrolls
  its diff there. The plugin never names another plugin's pane.
- A `permissions.api` scope for it, granted only to frames that declare it. Add the scope to the trust
  prompt.
- An optional line and side on `presentation:file-scroll`, and support for them in the shared diff
  source, so all three code hosts scroll to the line rather than the file header.
- In `review-guide`, make each hunk's path in the guide a link that calls the operation, and in the
  phase 4 view, switch the toggle to **Diff** first.
- The terminal client: either the same behavior, or an action that opens the file in the editor
  pane. Say which in the docs.

## Tests

- The bridge operation refuses a frame without the scope.
- The diff source scrolls to a line once its segment loads, and to the file header when the line is
  missing or outdated.
- A live check in `pnpm dev:agent`: click a hunk in the guide and land on its line in the GitHub diff.

## Docs

Add the operation to [frames](../../plugins/frames.md) and the scope to
[permissions](../../plugin-authoring/permissions.md).

## Done when

Clicking a hunk's path in the guide opens the task's change request diff at that line, on all three
code hosts.
