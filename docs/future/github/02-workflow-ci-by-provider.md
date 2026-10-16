# Phase 2: ask the task's code host for workflow CI

## Completion note

October 16, 2026. Done.

What landed:

- `ctx.core.codeHosts()` returns the ids of the running plugins that declare a code host. It reads
  `runningCodeHosts` in `packages/node-core/src/server/pluginHost/codeHosts.ts`. The published surface
  snapshot lists it.
- `CODE_HOST_POLICY`, the entry ids `ci-settled` and `review-received`, and `CiSettledValue` are in
  `plugins/workflows/src/contract/extensions.ts`, which also exports `PolicyVerdict`.
- `checks-green`, the new built-in `review-received`, and `ci-loop` read the task's primary change
  request through a new `RunnerDeps.taskCodeHost`, then ask `<provider>:ci-settled` or
  `<provider>:review-received`. The plugin wires the dep to `ctx.core.tasks.changeRequests`.
- With no pull request, the run fails with "This task has no pull request, so there are no checks to
  read." With no policy, it fails with "The gitlab plugin is off or has no ci-settled policy, so there
  are no checks to read."
- `registerWorkflowTriggers` subscribes to `plugin:<id>:checks-changed` for each running code host. On
  `plugins:changed` it subscribes to new hosts and drops stopped ones.
