# Phase 3: hold agent-created tasks to their own project

Date: October 21, 2026. Status: proposed. Severity: medium, when a trigger watches tasks.

A task token may create tasks, because a task row was inert: nothing on it ran until a person opened
it. Record triggers changed that. A trigger can watch core's Tasks source and start a workflow for each
new match, and the task's title and other fields can become the workflow's inputs. An agent that can
create a task in any project, with any `origin`, can start the owner's approved workflows with inputs
it wrote. Read [the programme](./README.md) first.

## Starting point

Read at `32b2ab6c3`.

- `packages/node-core/src/server/mountCoverage.test.ts` lists `POST /v1/core/tasks` as open to a task
  token, with the reason "creates an inert row; every executable path off it is separately gated".
- The handler, `tasks.post('/')` in `packages/node-core/src/server/routes/projects/tasks.ts`, takes any
  `projectId`, and `title`, `icon`, `branch`, `baseBranch`, `baseCommit`, `links`, `skipSetup`, and
  `origin` from the body. It refuses a task token only `worktreePath`.
- `origin` is any non-empty string. Clients send values such as `local`, `manual`, `github-pr`, and
  `linear`, and `ownsTaskOrigin` in the rail matches plugin IDs against it.
- The Tasks source in `packages/node-core/src/server/dataSources/coreTasks.ts` serves `origin`,
  `project`, and the title, and `origin` takes `eq` and `ne`. So an owner who writes a trigger that
  only admits `origin eq 'manual'` is filtering on a value the agent picks.
- `core:tasks` calls `changed`, and a record trigger on it checks again within seconds
  ([record triggers](../../workflows/triggers.md#record-triggers)). The trigger guard skips tasks the
  trigger made itself, not tasks an agent made.
- The task list a task token reads is filtered to its own task, so the agent never sees the task it
  made in another project. The owner does, in the rail.

## Changes

### Find the callers first

List every caller that creates a task with a task token before you narrow the route. Two to check:

- The `acorn` CLI run inside a task's terminal, which may hold that terminal's task token rather than
  a device token.
- Any agent tool or MCP path that creates a task. None was found at `32b2ab6c3`, so confirm.

If the CLI in a task terminal needs to create a task in another project, it should pair as a device
for that. Record what you decide in [authentication](../../authentication.md).

### Narrow the route for a task token

In the handler, when `isTaskConfined(c)`:

1. Refuse with 403 unless `projectId` is the project of the caller's own task.
2. Ignore the body's `origin` and store `agent`. Keep the caller's task ID in a new nullable column,
   `created_by_task_id`, so the owner can see which task made it and a trigger can exclude it.
3. Refuse `baseCommit` and `skipSetup: true`. An agent has no reason to choose the commit a person's
   worktree starts from, or to skip the project's setup.

Device callers are unchanged. Run `pnpm db:generate` for the column and `pnpm db:check` after.

### Let a trigger tell agent-made tasks apart

- Serve `createdByTask` on the Tasks source as a field that takes `present` and `missing`. Those
  operators test whether a field exists, not whether it's null, so leave the field out of a person's
  task rather than setting it to null.
- When a trigger reads core's Tasks source, its approval sheet says "Agents can create tasks this
  trigger would match" unless the query excludes `createdByTask`. A starter trigger on tasks excludes
  it by default.

### Update the reason in the coverage test

Change the allowlist reason for `POST /v1/core/tasks` to say a task token creates only in its own
project, with `origin` stamped by the Node, because a trigger can act on a new task.

## Tests

- `routes/projects/tasks.test.ts`: a task token creating a task in another project gets 403. In its
  own project, the stored `origin` is `agent` whatever the body says, and `created_by_task_id` is the
  caller's task. `baseCommit` and `skipSetup: true` are refused. A device's request is unchanged.
- A Tasks source test: a task an agent made carries `createdByTask`, and one a person made doesn't.
- A trigger approval test: a trigger on Tasks without the exclusion shows the warning.

## Acceptance

- In `pnpm dev:agent`, a record trigger on Tasks with the starter's exclusion doesn't start a run when
  an agent's token creates a task, and does when the owner creates one.
- [Workspaces and tasks](../../workspaces-and-tasks.md) and [transport and auth](../../security/transport-and-auth.md)
  describe what a task token may create.
