# Say when records changed

A plugin that knows the moment its data changes, such as after a mirror write, says so:

```ts
ctx.dataSources.changed('pull-requests', { connectionId })
```

Both plugin tiers have it, as part of the [typed data sources](../data-sources.md) contract. The
code is in `packages/node-core/src/server/dataSources/changes.ts`.

- The host binds the caller's plugin ID, so a plugin can only name its own sources, including ones
  it discovered. A name the plugin has no source for is logged once and dropped. The call never
  throws, so you can make it from any write without guarding it.
- The Node waits a second after the first call for a source, then publishes `data-source:changed`
  once with `{ pluginId, sourceId, connectionId? }` ([events](../plugins/events.md#hearing-a-core-event)).
  `connectionId` stays only when every call in that second named the same account.
- Each derived source that declares the changed source as an input gets its own event, and so do the
  derived sources that read those. That's two levels, the most that inputs may nest. A derived
  source's event carries no `connectionId`.

The event asks listeners to read again. It carries no records and has no delivery guarantee, so a
listener still reads on its own schedule and treats the event as a reason to read sooner. These
sources call it: `github:pull-requests`, `gitlab:merge-requests`, `bitbucket:pull-requests`,
`workflows:runs`, `agents:sessions`, and `core:tasks`. The three code hosts call it beside
`pulls-changed` and `pr-synced`. An [event feed](./event-feeds.md) calls it for you whenever
`append` stores an event.

Linear's issues and Rollbar's errors don't call it. Acorn only reads them, so the plugin never sees
the moment they change, and their triggers check on the cadence the person picks.

The workflows plugin listens. Each approved record trigger whose query reads the changed source checks
again within seconds, at most once every 15 seconds, through the scheduler's `wake`
([record triggers](../workflows/triggers.md#record-triggers)).
