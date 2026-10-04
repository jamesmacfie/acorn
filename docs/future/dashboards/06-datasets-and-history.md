> **Completed 2026-10-04** by the "Phase 06 datasets and history" task.
>
> **What landed:** Core SQLite datasets now support current mirror, event archive, and snapshot history storage with versions, caps, retention, captures, explicit event coverage, and scoped source discovery. Device-approved capture schedules, task-scoped workflow and evidence-backed agent writes, durable human corrections, the Keep history editor flow, Settings → Datasets, authoring context and evaluation cases, and SQLite summaries with bounded drill-down are wired through the Node and client.
>
> **Deviations:** The Phase 03 GitHub Actions source did not land, so capture and continuation were verified with fixture sources; live provider acceptance remains open. Stat measure history stays in its existing table and compactor to preserve stored trends; datasets default to 90 days, 500,000 rows, and 512 MB. The Node cold-start budget rose by 28 KB after dataset work was moved behind request and schedule boundaries.
>
> **For later phases:** Dataset storage, capture, source, and SQL summary seams live in `packages/node-core/src/server/datasets/`; `dataset_write` and `write-dataset` require a project-owned dataset at its current version. Corrections count against the byte cap and persist until dataset deletion. A provider must declare event coverage or incremental boundaries before a successful capture can prove event completeness. The 200,000-row SQLite percentile check passed; the desktop Datasets page rendered, while the real-app source picker did not open through the driver, so Keep history interaction and human annotation remain unverified. Bucketed stored-summary drill-down is bounded and read-only; Add as panel awaits an exact time-range plan.

# Workstream 6: datasets and history

