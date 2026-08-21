# Events a plugin can act on

Status: proposal, 2026-08-21. Nothing here has started. This records what a plugin can listen to
today, which additions the plugin ideas in
[docs/future/integration-ideas.md](./integration-ideas.md) actually need, and the rule for deciding
what belongs on that list later. The contribution seams themselves are in
[docs/extensibility.md](../extensibility.md), and the tier boundary this all turns on is in
[docs/plugins.md](../plugins.md).

The short version: the event names are the cheap part. The delivery model is the work, and it has to
be fixed first or none of the additions behave the way an author will assume.

## What exists today

### The client bus, compiled-in tier only

`ClientEventMap` in `client-core/src/registries/clientEvents.ts` is a closed union with ten keys,
reachable through `clientEvents.on(kind, listener)` by any plugin with shell-realm code.

| Event | Payload |
| --- | --- |
| `boot:restored` | `{ phases: ('workspace' \| 'view' \| 'panes')[] }` |
| `presentation:pane-intent` | `{ taskId, paneId, intent: PaneIntent }` |
| `presentation:terminal-focus` | `{ taskId, sessionId }` |
| `presentation:file-scroll` | `{ routeKey, path }` |
| `presentation:open-settings` | `{ tab }` |
| `plugin:surface-action` | `{ pluginId, surface, command }` |
| `runtime:task-archived` | `{ taskId }` |
| `runtime:workspace-removed` | `{ workspaceId }` |
| `runtime:node-removed` | `{ nodeId }` |
| `runtime:node-switched` | `{ from: string \| null, to: string \| null }` |

`PaneIntent` is a nested union carried by `presentation:pane-intent`: `notes:open`,
`editor:reveal`, `editor:search`, `integration:show-ref`, `context:reveal`, and `plugin:select`.

Alongside it, four WebSocket subscriptions are exported on the plugin surface: `wsOnStatus`
(`term:status`, a payload-free ping), `wsOnNotice` (`workflow:notice`), `wsOnWorkflowStepEvent`
(`workflow:step:event`), and `wsAttach` for PTY output. `wsOnPluginsChanged` and `wsOnReconnect`
exist in `wsClient.ts` and are deliberately not published.

`registerWsChannel(prefix, handler)` claims a whole prefix rather than subscribing to an event, and
a duplicate throws. Six are claimed: `term`, `workflow`, `plugins`, and `plugin` are core's, while
`docker` and `agent` belong to their plugins. `apps/desktop/test/client/wsChannelPrefixes.test.ts`
pins that set.

Some state is not an event and does not need to be. `activeTaskId`, `activeNodeId`, `focusedPane`,
`activeTerminal`, and `taskStatus` are Solid signals on the plugin surface, so a `createEffect` is
the change notification. This is why there is no focus event today, and it is the right answer for
the compiled-in tier.

### The frame bridge, loaded tier

A frame's `port.onmessage` handles five inbound kinds (`plugins/frames/sdk.ts`): `ready`, `event`,
`appearance`, `select`, and `surfaceAction`. Only `event` is a subscription delivery.

What `acorn.on(channel, cb)` may name is checked twice, against the manifest's `permissions.events`
in `broker.ts` and against the allowlist in `frameServices.ts`. The allowlist is
`SUBSCRIBABLE_CHANNELS` in `plugins/frames/channels.ts`, four entries:

- `runtime:task-archived`
- `runtime:workspace-removed`
- `runtime:node-removed`
- `runtime:node-switched`

Plus the plugin's own `plugin:<id>:<verb>` namespace, admitted by shape rather than by name because
core cannot enumerate verbs it never sees. Webview frames also get `webview:navigated` and
`webview:blocked`, special-cased in `sdk.ts` to skip the subscribe round trip.

Each allowlist entry carries host-owned copy in `CHANNEL_DESCRIPTIONS` for the trust prompt. That is
a real cost per entry and the most useful brake on this list growing carelessly.

### The node half, both tiers

Nothing. `PluginBroadcast` (`server/plugin/types.ts:176`) is `send`, `status`, `notice`,
`repoConfigTrustNotice`, `stepEvent`, `channel`, and `streams`, with no `on`, `subscribe`, or
`once`. [docs/plugins.md](../plugins.md) states it plainly: there is no subscribe side, nothing in
the node listens. For a loaded plugin the surface narrows further in `server/plugin/context.ts`,
where `send` throws unless the channel is the plugin's own and `channel` and `streams` are
`undefined as never`.

Four things get mistaken for events and are not:

- `ctx.schedules.register` is periodic invocation. The plugin floor is 300 seconds
  (`CADENCE_MIN_SECONDS_PLUGIN` in `protocol/src/schedules.ts`), clamped rather than rejected.
- `ctx.taskChecks.register` runs before an archive and can object. A veto on a decision, not a
  notification after a change.
- `routeCapability` hooks are single-slot function pointers and `provide` throws on a duplicate.
  There are five: `PLUGIN_STATE`, `SCHEDULER`, `TASK_SESSIONS`, `TASK_CREATED`, `RUN_TARGETS`.
  `TASK_CREATED` is the one authors reach for, the required terminal plugin already holds it, and it
  fires only from the client-initiated `on-created` route.
- `ctx.core.*` is entirely pull. `TaskService` has `load`, `active`, and `links` with no watch.

One trap worth writing down: `ctx.core.tasks.active()` means `status = 'active'`, so "not archived".
It is not "the task the person is looking at".

## The precondition: fix delivery before adding names

Every event a frame can reach today is emitted in the renderer that caused it.
`runtime:task-archived` comes from `client-core/src/tasks/archiveLifecycle.ts`, in the window where
the archive happened. A plugin in another window, on another paired device, or in a frame that was
not mounted at that moment never sees it.

