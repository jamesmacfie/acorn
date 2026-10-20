# Workflow triggers

Date: October 20, 2026. Status: proposed. Implementation not started.

This programme lets a workflow start on its own when something happens: a pull request asks for your
review, a Linear issue arrives with a label, a Rollbar error has been seen twice, or a host's load
crosses a line. Any data source from any plugin can drive one, and a plugin whose only job is to
notice things can feed one in about a dozen lines.

Most of the work is refactoring. Acorn already has scheduled workflows, a ledger that remembers
which records a loop handled, and a typed contract every data source speaks. The plan reshapes those
into one trigger model, then adds the parts that are missing, so the result reads as if triggers
were designed in from the start.

## The problem

Today you can react to records only by scheduling a workflow whose first step finds records and
whose **For each** remembers which ones it handled. That works for a morning batch, but it fails as a
trigger in three ways:

- **Every check is a task.** Each occurrence of a schedule creates a root task and a root run before
  it knows whether anything matched (`WorkflowScheduleService.resume` in
  `plugins/workflows/src/server/schedules/service.ts`). A check every five minutes makes 288 tasks a
  day, almost all empty.
- **One slow run blocks every later check.** An occurrence owns overlap until the root run and every
  child are finished ([scheduled roots](../../workflows/scheduled-roots.md)). If a pull request review
  takes 40 minutes, no new pull request is noticed for 40 minutes.
- **Checks only happen on a clock.** The floor for a user schedule is 60 seconds, and a plugin has
  no way to say "my data just changed, look now".

Three things in the code are called a trigger, and none of them is this feature:

- The `workflows:trigger` extension point lets a plugin return any definition to run on any task. It
  skips the approval, overlap, and recovery rules that schedules follow, and no plugin contributes
  to it.
- A definition's `trigger` key is stored and written back, and nothing reads it.
- A run's `trigger` column records what started the run, such as `manual` or `agent-map`.

A plugin author who wants to fire workflows has no path short of writing their own storage, a data
source with paging, and hoping something polls it.

## What the person gets

When every phase ships:

- The Workflows list has a **Triggers** section. Each trigger starts one published workflow either
  **On a schedule** or **When records change**.
- A record trigger is a source, a filter, and a rule: start a run when a record **is new**, **starts
  matching**, or **changes** in fields you pick. The same query editor that panels and **Find
  records** steps use builds the filter.
- Each match gets its own task and run, with the record filled into the workflow's inputs by the
  same rule **Start workflow…** uses on a row. A slow run never blocks the next match.
- A trigger fires within seconds when the source's plugin says its data changed, and on its own
  cadence otherwise.
- The editor shows what matches right now, and **Track from now** starts nothing until something
  new happens.
- Sources ship suggested triggers, such as **A pull request asks for your review**, the way they ship
  starter panels.
- A plugin can declare an event feed, call `append`, and have triggers, dashboards, and workflow
  steps read the events like any other source.

## Starting point

Checked against `a06946dc2`:

- Workflow schedules live in the workflows plugin: `server/schedules/service.ts` (611 lines) holds
  approval, the occurrence ledger, recovery, and the loop settings together. The tables are
  `workflow_schedules` and `workflow_schedule_occurrences` in `plugins/workflows/src/node/schema.ts`.
  The core scheduler times them through the user target kind `workflow` with the target
  `{ scheduleId }` ([user schedules](../../schedules/user-schedules.md)).
- The record ledger for **For each** is `server/processing/`. Its pure rules, record identity,
  tracked-field projection, and the repeat decision, are in `server/processing/rules.ts`. Repeat
  modes are `every-match`, `unseen`, and `changed`.
- `WorkflowRunner.pollTriggers` sweeps the `workflows:trigger` extension point every 300 seconds and
  when a code host emits `checks-changed` (`registerWorkflowTriggers` in
  `server/schedules/activation.ts`). The only contributor is a test in
  `apps/node/test/integration/plugins/workflowRunner.test.ts`.
