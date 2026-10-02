# Workstream 2: the editor and the panel plan

Status: proposed, 2026-10-02, revised the same day. Depends on
[workstream 1](./01-trustworthy-results.md). Read [design.md](./design.md) first, especially
[the panel plan](./design.md#the-panel-plan), [when sources change](./design.md#when-sources-change),
[running a plan on the Node](./design.md#running-a-plan-on-the-node), [the editor](./design.md#the-editor),
and [authoring](./design.md#authoring).

## Goal

A person either picks the data first or describes what they want, then adjusts a short list of plain
stages and sees the real result as they go. Panels own their columns, keep their time policy, filter,
sort, and group the combined result, and survive source changes with diagnostics instead of silent
gaps. The Node runs every plan and plans its reads. The AI works from real accounts and a real
description of the panel format, says what it couldn't do, and is measured against requirements that
people wrote.

## Milestones

Milestone 1 takes everything here except two items. The independent requirements pass is measured
during milestone 1 and its default is decided before milestone 2. Projection support lands with
milestone 3, when report volumes make it matter. The stage runner is built generically in milestone 1
so workstream 5 adds operations without changing it.

## What the owner gets at the end

- **Add panel** offers two entrances: **Pick data**, one picker of source and account pairs such as
  "Linear issues · Acme" and "Linear issues · Personal", and **Describe it**, where the AI works out
  which sources could answer.
- Starter plans for the chosen source, one AI conversation per panel, and a plain list of stages that
  can be edited directly.
- Columns named by the person, shared across sources, with units, colours on fixed values, lists drawn
  as chips, and calendar dates that don't shift by time zone.
- A filter, sort, and grouping over the combined rows, with counts on group headers.
- A time zone and week start stored on the panel, so the screen and its history agree.
- Every view option back in the editor, including stat trends and chart axes.
- A live preview that is the real panel, with row counts after each stage.
- Panels that name a missing or changed source field and offer to rebind it.
- An AI proposal with a checklist to confirm, beside the host's own description of the plan.
- A panel refresh interval, and a Home tab that reads a shared query once instead of once per panel.

## Starting point

- `DashboardPanelContent` version 1 in `packages/protocol/src/dashboards/panels.ts`: up to eight
  queries, a five-role mapping, and `display` with view, fields, group, and limit.
- `packages/dashboards-core/src/typedProjection.ts` projects version 1 content. `shaping.ts` already
  filters, sorts, and limits. `mapping.ts` unions sources. `model.ts` still declares `extraFields` and
  panel-level filters and sorts that version 1 doesn't carry.
- `DashboardEditor.tsx` stacks a panel AI box above a list of query slots. Each slot is a
  `SourceQueryEditor`, which has its own collapsed AI box, a source picker, and an account select. The
  view select writes only `{ kind }`.
- `SourceQueryEditor.selectSource` picks the only account when exactly one exists, so a chosen source
  already reaches the AI's `base` with its account.
- The client and the sampler each run their own fetch loop:
  `PublishedDashboardPanel.tsx` and `packages/node-core/src/server/dashboards/sampler.ts`.
- `ProviderRequestScheduler` in `packages/node-core/src/server/integrations/budgetRuntime.ts` limits
  concurrency per provider and per account for resource reads.
- The authoring route in `packages/node-core/src/server/routes/authoring.ts` sends a one-sentence
  instruction per target. `packages/protocol/src/data/authoring.ts` allows two candidate attempts and
  has no reply kind for an unavailable request.

## Requirements

### The plan format

1. Add `PanelPlan` version 2 to the protocol, as sketched in
   [the panel plan](./design.md#the-panel-plan). In this workstream, sources are primary only and
   the only stage is `filter`. The validator refuses other operations until their workstream ships.
2. `packages/dashboards-core/src/plan.ts` (new) holds the pure pieces: binding records to columns, a
   stage runner driven by a registry of operations, the filter evaluator, sort, grouping with buckets
   under the plan's time policy, limit, the validator, and the describer.
3. `packages/dashboards-core/src/capabilities.ts` (new) lists the operations, view requirements, units,
   precisions, bucket kinds, and group orders. The editor, the validator, and the prompt builder read
   it, and nothing else defines those lists.
4. The validator returns path-addressed problems. It checks every column binding against the source's
   description, every column reference in later stages, type fit for each operator, sort, bucket, and
   view option, the stage-count bounds, and the eight-source and three-button caps.
5. The describer states what a row is, how far each source reaches, and each stage in plain language.
6. Declared source choices gain optional `tone` and `rank` in
   `packages/protocol/src/data/values/dataBindings.ts`. Columns inherit them unless the plan overrides
   them. Enum columns declare where unmatched values go.
7. Columns carry fixed units or per-row units bound to another column. The operation registry checks
   unit compatibility, so any operation that adds, compares, or aggregates numbers refuses mixed
   currencies unless the rows are grouped or filtered by the unit column, and converts durations to
   milliseconds first.
8. The plan stores its time policy: an IANA zone that defaults to the creator's device zone, `fixed`
   or `viewer` mode, and a week start. Runs and the sampler both use it.
9. Version 1 content reads through a pure upgrade, with a UTC fixed time policy, and new saves write
   version 2. If the owner decides on a reset instead, the reset follows the existing persistence rule
   and the upgrade is dropped. That decision blocks this requirement.
10. Placement metadata (`sources` and `fieldRoles` on a placed panel) derives from the plan, so region
    constraints keep working.

### When sources change

11. Every run validates bindings against the current description. A missing or retyped field makes
    its column unavailable for that run, the diagnostics name the column and the change, and the
    editor offers to rebind it.
12. New values in a fixed-value field go to the column's unmatched destination, and the panel lists
    them in a notice until the author maps them.
13. A changed source revision invalidates cached descriptions and runs.

### Running on the Node

14. Add the `run` operation to `/v1/core/dashboards/:operation` as described in
    [running a plan on the Node](./design.md#running-a-plan-on-the-node).
15. `PublishedDashboardPanel.tsx` renders runs and deletes its own fetch loop. The sampler calls the
    same function in process, under the plan's stored time policy.
16. The client caches runs by Node, scope, panel, revision, and time zone, and refetches on account and
    plugin changes the run reported, on focus, and on the plan's `refresh` interval.

### Planning the reads

17. A filter stage before any compute or summary, on a column bound to one source field, pushes down
    into that source's query when the source declares the operator and the semantics match. A field
    that can be unknown pushes down only for `missing`, `present`, and equality tests.
18. A final sort and limit become a source `take` only when no stage after the read changes which rows
    survive or their order. A source query with its own `take` followed by a panel filter draws a
    validator warning, and the describer states the order of the two.
19. Identical authorized reads share one in-flight read and its result for a short interval, keyed by
    principal, source, scope, account, resolved query digest, and evaluation window.
20. Source reads go through `ProviderRequestScheduler`, and rate-limit answers back off and surface as
    a named diagnostic.
21. The run enforces total records, total time, output bytes, and intermediate rows per stage, and
    names the budget when it stops.
22. Sources may accept a projection list on queries and send only the fields the plan reads. The host
    still projects. This lands with milestone 3.

### The editor

23. **Add panel** offers **Pick data** and **Describe it**. Both end in the same plan and stages.
24. **Pick data** lists each source paired with each usable account, named with the connection's name,
    plus saved queries. A source whose description requires a scope parameter asks for it on the same
    step, including its reach.
25. **Describe it** sends the request to the AI with the source list and the person's accounts. The AI
    explains which sources could answer, asks only where an account or reach is ambiguous, and
    proposes a plan. The proposed sources and accounts are shown, and nothing beyond metadata is read
    until the person accepts them.
26. Sources may return starter plans from `describe`. The editor shows them as cards after **Pick
    data**, each with the host's description. The validator checks every starter before it is shown.
27. The dashboard editor shows one AI conversation per panel. `SourceQueryEditor` gains a prop that
    hides its own AI box, and workflow step editing keeps it.
28. The plan shows as a list of stages in the host's words. Each opens into its form. **Add stage**
    offers only operations the columns at that point allow, and says why an unavailable one is
    unavailable.
29. The columns step shows one row per column and one binding cell per source. A new source offers to
    bind existing columns to its fields by role and type, and the person confirms each binding.
30. The view step offers every option the view supports, including `aggregate`, `field`, `shape`, `x`,
    `series`, `trend`, `compare`, and `good`.
31. The preview is a preview run drawn by the same view components as a placed panel. Each stage shows
    its output row count, and warnings sit beside the stage that caused them.
32. **Add another source** reopens **Pick data** for a second source and account.
33. Every control is reachable from the keyboard, and focus returns to the stage that opened a dialog
    when it closes. The editor uses only closed-kit components.

### Authoring

34. Each turn sends the context listed in [authoring](./design.md#authoring), minus the parts later
    workstreams add.
35. The dashboard system prompt is generated from the capability list, with one worked example per
    operation. A test parses every example against the plan schema.
36. A proposal carries the requirements list. The host checks that every covered or partial item
    points at existing plan parts of the claimed shape, and that no item covered in the previous plan
    disappears unless the instruction removes it. Failed checks go back to the model as a repair.
37. An independent pass lists the request's requirements without seeing the plan. Items the authored
    list doesn't match show as "not addressed". Measure what it catches during milestone 1, and decide
    whether it runs by default.
38. Add the `unavailable` reply kind, with a reason per missing capability or source.
39. Add a `list-accounts` metadata call that returns account IDs, providers, and names only. A
    candidate may use an account only if the person chose it, or if it is the person's only usable
    account for that source and the plan names it. The validator enforces that.
40. When a request could mean more than one reach, the AI asks, offering the reaches the source
    supports.
41. Raise the candidate attempt limit from two to three.
42. The plan stores the person's original request. The editor shows the requirements as a checklist to
    confirm, beside the preview, with the host's description of the plan above the model's summary.
43. A turn that ends without a valid candidate is logged with its problems, as the route does today.

### Evaluation and acceptance

44. Add an authoring evaluation suite with two layers. The first replays scripted model replies
    through the real loop, checks, and validator, and runs in the normal test suite. The second sends
    the prompts to a real model on demand and records the outcome per model.
45. Cases carry requirements and expected results annotated by people: the expected sources and reach,
    the required columns, filters, sorts, and stages, and the expected rows over fixture data. The
    model's own requirements list is never the reference.
46. Seed the suite with examples 1 to 5, 12, 13, and 18 from [examples.md](./examples.md), plus
    variants: different wording, two accounts for one provider, an ambiguous reach, a source the person
    hasn't added, and a request no source can answer.
47. A case fails when a required part is missing, an account is guessed, a reach is assumed without
    being stated, or a partial result has no partial or unavailable requirement.
48. Milestone 1 is also accepted against at least 20 unseen requests collected from people, judged as
    [acceptance](./design.md#acceptance) describes. Failures become evaluation cases.

## Done when

A person with two Linear accounts picks one by name, or describes a panel and is asked which account
they meant. A panel built from a starter plan, an AI proposal, or the stage forms is the same plan and
previews the same way. A combined GitHub and Linear panel shows a shared priority column and sorts
across both. A table groups by repository with counts. Every view option is editable. Removing a field
from a fixture source makes its column unavailable with a rebind offer. Six panels over one query on a
Home tab cause one read. Placed panels render runs from the Node, and the sampler's measure matches the
screen under the panel's time zone. With workstream 3's milestone 1 parts, "Show all my pull requests
across my repositories, with CI and approval status" covers every requirement. Without them, the
checklist marks the missing parts unavailable with reasons. The scripted evaluation layer passes in the
normal test suite.

## Docs to update

- [Dashboards](../../dashboards.md): the plan format, time policy, units, source changes, the run
  operation, read planning, the editor, refresh, and the version 1 upgrade or reset.
- [Typed data sources](../../data-sources.md): tones and ranks on choices, starter plans, and
  projection.
- [API reference](../../api-reference.md): the `run` operation and `list-accounts`.
- [Testing](../../testing.md) and [testing workflows](../../testing/workflows.md): the evaluation
  suite, the unseen-request acceptance, and the editor's manual checks.
- [Plugin authoring](../../plugin-authoring.md): starter plans and choice tones.

## Verify before building

- The current shape of `SourceQueryEditor` props and its AI box, which workflow step editing shares
  through `@acorn/plugin-api/ui/data-sources`.
- That the published plugin API surface snapshot in `tools/arch/publishedPluginSurface.snapshot.txt`
  covers any type this workstream exports, and that each export is a deliberate surface change.
- How placement regions read `publication.sources` and `fieldRoles`, so derived metadata matches.
- Whether source reads already go through `ProviderRequestScheduler`, or only resource reads do.
- The renderer budget. The August build gate was already over its script and style limits, and the
  editor is in the startup graph. Lazy-loading the dashboards surface may be needed first.
- That `parseDataPredicate` accepts item pointers built from column IDs, and how `compareDataValues`
  treats a missing operand, so the panel evaluator's wrapper matches the design.
