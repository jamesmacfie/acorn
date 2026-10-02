# Workstream 3: identity, time, and richer sources

Status: proposed, 2026-10-02, revised the same day. Depends on
[workstream 2](./02-source-first-editor.md). Read
[identity, scope, and time](./design.md#identity-scope-and-time) and
[what a good source provides](./design.md#what-a-good-source-provides) first.

## Goal

Panels know who "me" is in each account, state how far each query reaches, filter on relative and
calendar time, treat due dates as dates, and know what time range each source can vouch for. The
sources acorn already owns expose the facts the examples need, and facts that happen over time, such
as agent usage, are records of their own.

These contracts belong to the data-source format, so workflows gain them as well.

## Milestones

| Milestone | Parts of this workstream |
| --- | --- |
| 1 | Identity and `viewerMatch`, provider-computed viewer fields, reach with list scopes and `workspaceLinks`, the `now` and `calendar` context values, the GitHub pull request facts, and the mirror's team review requests. |
| 2 | Local branches, local worktrees, and the worktree fields on core tasks. |
| 3 | Usage records, the GitHub Actions runs and jobs source, and coverage and observation time. |
| By demand | Date-only precision on source fields with the Linear facts, the other new GitHub sources, activity events, the package manifest source, and saved SQL queries. |

## What the owner gets at the end

- **You** as a value on person fields, resolved per account, so "my pull requests" and "assigned to
  me" work without typing a login.
- Panels that say how far they reach: everything the account can see, the workspace's linked
  repositories or projects, or a chosen list.
- Filters such as "updated more than seven days ago", "due within four hours", and "since the start of
  last week".
- Due dates that read the same day in every time zone.
- Panels that say when part of a window isn't covered, instead of showing an empty result as a fact.
- GitHub pull requests with CI, approvals, requested reviewers and teams, last activity, labels, and
  GitHub's own merge readiness.
- AI usage and cost as records with their own time, model, and task, from which session totals follow.
- Worktree status, local branches and worktrees, new GitHub sources, richer Linear issues, and the
  events a task timeline needs, as people ask for them.

## Starting point

- GitHub's source in `plugins/github/src/shared/pullSource.ts` requires one `repository` and filters
  `author` by a literal login. `pullSearch` in `plugins/github/src/server/data/pullQuery.ts` builds a
  search query with one `repo:` qualifier.
- The GitHub mirror in `plugins/github/src/server/routes/mirror/prFetch.ts` fetches the checks rollup,
  commits, comments, and review requests, but asks for review requests only `... on User`.
- Linear's source in `plugins/linear/src/shared/issueSource.ts` requires one `project`.
- Core tasks in `packages/node-core/src/server/dataSources/coreTasks.ts` set `worktreeChanged` to
  `null` on every row.
- Agent sessions in `plugins/agents/src/shared/sessionSource.ts` carry no usage. The agents ledger
  records usage per turn, and the cost estimate lives in the client-only plugin at
  `plugins/agent-cost/src/tree/sessionCost.ts`.
- Query time windows resolve in `packages/protocol/src/data/queries/dataQueryTime.ts`.
- `DataBinding` addresses in `packages/protocol/src/data/values/dataBindings.ts` are `literal`,
  `input`, `step`, and `item`.
- Workspace links live in `workspace_external_projects`, described in
  [integrations](../../integrations.md#project-sources). GitHub repositories attach to projects
  through the project's repository facet instead.

## Requirements

### Identity

1. Sources may declare an `identity` operation that returns `{ id, login, name, email, teamIds,
   teams }` for the account, every member optional. Its schema lives in the data-source protocol.
2. The host caches identity answers per plugin and account, clears them on account changes, and never
   sends them to a plugin frame.
3. Fields may declare `viewerMatch`, a pointer into the identity answer. The editor offers **You**
   for such fields, and the describer writes "author is you (login)".
4. Add the `context` binding address with the `viewer` name. The host resolves it to a literal before
   the provider sees the query.
5. Provider-computed viewer fields, such as GitHub's "review requested from me, directly or through a
   team", are ordinary declared fields. The source checklist recommends them wherever the provider
   computes the relationship natively.

### Reach

6. Scope parameters may be lists with dynamic choices. The source editor and **Pick data** offer a
   multi-select for them.
7. Where a provider can search more widely, the scope parameter becomes optional, and the source
   describes that default reach in `consistency`.
8. Add the `workspaceLinks` context value. It resolves to the external IDs linked to the panel's
   workspace, and project when it has one, for the query's account, from `workspace_external_projects`
   and from project repository facets for GitHub.
9. The describer names the reach of every source in the plan: "every repository your Work account can
   see", "the 4 repositories linked to this workspace", or the chosen names. Authoring asks when a
   request could mean more than one reach, and "across my repositories" defaults to nothing narrower
   than the account's reach.
10. Every record key a source returns includes the scope that makes it unique, such as the repository
    for a GitHub pull request number, so workstream 5's relations can build composite keys.

### Time

11. Add the `now` and `calendar` context values with ISO 8601 offsets, resolved once per run at the
    evaluation instant under the plan's time policy, through the time-window code path.
12. Fields may declare `precision: 'day'`. Date-only values are `YYYY-MM-DD` strings. A context
    instant compared against one becomes the local date in the plan's zone.
13. The editor's filter stage offers relative and calendar values for datetime columns, and the
    describer writes them as "more than seven days ago" or "since the start of last week".

### Coverage and freshness

14. Source descriptions may declare coverage: `snapshot`, or `events` with retention, earliest time,
    and completeness. Reads may report the range they covered and, for mirrored data, when the
    provider was last observed.
15. The run labels any part of a filter's time window that falls outside coverage, marks summaries
    over an uncovered window as partial, and refuses to present an empty result as an absence when
    coverage doesn't include the window.
16. Placed panels show "as of" with the oldest observation time among their sources when it is older
    than the read.

### Authoring

17. The authoring context adds each account's identity answer, the workspace links, each source's
    supported reaches, and each source's coverage.
18. The evaluation suite adds cases for reach ambiguity and for each source this workstream adds, and
    moves the expected outcome of examples 1, 12, 13, and 18 from unavailable to covered as their parts
    land.

### GitHub

19. The pull request source gains:
    - An optional repository list, searching across the account's reach when it is absent.
    - Identity, with `viewerMatch` on author.
    - A team-aware `/viewer/reviewRequested` field.
    - Requested reviewers as a list of users and teams, and the time each request was made.
    - Review decision.
    - The checks rollup for the head commit, keeping pending, missing, failed, cancelled, skipped,
      and neutral distinct.
    - GitHub's merge state as a fixed-value field with tones, keeping unknown.
    - Labels as a list.
    - `lastActivityAt` from commits, comments, and reviews.
20. The mirror asks for team review requests as well as user requests.
21. An Actions workflow runs and jobs source, with attempts, start and finish times, duration,
    conclusion, and linked pull request. It declares itself an event source with coverage matching
    GitHub's retention, and supports incremental continuation if the API allows it.
22. By demand, further GitHub sources, each declaring identity, coverage, and starter plans:
    - Issues.
    - Deployments, with environment, outcome, and duration.
    - Milestones, with date-only due dates and open and closed issue counts.
    - Dependabot alerts and code scanning alerts.
    - Repositories, so a summary can include repositories with no open pull requests.

### Linear

23. By demand, the issue source gains:
    - An optional project list, with team-wide reach when it is absent.
    - Identity with `teamIds`, and `viewerMatch` on assignee.
    - Priority with ranks and tones, due date with day precision, estimate, cycle, team, and labels as
      a list.
    - Blocking and blocked-by relations as lists of issue identifiers and owners, with the time
      blocking began where Linear records it.
    - Equivalence declarations for GitHub issues that Linear's sync mirrors, kept separate from
      attached pull requests, which are related artifacts.

### Agent usage

24. A usage records source, one record per usage event, with the usage time, session, task, provider,
    model in use at that moment, input, output, cache-read, and cache-write tokens, and cost. Each
    record says how its cost was obtained: reported by the provider, estimated from a named price, or
    unknown. Cumulative counters become per-event deltas before they are exposed.
25. It is an event source whose coverage starts with the ledger, so a 30-day window is answered from
    the events inside it, and a session that spans the window boundary or changes model is counted
    correctly.
26. Session totals derive from usage records. The sessions source may expose them as a convenience,
    computed from the same records.
27. The cost policy moves to where the source can use it, and the `agent-cost` badge reads the same
    answer so the two never disagree. Where it lives is an open decision.

### Core and local sources

28. Core tasks fill `worktreeChanged` from the changes plugin, add modified and untracked counts and
    the worktree path, and keep `null` only where the Node hasn't inspected the worktree.
29. A local branches source per project: name, upstream, ahead and behind counts against the upstream
    and the default branch, last commit time, and observation time. It reads local references and
    never fetches unless the person asks.
30. A local worktrees source per project, covering worktrees acorn didn't create: path, branch or
    detached head, modified and untracked counts, last commit time, and the task where one exists.
31. By demand, a package manifest source that reads manifests and lockfiles per project, resolves
    versions per ecosystem, and classifies available updates.

### Activity events

32. By demand, event sources for task notes, session completions, commits on a task's branch, and task
    links, each with a stable event ID, actor, time, summary, and a reference to the artifact. A task
    timeline is then a combined plan over these sources, grouped by day.

### Saved SQL queries

33. By demand, saved SQL queries can become a source. The August design made three decisions that
    still hold. A panel names a project, and the Node resolves the database through the same layers
    against the project's main checkout, never a task. A repository-authored `url_script` never runs
    unattended without consent recorded per project, and a missing consent refuses with a reason the
    panel shows rather than prompting. Column types come from the driver's type IDs through a closed
    table, and enum, person, and link are never inferred. Under the data-source format, the saved
    query's columns are recorded when it is saved, and a later read that returns different columns is
    handled as a source change. The full reasoning is in git history at
    `docs/future/dashboards/project-database.md`, deleted 2026-10-02.

## Done when

Milestone 1: "Show all my pull requests across my repositories, with CI and approval status" covers
every requirement and describes its reach as every repository the account can see. A panel over
"pull requests where review is requested from me" includes team requests. A filter on "updated more
than seven days ago" moves with the clock.

Milestone 2: a worktree with uncommitted files shows its counts, and a local branch shows how far
ahead and behind it is.

Milestone 3: a usage panel over the last 30 days counts only usage inside the window, splits a session
that changed model, and leaves unknown prices unknown. A failed-jobs panel over a window older than the
source's coverage says the window isn't covered.

## Docs to update

- [Typed data sources](../../data-sources.md): identity, `viewerMatch`, reach and list scopes,
  context bindings, precision, scoped keys, and coverage.
- [Workflows](../../workflows.md): context bindings, which workflow queries gain too.
- [GitHub integration](../../github-integration.md) and [integrations](../../integrations.md): the new
  and enriched GitHub and Linear sources.
- [Managed agents](../../managed-agents.md): usage records and session totals.
- [Workspaces and tasks](../../workspaces-and-tasks.md): worktree fields and local Git sources.
- [Plugin authoring](../../plugin-authoring.md): the source checklist.

## Verify before building

- Whether identity belongs on the source or on the connection provider, given that two sources from
  one provider would otherwise answer the same question twice.
- How GitHub repository facets on projects relate to `workspace_external_projects`, and whether
  GitHub should declare a project source.
- GitHub GraphQL fields for team review requests, request timestamps, and the checks rollup on the
  head commit, and their rate costs at 1,000 search results.
- The Actions API's retention, pagination, and whether any incremental cursor exists.
- Linear GraphQL support for `isMe`, team membership, priority, due dates, and issue relations.
- Where the changes plugin computes worktree status, and its cost per worktree.
- How the agents ledger stores per-turn usage, whether counters are cumulative per provider, and how
  far back the ledger goes.
