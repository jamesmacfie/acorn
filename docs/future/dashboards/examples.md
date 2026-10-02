# The 30 example panels

Status: assessment, 2026-10-02, revised the same day. Independent reviews checked these requests
against the code at `239cea789`, and their findings are merged here. This is the evidence for the
programme, not its scope: each example names the shared capabilities it needs, and those capabilities
serve far more requests than these. Acceptance also uses requests nobody has written yet. See
[acceptance](./design.md#acceptance).

## How to read the table

**Today** says how far the shipped system gets:

- _Partial_: a typed source exists and part of the panel can be built.
- _Related data_: acorn holds useful data, such as a mirror or a ledger, but no dashboard source
  exposes it.
- _No source_: no reader exists for the service.

None of the 30 works in full. **Needs** names the workstreams from [README.md](./README.md) and the
source work. Workstreams 1 and 2 apply to every row and aren't repeated.

## Code and delivery

| # | Panel | Today | Needs |
| --- | --- | --- | --- |
| 1 | All of my pull requests | Partial. One query per repository, up to eight, filtered by a login typed by hand, with state, draft, and updated date. | Workstream 3: identity, the account's full reach, and CI and approval states that keep pending, missing, failed, cancelled, and skipped distinct. Column tones from workstream 2. Milestone 1. |
| 2 | Pull requests waiting for my review | Related data. The GitHub mirror stores review requests, but only for users, not teams. | Workstream 3: a provider-computed "requested from me, directly or through a team" field, request time, and reason. Grouping and age display from workstream 2. |
| 3 | Pull requests ready to merge | Partial. `mergeStateStatus` is on each row but can't be filtered. | Workstream 3: GitHub's own readiness as a fixed-value field with "unknown" kept, plus required checks for the head commit. Workstream 2's filter and grouping. |
| 4 | Pull requests with no recent activity | Partial. Rows can be sorted by oldest update, but active ones can't be hidden. | Workstream 3: a last-activity time from commits, comments, and reviews, because `updatedAt` also moves on label edits. Workstream 3 also adds relative instants and requested reviewers as a list column. Boolean grouping comes from workstream 2. |
| 5 | Pull request summary by repository | Partial. | Workstream 5: a summary with overlapping count-where measures and oldest-open age, with drill-down from workstream 4. Repositories with no open pull requests need a repository source as the primary, with pull requests as children. Milestone 2. |
| 6 | Failed CI jobs | Related data. Job and log routes exist for the pull request view, not as a source. | Workstream 3: the Actions runs and jobs source, with attempts, failure time, duration, and linked pull request. Two-level grouping from workstream 2. |
| 7 | CI duration trends | No source. | Workstream 3's runs source, workstream 5's week buckets, median, 95th percentile, and previous-bucket change, and a workstream 6 event archive once eight weeks of runs exceed a single read, summarized in the Node's database. Milestone 3. |
| 8 | Flaky tests | No source. | Workstream 6: a workflow that parses test reports into one record per test run. Missing reports stay visible as missing coverage, never as passes. Workstream 5's repeated stages then find tests that passed and failed on one commit, in the panel. |
| 9 | Release checklist | No complete source. Milestones, checks, Linear issues, and an approval document have no shared release identity. | Workstream 5 relations on an explicit release identifier, or a workstream 6 dataset assembled by a workflow. |
| 10 | Deployment history | No source. | Workstream 3: a GitHub deployments source, plus provider plugins. Workstream 5 equivalence on an explicit attempt identifier, so one attempt reported by two systems counts once. Explicit group order from workstream 2. |
| 11 | Local branches needing attention | Related data. Git operations exist, but no branch source. | Workstream 3: a local branch source with upstream, ahead and behind counts, default branch, and observation time. A workstream 5 lookup of each branch's pull request, keeping branches with none. Milestone 2. |
| 12 | Worktrees and unfinished changes | Partial. Tasks show their branch, but `worktreeChanged` is always null. | Workstream 3: a worktree source covering managed and unmanaged worktrees, paths, detached heads, separate modified and untracked counts, and each worktree's task where it has one. Milestone 2. |
| 16 | Overdue milestones | No source. | Workstream 3: a milestones source with date-only due dates and open and closed issue counts. Relative instants. |
| 23 | Open security findings | No source. | Workstream 3: Dependabot and code scanning sources, ideally organization-wide through list scopes. A shared severity column across both from workstream 2. Owner and fix availability stay unknown where the provider doesn't say. |
| 24 | Dependency versions across projects | No source. | Workstream 3: a manifest and lockfile source on the Node with ecosystem-aware versions and registry metadata. The source classifies update type. Workstream 5 distinct lists. |

## Work tracking

| # | Panel | Today | Needs |
| --- | --- | --- | --- |
| 13 | My assigned work across trackers | Partial. Linear issues exist per project, without assignee, priority, or due date. | Workstream 3: a GitHub issues source, richer Linear fields, and identity per account. Workstream 2 columns across sources with a global sort. Workstream 5 equivalence for issues Linear's sync mirrors from GitHub, never for pull requests attached to an issue. |
| 14 | Blocked work and its dependencies | Partial. | Workstream 3: Linear relations as lists, blocker owners, due dates, and when blocking began. Decide whether the panel shows direct or transitive blockers. Jira needs a plugin. |
| 15 | Sprint workload by person | No source. | A Jira plugin with sprints and estimates. Workstream 5 pivot of points by status, a separate unestimated count, and a defined row for unassigned work. |
| 17 | Task activity timeline | Related data. Notes, sessions, commits, and task links exist in separate stores. | Workstream 3: event sources for notes, session completions, commits, and task links, each with stable event IDs, actors, and times. The timeline is then a combined plan grouped by day. |
| 18 | AI usage and cost by task | Related data. The agents ledger records usage per turn. | Workstream 3: a usage records source, one record per usage event with its own time, model, task, and cost provenance, so a 30-day window and a session that changed model count correctly. Workstream 5 summary by task and model, with partial sums marked. Milestone 3. |

## Operations

| # | Panel | Today | Needs |
| --- | --- | --- | --- |
| 19 | Service health | No source. | Uptime and metrics plugins with provider-declared health thresholds. Missing observations give unknown health. Ranked enum sort from workstream 2. |
| 20 | Recurring application errors | Partial through Rollbar, which isn't the requested Sentry or Coralogix. Rollbar gives lifetime totals only. | A Sentry or Coralogix reader. The acorn Sentry integration exports telemetry and reads nothing. Windowed counts and the previous-day comparison come from the provider. |
| 21 | Active incidents | No source. | A PagerDuty plugin with normalized severity and state, commander, and public-update time. Status-page links through workstream 5 relations. |
| 22 | Support tickets at risk of missing a response deadline | No source. | A Zendesk or Intercom plugin that computes the deadline under the response policy, including business hours and paused clocks. Workstream 3 relative instants for "overdue or due within four hours", with workstream 2's any-of filter. |

## Personal and business

| # | Panel | Today | Needs |
| --- | --- | --- | --- |
| 25 | Documents due for review | No source. | Notion and Drive plugins. Keep the review schedule as document properties where possible, or relate a schedule dataset by document identity in workstream 5. "Overdue or missing" uses workstream 2's any-of filter. |
| 26 | Messages awaiting my reply | No source. | Slack and Teams plugins, then a workstream 6 dataset filled by an agent that classifies direct questions with evidence and a correction field. "No reply" needs complete thread coverage. This one is also a product decision. |
| 27 | Email follow-up queue | No source. | Gmail and Outlook plugins. Gmail labels carry no follow-up date, so those rows land in the undated group. Relative date groups from workstream 2. |
| 28 | Calendar conflicts | No source. | Calendar plugins that expand recurring occurrences and provide normalized intervals, event identity, recurrence identity, and response states. The host merges duplicate invitations through a workstream 5 equivalence on event identity plus recurrence identity, because recurring occurrences share one `iCalUID`, then finds conflicts across providers with the overlap stage. |
| 29 | Cloud spending by service | No source. | Billing plugins that state currency, cost basis, freshness, and forecast method. Budgets come from the provider or a dataset related by provider, account, service, and period. Share of total and budget ratios from workstream 5's compute after a summary, with currencies never mixed. |
| 30 | Outstanding customer invoices | No source. | Stripe and accounting plugins. Workstream 5 equivalence on the scoped external invoice identifier with field precedence, so mirrored balances are never summed. Per-row currency from workstream 2, grouped before any total. |

## What each milestone unlocks

Milestone 1 delivers example 1 in full, and 2, 3, and 4 fall out of the same parts. Milestone 2
delivers 5, 11, and 12. Milestone 3 delivers 7 and 18. Milestone 4 delivers one example on a new
connector, chosen by demand, such as 15 on Jira or 21 on PagerDuty. The rest arrive in order of demand
on the parts the milestones built: 6, 13, 14, 16, 17, 23, and 24 need sources on providers acorn
already has, and 8, 9, 10, 25, 28, and 30 need equivalence, overlap, or datasets on top.

Twelve examples depend on services acorn has no reader for: 15, 19, 20, 21, 22, 25, 26, 27, 28,
29, 30, and the approval document in 9. Those integrations run as a parallel track on the seams this
programme builds. See [what a good source provides](./design.md#what-a-good-source-provides).

## One request, today and after

"Show all my pull requests across my repositories. Include CI status, whether each is a draft,
whether it is approved, and when it was last modified. Sort by last modified, newest first."

**Today.** The person types this into the AI box at the top of a new panel. The model lists sources
and finds GitHub pull requests. It asks to describe the source and gets `connection-required`,
because describing a provider source needs an account and no metadata call lists accounts. It can't
recover. If the person had first picked the source in the query editor below, the draft would carry
the account and the model could describe the source. It would then need the person's GitHub login,
which nothing provides, and one repository, because the source requires one. It would find no CI or
approval fields, and the most likely outcome is a valid panel without them, sorted per query, with a
summary that doesn't mention what is missing.

**With workstream 2 alone.** Through **Describe it**, the model sees one GitHub account and proposes it,
named in the plan. It proposes columns for title, repository, number, state, draft, and updated, and a
descending sort on updated. Its requirements list marks "my", "across my repositories", "CI status",
and "approved" as unavailable, each with the reason, and the host's description says "one row per pull
request in one repository". The person sees exactly what the panel does and doesn't do.

**After milestone 1.** The model binds author to **You** through the account's identity and leaves the
repository list empty, so the panel reaches every repository the account can see. "Across my
repositories" means the person's repositories in general, not only the ones linked to this workspace,
and the host's description says so: "one row per pull request you authored, in every repository your
Work account can see". It adds CI and approval columns whose values keep pending, missing, and failed
distinct. Pressing a row opens the pull request in a side panel. Every requirement is covered, the host
has checked each pointer, and the evaluation suite compares the plan against requirements a person
annotated for this request.

## Provider details that shaped the design

- GitHub merge readiness depends on branch rules, the head commit, and which check conclusions count,
  including skipped and neutral. "Approved and green" is not a universal rule.
  [GitHub's required status checks troubleshooting](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)
  covers the details. This is why provider meaning lives in adapters.
- GitHub's `review-requested:@me` includes team requests and `user-review-requested:@me` doesn't, so
  "requested from me" is one qualifier for the provider and a chain of joins anywhere else.
- Google Calendar recurring occurrences share an `iCalUID`, per the
  [Google Calendar event reference](https://developers.google.com/workspace/calendar/api/v3/reference/events),
  so equivalence on that value alone would merge distinct meetings. And no single calendar adapter can
  see conflicts with another provider's meetings, which is why overlap is a host operation.
- Support response deadlines depend on business hours and paused clocks, so the last message time
  can't stand in for them.
- An invoice mirrored in billing and accounting must count once, which is why merging needs an explicit
  equivalence and field precedence.
- A pull request that implements a Linear issue is a related artifact, and one issue can have several.
  Treating that link as "the same item" would merge rows that should stay apart.
