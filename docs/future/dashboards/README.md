# Dashboards: panels that answer real questions

Status: proposed, 2026-10-02, revised the same day after a third review. Workstream 1 is complete as of
2026-10-03, and nothing else in this programme is built. It replaces the August 2026 backlog that lived here: the redesign verification pass,
`project-database.md`, `dynamic-collections.md`, and the old `write-back.md`. Git history keeps them,
and their surviving decisions are carried into the files below. [Dashboards](../../dashboards.md) and
[typed data sources](../../data-sources.md) own shipped behaviour and win over anything here until a
workstream changes them.

## What this is

Thirty example panels, written as the requests people would type, were checked against the shipped
system on 2026-10-02 by independent reviews. None works in full and six work in part. The gaps repeat
across examples. A panel that combines sources can show only five shared fields. Nothing sorts or
groups the combined result, summarizes it, or relates one source to another. Panels don't know who
"me" is or what time it is, and each row does whatever its source chose. The AI author can't learn
which account to use, never sees the panel format, and can return a valid panel that quietly drops
half the request.

This programme widens the system in shared pieces rather than per example. The examples prove the
design. They aren't its scope, and acceptance includes requests nobody has written yet.

One rule holds the programme together. A panel is one plan built from a closed set of operations, and
every operation ships with four parts at once: a form in the editor, a plain-language description the
host writes, a validator, and evaluation cases for the AI. Stages can repeat within bounds, so ordinary
multi-stage analysis fits in a panel. The system grows by adding operations that carry all four parts,
which is how the editor and the AI stay able to use everything it can do. It does not grow through a
formula language or SQL inside panels.

## Read this programme

| File | What it covers |
| --- | --- |
| [design.md](./design.md) | The problem, the boundaries that stay, the principles, the panel plan and its row model, units and time, schema changes, running plans on the Node, identity and reach, composition, navigation, datasets, the editor, authoring, acceptance, the source checklist, and open decisions. |
| [examples.md](./examples.md) | The 30 example panels, what each needs, and how one request goes today and after. |
| [refused.md](./refused.md) | What this programme decided not to build, and when to revisit it. |
| [01-trustworthy-results.md](./01-trustworthy-results.md) | Workstream 1. Fix the bugs that make results untrustworthy, and check what shipped before workflow v2. |
| [02-source-first-editor.md](./02-source-first-editor.md) | Workstream 2. The panel plan, runs on the Node with read planning, the editor's two entrances, and authoring. |
| [03-identity-time-and-sources.md](./03-identity-time-and-sources.md) | Workstream 3. Identity, reach, relative and calendar time, coverage, and richer sources, including usage records. |
| [04-row-actions-and-navigation.md](./04-row-actions-and-navigation.md) | Workstream 4. Row presses, buttons, actions run on the Node, plugin targets, and drill-down. |
| [05-composition-and-analysis.md](./05-composition-and-analysis.md) | Workstream 5. The row model, relations and equivalence, repeated stages, summaries, and overlap. |
| [06-datasets-and-history.md](./06-datasets-and-history.md) | Workstream 6. Datasets with storage modes and two kinds of coverage, filled by schedules, workflows, and agents. |
| [07-write-back.md](./07-write-back.md) | Workstream 7. Board drag that changes provider values. Gated. |

## Workstreams and milestones

The seven phase files are workstreams. Each owns one area and keeps its own requirements. Delivery
happens in milestones that cut across them, so the first excellent panel arrives early instead of after
two whole workstreams finish. Each phase file has a **Milestones** section saying which of its parts
land when.

| Milestone | What people get | What it proves |
| --- | --- | --- |
| 1 | "My pull requests", done properly: every pull request you authored across every repository your account can see, with real CI and approval states, draft, and last activity, sorted, optionally grouped by repository, and opening each one where you choose. Built by picking the source or by describing it. | Workstream 1 in full. The plan's core, runs on the Node, both editor entrances, authoring with the requirements check, and the evaluation suite. Identity, reach, relative time, and the GitHub pull request facts. Basic row presses. |
| 2 | Summaries and local work: open pull requests summarized by repository with drill-down, local branches with their pull requests, and worktrees with uncommitted changes. | The row model, lookup relations, compute and summary stages, drill-down, and the local Git sources. |
| 3 | Cost and trends over time: AI usage and estimated cost by task and model over 30 days, and CI duration trends over eight weeks with percentiles. | Usage records, the Actions runs source, repeated stages, time buckets, event-archive datasets with coverage, aggregation at the data, and time semantics shared with history. |
| 4 | A real requested panel on a new connector. | The plugin contracts work outside the providers acorn already owns. Gaps it finds feed the roadmap. |

