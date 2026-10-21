# What the renderer persists

This page covers which queries the renderer saves, when it saves them, and how a saved snapshot comes
back. Read it before you add a query the first frame needs or change a query key. It's part of
[caching](../caching.md#renderer-query-cache).

The code is `packages/client-core/src/infra/persistence/queryPersistence.ts`, which holds the policy,
and `queryCacheLifecycle.ts`, which applies it.

## The allowlist

Only what the first frame draws is saved, so a save and a restore cost little however much the window
has read. `PERSISTED_KEY_PREFIXES` names it:

- Preferences, workspaces, projects, and the task list.
- Each task's script snapshot and run targets, which the rail's markers and run buttons draw.
- Integrations and model backends.
- A plugin's query that sets `meta: { persist: true }`, because core can't name a plugin's keys. The
  Agent pane's harness list, `['agents', 'providers']`, is one.

A key matches by prefix, so a versioned key such as `['tasks', 'v3']` follows its constant. Anything
else stays in memory: pull requests, issues, files, dashboards, transcripts, and search answers. The
archived task list stays in memory too, with `meta: { persist: false }`, because it grows without bound.
A query keeps `persist: false` even under a listed prefix, as the rail's batched script read does.

To persist a new query, add its key to the list and keep it small. The first frame can only draw what
a snapshot holds.

## When a save runs

A query's result (`success`), a direct write to its state (`setState`), or its removal marks the
partition dirty, and only for a key on the list. A fetch that starts or fails changes nothing the
snapshot holds, and a refetch of a pull request changes nothing it keeps, so neither schedules a save.
Mutation events still mark it dirty, because a paused mutation is part of a snapshot. One five-second
clock then coalesces dehydration, serialization, and the write.

## How a snapshot comes back

A snapshot written before the list existed still restores. `restoreClient` drops every entry whose key
is no longer on the list, so those entries neither draw stale rows nor sit in memory. The snapshot keeps
its shape and its seven-day age.

## Ages

Two ages bound a snapshot. A snapshot is restored if it was written in the last seven days, so the first
launch after a weekend draws last-known rows. An entry goes into the next snapshot only if it was
fetched in the last day, matching `gcTime`.

## In memory only

A query whose options set `meta: { persist: false }` stays in memory only. Provider search answers do,
so a relaunch never shows an old answer as though it had just arrived. GitHub job logs and dashboard
panel previews do too, and set a short `gcTime` as well. A job log is a whole CI log with no size cap,
and a preview gets a new key on every edit, so a day in memory would keep each one long after the
screen that read it closed.
