# Phase 5: jump from a guide step to the code

Date: October 30, 2026. Status: done.

## Completion note

Landed October 30, 2026.

What landed:

- A bridge verb, `ui.revealChangeRequestLine(path, line?, side?)`, on the wire union, the SDK's
  `AcornBridge` (both copies), `verbs.ts`, and the `plugin_authoring` verb list. The broker refuses it
  without `core.changeRequests:reveal`, answers `bad_request` for an empty or long path, a line under 1,
  or a side that isn't `old` or `new`, and `not_found` when the task has no change request.
- The scope is a verb scope: `VERB_SCOPES` in `scopes.ts` maps it to the verb it grants, and
  `GRANTABLE_SCOPES` includes it, so the trust prompt reads "Open a task's pull or merge request diff at
  a line". The site's generated permissions table reads `VERB_SCOPES` too.
- `createFrameServices` reads `task.changeRequest.pane` and opens it with a new
  `change-request:reveal` pane intent that carries a `DiffPlace` (`{ path, line?, side? }`).
- `onChangeRequestReveal(task, reveal)` in `@acorn/change-request-ui/views` hands each intent to the
  host's pane. GitHub, GitLab, and Bitbucket call it, and send the place on with the file-scroll event.
  GitHub selects the primary pull's tab first.
- `presentation:file-scroll` carries an optional line and side. `requestFileScroll` in client-core
  (exported from `@acorn/plugin-api/client`) holds the last one until a diff with its route key takes
  it. GitHub's own copy of `requestFileScroll` is gone.
- The diff holds the wanted place in a signal. It goes to the file's header once the topology and
  scroller exist, and to the line, centered, once its segment loads (`segmentOfLine`, then the find
  reveal's `revealMatch`). A line no segment covers lands on the header.
- `review-guide` declares the scope. Each hunk sits under a link named `path:line`, or the path alone
  for a hunk with no new side, and pressing it calls the verb. `hunkStart` reads the `@@` header.
- Tests: the broker refusals and parsing, the host service, the diff (held scroll, line after its
  segment loads, header for a missing line), and the guide's links and `hunkStart`.
- Docs: [frames](../../plugins/frames.md#showing-a-line-in-the-change-request),
  [permissions](../../plugin-authoring/permissions.md#frame-scopes),
  [the bridge](../../plugin-authoring/the-bridge.md),
  [review threads and state](../../diff-rendering/review.md#review-threads-and-state),
  [shared review views](../../plugins/change-request-ui.md#extension-points), and
  [the review guide plugin](../../first-party-plugins/review-guide.md). The site's review guide page is
  updated, the plugin's grant has a reason, and every site page citing a changed file is marked checked.
- The Node service graph is unchanged at 1,942,974 bytes. The authoring verb list loads lazily.

Decisions and deviations:

- The terminal client opens the file in the **Editor** pane at the line, through a
  `revealChangeRequestLine` override on `FrameServiceHost`. Its diff column beside the tabs isn't a
  keyboard stop, so a line shown there couldn't be reached, and its `DiffPane` doesn't hear file-scroll
  at all. A deleted line opens the file at its top.
- No **Diff** switch. Phase 4 made the guide a tab, and in a window the diff is a column beside it, so
  there's nothing to switch to. The terminal goes to the editor instead.
- No focus rule or navigation budget, the same as `openPane`, because the verb moves nothing outside
  the task.
- `scrollRestoration.publish` now runs its three steps in one `batch`. Without it, the held reveal ran
  as soon as the scroller was set, and the saved place was put back over it. A held place also counts as
  explicit navigation, so no saved place is restored over it.
- GitHub's `prTabs` consumed every intent for `pr` when it built. It now consumes only `plugin:select`,
  so a reveal waiting for the pane survives.
- The link is a `Link` above `StackedDiff`, which repeats the path. Making `StackedDiff`'s header
  pressable would change a kit node in both hosts and its focus role.

Not checked live:

- The `pnpm dev:agent` session still has no signed-in code host, so no task had a pull request and no
  guide had hunks. Clicking a hunk into a real GitHub, GitLab, or Bitbucket diff is unchecked, as phases
  3 and 4's real-pull-request checks are. The diff test covers the scroll on the generated fixture.
- The phone's change request view, if it draws one, stacks the tabs and the diff and isn't switched to
  the diff.
- `EditorPane.test.tsx` "uses the shared collapse control…" fails on the base commit too, so it isn't
  from this phase.

For later phases:

- This is the last phase. The `docs/future/guide` files can go.

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