Status: proposed, 2026-10-02, revised the same day. Depends on
[workstream 2](./02-source-first-editor.md), and on [workstream 5](./05-composition-and-analysis.md)
for analysis over datasets. Read [datasets](./design.md#datasets) first.

## Goal

Some answers need data no single read can give: eight weeks of CI runs, how open issues changed day by
day, test results parsed from artifacts, a release checklist assembled from three systems, or messages
a model has judged to be direct questions. A dataset is a Node table that a schedule, a workflow, or an
agent fills, served to panels as an ordinary source. Each dataset has a storage mode that decides which
questions it can answer, and it tracks what it can vouch for separately from when captures ran.

## Milestones

| Milestone | Parts of this workstream |
| --- | --- |
| 3 | Event archive datasets filled by capture schedules, capture and event coverage, aggregation at the data, schema versions, and the Datasets page. |
| By demand | Current mirror and snapshot history modes, the workflow step, the agent tool, and folding measure history into datasets. |

## What the owner gets at the end

- **Keep history** on a query, which asks what to keep and says what the result can answer: "keeps
  every run seen since 2 October", "shows how open issues changed day by day from 2 October", or "keeps
  the latest state of each issue".
- Panels over datasets that look back further than the provider remembers, and summarize hundreds of
  thousands of stored records without loading them all.
- Panels that say where a dataset can vouch for every event, where captures failed, and where events
  may be missing.
- A workflow step that writes rows into a dataset, so a scheduled workflow can maintain a release
  checklist or a flaky-test report.
- An agent tool that writes rows with evidence attached, for judgements such as "this message asks me
  a direct question", with a correction the person can make.
- A Datasets page under Settings that lists each dataset's mode, feeder, size, retention, and coverage,
  and deletes a dataset.

## Starting point

- [Schedules](../../schedules.md) runs `core:sample-measures` hourly and compacts history daily.
- `packages/node-core/src/server/dashboards/history.ts` stores one number per panel per hour, keyed by
  a signature that workstream 1 makes complete.
- Workflows declare named outputs and contributed step kinds ([workflows](../../workflows.md)).
- Data sources support discovery, so a core source can list datasets as they are created.
- Sources may declare incremental continuation with an opaque boundary, described in
  [typed data sources](../../data-sources.md#incremental-continuation). No first-party source declares
  it yet.

## Requirements

### Storage modes

1. Datasets live in the core SQLite migration chain. A definition holds a name, its workspace and
   optional project, a versioned structural schema and fields in the data-source format, its identity
   fields, its storage mode, its feeder, retention, and caps.
2. **Current mirror** upserts by record identity. After a capture that read its source completely,
   records the source no longer returns are marked removed, with the time. An incomplete capture never
   marks anything removed.
3. **Event archive** keeps every event by its stable identity and its event time, and never overwrites
   an event with a different event time. It accepts events older than the latest capture and records
   when each one arrived.
4. **Snapshot history** keeps one observation per record per capture, keyed by record identity and
   observation time, so a panel can ask what a record looked like on a given day.
5. The mode is chosen when the dataset is created and can't change. A different mode is a new dataset.

### Coverage

6. Capture coverage records every capture: when it ran, whether its read was complete, and why it
   failed if it did.
7. Event coverage records the windows in which the dataset can vouch that it holds every event. A
   successful capture extends event coverage only when the source's own coverage and the read's
   completeness prove it. Successful daily captures alone don't.
8. Event archives declare a backfill boundary: the earliest time from which they claim completeness.
   Where the source declares incremental continuation, captures use it as a checkpoint so no events
   fall between captures. Where it doesn't, the dataset's event coverage says so.
9. Gaps are explicit records, not absences, and a panel over a window that includes a gap marks its
   answer partial with the gap's reason.

### Feeders

10. **Capture.** A schedule target runs a source query at a cadence the owner approves, under the
    Node's service principal with the same confinement checks every scheduled run uses, and writes
    according to the dataset's mode.
11. **Workflow step.** A contributed workflow step kind writes rows from a step's output, validated
    against the dataset's current schema version.
12. **Agent tool.** A core-owned agent tool writes rows with an evidence field and a reason. Rows
    written this way carry a correction field that the person can set from the panel, and corrections
    survive later writes for the same identity.

### Serving and execution

13. A core source discovers datasets in the caller's scope and serves each one with its schema,
    fields, mode, coverage, and the standard query operators on every field.
14. A summarize stage over a dataset, with any filters before it, runs as a query in the Node's
    database, returning only the summary rows. The same plan over a provider source runs in memory.
    Both paths produce the same result for the same rows, and a test holds them together.
15. Coverage labels and partial measures from workstreams 3 and 5 apply to dataset panels.

### Schema versions

16. A feeder whose output no longer matches the dataset's schema fails visibly, and the failure is a
    gap. Changing the schema creates a new version. Panels bound to a field the new version drops
    become unavailable with a rebind offer, as workstream 2 requires for sources.

### History

17. Decide whether measure history becomes a snapshot-history dataset of one number per bucket, or
    stays as its own table beside datasets. Either way, stat trends keep their behaviour and their
    stored series.

### Security

18. Creating a dataset or approving a capture schedule needs a device principal. Datasets are never
    reachable from plugin frames.
19. Datasets hold provider data at rest. They are scoped to a workspace, deleted with it, capped in
    size, and listed with their mode, feeder, and retention so the owner can see what is kept.
20. An agent-written row can't change a dataset's schema or write to another dataset.

### Editor and AI

21. **Keep history** asks for the mode in plain words and states what the dataset will be able to
    answer before it is created. The dataset then appears as a source in **Pick data**.
22. The authoring context lists datasets in scope with their mode and coverage, and the AI proposes a
    dataset only when a request needs history the sources can't provide. The evaluation suite adds
    examples 7, 8, 9, and 26.

## Done when

Milestone 3: a daily capture of GitHub Actions runs into an event archive keeps runs after GitHub stops
returning them. A weekly percentile panel over 200,000 stored runs returns in the Node without loading
every run, and says where event coverage starts and where a failed capture left a gap.

By demand: a snapshot-history dataset of open issues answers how many were open on each day, and a
closed issue stops counting from the day it closed. A scheduled workflow writes a release checklist
into a dataset that a panel reads. An agent writes message rows with evidence, a person corrects one,
and the correction survives the next run. Deleting a workspace deletes its datasets.

## Docs to update

- [Dashboards](../../dashboards.md): datasets as sources, storage modes, **Keep history**, and coverage
  labels.
- [Schedules](../../schedules.md): the capture target and compaction.
- [Workflows](../../workflows.md): the dataset write step.
- [Agent tools](../../agent-tools.md): the dataset write tool.
- [Security](../../security.md): data at rest, scope, and deletion.
- [Data layer](../../data-layer.md): the dataset tables.

## Verify before building

- How schedule targets declare consent and cadence today, so capture follows the same approval path.
- Which first-party sources can declare incremental continuation, starting with the Actions runs
  source.
- Whether the history table's compaction and orphan sweep can extend to datasets or should stay
  separate.
- The rules for core-owned agent tools that write data on the person's behalf.
- Size and retention defaults against the Node's storage budget, and query plans for summaries over
  the largest expected dataset.
