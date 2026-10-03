# Plugin schedules

This page covers how a plugin declares periodic work, how the owner's overrides apply to it, what
happens across disable and reload, and how a schedule is disclosed at trust time. Read it before you
give a plugin a schedule. It's part of [schedules](../schedules.md).

## How a plugin declares one

Two feeders fill one registry, and nothing downstream can tell them apart.

A loaded plugin declares a schedule in its manifest, because the manifest is also what the owner sees
at install ([descriptors](../plugins.md#descriptors)). It carries an id, a name, a `run` route confined
to the plugin's own `/v1/p/<id>/` namespace, a cadence, and an optional timeout in seconds. On the
cadence, the Node POSTs `{ scheduleId }` to that route in process, as its own `service` principal, in
the same request context an HTTP request gets. It reads only success or failure from the answer. A
non-2xx is a failed run, which means backoff and a visible error, not a crashed Node. Confinement is
checked when the manifest is parsed and again on every fire.

A compiled plugin has no manifest, so it registers in `init`:

```ts
ctx.schedules.register({
  scheduleId: 'refresh-pull-mirror',
  name: 'Refresh pull request mirror',
  cadence: { every: 3600 },
  timeout: 120,                       // seconds here; the engine's DeclaredSchedule is milliseconds
  run: async (signal: AbortSignal) => { await refreshPullMirror(signal) },
})
```

In both cases the host binds `pluginId` from the registering plugin, so a schedule can't be filed under
another plugin's name. It mints the `<pluginId>:<scheduleId>` key and ties removal to the plugin's
teardown. Declaring the schedule is the lifecycle. A `setInterval` in plugin Node code is a review
flag.

A plugin may declare at most four schedules. The 300-second interval floor comes from the key prefix,
applied on read like every other clamp.

## The override model

The registry, manifest or code, is the definition. `schedule_state` holds the owner's overrides and the
run state. A pause beats the declared default, and a cadence retune beats the declared cadence, clamped
again on read, so a plugin can't un-pause itself by declaring again. The name, route or handler, and
timeout belong to the definition. Someone who wants a schedule to do something else wants a schedule of
their own.

## Lifecycle

| Event | Effect |
| --- | --- |
| Plugin disabled or uninstalled | Its schedules leave the registry and stop firing. Their state rows, meaning pause, backoff, and history, are kept unread. |
| Plugin returns | Definitions register again, and kept state reattaches by key. A pause survives the round trip. |
| Manifest drops a schedule id | The same as disabled, for that id. |
| Manifest changes cadence | The declared cadence applies unless the owner retuned it. |
| Plugin reloaded in the dev loop | The candidate's schedules are buffered like every other registration and swapped in only on commit. A failed reload leaves the previous instance firing. |

None of that is schedule-specific. It's the engine's keep-the-state-row rule and the host's
registration lifecycle, applied to this kind.

## Trust

A schedule joins the **Declared** group of the trust dialog and of the agent-install review screen, and
is recorded with the decision, so an update that changes a cadence reads as newly requested. It's a
disclosure, not a capability: the run route is one the plugin already owns and could reach from any of
its surfaces. What changes is that it runs with no client open, which is worth a line at trust time.
