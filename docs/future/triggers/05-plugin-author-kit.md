# Phase 5: the plugin author kit

Date: October 20, 2026. Status: proposed. Needs phase 4.

## Goal

A plugin author can make triggers easy to find, can feed triggers from things that happen rather
than things that exist, and can test what a trigger would start before anyone installs the plugin.
The kit covers the whole range of plugins:

- A plugin with sources gets triggers without writing anything. It can add suggested triggers and
  call `changed()`.
- A plugin that only notices things declares an event feed and calls `append`.
- Every author tests triggers with the same rules the Node runs.

## Starting point

- A source description carries up to 10 `starterPlans`. The Node validates each against the
  description before offering it, and each built-in source has a test that does the same
  ([typed data sources](../../data-sources.md#register-a-source)).
- `acorn-plugin-sdk/data` has `defineDerivedSource` with typed `field` builders, and
  `acorn-plugin-sdk/testing` has `testDerivedSource` and `fixtures`
  (`packages/plugin-sdk/src/data/`, `packages/plugin-sdk/src/testing/`). The SDK bundles
  `@acorn/protocol` modules, so it can run the change rules phase 4 moved there.
- `npm create acorn-plugin <name> -- --data-source` scaffolds a derived source
  (`packages/create-acorn-plugin/index.mjs`).
- A loaded plugin can declare `contributions.cliCommands`, which the `acorn` CLI calls through the
  plugin's own route ([CLI commands](../../plugin-authoring/cli-commands.md)).
- A plugin's data lives in its own SQLite file, which needs a declared migration chain. Core keeps a
  few plugin-keyed rows, such as preferences and schedule state, and `cascadeDeletePluginData` in
  `packages/node-core/src/server/db/cascade.ts` removes them on purge
  ([data ownership](../../plugins/data-ownership.md)).
- `examples/plugins/acme-data` is a loaded plugin with a **Deploys** source, its own storage, a sync
  schedule, and a `deploys-changed` verb.
- `dataSourceDescriptionSchema` is strict, so a description with a key an older Node doesn't know
  fails there.

## The design

### Suggested triggers

A description may carry up to 10 `starterTriggers`:

```ts
type StarterTrigger = {
  id: string // stable within the source
  label: string // "A pull request asks for your review"
  description: string
  predicate?: DataPredicate // over this source's fields, with no workspace or account
  change: { on: 'new' } | { on: 'enters' } | { on: 'changes'; fields: string[] }
}
```

A starter names no workspace, account, or workflow. The trigger dialog lists the starters of every
source the project can read as its first screen, **Start from a suggestion**, and fills **When**
from the one picked. The person still picks the workflow, the inputs, and the account.

The Node validates each starter against the description the way it validates starter plans, and drops
one that fails with a log line naming the source and the starter. A plugin that ships starters
declares the `apiVersion` that introduced them, so an older Node refuses it with a clear reason
instead of failing the description.

### Event feeds

A feed is a source the host stores and serves. The plugin declares it and appends to it:

```json
{
  "sourceId": "alerts",
  "name": "Load alerts",
  "singular": "Alert",
  "plural": "Alerts",
  "identityScope": "An alert ID is unique for this plugin.",
  "feed": { "schema": { "...": "..." }, "fields": [], "retentionDays": 14, "maxEvents": 10000 }
}
```

```ts
await ctx.dataSources.append('alerts', [
  { id: 'web-1:1729400000', time: Date.now(), data: { host: 'web-1', load: 6.2 }, title: 'web-1 load 6.2' },
])
```

- A feed entry has no `handler`. A compiled plugin calls `ctx.dataSources.registerFeed` with the same
  shape.
- `append` validates each event against the feed's schema and the shared value limits, skips an ID
  the feed already holds, stores the rest, and calls `changed()`. It returns the count stored.
- The host serves `describe` with event coverage and `incremental`, and `query` newest first with
  the shared predicate evaluator, its continuation being the store's sequence number.
- Events live in one core table, `data_feed_events`, keyed by plugin and source (decision 6 in the
  [README](./README.md)). A daily core job applies each feed's retention (decision 7).
  `cascadeDeletePluginData` removes a plugin's events on purge.
- The trust prompt says "Store up to 10,000 events from this plugin" once per feed.

A feed is also an ordinary source: a panel can chart it and a **Find records** step can read it.

### SDK helpers

- `defineEventFeed` in `acorn-plugin-sdk/data` takes the feed's names and `field` builders, like
  `defineDerivedSource`, and returns the manifest entry and a typed `append`, so an event's `data`
  type follows from its fields.
- `defineDerivedSource` accepts `starterTriggers`.
- `acorn-plugin-sdk/testing` gains two helpers:
  - `checkStarterTriggers(description)` fails with each starter's problem.
  - `testTrigger(description, change, reads, options?)` takes a sequence of reads, each a list of
    records with an optional completeness, and returns which records would start a run on each
    read and why. It runs the protocol's change rules, so the test and the Node agree.

```ts
const result = testTrigger(alerts.description, { on: 'enters' }, [
  [alert('web-1', 6.2)],
  [alert('web-1', 6.4)],
  [],
  [alert('web-1', 5.1)],
])
expect(result.map((read) => read.starts.length)).toEqual([1, 0, 0, 1])
```

### The scaffold and the example

`npm create acorn-plugin <name> -- --trigger` writes a trigger-only plugin:

```text
my-alerts/
  acorn-plugin.json   the manifest: a feed, a CLI command, and one suggested trigger
  src/feed.ts         the feed's fields and its suggested trigger
  src/index.ts        the node half: the CLI command's route calls append
  src/feed.test.ts    testTrigger over three reads
```

`examples/plugins/acme-alerts` is the same shape, finished: a **Load alerts** feed, a suggested
trigger, and `acorn acme-alerts raise --host web-1 --load 6.2`, so a script, a git hook, or a CI job
on the machine can fire a trigger. `examples/plugins/acme-data` shows the other end of the range: its
sync calls `changed('deploys')`, and its source suggests **A deploy fails**.

### The authoring guide

`docs/plugin-authoring/triggers.md` (new) walks the range in order:

1. You have a source: triggers work. Add `changed()` where your data changes, and suggested triggers.
2. You watch something that has a current state: serve a source of the current state. "Starts
   matching" turns a threshold into a trigger.
3. You hear about things that happen: declare a feed and `append`.
4. Test with `testTrigger` and `checkStarterTriggers`.
5. What you don't write: approval, duplicates, overlap, recovery, and rate limiting. The workflows
   plugin owns those.

The data source reference gets a page for feeds, `docs/data-sources/event-feeds.md` (new), and the step-kinds
page's trigger row links to the guide.

## Steps

1. Add `starterTriggers` to the description schema, the Node's validation, and the dialog's first
   screen.
2. Add feeds: the manifest entry, `registerFeed`, `append`, the core table and its migration, the
   served source, retention, purge, and the trust sentence.
3. Add the SDK helpers and their published declarations, with `contract.test.ts` coverage.
4. Add the `--trigger` scaffold and its test in `packages/create-acorn-plugin/index.test.ts`.
5. Add `examples/plugins/acme-alerts`, and the `changed()` call and starter to `acme-data`.
6. Write the guide and the feed reference, and add both to [docs/README.md](../../README.md).

## Acceptance

- The scaffold's output passes `npm test`, builds, and installs into a `pnpm dev:agent` session as a
  hand-written package.
- A trigger made from the example's suggestion starts a workflow within seconds of
  `acorn acme-alerts raise`, and the same event raised twice starts one run.
- A loaded plugin can't append to another plugin's feed or exceed its feed's caps.
- Uninstalling the example with purge removes its events.
- A starter whose predicate names a field the source doesn't describe is dropped with a log line, and
  fails `checkStarterTriggers`.
