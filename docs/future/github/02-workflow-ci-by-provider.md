# Phase 2: ask the task's code host for workflow CI

Date: October 16, 2026. Status: proposed. Depends on [phase 1](./01-change-request-agent-context.md).

## Goal

A workflow that waits for CI, or loops an agent until CI passes, works on a GitLab or Bitbucket task
the way it works on a GitHub task. The workflows plugin stops importing the GitHub plugin.

## Starting point

- `plugins/workflows/src/server/steps/builtins.ts` imports `CI_SETTLED_POLICY`, the string
  `github:ci-settled`, from `plugins/github/src/contract/workflowPolicies.ts`. The `checks-green`
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
