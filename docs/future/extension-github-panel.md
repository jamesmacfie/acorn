# Pull request panel in the browser extension

This page is a plan for a GitHub panel in the browser extension's sidebar. The panel shows the state,
checks, and reviews of the task's pull request. Read it before you build the panel or let a built-in
plugin declare one.

Proposed October 16, 2026, against `afb826ee3`. Parts 1 and 2 implemented October 16, 2026. The
check in a real browser against a dev Node is still open. The
[Docker panel](./extension-docker-panel.md) depends on the first part of this plan.

## Why

The sidebar knows which task a page belongs to, but it shows nothing about that task's pull request.
[Pages matched to tasks](../browser-extension/task-pages.md#this-page) says so: "The panel shows no
item state, such as checks or review." To find out whether CI passed or a reviewer asked for changes,
you have to switch to the desktop app or open github.com.

The GitHub plugin already keeps this data. Its mirror tables in `plugins/github/src/node/schema.ts`
hold each pull request's state, merge state, reviews, requested reviewers, and one row per check with
its result and address. The pull request pane reads them through `readPullDetail` in
`plugins/github/src/server/routes/pulls/pullDetail.ts`. The panel reads them the same way and draws
them with the blocks the extension already has. The extension needs no changes.

## Part 1: let a built-in plugin declare a panel

Implemented October 16, 2026, with the [Docker panel](./extension-docker-panel.md).

Only a loaded plugin can declare a panel today. A built-in plugin can declare browser handoffs through
`NodePlugin.browserHandoffs`, but not a panel. GitHub and Docker are both built in, so open the panel
the same way handoffs were opened. Whichever panel ships first does this part.

1. Add `browserPanel?: BrowserPanelDescriptor` to `NodePlugin` in
   `packages/node-core/src/server/pluginHost/types.ts`, beside `browserHandoffs`, with the same
   comment: a loaded plugin declares it in its manifest, and this field is ignored for it.
2. In `packages/node-core/src/server/pluginHost/host.ts`, pass `{ browserPanel: plugin.browserPanel }`
   as the third argument to `declareBrowserHandoffs` when there is no loaded binding.
3. In `packages/node-core/src/server/pluginHost/browserHandoffs.ts`, check a built-in's panel the way
   `validated` checks its handoffs: parse it with `browserPanelDescriptor`, and refuse a route outside
   `/v1/p/<pluginId>/`. A built-in that breaks either rule fails the boot. Update the comment that
   says only a loaded manifest declares a panel.
4. Update `docs/plugin-authoring/browser-panel.md`, which says "Only a loaded plugin declares a panel".

Leave `taskAddresses` loaded-only. Nothing built in needs it yet.

The Node half of a built-in can't see its client panes, so the host can't check that `pane` names a
real task pane, as it does for a manifest. Each plugin that declares a panel adds a test that its
`pane` matches the ID its client registers.

Tests for this part:

- A built-in with a panel appears under `panels` in `GET /v1/core/browser-handoffs`.
- A built-in whose panel route is outside its namespace fails to start.
- A loaded plugin's panel still comes from its manifest, and `NodePlugin.browserPanel` is ignored for it.

## Part 2: the GitHub panel

### Declare it

In `plugins/github/src/node/index.ts`, beside `browserHandoffs`:

```ts
browserPanel: { label: 'Pull request', glyph: 'git-pull-request', pane: 'pr', route: '/v1/p/github/browser-panel' },
```

Put the route handler in a new file, `browserPanel.ts`, in `plugins/github/src/server/`. Keep the code that
turns a `PullDetail` into a `BrowserPanelView` a pure function, so tests can feed it a detail without
a database.

### What the route answers

`GET /v1/p/github/browser-panel?taskId=<id>`. Answer device callers only, with `requireDevice`. The
extension's bridge holds a device credential, and no agent needs this route.

1. Load the task. Answer 404 when the task doesn't exist, has no `pullNumber`, or its project has no
   GitHub repository. A 404 means no nav item, which is right for a task with no pull request.
2. Read the pull request with `readPullDetail`, using the caller's owner ID and GitHub token. This
   serves the mirror and refreshes it in the background when it's older than 45 seconds. It waits for
   GitHub only the first time the mirror sees this pull request.
3. With no connected GitHub account, answer one `status` block: "GitHub isn't connected", severity
   `warn`, with a detail that says to connect it in Acorn's **Settings** > **Services**.
4. If the read fails, answer the failure's status and error, not a view. The sidebar then keeps the
   last view it had and shows why above it.

### The blocks

The view has up to four blocks, in this order. Leave out a block that would be empty.

The **status** block, labelled "Pull request #482":

- `state` is Draft, Open, Merged, or Closed.
- `severity` is `danger` for conflicts or a failed check, `pending` while a check runs, `warn` when a
  reviewer asked for changes, and `info` otherwise. Merged and closed are always `info`.
- `detail` holds the title, `head → base`, and one line on what blocks the merge. That line comes from
  `mergeStateStatus`: conflicts, behind the base branch, blocked by checks or reviews, failing checks,
  or ready to merge. After it come the number of unresolved review threads and whether auto-merge is on.

The **Checks** `rows` block has one row per check:

- The label is the check's name, cut to 80 characters.
- The state is GitHub's result in lowercase, with underscores as spaces, such as "in progress".
- A failure, timeout, cancellation, error, or action required is `danger`. Queued, pending, waiting,
  in progress, and expected are `pending`. Everything else is `info`.
- Failed checks come first, then running ones, then the rest, each group in GitHub's order. The block
  holds at most 64 rows, so a cut drops passing checks first.

The **Reviews** `rows` block has one row per reviewer:

- Each reviewer's latest review counts, leaving out pending ones. Changes requested is `warn`, and
  every other review is `info`.
- Each requested reviewer who hasn't reviewed gets a row with the state "requested" and `pending`.

The **Links** block has at most 16 links:

- The pull request, and its checks tab.
- Each failed check that has an address, labelled with its name cut to 40 characters.

### Keep an open panel current

The extension never polls. It reads an open panel again when the Node's tasks change, or when a
plugin that declares a panel sends `term:status` (`apps/cli/src/browser/bridge.ts`).

After a background refresh, the GitHub plugin emits `pr-synced` or `checks-changed` on its own
channel. The bridge doesn't listen to that channel. So when the panel route reads a pull request,
pass `readPullDetail` an emit that also calls `ctx.events.status()`. Then a refresh that the panel
started makes the panel read itself again.

That can't loop. The second read finds the mirror less than 45 seconds old and doesn't refresh again.
Add a test that proves it: one panel read on a stale mirror leads to exactly one more read, and then
nothing.

## Out of scope

- Any action, such as merge, approve, rerun a check, or mark ready. The panel is read-only by contract.
  **Open in Acorn** goes to the pull request pane for these.
- Review comment text, the diff, and check logs. The mirror holds no check logs.
- Pull requests an agent opened for the task that aren't the task's own (`taskPulls`). Only
  `pullNumber` counts.
- Projects on other code hosts.

## Acceptance

- A task with a pull request shows a **Pull request** nav item. A task without one shows none.
- The nav item opens a panel with the state, checks, reviews, and links above, all drawn from the
  mirror. A test feeds `PullDetail` fixtures for an open, draft, merged, conflicting, and
  failing-check pull request and checks each view against `browserPanelView`.
- **Open in Acorn** opens the task on the `pr` pane.
- With no GitHub connection, the panel says how to connect.
- A check that finishes on GitHub shows in an open panel after **Refresh**, without reopening it.
- The GitHub plugin's test checks that `pane: 'pr'` matches its client's pane ID.
- `docs/browser-extension/task-pages.md` stops saying that the panel shows no checks or review, and
  `docs/github-integration.md` names the panel.
- Check it once in a real browser against a dev Node. The extension's plugin panels have only been
  checked in unit tests ([plugin panels](../browser-extension/plugin-panels.md#gaps)).

## Limits

- A check that finishes while the panel is open shows only after something makes the panel read
  again, such as **Refresh**, another task change, or a background refresh. That follows from the
  extension never polling.
- The sidebar reads every declared panel when its task changes, to decide which nav items show. Each
  of those reads can start a background request to GitHub when the mirror is stale. This is the same
  request the pull request pane makes, rate-limited by the same 45-second window.
- The first read of a pull request the mirror has never seen waits for GitHub, and the nav item waits
  with it.