- **Start workflow…** on a row fills inputs by name. The rule is split across
  `contract/itemInputs.ts` (`issue`, `item`, `context`, `link`, `url`) and
  `client/startFromItem.ts` (`record`, and `item` again as the record's data).
- Data sources describe typed fields, record identity, `incremental` continuation, event coverage,
  and up to 10 `starterPlans` (`packages/protocol/src/data/dataSources.ts`). Nothing tells the Node
  that a source's records changed.
- Three other jobs read a query on a clock with their own checkpoint handling: dataset capture
  (`packages/node-core/src/server/datasets/capture.ts`), the measure sampler, and incremental **Find
  records**. They stay as they are. A trigger is a fourth reader, not a reason to merge them.
- Events are invalidation with no delivery guarantee ([events](../../plugins/events.md)).
- The scheduler's `runNow` refuses while a job runs or while four jobs are running, so it can't serve
  as an early wake-up (`packages/node-core/src/server/schedules/scheduler.ts`).
- The Node service bundle runs close to its 1,914,100-byte ceiling, which the last three commits
  to `apps/node/scripts/check-service-budget.mjs` each raised.

## The design

### One rule

Plugins describe data and say when it changed. The workflows plugin decides what starts, under the
owner's approval. No plugin code decides that a workflow should run.

That one rule keeps approval, overlap, the daily cap, recovery after a crash, and the history of
what started and why in a single place. It's also why the `workflows:trigger` extension point goes.

### The layers

| Layer | Owner | Job | What this programme adds |
| --- | --- | --- | --- |
| Data sources | Core and each plugin | What exists, as typed records | A `changed` signal, event feeds, and suggested triggers |
| Scheduler | Core | When to look | `wake`, an early run that keeps the scheduler's rules |
| Triggers | Workflows plugin | What starts, as the owner approved it | The trigger model, which replaces workflow schedules |
| Runs | Workflows plugin | The work itself | A run records that a trigger started it, and which one |

### How a record trigger fires

1. A plugin's data changes. If the plugin knows, it calls `ctx.dataSources.changed('pull-requests')`.
2. Core publishes `data-source:changed`. The workflows plugin finds the triggers that read that
   source and asks the scheduler to `wake` each one.
3. With or without a wake, the scheduler runs the trigger's check on its cadence.
4. The check reads the frozen query, compares each record with the trigger's record ledger, and
   decides which records are new, started matching, or changed.
5. In one transaction it updates the ledger and reserves one occurrence, with its task and run IDs,
   for each record that should start.
6. After the commit, each occurrence creates its task and starts its run, with the record bound to
   the workflow's inputs. Recovery after a crash reuses the reserved IDs.

A check that finds nothing creates nothing.

### Records are the truth, events are a nudge

Events in Acorn carry no delivery guarantee, on purpose. A trigger built on event payloads would miss
whatever happened while the Node was restarting, and it couldn't show what it would start before you
turned it on. Records can be read again, previewed in the editor, filtered with the query editor
people already know, drawn on a dashboard, and baselined. So the only thing an event does here is make
a check happen sooner.

A plugin whose news is a stream of things that happened, rather than a list of things that exist,
declares an event feed. The host stores the events and serves them as a source, so even a webhook-like
plugin feeds triggers through records.

### The trigger

```ts
type WorkflowTrigger = {
  id: string
  name: string
  projectId: string
  workflowId: string // a published database workflow
  when:
    | { kind: 'clock'; timezone: string } // cadence stays on the core scheduler row
    | { kind: 'records'; query: QueryReference; change: RecordChange }
  inputs: Record<string, DataBinding> // a literal, or `{ from: 'item', pointer }` on a record trigger
  firstCheck: 'process-current' | 'track-now'
  limits: WorkflowScheduleLimits
  state: 'draft' | 'baselining' | 'active' | 'needs-review' | 'baseline-failed' | 'deleted'
}

type RecordChange = { on: 'new' } | { on: 'enters' } | { on: 'changes'; fields: string[] }
```

- **New** starts a run the first time a record matches, ever.
- **Starts matching** starts a run when a record matches now and didn't on the last complete check.
  A pull request that's asked for your review again, or a host whose load drops and climbs again,
  fires again.
- **Changes** starts a run when a matching record's chosen fields differ from what the ledger last
  kept.

### What a plugin author does

| Plugin | What the author writes | What they get |
| --- | --- | --- |
| Has data sources, such as GitHub or Linear | Nothing | Triggers on every source. `changed()` makes them fast. `starterTriggers` makes them easy to find. |
| Watches current state, such as a load monitor | A source whose records are hosts with their load | "Load above 4, starts matching" |
| Only notices things, such as a CI listener | An event feed and `append` | A host-stored source, triggers, panels, and workflow steps over it |
| A large plugin with mirrors, such as agents or workflows | `changed()` where it already knows | Triggers that fire within seconds |

A trigger-only package can also declare a CLI command that appends to its feed, so a git hook, a CI
job, or a cron script on the same machine can fire a trigger with `acorn <plugin> <command>`.

### What gets refactored

- The `workflows:trigger` extension point, its sweep, and its schedule are deleted.
- The dead `trigger` key leaves workflow definitions.
- A run's start reason is called `startedBy`, and a run started by a trigger records the trigger's ID.
- Workflow schedules become clock triggers. The 611-line service splits into approval, occurrences,
  and one module per kind, and message-matching regular expressions become typed errors.
- The record-change rules move to `@acorn/protocol`, so loops, triggers, the editor's preview, and
  the plugin test kit all use one implementation.
- The two halves of the "fill inputs from an item" rule become one contract function.
- The scheduler gains `wake` instead of each consumer working around `runNow`.

## The phases

| Phase | What changes |
| --- | --- |
| [1](./01-clear-the-ground.md) | Delete the unused trigger extension point and the dead definition key. Rename a run's start reason to `startedBy`. |
| [2](./02-one-trigger-model.md) | Workflow schedules become clock triggers: new tables, a split service, `/workflows/triggers`, and a **Triggers** section with a **When** field. Nothing a person relies on changes. |
| [3](./03-say-when-data-changed.md) | `ctx.dataSources.changed`, the `data-source:changed` event, derived-source fan-out, and the scheduler's `wake`. |
| [4](./04-record-triggers.md) | **When records change**: shared change rules, the record ledger, the check, inputs from a record, and the editor. |
| [5](./05-plugin-author-kit.md) | Suggested triggers on sources, event feeds, SDK helpers and a test helper, a `--trigger` scaffold, an example package, and the authoring guide. |
| [6](./06-first-party-triggers.md) | Suggested triggers and missing fields in GitHub, Linear, Rollbar, and Workflows, and acceptance with real accounts. |

Phase 2 needs phase 1. Phase 3 needs neither and can run beside phases 1 and 2. Phase 4 needs phases
2 and 3. Phase 5 needs phase 4. Phase 6 needs phase 5.

## What holds across every phase

- **One way to start unattended work.** An approved trigger is the only thing that starts a workflow
  with nobody present. It runs a published database workflow, frozen at approval, under the limits
  the owner accepted.
- **Plugins never decide what starts.** They describe records, say when records changed, and suggest
  triggers. Nothing more.
- **Records are the truth.** Events and wakes only make a check happen sooner. A missed event delays
  a run until the next check and never loses it.
- **Refactors keep behavior.** Phases 1 and 2 keep every approved schedule running, with its run
  history and record history. A change a person can see is named in the phase.
- **Both hosts.** Every editor and list works in the desktop app and the terminal client through the
  shared kit, as the schedule dialog does today.
- **The Node service budget.** Checks, the feed store, and the trigger editor's preview load on first
  use. The coordinator raises the ceiling once per merged phase, with the measured size and the reason
  in the commit message.
- **Docs move with the code.** Each phase updates the reference pages it changes and the
  [future index](../README.md).

## Decisions for the owner

Each phase names the default it assumes:

1. **The default change rule.** The default is **New**, because it can't fire twice for one record.
   **Starts matching** is the alternative, and it suits review requests and thresholds better.
2. **Circuit breakers.** The default starts at most 10 runs per check and 50 per trigger per day. A
   trigger that hits the daily cap moves to **Needs review**.
3. **How often a record trigger checks.** The default is every 5 minutes, at least 1 minute, with
   wakes at least 15 seconds apart for one trigger.
4. **Where a run lands.** The default gives each match its own task, titled
   "Workflow name · record title". The alternative uses the record's own task when it names one,
   which runs inside a task someone may be working in.
5. **The public name of a run's start reason.** The default keeps the Workflow runs source's `/trigger`
   field, labeled **Started by**, so saved queries and panels keep working, and adds `/triggerId`.
   The alternative renames the field and rewrites saved queries and panels that use it.
6. **Where event feeds are stored.** The default is one core table keyed by plugin, removed when the
   plugin's data is purged, the way core keeps a plugin's schedule state. The alternative is each
   plugin's own database, which needs a migration chain in every trigger-only package.
7. **Event feed retention.** The default keeps 14 days and at most 10,000 events per feed.

## Refused

- **Plugin code that picks workflows to start.** That's the extension point phase 1 deletes.
- **Event payloads as trigger input.** A payload is a hint to read again, never the record.
- **Inbound webhooks on the Node.** The Node is usually a laptop with no public address. See Later.
- **Filters a source can't run.** A trigger uses the same rule as every query: the host doesn't fetch
  everything to filter what the source can't. Add the operator to the source instead, as phase 6 does
  for Rollbar's occurrence count.
- **Triggers from repository or user workflow files.** They need the file-owned consent in
  [workflow gaps](../workflows-gaps.md#define-file-owned-trigger-consent).
- **Agents creating or approving triggers.** Approval stays a device action, as it is for schedules.
- **Exactly-once effects.** A trigger never starts two runs for one decision, but a workflow that
  posts somewhere can still post twice if it's retried.

## Later

- **Webhooks through the Cloud relay.** When the [cloud](../cloud/README.md) relay exists, a provider
  webhook can arrive at a hosted endpoint and become an `append` on the provider plugin's feed.
- **Panels that refresh on `data-source:changed`.** The same event can replace some panel polling.
- **Starts matching in For each loops.** The shared rules make it a small change, once a loop needs it.
- **An agent that proposes a trigger.** The owner would still approve it on a device.
- **Another kind of "then".** A trigger starts a workflow. A one-step workflow covers "notify me".
  Add another action only when that proves clumsy.

## Why

The pieces already exist. Data sources give every record a stable identity and typed fields, the
processing rules already decide what's new and what changed, and schedules already know how to freeze
an approved workflow and recover a half-started run. What's missing is a shape that puts them
together for "when this happens": a check that isn't itself a run, a ledger per trigger, and a way
to hear about changes sooner.

Putting the decision in one place, the workflows plugin, is what makes the plugin side simple. An
author never thinks about approval, duplicates, overlap, or crashes. They describe their data, and
optionally say when it changed.
