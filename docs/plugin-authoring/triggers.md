# Plugin triggers

A trigger starts a workflow when records change ([record triggers](../workflows/triggers.md#record-triggers)).
The workflows plugin decides what starts, under the owner's approval. Your plugin describes records,
says when they changed, and suggests triggers. This page walks the range of plugins in order. It's
part of [plugin authoring](../plugin-authoring.md).

## You have a source

If your plugin serves a [data source](../data-sources.md), triggers already work on it. A person picks
it under **When records change**, adds a filter, and picks a rule: a record **is new**, **starts
matching**, or **changes**. Two additions make it better.

Call `changed()` where your data changes, so a trigger checks within seconds instead of on its
cadence ([say when records changed](../data-sources/changes.md)):

```js
store.add(deploy)
ctx.dataSources.changed('deploys')
```

If your plugin only reads another service, as Linear's and Rollbar's do, it has no moment to signal.
Skip the call. Their triggers check on the cadence the person picks, every 5 minutes for a
suggestion.

Add suggested triggers to the description, up to 10. The trigger dialog lists the suggestions of every
source the project can read as its first screen, **Start from a suggestion**, and fills **When** from
the one picked. The person still picks the workflow, the inputs, and the account.

```js
starterTriggers: [{
  id: 'deploy-fails',
  label: 'A deploy fails',
  description: 'Starts a run when a deploy’s status becomes failed.',
  predicate: {
    kind: 'comparison',
    left: { address: { from: 'item', pointer: '/status' } },
    operator: 'eq',
    right: { address: { from: 'literal', value: 'failed' } },
  },
  change: { on: 'enters' },
}],
```

A suggestion names no workspace, account, or workflow. Its predicate and its watched fields point
into your records, the way a query's do, and each operand is a literal. The Node checks each one
against the description. It drops a suggestion that names a field you don't describe, an operator a
field doesn't take, or a value outside a field's choices, and logs one line naming the source and the
suggestion. `defineDerivedSource` takes `starterTriggers` too. `examples/plugins/acme-data` shows a
hand-written source with one.

A plugin that ships suggestions declares `"apiVersion": "6"`. A Node at major 5 fails a description
that carries them, and the version makes it refuse the plugin with a reason instead.

## You watch something that has a current state

Serve a source of the current state, such as one record per host with its load. **Starts matching**
turns a threshold into a trigger: "load above 4" starts a run when a host crosses the line, and again
when it drops below and climbs back. Only a complete read can say a record stopped matching, so a
read cut short never lets a record start matching again.

`examples/plugins/acme-alerts` has one, **Host load**, which it builds from its own alert feed on each
read: one record per host, holding its newest alert's load. Its suggestion is **A host's load goes
above 4** with **Starts matching**.

## You hear about things that happen

Declare an event feed and call `append`. Acorn stores the events and serves them as a source, so a
trigger, a panel, or a **Find records** step reads them like any other records
([event feeds](../data-sources/event-feeds.md)).

```ts
import { defineEventFeed, field } from 'acorn-plugin-sdk/data'

export const alerts = defineEventFeed({
  id: 'alerts',
  name: 'Load alerts',
  singular: 'Alert',
  plural: 'Alerts',
  fields: { host: field.text({ label: 'Host', role: 'title' }), load: field.number({ label: 'Load' }) },
})

await alerts.append(ctx, [{ id: 'web-1:1729400000', time: Date.now(), data: { host: 'web-1', load: 6.2 } }])
```

Every event is a record of its own, so a feed's suggestion pairs with **Is new**, such as **A
high-load alert arrives**. **Starts matching** on a feed starts a run for every matching event too,
because no event ever stops matching. A threshold that fires once until it clears needs a source of
current state, like the one in the section above.

`alerts.manifest` is the `contributions.dataSources` entry, and an event's `data` type follows from
the fields. A feed with no other job can also declare a [CLI command](./cli-commands.md) that appends,
so a script, a git hook, or a CI job on the same machine can fire a trigger:

```sh
jq -n --arg nodeId "$NODE_ID" '{nodeId: $nodeId, host: "web-1", load: 6.2}' |
  acorn plugin acme-alerts raise --input-file -
```

`npm create acorn-plugin <name> -- --trigger` writes this shape: a feed, a `raise` command, one
suggested trigger, and a test. `examples/plugins/acme-alerts` is the same shape, finished, with a
**Host load** source beside the feed.

## Test your triggers

`acorn-plugin-sdk/testing` has two helpers. Both run the Node's own rules, from `@acorn/protocol`, so a
test and the Node agree.

- `checkStarterTriggers(description)` throws with each suggestion's problems: the ones the Node
  would drop.
- `testTrigger(description, change, reads, options?)` takes a sequence of reads and returns which
  records each read would start a run for, and why. A read is a list of `{ id, data }`, or
  `{ records, completeness }` for a read cut short. With `{ predicate }`, each read is filtered first,
  as the source would.

```ts
const [highLoad] = hostsDescription.starterTriggers!
const result = testTrigger(
  hostsDescription,
  highLoad.change,
  [[host('web-1', 6.2)], [host('web-1', 6.4)], [host('web-1', 2.1)], [host('web-1', 5.1)]],
  { predicate: highLoad.predicate },
)
expect(result.map((read) => read.starts.length)).toEqual([1, 0, 0, 1])
```

`testTrigger` takes every run to have finished before the next read, and it doesn't apply a
trigger's caps. Those are the owner's settings, not your plugin's logic.

## What you don't write

Approval, duplicates, overlap, recovery after a crash, and rate limiting all belong to the workflows
plugin. A trigger starts one run per record decision, holds a record that's still running, resumes
a half-started run from the IDs it reserved, and stops at 10 runs a check and 50 a day. No plugin
code decides that a workflow should run.