- `plugins/workflows` no longer depends on `@acorn/plugin-github`.
- [Step kinds](../../workflows/step-kinds.md), [polling gates](../../workflows/polling-gates.md),
  [code hosts](../../plugins/code-hosts.md#workflow-ci), and
  [the node half](../../plugin-authoring/the-node-half.md) describe the neutral names.

Decisions and deviations:

- GitHub doesn't keep a mirror of the policy types. Once workflows stopped importing GitHub, GitHub can
  import the workflows contract directly, as the http and database plugins do. So
  `plugins/github/src/contract/workflowPolicies.ts` and its line in the mirror test are deleted, and
  `@acorn/plugin-github` depends on `@acorn/plugin-workflows`. This replaces change 5. The package graph
  cycle check in `tools/arch/boundaries.test.ts` fails if workflows imports GitHub again, which covers
  the boundary acceptance item.
- A loaded plugin gets `codeHosts()` with any project grant (`projects:read`, `projects:config`, or
  `projects:write`), not with no grant. A project's repository already names its code host, and
  `scopeCore` keeps its rule that a manifest with no grants gets nothing.
- Messages name the provider by plugin id, such as `gitlab`, not a display name. No display name is
  available at that point. "Off or has no policy" covers both cases, because a stored provider stays on
  a task after its plugin is turned off.
- `ci-loop` resolves the code host once when the step starts, as it resolved GitHub's policy before.
  `checks-green` and `review-received` resolve it on every poll.
- `review-received` declares no fields. Its settings, such as GitHub's `include_bots`, pass through to
  the code host's policy, which reads its own.
- `RunnerDeps.taskCodeHost` is optional, and a runner without it fails these steps closed. The runner
  integration test's `deps()` gains one line that puts the task on GitHub. Every assertion in the
  existing CI tests is unchanged.
- A code host that doesn't declare `checks-changed` refuses the subscription. The sweep catches that
  and leaves the host on the five-minute clock.

For later phases:

- A new code host files `CODE_HOST_POLICY.ciSettled` and `CODE_HOST_POLICY.reviewReceived` against
  `WORKFLOW_POLICY`, answers `ci-settled` with a `CiSettledValue`, and emits `checks-changed` with the
  verb in `emits`. It needs no workflows edit.
- GitHub's `ci-settled` policy still reads `task.pullNumber` through `mirroredTaskPull`.
- The fixture is `gitlab-test` in `apps/node/test/integration/plugins/workflowRunner.test.ts`.
- These were already red at the base commit and are untouched here: the `pluginDisable` and
  `routeRegistry` goldens in `apps/node`, knip's `proposalChanges`, and three `docPaths` entries for
  `dist` files.

Date: October 16, 2026. Status: proposed. Depends on [phase 1](./01-change-request-agent-context.md).

## Goal

A workflow that waits for CI, or loops an agent until CI passes, works on a GitLab or Bitbucket task
the way it works on a GitHub task. The workflows plugin stops importing the GitHub plugin.

## Starting point

- `plugins/workflows/src/server/steps/builtins.ts` imports `CI_SETTLED_POLICY`, the string
  `github:ci-settled`, from the GitHub plugin's `contract/workflowPolicies.ts`. The `checks-green`
  policy and `runCiLoop` both ask that one policy. With GitHub off, or on a GitLab task, they fail
  with "The GitHub plugin is off, so there are no checks to read."
- `plugins/workflows/package.json` depends on `@acorn/plugin-github` for that file.
- A code host can already file its own policies against the `workflows:policy` point, as GitHub does
  in `plugins/github/src/server/workflowPolicies.ts`. A GitLab plugin's would be `gitlab:ci-settled`
  and `gitlab:review-received`. A workflow file that names `github:review-received` still asks GitHub.
- `registerWorkflowTriggers` in `plugins/workflows/src/server/schedules/activation.ts` runs a trigger
  sweep early on `plugin:github:checks-changed`. Every other host waits for the five-minute clock.

## The design

A code host that supports CI files a policy with the id `ci-settled`, and one that supports reviews
files `review-received`. The host mints them as `<plugin>:ci-settled` and `<plugin>:review-received`.
That's a naming convention, written down in [step kinds](../../workflows/step-kinds.md), not a new
contract.

The workflows plugin resolves a provider-neutral name at evaluation time. It reads the task's primary
change request with `ctx.core.tasks.changeRequests(taskId)`, and asks `<provider>:ci-settled`. A task
with no primary, or a provider with no such policy, fails closed with a message that names the
provider: "GitLab has no CI policy, so there are no checks to read."

`CiSettledValue`, the shape the CI loop reads failures from, moves into the workflows plugin's own
contract. Each code host mirrors it, the same way `workflowPolicies.ts` in the GitHub plugin already
mirrors the policy shape to keep the package graph acyclic.

For the early wakeup, a code host emits `checks-changed`, the verb GitHub uses. The workflows plugin
subscribes to it for every plugin that declares a code host. That needs one read core doesn't offer
plugins: the ids of the running code hosts.

## Changes

1. Add `ctx.core.codeHosts()` to the node plugin context, returning the running code hosts' plugin
   ids, from `packages/node-core/src/server/pluginHost/codeHosts.ts`. Update the published surface
   snapshot.
2. Move `CiSettledValue` and the policy id convention into the workflows plugin's contract. Delete the
   import of the GitHub contract from `builtins.ts`, and the dependency from
   `plugins/workflows/package.json`.
3. Resolve `checks-green` and `runCiLoop` by the task's provider. Add `review-received` as a built-in
   name resolved the same way, beside the provider-qualified ids that workflow files use.
4. Subscribe the trigger sweep to `plugin:<id>:checks-changed` for each running code host, and follow
   a code host that starts or stops after the workflows plugin.
5. Have the GitHub plugin mirror `CiSettledValue` from the workflows contract, with the test that
   holds the mirror against the real type, as its policy shape has.
6. Update [step kinds](../../workflows/step-kinds.md) and
   [polling gates](../../workflows/polling-gates.md) to describe the neutral names.

## Out of scope

Provider-specific CI settings, such as which GitLab pipeline counts or which Bitbucket build statuses
are required. Each code host's policy reads its own form fields, as GitHub's does.

## Acceptance

- Every workflow test that uses `checks-green`, the CI loop, or `github:review-received` passes
  unchanged.
- A workflow on a `gitlab-test` task with a fixture `gitlab-test:ci-settled` policy waits, fails, and
  passes with the fixture's verdicts through `checks-green` and the CI loop.
- With no code host policy for the task's provider, both fail with a message naming the provider.
- `plugins/workflows` imports nothing from `plugins/github`. The boundaries test in
  `tools/arch/boundaries.test.ts` holds it.

## Risks

A workflow file saved with `github:review-received` on a task that moves to another host keeps asking
GitHub. That's correct, since the file named GitHub, but the run fails closed with GitHub's message.
The neutral name is what new workflow files should use.
