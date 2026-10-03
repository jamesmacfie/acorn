# Search providers

This page covers how a plugin makes its data searchable. It's part of the
[plugin reference](../plugins.md).

## Search providers

A plugin registers a search provider. Core asks every provider at once and shows the answers grouped
by provider. The archive page calls `GET /v1/core/search?q=…&archived=1`, and `archived=0` searches
active tasks.

```ts
ctx.search.register({
  id: 'sessions',
  label: 'Agent sessions',
  search: async ({ text, limit, taskIds }, signal) => [{ taskId, title, preview, target }],
})
```

Each plugin searches its own data however suits it, such as full text for agent transcripts or a
substring scan for a small table. Core searches task titles and branches itself, as the first group.
The agents plugin is the one provider.

A provider decides what's searchable and what a hit shows: a task id, or `null` for a hit that belongs
to no task, a plain-text title and preview, and a `target` in the shape notices use. Searching raw
tables would match event JSON and metadata.

The host binds the owner, the group id `<pluginId>:<id>`, the scope, and the limits. Core resolves the
scope into `taskIds` once, and drops a hit naming a task outside that list. Titles and previews are
trimmed, and each group is capped at 20 hits.

Each provider has 1.5 seconds. Cancellation doesn't reach a plugin that keeps working after the next
keystroke, so the client debounces, core never waits past the deadline, and a provider that timed out
or threw shows as a group that couldn't answer, not an empty one.

Search providers are compiled-only. A loaded twin would be a manifest route the host calls with the
query, the way task checks work. The registry is `packages/node-core/src/server/pluginHost/search.ts`,
and the route is `packages/node-core/src/server/routes/search.ts`. The route is device-only, because
it reaches every task's history.

## Why results stay grouped

Relevance scores from different indexes can't be compared, so one merged list would be a guess. A
central index that plugins push documents into was refused, because every plugin would keep two
copies of its data in step, and deletes and uninstalls would have to clean both.