The node side is thinner than it looks. `server/routes/tasks.ts` is the whole task CRUD surface and
it broadcasts nothing at all, on create, update, archive, or link change. The guarded path in
`main/archive.ts` broadcasts nothing either. The only task-lifecycle frames in the tree are
`broadcastStatus()` from `createChild` and `cancel` in `main/core/tasks/service.ts`, and from the
`on-created` route in `server/routes/worktree.ts`, and all three send the content-free `term:status`.

The consequence today is a defect worth fixing on its own account, independent of anything below.
`client-core/src/tasks/mutations.ts` says callers invalidate `tasksKey` afterwards, and no
`wsOnStatus` subscriber invalidates it, so a second connected client keeps a stale task list until
it reconnects.

So the rule for anything added here: **if a plugin is expected to act on it, it originates on the
node and arrives over the WebSocket.** A renderer-local emission is the shell telling itself
something. It is not an event a third party can build on, and shipping more of them would produce
plugins that work on the author's machine and fail in the field for reasons nobody can reproduce.

## The additions worth making

### HEAD moved

`{ projectId, taskId?, branch, head, dirty }`, when a commit lands, a branch is checked out, or a
pull or rebase moves the tip.

The highest-leverage event on this page by a wide margin. It converts a whole class of plugin from
blind polling to reactive: continuous integration, preview deployments, coverage diff, bundle size,
changesets, lockfile watching, secret scanning. Every one of those has to guess today, and the
300-second plugin cadence floor means it guesses slowly.

Given a choice between lowering that floor and adding this event, add the event. A plugin that
fetches once on a real signal costs less than one polling every five minutes forever, and the floor
exists because a plugin's polling spends someone else's rate budget.

### Task changed

`{ taskId }`, deliberately payload-free, so a dropped frame self-heals by re-reading.

Less an addition than finishing what is already half-built. It closes the stale-list defect above,
and it serves the standup assistant, worklog push, and any source plugin showing a task list. The
cheapest item here, and it removes a defect rather than adding surface.

### Focus changed

`{ taskId: string | null, paneId: string | null }`, coarse.

Not only for time tracking. Every plugin whose job is to show the thing relevant to what you are
looking at needs it: offline documentation for the library in view, Storybook for the current
component, the Figma frame for this ticket, design token checks. The frame tier cannot know what the
user is looking at today, which rules out that entire category.

The compiled-in tier already has this through the `activeTaskId` signal. This event exists to carry
it across the frame boundary, not to duplicate it.

### Agent session state

`{ taskId, sessionId, state: 'started' | 'finished' | 'failed' }`.

Worth calling out because agent execution is the most distinctive thing acorn does and third parties
are completely blind to it. The `agent` prefix is claimed by the agents plugin, and
`ctx.events.channel` is `undefined as never` for loaded plugins, so there is no route by which a
loaded plugin can observe agent activity. That blocks cost dashboards, run history, notification and
focus plugins, and any timekeeping that counts waiting on an agent as work.

### Two at lower confidence

**Connection changed**, `{ integrationId, providerId, state }`, so an integration plugin stops
hammering a revoked credential instead of discovering it through a 401. Cheap, and it prevents a
predictable class of bug.

**Worktree created or removed**, for the service-dependency runner, port manager, and tunnel
manager. Try folding this into task changed first. A worktree appearing is a task state transition,
and a separate event may be redundant once the task event exists.

## The admission rule

An event earns a place only if all four hold. Written down because this list will be asked to grow,
and the argument for each individual addition is always reasonable.

1. **Core is the only possible observer.** Focus, HEAD, agent lifecycle, and credential state
   qualify. "A new Sentry issue" does not: that is the plugin's own poll, and core has no business
   knowing about it.
2. **It is human-scale, not machine-scale.** Per commit, yes. Per keystroke, no.
3. **It carries state rather than a delta,** so a missed frame is self-healing. The WebSocket
   contract already commits to this in `protocol/src/ws.ts`: an invalidation channel with no replay.
4. **One honest sentence describes it in the trust prompt,** and a person would knowingly accept
   that sentence. "Receive task archive events" is easy. If the sentence is hard to write without
   sounding evasive, that is the design telling you something.

## What to refuse

**File opened and file saved.** Tempting for test runners and linters. Fails tests 2 and 4. A plugin
that genuinely wants this wants a file watcher, which its node half can run itself, without core
putting the editor's inner loop on a cross-boundary channel.

**Terminal output.** Settled by the tier rule already: PTY stream ownership does not survive message
passing. Reopening it here would reopen that.

**Anything per-keystroke, per-selection, or per-render.**

**Process and port lifecycle.** A port manager can poll `lsof` itself. Core observing it buys
nothing.

**Raw user activity, meaning an idle or active signal.** The time tracking idea in
[integration-ideas.md](./integration-ideas.md) needs this, and it should still be refused as an
event. A general "what is the human doing right now" broadcast is the most surveillance-shaped thing
that could go on a third-party surface, and it would be added for one consumer. Core should keep its
own activity record and expose the result through `CoreServices`, the way `TaskService` returns a
`TaskRef` projection rather than the row.

## A naming problem to settle first

The comment above `SUBSCRIBABLE_CHANNELS` states the current philosophy: the `runtime:*` family says
something a plugin may be showing has gone or moved. It is a deletion and invalidation list, and it
reads as the rule for what belongs there.

Every addition on this page is a different contract. "Something happened that you may want to act
on" is not "something you were displaying is gone". Putting both in one array means either splitting
the naming or rewriting that comment. Leaving it as it stands is the worst option: the next person
reads the philosophy, looks at the entries, and correctly concludes that one of them is wrong.
