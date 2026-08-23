# Events: what plugins can act on, and what they can announce

Status: proposal, 2026-08-23. Nothing here has started. This folder supersedes the single-file
`docs/future/events.md` (deleted; `git log --follow -- docs/future/events.md` has it), and it exists
because that file undersold the problem: it catalogued six event names and one delivery precondition,
when the survey behind this folder found three distinct pieces of work and roughly thirty candidate
transitions across the plugin tree. The contribution seams are in
[docs/extensibility.md](../../extensibility.md); the tier boundary everything here turns on is in
[docs/plugins.md](../../plugins.md).

The end goal, stated once so every file can lean on it: **a plugin fires events that other plugins
can listen to.** Today that sentence fails three separate ways, and each failure is its own
deliverable:

1. **Delivery.** Every event a frame can reach is emitted in the renderer that caused it, so a
   plugin in another window or on another device never sees it. The node broadcasts almost nothing.
   [delivery.md](./delivery.md).
2. **The catalogue.** Core owns transitions nobody announces (HEAD, connections, project config, run
   targets), and every integration plugin owns a "the external data changed" transition it cannot
   say out loud. [core-events.md](./core-events.md) and [plugin-events.md](./plugin-events.md).
3. **Subscription.** Even with delivery fixed and events flowing, a plugin may only hear its own
   channel. Cross-plugin listening is refused by name at both ends of the wire, and the node half of
   a plugin cannot subscribe to anything at all. [subscriptions.md](./subscriptions.md).

[refused.md](./refused.md) holds the other half of the design: the transitions that stay off the
wire no matter who asks, and why.

## What exists today, in one screen

The long-form survey of the current machinery lived in the old file and its facts still hold; this
is the pointer version.

- **The client bus** — `ClientEventMap` in `client-core/src/registries/clientEvents.ts`, a closed
  union of ten keys, renderer-local only. Two of the ten (`presentation:file-scroll`,
  `presentation:open-settings`) are declared and, outside github's emitters, barely used.
- **The frame allowlist** — `SUBSCRIBABLE_CHANNELS` in `client-core/src/plugins/frames/channels.ts`,
  four `runtime:*` entries plus the plugin's own `plugin:<id>:<verb>` namespace, admitted by shape.
  Each allowlist entry carries host-owned trust-prompt copy in `CHANNEL_DESCRIPTIONS`, which is the
  real per-entry cost and the most useful brake on growth.
- **The WS hub** — six claimed prefixes, pinned by
  `apps/desktop/test/client/wsChannelPrefixes.test.ts`: `term`, `workflow`, `plugins`, `plugin` are
  core's; `docker` and `agent` belong to their plugins. The envelope
  (`protocol/src/ws.ts`) commits to invalidation with no replay.
- **The node side has no ears.** `PluginBroadcast` (`node-core/src/server/plugin/types.ts`) is all
  send and no `on`. A plugin's node half cannot react to anything except its own routes, its
  schedule ticks, and the five single-slot `routeCapability` hooks.
- **The `plugin:<id>:<verb>` namespace is entirely unused.** All four loaded plugins declare
  `permissions.events: []`, and no frame in the tree calls `acorn.on`. The cheapest publishing
  mechanism acorn has is sitting idle, which is worth remembering whenever a new mechanism looks
  necessary.
- **Solid signals still cover the compiled-in tier.** `activeTaskId`, `focusedPane`, `taskStatus`
  and friends are signals on the plugin surface, so a `createEffect` is the change notification.
  That remains the right answer for that tier; the events here exist to cross boundaries signals
  cannot.

## The admission rule

Unchanged from the original proposal, and every file in this folder applies it. An event earns a
place only if all four hold:

1. **Core (or the emitting plugin) is the only possible observer.** Focus, HEAD, agent lifecycle,
   and credential state qualify. "A new Sentry issue" does not qualify as a *core* event — but it is
   exactly what the emitting plugin's own channel is for, which is the distinction
   [plugin-events.md](./plugin-events.md) is built on.
2. **It is human-scale, not machine-scale.** Per commit, yes. Per keystroke, per agent step, per
   container health check, no.
3. **It carries state rather than a delta,** so a missed frame is self-healing. The WS contract
   already commits to this.
4. **One honest sentence describes it in the trust prompt,** and a person would knowingly accept
   that sentence.

## The order of work

The files are readable in any order but buildable in only one:

1. **[delivery.md](./delivery.md)** first, because everything else is names on a broken pipe. It
   also contains four standing defects worth fixing on their own account, event system or not.
2. **[core-events.md](./core-events.md)** second. The survey found that nearly every core event
   already has a single node-side choke point, so once delivery exists, most of these are one line
   at a place the code already funnels through.
3. **[plugin-events.md](./plugin-events.md)** third, and partly in parallel: a plugin publishing on
   its own channel to its own frames works today, so producers can start emitting before anyone else
   can hear them, and the payloads get exercised.
4. **[subscriptions.md](./subscriptions.md)** last. Cross-plugin listening is the piece with real
   design risk (trust copy, discovery, absent producers), and it is worth nothing until there are
   events worth subscribing to.

## What the survey established

Three findings shape everything in this folder, recorded here so the per-file arguments do not have
to re-derive them.

**The choke points already exist.** Worktree creation funnels through
`node-core/src/main/taskWorktree.ts` (one hook, `WORKTREE_CREATED`), archive through
`main/archive.ts`, every workflow write through `workflowRunner.ts`'s `setRun`/`setStep`, every
local-git mutation through one wrapper in changes' `localGit.ts`, every managed-agent event through
`runtimeEngine.ts`'s single `emit()`. The delivery model is the work; the emit sites are cheap.

**There is a working precedent for outbound agent events.** The agents plugin already ships an
HMAC-signed webhook service (`plugins/agents/src/main/webhookService.ts`) that reduces the firehose
of session events to exactly two logical kinds, `completion` and `attention`. That is the shape and
the fan-out point the "agent session state" event should reuse, not a parallel invention.

**The one live cross-plugin dependency is a poll, and it is the motivating case.** workflows asks
github's `GITHUB_MIRROR.failingChecks` from its own loop (`apps/node/src/server/pluginDeps.ts`); a
green-to-red flip is invisible until someone asks. A `plugin:github:checks-changed` push replaces
that poll and is the concrete proof the whole design should be measured against.
