# Phase 3: the review guide plugin

Date: October 30, 2026. Status: not started. Needs phases 1 and 2.

## Goal

A bundled loaded plugin, `review-guide`, that builds a guide for a task's change request with the
harness the person picks, and shows it in its own pane. This is the first version people can use.

## Where it lives

`plugins/review-guide/`, a first-party loaded package. Copy the layout, build, and bundling of
`@acorn/plugin-rollbar`: `plugins/rollbar/acorn-plugin.config.mjs`, its dependency entry in
`apps/node/package.json`, and `apps/node/scripts/build-plugin.mjs`. Use `pnpm dev:plugin review-guide`
while you work. Being a loaded package keeps it honest: it can use only what an outside author can.

## The manifest

- `requires.plugins`: `agents`.
- `permissions.node.core`: `tasks`, `git`, and `prefs`.
- `permissions.node.capabilities`: `agents.sessionExecute`, and the profile list from phase 1.
- `permissions.events`: `head:changed`, and the plugin's own `plugin:review-guide:changed`.
- No `net`, no `exec`, and no `secrets`.
- `contributions`: a task pane frame named **Guide** whose body is a remote tree, and a command to open
  it. Model them on the pane and command in `examples/plugins/acme-review/acorn-plugin.json`.

## The node half

### Read the change

1. Read the task's change request with `tasks.changeRequestDetail(taskId)` from phase 2. No change
   request means the pane shows an empty state, and nothing else runs.
2. In `tasks.root(taskId)`, fetch the target branch with `core.git`, then find
   `git merge-base origin/<baseRef> HEAD`.
3. Run `git diff --no-color --no-ext-diff -U3 <base> HEAD`.
4. Split the output into files and hunks. A hunk's ID is its path and its position in the file, such
   as `src/billing/invoice.ts#2`. A binary file, a pure rename, or a mode change is one item with no
   hunk text.

Keep the parser in its own module with its own tests. It has to handle added, deleted, renamed, and
binary files, quoted paths, and "No newline at end of file".

### Ask the harness

Run one turn through `agents.sessionExecute`:

- `profileId` is the person's choice, saved with the `prefs` facet. With no choice, use the agents
  plugin's default profile.
- `title` is "Review guide".
- `context` holds the hunk list. Each item gives the ID, the path, and the hunk's text. When the total
  passes a cap, send IDs, paths, and hunk headers only, and tell the harness to read the files itself.
  The session runs in the worktree, so it can.
- `schema` asks for a summary and a list of sections. Each section has a title, a short "why", a kind
  (`core` or `supporting`), and the hunk IDs it covers, in reading order.
- `tools` is a read-only ceiling.
- `signal` cancels the turn when the person presses **Stop**.

Keep the prompt in one module, next to the schema it asks for.

### Check coverage

Before storing anything, compare the answer with the hunk list:

- A hunk in no section goes in a final section, **Not covered by the guide**, in file order.
- A hunk in two sections stays in the first.
- An unknown ID is dropped and counted.

The pane shows the counts, such as "3 hunks weren't covered by the guide". This check is the reason a
reviewer can trust the guide. Test it on its own.

### Store and serve

- One SQLite table keyed by task, base commit, and head commit. It holds the profile, the status
  (`generating`, `ready`, `failed`, or `stale`), the checked guide as JSON, the session ID, and the
  times. Use the plugin's own migrations.
- One generation per task at a time. A second request while one runs gets the running one.
- On `head:changed`, mark that task's guide `stale`. Don't regenerate. The person presses
  **Regenerate** when they want to spend the usage.
- Emit `plugin:review-guide:changed` when a status changes, and have the tree refetch.
- Routes: `GET /guide?taskId=`, `POST /guide/generate`, and `POST /guide/stop`. Each holds a
  task-scoped caller to its own task, the way the scaffold's `/greeting` route does.

## The pane

A remote tree:

- A header with the summary, the profile used, and **Regenerate**. A stale guide says the change has
  new commits.
- One block per section in order: title, the "why" as Markdown, then each hunk in `StackedDiff` with
  its path and patch. `StackedDiff` is in `packages/client-core/src/kit/diff/DiffRows.tsx`, and the
  SDK exports it.
- The **Not covered by the guide** section last, when it has anything.
- While it generates: progress, a link to the session's transcript, and **Stop**.
- A failure shows the error and **Try again**.
- A harness picker in the pane's header or in a settings page.

Check the pane in the desktop and in the terminal client. Both draw plugin trees.

## Tests

- The diff parser, on fixtures.
- The coverage check.
- The routes, with a fake `agents.sessionExecute`: one generation at a time, stale on
  `head:changed`, stop, and a failed turn.
- A live check in `pnpm dev:agent -- --session guide` on a task with a real GitHub pull request, and on
  one GitLab or Bitbucket change request if you have an account.

## Docs

Add the plugin to [first-party plugins](../../first-party-plugins.md) and give it a reference page that
says what it reads, what it spends, and what the coverage check guarantees.

## Done when

On a task with a primary change request on any of the three hosts, a person opens **Guide**, picks a
harness, and gets a guide in which every hunk appears exactly once. A new commit marks it stale.
