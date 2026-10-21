# Phase 5: the plugin author kit

Date: October 20, 2026. Status: built on branch `phase-5-plugin-author-kit`, not merged. Needs phase 4.

## Completion note

Built October 21, 2026. A source can suggest triggers, a plugin can declare an event feed and append
to it, and the SDK tests a trigger with the Node's own rules. [Plugin triggers](../../plugin-authoring/triggers.md)
is the guide, and [event feeds](../../data-sources/event-feeds.md) is the reference.

### What landed

- **Suggested triggers.** A description takes up to 10 `starterTriggers`. `starterTriggerCheck` in
  `packages/protocol/src/data/starterTriggers.ts` is the one check: the Node's `describe` drops a
  starter that fails it, logging one line per starter and description revision, and the SDK's
  `checkStarterTriggers` throws with the same problems. `RecordChange` lives there too, and the
  workflows plugin's `WorkflowRecordChange` is that type.
- **The dialog's first screen.** A new trigger opens on **Start from a suggestion**.
  `SuggestedTriggers` in client-core, exported from `@acorn/plugin-api/ui/data-sources` and the
  terminal's own copy of that module, describes each source the project can read once per account,
  as the source picker lists them, and lists every suggestion. Picking one sets **When records
  change**, a five-minute cadence, the query with the suggestion's predicate, and its change rule.
  **Set it up yourself** opens the form as before.
- **Event feeds.** A `contributions.dataSources` entry with `feed` in place of `handler` and
  `providerId`, or `ctx.dataSources.registerFeed`. `feedDescription` in
  `packages/protocol/src/data/eventFeeds.ts` builds what the Node serves: the declared fields, a
  `time` the host adds, incremental reads, and event coverage. `ctx.dataSources.append` stores up to
  100 events a call in `data_feed_events` (migration `0013_data_feed_events`), skips an ID it holds,
  trims to `maxEvents`, and calls `changed()`. `query` reads newest first through
  `selectDataRecords`, with the sequence number as its boundary. `core:prune-feeds` applies
  retention daily, `cascadeDeletePluginData` removes a plugin's events, and the trust prompt says
  "Store up to 10,000 events from this plugin" once per feed.
- **SDK 1.3.0.** `defineEventFeed`, `starterTriggers` on `defineDerivedSource`, `checkStarterTriggers`,
  and `testTrigger`, with published declarations and drift checks in
  `packages/plugin-sdk/src/testing/triggers.test.ts`. `testTrigger` runs `recordChangeDecision` the way
  the check does, and the phase's example gives `[1, 0, 0, 1]`.
- **Scaffold.** `npm create acorn-plugin <name> -- --trigger` writes the feed, a `raise` command, one
  suggested trigger, and a `testTrigger` test. `index.test.ts` builds it against the packed SDK,
  checks the build writes the manifest the scaffold wrote, and loads it.
- **Examples.** `examples/plugins/acme-alerts` is the same shape, finished. `acme-data` calls
  `changed('deploys')` on every write and suggests **A deploy fails**.
- **Docs.** The two new pages, CLI commands, contributions, the scaffold page, say when records
  changed, data ownership, schedules, step kinds, publishing, the manifest, release notes, and the
  index. On the site, the command line and install pages.

### Decisions and deviations

- **Plugin API major 6.** The phase says a plugin with suggestions declares the version that added
  them, and only a new major can do that. Nothing was removed. Every in-repo manifest and fixture
  says `"6"`, and the release notes say a plugin that uses neither feature needs only `"5 || 6"`. A
  loaded plugin installed on a Node with `"5"` alone stops loading, as with every major.
- **A CLI command's `capability` is optional.** A command that only appends to its own feed needs no
  core facet, and asking for one it doesn't use teaches the wrong habit. The Node checks it only
  when it's set.
- **The CLI takes `--input-file`.** The phase's `acorn acme-alerts raise --host web-1 --load 6.2` isn't
  a form the CLI has. The examples pipe JSON to `acorn plugin acme-alerts raise --input-file -`.
  Flags from an input schema would be a CLI change of its own.
- **Caps are maximums too.** `retentionDays` and `maxEvents` default to 14 and 10,000 and may not go
  higher, which is the simplest reading of decision 7 and keeps "can't exceed its caps" true.
- **The host picks a feed field's operators.** Only a required top-level field takes operators, and a
  nullable one takes equality only, because the shared evaluator throws on a missing or null operand
  in an ordered comparison. `time` is sortable.
- **Retention follows registered feeds.** A feed whose plugin isn't loaded keeps its events until it
  returns or is purged.
- **The predicate evaluator moved to protocol** as `dataPredicateMatches`, so `selectDataRecords` and
  `testTrigger` share it. `sourceFieldSchema` moved to `@acorn/protocol/dataSchemas.ts` for the same
  reason.
- **The example harness registers manifest data sources** before init, as the host does.
- **`data-sources.md` is unchanged.** It sits at the 200-line limit, so the index, the changes page,
  and the feed page carry the links.

### Checked

The full `pnpm test` ran once. Five packages failed there. Four of them passed when rerun alone.
`teardown.test.ts` needed a probe for `registerFeed`, which this branch added. The arch tests'
`testFocus` and `tomlSecurity`, `runScript.test.ts`, and agents' `instructionSnapshot.test.ts` timed
out under load and pass alone. The site's "Show workspace rail puts /docs/settings/general/ first" is
red on main. `@acorn/desktop` fails because its build runs the service size check below.

On a `pnpm dev:agent` session, launched with `--prepared` because the size check is red, with
acme-alerts copied into the bundled plugins:

- The trigger dialog for a published one-step workflow opened on **Start from a suggestion**, listing
  "A host’s load goes above 4 · Load alerts". Picking it filled **When records change** with **Load
  alerts**, Load greater than 4, and **Is new**. **Review activation** and **Activate** made it
  active.
- `POST /v1/core/plugins/acme-alerts/cli/raise`, the route `acorn plugin acme-alerts raise` calls,
  stored the alert at 14:40:52. The trigger checked at 14:40:53 and started one run, "web-1 load 6.2",
  with `started_by = trigger`.
- Raising the same ID again stored nothing, and an alert with load 2.1 was stored and matched nothing.
  The next check started no run, so the trigger had one run in total.
- Uninstalling acme-alerts with purge left `data_feed_events` empty.

That check found a bug the unit tests missed. The suggestion list sent the catalog's reactive row in
its describe request, and the value parser behind the request's cache key threw "Symbol properties
are unsupported", which broke the workflows view. The request now carries plain copies, and
`SuggestedTriggers.test.tsx` renders the list with a real query client. It fails on the old code.

Not checked live: the scaffold's own package in a session. `index.test.ts` loads it with the Node's
loader, and acme-alerts, which has the same shape, ran in the session. The terminal client wasn't
checked either. The dialog is shared kit, and the terminal type-checks against the same component.

### For later phases

- **Phase 6.** Add `starterTriggers` to GitHub, Linear, Rollbar, and Workflows descriptions, each with a
  `checkStarterTriggers`-style test against the real description. A suggestion's predicate needs each
  field it names to declare the operator, so a source may need operators it doesn't offer today.
- **Service size.** The Node's static graph is 1,929,849 bytes on this branch, against 1,923,592 on
  the base, 6,257 more and 4,249 over the 1,925,600 ceiling. The ceiling isn't raised here. Most of
  it is the core table and its migration, the feed entry in the manifest contract, feed registration
  at load, and the prune job. The store, the starter check, and the served operations load on first
  use.

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
