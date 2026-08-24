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
`term:status`. Task update, archive, link changes, project writes, connection changes, and plugin
installs broadcast nothing at all.

## Four standing defects

Each of these is a bug by the codebase's own rules, independent of the event design. They are listed
here because fixing them *is* the first slice of delivery work, and because each one is the
concrete, reproducible symptom that justifies its corresponding event.

1. **A second client keeps a stale task list until reconnect.**
   `client-core/src/tasks/mutations.ts` says callers invalidate `tasksKey` afterwards, and no
   `wsOnStatus` subscriber invalidates it. The whole task CRUD surface in `server/routes/tasks.ts`
   broadcasts nothing. The "task changed" event in [core-events.md](./core-events.md) closes this.
2. **`plugins:changed` fires on reload and nothing else.** The only sender is
   `main/pluginReload.ts:61`. Install, update, uninstall, and enable/disable
   (`server/routes/plugins.ts:76,120,137,168`) all mutate the roster the settings page renders,
   write an audit row, and push no frame. The channel already exists; four call sites are missing.
3. **A remote file save is invisible to other clients.** editor's `main/editor.ts:63-68` writes the
   file without pinging `ctx.events.status`, so a second client's tree and dirty markers do not
   move. One line, and deliberately *not* an event — "file saved" stays refused
   ([refused.md](./refused.md)); this is the same invalidation ping every other mutation sends.
4. **Connection state changes are discovered by failing.** Four independent writers flip a
   connection to `needs-auth` (`server/integrations/connections.ts:239`,
   `resourceRuntime.ts:84-87`, `projectSource.ts:94`, `modelProviders/runtime.ts:80-85`) and none
   broadcasts. Clients refetch on suspicion — onboarding hand-invalidates after connecting
   (`GithubConnect.tsx:23`) — and integration plugins learn about revocation through the next 401.
   The "connection changed" event closes this.

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

## The naming problem

The comment above `SUBSCRIBABLE_CHANNELS` (`client-core/src/plugins/frames/channels.ts`) states the
current philosophy: the `runtime:*` family says something a plugin may be showing has gone or moved.
It is a deletion and invalidation list, and it reads as the rule for what belongs there.

Every addition in this folder is a different contract. "Something happened that you may want to act
on" is not "something you were displaying is gone". Putting both in one array means either splitting
the naming (a second family alongside `runtime:*`) or rewriting that comment. Leaving it as it
stands is the worst option: the next person reads the philosophy, looks at the entries, and
correctly concludes that one of them is wrong. Settle this before the first addition lands, because
the first addition is what makes it unsettleable.

## Work items

1. Fix defects 2 and 3 above outright — no design needed, four `broadcastPluginsChanged()` calls and
   one `broadcastStatus()`.
2. Decide the naming split and rewrite or relocate the `SUBSCRIBABLE_CHANNELS` comment.
3. Add the node-side emit path for core events (the prefix, the frame shapes, the client re-emit
   into `clientEvents`), and ship **task changed** through it end to end — it is the cheapest event,
   it closes defect 1, and it exercises every layer.
4. Only then start admitting the rest of [core-events.md](./core-events.md), one
   `SUBSCRIBABLE_CHANNELS` entry and one honest sentence at a time.
