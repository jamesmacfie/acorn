# Phase 3: the review guide plugin

Date: October 30, 2026. Status: done.

## Completion note

Landed October 30, 2026.

What landed:

- `plugins/review-guide`, a bundled loaded package in `scripts/bundled-plugins.mjs`, built like
  rollbar and stored like http. The reference page is
  [the review guide plugin](../../first-party-plugins/review-guide.md). The site has
  `/docs/built-in-plugins/review-guide/` and an entry in `apps/site/src/data/plugins.ts` with a reason
  for each grant.
- `src/server/diff.ts` parses `git diff` into items, tested on a fixture of real git output.
  `src/server/coverage.ts` checks the answer. `src/server/prompt.ts` holds the prompt and the schema.
  `src/server/guides.ts` owns storage, one generation per task, stop, and stale marking.
  `src/server/routes.ts` serves the three routes. `src/tree/GuidePane.tsx` draws the pane.
- Tests: the parser, the coverage check, the routes over a real git repository and plugin database with
  a stand-in `agents.sessionExecute`, and the pane through a remote root.
- The Node service graph is unchanged at 1,942,974 bytes.
- Live checks: in `pnpm dev:agent` and `pnpm dev:tui:agent`, the bundled package loads, the trust
  prompt lists every grant, **Open review guide** opens the pane, and a task with no change request
  shows the empty state. Neither session had a signed-in code host, so a guide over a real pull request
  wasn't generated. That check is still open. `dev:tui:agent` installs no loaded packages, so the
  plugin was built into its data root with `ACORN_DATA_DIR=... build:plugin review-guide`.

Decisions and deviations:

- No saved choice uses the first profile `agents.profiles` lists, which is Claude Code, the Agents
  plugin's default. `agents.defaultProfile` isn't in the published catalogue, and adding it wasn't worth
  a contract change.
- `build-plugin.mjs` and the testkit's `validatePluginConfig` now pass a config's `requires` into the
  manifest. Both dropped it before, so the manifest's `requires.plugins: agents` would have vanished.
- The context is one block that lists every hunk, not one block per hunk. The headers-only cap is 256 KiB
  of hunk text, half the Agents plugin's 512 KiB context limit.
- A task keeps one guide. Generating removes the rows for earlier commits.
- Reading the change happens inside `POST /guide/generate`, so a missing target branch, a missing
  worktree, or an empty diff comes back as an error the pane shows, with nothing stored. Only the turn
  runs in the background.
- A turn that finishes after HEAD moved stores `stale`. A restart marks `generating` rows `failed`.
- `stepId` is `<profile>:<head>`, so a retry on the same commit and harness reuses the session. The
  profile is in it because the Agents plugin refuses a reused session on another provider.
- The tree caps its first draw at 256 KiB of hunk text, because the host refuses a batch over 1 MiB.
  Later sections open on demand.
- The transcript link uses a `session` destination with target kind `managed-agent`.
- The site page's `checked` is the commit before this one, so `stale` lists it once.
- The pane's open sections are kept by index, so after **Regenerate** the open set can point at
  different sections. Small, and left as it is.

For later phases:

- The tree's entry is `pane`, mounted with `{ taskId }`. Phase 4 can mount the same `GuidePane` from a
  `review-panel` point, since it needs only the task.
- Each item has `path` and its hunk's `@@` header, which is what phase 5 needs to jump to a line.
- `plugin:review-guide:changed` carries `taskId`.


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
