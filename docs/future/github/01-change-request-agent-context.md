# Phase 1: ask the task's code host for agent context

## Completion note

October 16, 2026. Done.

What landed:

- `codeHost.changeRequest.api` in `packages/protocol/src/plugin/contract.ts`, with the shapes
  `changeRequestDetail`, `changeRequestChecks`, `changeRequestFeedback`, `changeRequestCreateInput`,
  and `changeRequestCreated` beside it. The manifest schema is regenerated, and
  [code hosts](../../plugins/code-hosts.md#agent-context) documents the routes.
- Core's helper, `primaryChangeRequestHost`, `askChangeRequestHost`, and `readChangeRequest`, in
  `packages/node-core/src/server/core/changeRequests.ts`.
- Core owns the `pr` section (`changeRequestSection` in `contextSections.ts`) and the tools `pr_checks`,
  `pr_review_comments`, and the new `pr_create` (`coreTools.ts`). `pr_current` and `pr_changed_files`
  are unchanged and read the section.
- GitHub serves the four routes from its mirror under `/v1/p/github/change-requests`
  (`plugins/github/src/server/routes/changeRequests.ts`), sets `api`, and no longer registers the `pr`
  section or the two read tools. It keeps `github_pull_create`, unchanged, as the older name for
  `pr_create`.
- `TaskContext.task.changeRequest` and the `task` a compiled section's `assemble` receives carry
  `{ provider, number }` of the primary. `pullNumber` stays.
- The launch lead-in reads "This session is for the following pull request:", or merge request, from
  the section's label.
- A `gitlab-test` fixture with the four routes, in
  `packages/node-core/src/server/agentTools/changeRequestTools.test.ts`.

Decisions and deviations:

- `api` is a full plugin route, such as `/v1/p/github/change-requests`, not a bare `/change-requests`.
  Every other route a manifest declares, `browserPanel.route` included, is full, and the manifest
  check confines it to the plugin's namespace the same way.
- The helper lives in `core/changeRequests.ts`, beside `primaryChangeRequest`, not in `codeHosts.ts`.
  It needs the primary lookup, and `changeRequests.ts` already imports `codeHosts.ts`.
- Each GET carries `taskId` as a query parameter, and the POST carries it in the body, as task checks
  do. The plugin resolves its own repository from the task and checks it with `mayActOnTask`.
- The reads run as the task. The POST runs as the Node's service principal, not the task's, because a
  task principal can't spend a provider credential. That's the rule the data source tools follow.
- Reads wait 5 seconds and `pr_create` 30. A timeout, a non-2xx, or an answer that doesn't parse is no
  answer.
- The section registers in `wireAgentTools`, with the tools, because it needs the env to dispatch.
  Both Node entries call it through `bootNode`.
- The section's label is per task: the declared `label` with a capital, `Pull request` when the task has
  no primary. The compact heading stays `## PR …` and the item `kind` stays `PR` on every host, so a
  GitHub task's text is unchanged byte for byte.
- `pr_changed_files` still answers `[]` with no primary, not `no-pr`, so its return type doesn't change.
  `pr_current`, `pr_checks`, and `pr_review_comments` answer `no-pr`. With a primary that isn't
  mirrored, the last two still answer `no-mirrored-checks` and `no-mirrored-pr`, now with hints that
  don't name GitHub.
- `pr_create` answers `{ number, relationship }`. `github_pull_create` keeps its `pull` field.
- The GitHub read-tool tests moved, assertions intact, to the route tests. The composition test,
  `apps/node/test/integration/taskContext.test.ts`, calls `pr_checks` and `pr_review_comments`
  through core and GitHub's real routes.
- `taskChecks` and `taskReviewFeedback` in the GitHub mirror reads take a resolved pull, and
  `mirroredTaskPull` takes an optional number. The CI policy's one call changed to match.

For later phases:

- Phase 2 can reuse `primaryChangeRequestHost` and `readChangeRequest` to ask a task's code host for its
  checks. GitHub's `ci-settled` policy still reads `mirroredTaskPull` from `task.pullNumber`.
- A new code host sets `changeRequest.api` and serves the four routes. It needs no core edit. Its
  routes should 404 when they have nothing for that change request.
- Already red at the base commit and untouched here: the `pluginDisable` and `routeRegistry` goldens in
  `apps/node` (the `browser-panel` and agents MCP server routes), knip's `proposalChanges`, and three
  `docPaths` entries for `dist` files.

Date: October 16, 2026. Status: proposed.

## Goal

An agent on a GitLab or Bitbucket task gets the same context and task tools as an agent on a GitHub
task: the change request's title, body, and changed files, its CI checks, and what reviewers said. Core
asks whichever code host owns the task's primary change request. No tool or section names GitHub.

## Starting point

- `pr_current` and `pr_changed_files` in `packages/node-core/src/server/agentTools/coreTools.ts` read
  the context section with id `pr`. The GitHub plugin registers that section in
  its `contextSection.ts`. The registry in
  `packages/node-core/src/server/agentTools/contextSections.ts` refuses a second `pr`, so a GitLab
  plugin must pick another id, and the two core tools never see it.
- A section's `assemble` gets `task.pullNumber`, set in `contextSections.ts` from the task row. Core
  copies the primary's number into that column only on github.com, so a GitLab section sees null.
- `pr_checks` and `pr_review_comments` are the GitHub plugin's tools, in
  `plugins/github/src/server/agentTools.ts`. `github_pull_create` opens a pull request and attaches it
  with `attachChangeRequest`.
- `plugins/context/src/shared/contextBlock.ts` introduces the `pr` section with "This session is for
  the following GitHub pull request:".

## The design

The code host declaration gains one field, `changeRequest.api`, a path under the plugin's own
namespace, such as `/change-requests`. A plugin that sets it serves four routes there:

| Route | Answers |
| --- | --- |
| `GET {api}/{number}` | Number, title, body, and changed file paths |
| `GET {api}/{number}/checks` | Each check's name, status, and URL, with the failing and pending names |
| `GET {api}/{number}/feedback` | Reviews, inline threads, and conversation comments. `?includeResolved=true` adds resolved threads |
| `POST {api}` | Opens a change request from the task's branch and returns its number |

The response shapes live in protocol, so a compiled and a loaded plugin answer the same thing. The
GitHub plugin's mirror reads already produce them: `mirroredPullRequest`, `taskChecks`, and
`taskReviewFeedback`.

Routes, rather than a function registered at init, work the same way for a compiled and a loaded
plugin. A loaded plugin's code runs in a worker, and core already calls its routes for browser
handoffs. Core calls these routes with the task's principal, so the plugin's provider access check
applies as it does to a person.

Core owns the `pr` section and the four tools. Each one looks up the task's primary change request,
finds the running plugin that declared its provider, and calls the route. No primary, or a provider
with no `api`, gives the answer `pr_current` already gives: `no-pr` with a hint.

The tool names stay. See [the README](./README.md#decisions-this-programme-takes) for why.

## Changes

1. Add `changeRequest.api` to the code host descriptor in
   `packages/protocol/src/plugin/contract.ts`, and the four response schemas beside it. Update the
   manifest schema and [code hosts](../../plugins/code-hosts.md).
2. Add a core helper that turns a task id into its primary change request and a call to the owning
   plugin's route. Put it beside `changeRequestDeclaration` in
   `packages/node-core/src/server/pluginHost/codeHosts.ts`.
3. Register the `pr` section in core's `contextSections.ts`, built on the helper. Its label is the
   declared `changeRequest.label`, and its item label uses the declared `prefix`, so a merge request
   reads `!12 Fix the importer`.
4. Move `pr_checks` and `pr_review_comments` into `coreTools.ts` on the helper. Add `pr_create`, which
   calls `POST {api}` and attaches the result with the agent's session, as `github_pull_create` does.
5. In the GitHub plugin, serve the four routes from its mirror, set `api` in its `codeHost`, and drop
   its `pr` section and its two tools. Keep `github_pull_create` as a second name for `pr_create`
   until the next plugin API major, because saved prompts name it.
6. Add `changeRequest: { provider, number } | null` to the task a section's `assemble` receives and to
   `TaskContext.task`. Keep `pullNumber` beside it for the next major's removal list.
7. Change the lead-in in `contextBlock.ts` to use the section's label: "This session is for the
   following merge request:".
8. Give the `gitlab-test` fixture the four routes, answering from fixed data.

## Out of scope

The GitHub-specific tools that have no counterpart on the other hosts stay GitHub's. Code host
specific write tools, such as resolving a thread or merging, wait until a second host needs them.

## Acceptance

- Every GitHub tool and the `pr` section return what they returned before, field for field. The GitHub
  plugin's tool tests run against the core tools unchanged.
- A `gitlab-test` task with primary change request `!12` gets its title, files, checks, and feedback
  from `pr_current`, `pr_changed_files`, `pr_checks`, and `pr_review_comments`, with no core edit
  beyond this phase.
- A task with no primary change request gets `no-pr` from each tool, as `pr_current` does.
- The published plugin surface snapshot only gains lines.

## Risks

Each tool call adds a route dispatch. The routes read a local mirror, so the cost is a function call
and a JSON round trip, not a network request. If a loaded code host is slow, the context assembly
waits on it, so give the call a deadline and treat a timeout as no answer.
