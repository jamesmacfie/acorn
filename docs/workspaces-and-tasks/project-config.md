# Project configuration

A project's scripts, run targets, preview, database, and browser settings live on its `projects`
row, and a `.acorn/config.toml` can override most of them. This page covers the layers, the run
target merge, and layout recipes. `loadRepoConfig` in `packages/node-core/src/server/runConfig.ts`
does the merge.

## The project row

The `projects` row holds the machine-local values: setup, dev, dev restart, teardown, and database
scripts, the setup trigger, preview mode and value, run targets, browser rules, and the branch
prefix. The project's settings page edits them.

`GET /v1/core/projects/:id/config` returns the row as `config`. When the project folder has a
`.acorn/config.toml`, the response also carries `repoConfig`: what that file sets for run targets,
the database connection script, and the preview mode and value. The settings page reads it to mark
those values read-only.

## The layers

A value comes from the first layer that sets it, in this order:

1. The committed `./.acorn/config.toml` in the task's checkout. A branch can change it.
2. The personal `~/.acorn/config.toml`.
3. The project row.

Browser rules come from the project row only, because autofill selectors are personal. The `copy`
list comes whole from one layer ([copy files](./worktrees.md#copy-files-into-a-worktree)).

Run targets and layouts merge by ID, and the later layer wins for each ID. The `dev` target merges in
this order, each step overriding the last:

1. The project row's dev script and dev restart script, as a base `dev` target.
2. `projects.run_targets`, from the project's settings page.
3. `~/.acorn/config.toml`.
4. The committed `./.acorn/config.toml`.

The base `dev` target carries no URL and no `default` flag, so it can't shadow a repository's real
default target.

## Trust

A committed config can run code, through run targets and the database connection script. The Node
records which IDs won from the committed layer, in `repoTargetIds` and `dbUrlFromRepo`, and applies
the trust gate only to those. `config_acks` stores a hash of the reviewed snapshot. Changing the
snapshot needs a new review before a task or workflow runs it. Values you set on the row or in your
personal file don't need a review.

## Layout recipes

A `[layout.<id>]` block seeds a task's pane layout:

- `panes` opens known panes left to right, split equally. Unknown and duplicate pane IDs are
  dropped, and a recipe that names no valid pane does nothing.
- `terminal = "<run-target-id>"` starts that target and opens the terminal drawer.
- `browser = "run:<id>"` points the browser pane at that target's resolved URL once it's up.

`plugins/terminal/src/client/recipes.ts` applies a recipe.
