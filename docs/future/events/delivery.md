# Delivery: fix the pipe before adding names

Part of [docs/future/events/](./README.md). This is the precondition file: the delivery model has to
be fixed first or none of the catalogue behaves the way an author will assume. It also records four
standing defects that are worth fixing whether or not the rest of this folder ever ships.

## The rule

**If a plugin is expected to act on it, it originates on the node and arrives over the WebSocket.**

Every event a frame can reach today is emitted in the renderer that caused it.
`runtime:task-archived` comes from `client-core/src/tasks/archiveLifecycle.ts:29`, in the window
where the archive happened. A plugin in another window, on another paired device, or in a frame that
was not mounted at that moment never sees it. A renderer-local emission is the shell telling itself
something; it is not an event a third party can build on, and shipping more of them would produce
plugins that work on the author's machine and fail in the field for reasons nobody can reproduce.

The node side is thinner than the client bus makes it look. The full inventory of node broadcasts
outside plugins is six helpers in `node-core/src/main/notify.ts` (`broadcastStatus`, two notice
variants, the plugin-approval notice, `broadcastWorkflowStepEvent`, `broadcastPluginsChanged`) and
three non-plugin call sites: task insert and cancel in `main/core/tasks/service.ts:204,209`, and the
`on-created` route in `server/routes/worktree.ts:155`. All three send the content-free
`term:status`. That was the state before the four defects below were fixed. Task writes and
connection-status writes announce themselves now; project writes still do not.

## Four standing defects

Each of these is a bug by the codebase's own rules, independent of the event design. They are listed
here because fixing them *is* the first slice of delivery work, and because each one is the
concrete, reproducible symptom that justifies its corresponding event.

**All four are fixed** (2026-08-28).

1. ~~**A second client keeps a stale task list until reconnect.**~~ **Fixed.** Every task write on
   the node now broadcasts `tasks:changed` (`main/notify.ts`), from the create, patch, links and
   child-task paths plus archive and project delete. `watchTaskChanges()` invalidates `tasksKey` in
   every window and re-emits on the client bus, so a frame can hear it too.
2. ~~**`plugins:changed` fires on reload and nothing else.**~~ **Fixed.** Install, update, uninstall
   and enable/disable all broadcast it now, alongside the audit row each already wrote.
3. ~~**A remote file save is invisible to other clients.**~~ **Fixed.** `editorBridge` takes the
   `ctx.events.status` ping and calls it after a successful write. Still deliberately *not* an
   event — "file saved" stays refused ([refused.md](./refused.md)) — just the invalidation ping every
   other mutation sends.
4. ~~**Connection state changes are discovered by failing.**~~ **Fixed.** Every write to a
   connection's status broadcasts `connection:changed` now: the six in
   `packages/node-core/src/server/integrations/connections.ts` and the three demotions to
   `needs-auth` in `resourceRuntime.ts`, `projectSource.ts`, and `modelProviders/runtime.ts`. It went
   down the same path `tasks:changed` opened, with one difference: this frame carries
   `{ integrationId, providerId, status }` rather than being content-free, because every integration
   plugin hears it and most of them are looking at a different provider.

   One writer still says nothing, and deliberately. Disconnecting deletes the row, so there is no
   status to report, and inventing one would widen `IntegrationConnectionStatus` for a case the
   events catalogue has not settled. Pick it up with the rest of the catalogue.

## What delivery means concretely

- **Core events go out through the existing hub.** `wsBroadcast` (`main/wsHub.ts:89`) and a claimed
  prefix are the whole transport; the envelope (`protocol/src/ws.ts`) already commits to
  invalidation-with-no-replay, which is what admission test 3 (state, not delta) is for. Whether the
  new events ride an existing prefix or claim an `events` prefix of their own is a naming decision,
  not an architecture one — but see the naming problem below before deciding.
- **The client bus becomes a subscriber, not a source, for runtime facts.** The `runtime:*` emits
  that matter move node-side; the renderer re-emits what arrives on the socket so existing
  `clientEvents.on` consumers keep working. Renderer-local `presentation:*` intents stay exactly
  where they are — they are the shell talking to itself, which is the correct shape for them.
- **Frames subscribe through the allowlist they already have.** Each core event that frames may
  hear costs one `SUBSCRIBABLE_CHANNELS` entry and one host-owned sentence in
  `CHANNEL_DESCRIPTIONS`. That cost is real and intended.
- **Plugin events use the `plugin:<id>:<verb>` channel that already exists.** No new transport;
  [plugin-events.md](./plugin-events.md) is purely about what to put on it.

## The naming problem, settled

The comment above `SUBSCRIBABLE_CHANNELS` (`client-core/src/plugins/frames/channels.ts`) stated one
philosophy: the `runtime:*` family says something a plugin may be showing has gone or moved. It is a
deletion and invalidation list, and it read as the rule for what belongs there.

Every addition in this folder is a different contract. "Something happened that you may want to act
on" is not "something you were displaying is gone". Leaving it as it stood was the worst option: the
next person reads the philosophy, looks at the entries, and correctly concludes that one of them is
wrong.

**The call, taken 2026-08-28 with `tasks:changed`: split the naming, two families.**

| Family | Contract | Emitted | Who hears it |
| --- | --- | --- | --- |
| `runtime:*` | "Something you were displaying is gone or moved." | In the renderer that caused it | That window only |
| `<noun>:changed` | "Something happened on this node you may want to act on." | Where the write happens, on the node | Every window, and any plugin node half with the grant |

The second family is not new: `plugins:changed` was already shaped that way, and naming the rule is
what stops the next one drifting. A node-emitted fact appears in `SUBSCRIBABLE_CHANNELS` *and* in
`NODE_EVENT_CHANNELS` under one name and one sentence, because `permissions.events` is one grant
vocabulary across both sides of the wire. `runtime:*` stays renderer-local and out of
`NODE_EVENT_CHANNELS` entirely.

Both comments now say this, so the two lists cannot be read as one.

## Work items

1. ~~Fix defects 2 and 3 above outright.~~ **Done.**
2. ~~Decide the naming split and rewrite the `SUBSCRIBABLE_CHANNELS` comment.~~ **Done**, above.
3. ~~Add the node-side emit path for core events and ship **task changed** through it end to end.~~
   **Done.** The path is: `broadcastTasksChanged()` → `wsBroadcast` → the client's `tasks` channel
   handler → `watchTaskChanges()` invalidates `tasksKey` and re-emits on `clientEvents` → a frame
   subscribes through its manifest grant. Every layer the rest of the catalogue needs now exists.
4. ~~Ship "connection changed" down the same path (defect 4).~~ **Done.** The path is:
   `broadcastConnectionChanged()` → `wsBroadcast` → the client's `connection` channel handler →
   `watchConnectionChanges()` invalidates `integrationsKey` and re-emits on `clientEvents` → a frame
   subscribes through its manifest grant.
5. **Next.** Start admitting the rest of [core-events.md](./core-events.md), one
   `SUBSCRIBABLE_CHANNELS` entry and one honest sentence at a time. Connection deletion is the first
   candidate, since defect 4 left it out on purpose.