After milestone 2, the remaining parts ship in order of demand: equivalence and duplicate removal,
overlap, snapshot history, named actions and buttons, targets without URLs, activity sources, richer
Linear and new GitHub sources, terminal panels after the row menu, and write-back behind its gate.

Every milestone is accepted against the examples it targets and against unseen requests, judged on the
output, refinement, creation effort, refresh latency, and how understandable its failures are. See
[acceptance](./design.md#acceptance).

## Integrations as a parallel track

The dashboard workstreams build no third-party integrations. Twelve examples depend on services acorn
has no reader for: Jira, uptime and metrics services, Sentry or Coralogix errors, PagerDuty, Zendesk or
Intercom, Notion or Drive, Slack or Teams, Gmail or Outlook, calendars, cloud billing, Stripe, and an
approval document store. Each is a loaded plugin following
[what a good source provides](./design.md#what-a-good-source-provides).

Integrations run as their own track beside the workstreams, not after them. The track starts once
milestone 1 has shipped identity, list scopes, choice tones, and starter plans, picks the most-requested
connector, and delivers it as milestone 4. A real connector finds gaps that fixtures miss.

## The terminal client

The terminal client draws no dashboards. A `pane.aside` placement prints one muted line naming the
point. Runs return rows, columns, groups, and diagnostics, and stage descriptions are text, so a
terminal panel becomes a table with group headers and a keyboard row menu. That work should follow the
row menu. See [the terminal client](./design.md#the-terminal-client).

## Terms

| Term | Meaning |
| --- | --- |
| _Source_ | A typed data source registered on the Node by core or a plugin. |
| _Account_ | One connection to a provider. The editor says account. The code says connection. |
| _Panel plan_ | A panel's published definition: its sources, relations, columns, stages, presentation, and actions. Version 2 of `DashboardPanelContent`. |
| _Row model_ | What one row of a panel represents: primary sources supply rows, lookups attach columns, children attach lists, and equivalences merge rows. |
| _Column_ | A panel-owned output field with an ID, label, type, and one binding per source. Every later operation refers to columns, never to source fields. |
| _Stage_ | One step in a plan's bounded, linear list: filter, compute, summarize, expand, or overlap. Stages can repeat. |
| _Operation_ | Any stage or relation kind. Each has a form, a description, a validator, and evaluation cases. |
| _Reach_ | How far a source query looks: everything the account can see, the workspace's links, or an explicit list. |
| _Run_ | One execution of a plan on the Node, at one evaluation instant under the plan's time policy. |
| _Coverage_ | The time range a source or dataset can vouch for. Datasets track capture coverage and event coverage separately. |
| _Relation_ | A declared link between records of two sources, with a kind and a cardinality the run checks. Only an equivalence merges rows. |
| _Dataset_ | A Node table with a storage mode, filled by a schedule, workflow, or agent, and served as a source. |
| _Requirements list_ | The AI's account of each requirement it read in a request and which plan parts cover it. Evidence, not proof. |
| _Starter plan_ | A plan a source suggests, which the person can copy into their own panel. |

## Docs that change

Each workstream names the owning documents it updates. Across the programme:

- [Dashboards](../../dashboards.md) is rewritten section by section: the plan, runs, the editor,
  actions, composition, and datasets.
- [Typed data sources](../../data-sources.md) gains choice tones and ranks, starter plans, projection,
  identity, list scopes, context bindings, precision, coverage, relations and equivalences, named
  actions, targets, and writable fields.
- [Workflows](../../workflows.md), [schedules](../../schedules.md), and
  [agent tools](../../agent-tools.md) gain context bindings, the dataset capture target, the dataset
  write step, and the dataset write tool.
- [API reference](../../api-reference.md), [security](../../security.md), and
  [data layer](../../data-layer.md) cover the new routes, actions run on the Node, datasets at rest,
  and write confinement.
- [Plugin authoring](../../plugin-authoring.md) and [plugins](../../plugins.md) gain the source
  checklist and targets.
- [GitHub integration](../../github-integration.md), [integrations](../../integrations.md),
  [managed agents](../../managed-agents.md), and [workspaces and tasks](../../workspaces-and-tasks.md)
  cover the enriched and new sources.
- [Testing](../../testing.md) and [testing workflows](../../testing/workflows.md) carry the authoring
  evaluation suite, the unseen-request acceptance, and the manual checks.
- [What a plugin loses in the terminal](../../tui/plugin-losses.md) changes when the terminal draws
  panels.

## Verify before building

Every workstream ends with its own list. Before any milestone, recheck [dashboards](../../dashboards.md),
[typed data sources](../../data-sources.md), and each workstream's starting point against the code, because
the paths here are hints and the shipped contracts win. Do not describe a proposal in this folder as
shipped behaviour in an owning document until it lands.
