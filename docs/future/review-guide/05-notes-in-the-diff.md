# Phase 5: notes in the Diff tab

Date: October 30, 2026. Status: not started. Needs phase 1.

## Goal

The guide's notes show as one-line marks under their rows in the pull request's own diff, on GitHub,
GitLab, and Bitbucket. A reviewer who never opens the guide still sees what it flagged.

## Starting point

Checked against `main` at `e94c01050`. Recheck before you start.

- Each code host opens a `diff-line` annotation point, such as `github:diff-line`, from
  `changeRequestPoints` in `packages/change-request-ui/src/model/points.ts`. `DiffPane` draws every
  contributor's marks under the row they name
  ([marks from other plugins](../../diff-rendering/review.md#marks-from-other-plugins)).
- The key is `{ file, line, side }`, minted per row by `annotationKey` in
  `packages/client-core/src/host/annotations/annotationKey.ts`. `DIFF_LINE_KEY` must list the same
  fields in the same order, or keys match nothing.
- **The key names no task.** A contributor is asked about `src/a.ts` line 42 and can't tell which task's
  pull request the reader has open. The guide keeps one guide per task, so it can't answer.
- A mark holds a severity (`info`, `warn`, or `danger`), up to 200 characters of text, and an optional
  icon. It holds no action. `detail` is stripped on every point that doesn't set `acceptsDetail`, and
  the `diff-line` points don't ([annotations](../../plugins/rows-and-annotations.md#annotations)).
- No plugin in this repository contributes to a code host's `diff-line` point today.
- The guide stores the worktree's HEAD with each guide. That can differ from the pull request's head
  when a commit isn't pushed.

## In scope

### The task in the key

Add `task` to the code hosts' `diff-line` key, after the existing fields:
`['file', 'line', 'side', 'task']`. Give `DiffPane` an optional prop of fixed key fields that it adds to
every row's key, and have `ChangeRequestDiff` pass `{ task: taskId }`. On the browse surface, which has
no task, pass `task: ''`. Leave `git:diff-line` as it is.

With the task in the key, the host never puts a mark answered for one task on another task's diff. The
contributor can't widen its match, because the host builds the lookup from the declared fields.

### The guide's marks

Declare three extensions in `plugins/review-guide/acorn-plugin.config.mjs`, one per host, each with
`point: '<host>:diff-line'` and `items: '/v1/p/review-guide/marks'`.

Serve `POST /v1/p/review-guide/marks`. For each key:

1. Read the task's newest guide. Skip the key if there isn't a `ready` one.
2. Skip it if the guide's head commit isn't the change request's head, from
   `tasks.changeRequestDetail`. A guide on an unpushed commit would put notes on the wrong lines.
3. Answer every note on that file, side, and line as a mark: `info` for Explains, `warn` for Look
   closely, `danger` for Risk. The text is the note's title, which phase 1 already caps at 120
   characters. Use the `sparkles` icon, or whatever icon the host resolves closest to ✦.

Hold a task-scoped caller to its own task, as the other routes do. Cache the guide read per request,
not across requests, because a batch names one task. Send the plugin's descriptor invalidation when a
guide's status changes, so the marks follow a new guide or a stale one.

### What the reader can do

Nothing beyond seeing the mark. A mark has no click action, so it can't open its step. To act on a
note, the reader uses ✦ on that line, as on any line. The mockup's "step 2" link in a mark needs a host
change and isn't part of this phase.

## Decide before you build

- The task in the key against a scope beside the keys. Appending `task` keeps the host's matching rule
  as it is, and a contributor that sends back the keys it was asked about keeps working. A contributor
  outside this repository that builds keys from the three fields would stop matching. The other way is
  a `scope` object the host sends with the keys and includes in the request's identity. That changes
  nothing for existing contributors, but leaves isolation to each contributor. The key is the stronger
  rule. Check the published plugin surface snapshot, `tools/arch/publishedPluginSurface.snapshot.txt`,
  for anything that names the key, before choosing.
- A way to hide the guide's marks. The mockup has a checkbox in the diff toolbar. The diff has no
  per-contributor switch, so this needs a setting in the guide, or a host change. Start without one, and
  add a setting if the marks get in the way.
- Whether Explains notes belong in the diff at all. They give context in the guide. In the diff, only
  Look closely and Risk may earn the space. Try both on a real pull request.

## Tests

- `annotationKey` with fixed fields, and `points.test.ts` holding `DIFF_LINE_KEY` against the minted
  key, including `task`.
- `DiffPane`: marks answered for one task don't draw on another task's diff with the same file and
  line.
- The guide's marks route: marks for a ready guide, none for a stale or generating one, none when the
  heads differ, the severity per tone, and a caller from another task refused.
- `pnpm --filter @acorn/arch-tests test`, because the manifest and the published surface change.
- A live check in `pnpm dev:agent` on GitHub: generate a guide, open **Diff**, and find each note's
  title under its line. Push a commit and check the marks go away until the guide is regenerated.

## Docs

Add the `task` field to [diff review threads and marks](../../diff-rendering/review.md#marks-from-other-plugins)
and to the extension points section of [shared review views](../../plugins/change-request-ui.md#extension-points).
Add the marks route and the three extensions to [the review guide plugin](../../first-party-plugins/review-guide.md).

## Done when

With a ready guide on the pull request's head commit, each note's title shows under its line in the
**Diff** tab on all three code hosts, colored by its tone, and nothing shows on any other task's diff.
