# How a plugin fits together

An orientation map, not the reference. It names every surface a plugin can reach, says what each one
does in a line, and shows two working examples. When you need the argument behind a rule, follow the
link: [plugins.md](./plugins.md) is the reference, [plugin-authoring.md](./plugin-authoring.md) is the
by-hand walkthrough for a package you install from disk, and
[extensibility.md](./extensibility.md) holds the reasoning.

## The three shapes a plugin can take

A plugin has a node half, a client half, or both. Which one you write decides what you can reach.

| Shape | Where it runs | What it can do |
| --- | --- | --- |
| Compiled | In the app binary, one roster line per side | The whole API, including Hono routers and websocket channel prefixes |
| Loaded | A package on disk the node imports at boot | The same node API minus live-object seams, plus manifest descriptors |
| Frame | A sandboxed iframe inside a pane the host draws | The bridge only: HTTP to its own routes, state, one channel, a few UI verbs |

A compiled plugin registers by adding one line to each roster:
`apps/node/src/server/plugins.ts` and `apps/desktop/src/app/client/plugins.ts`. Everything else it
does, it does through the context object the host hands it.

A loaded plugin arrives through `POST /v2/core/plugins/install` and declares its contributions in an
`acorn-plugin.json` manifest. It joins the same array and the same host pass, so ordering, `ready`,
capability binding, and disposal work identically.

## Startup

Both sides run the same two-pass lifecycle, and the reason for the second pass is the same on each:
no plugin should do work while half the registries are still empty.

**Node.** The host awaits `init(ctx)` on every enabled plugin, then awaits the optional `ready(ctx)`
on every plugin that has one, then binds the listener. So a route exists before the first request
arrives, and a plugin that needs another plugin's contribution waits for `ready`. Init order is not a
dependency contract, and reading a capability during `init` can read `undefined` for no better reason
than roster position.

`dispose()` releases what the plugin opened: timers, child processes, pools, capability slots. Not its
database. The host closes that after your `dispose` returns, so an in-flight write still has a live
connection.

**Client.** `init(ctx)` is registration only, and synchronous, because nothing there does I/O.
`activate(ctx)` is the side-effect pass, and also synchronous, so a plugin that wants a network read
fires it and handles its own rejection.

Failures diverge by tier. A compiled plugin throwing from `init` fails the boot, because a node that
cannot assemble itself should say so. A loaded plugin throwing has its registrations rolled back, gets
a `failed` roster row carrying `reason` and `stage`, and the node keeps starting.

## The node API

Your plugin exports a `NodePlugin`: a `name`, an `init`, and optionally `ready`, `dispose`,
`required`, and `migrationsModule`. Everything else reaches you through `ctx`.

| `ctx` member | What it gives you |
| --- | --- |
| `name` | Your own plugin id, already bound by the host |
| `routes` | Mount HTTP under `/v2/p/<your-id>`. `register(hono)` for compiled, `fetch(handler)` for loaded |
| `tools` | Register an agent tool. Core projects it to the task HTTP surface, the MCP server, and the permission UI |
| `schedules` | Periodic node-side work, floored at 300 seconds for a plugin. Any `setInterval` in plugin code is a review flag |
| `collections` | Where a collection can be read with no client attached, so the dashboard sampler can ask the same question |
| `taskChecks` | What you have to say when the owner archives a task, and the cleanup you can offer |
| `contextSections` | One section of the task context an agent gets at launch |
| `providers` | `integration`, `connection`, `model` and `nodes` descriptors, plus `withConnection` for credential access outside a request |
| `capabilities` | `provide`, `get`, `require`, `ids`. The only late-binding seam between two node halves |
| `storage` | `open()` returns your own SQLite handle. Absent unless you declared migrations |
| `core` | Core services: see the table below |
| `events` | Tell connected clients something changed. Read the events section before you assume this is a bus |

Two node contributions have no `ctx` member, on purpose: **node actions** (which of your chrome actions
a person may put on a timer, plus its risk tier) and **managed-agent harnesses**. Both are declared in
the manifest — a command whose verb is `runNodeAction`, and `contributions.harnesses` — and the host
registers them on your behalf. Use `console` for logging, prefixed with your plugin id; there is no
`ctx.log`.

`ctx.core` is how you consume core capability without deep-importing whichever core module holds the
helper:

| Facet | What it does |
| --- | --- |
| `fs` | Path-confined reads and writes for anything a caller names |
| `git` | The one git seam. Terminal prompts off, SSH agent passed through, output bounded |
| `proc` | Every child process. Environment allowlist, process-group kill, bounded capture |
| `secrets` | Use-scoped credentials. Scrubs plaintext out of anything thrown from its scope |
| `tasks` | Resolve a task id to a `TaskRef` projection, never the row |
| `context` | The launch-context reads: the injection preference and core's section assembler |
| `models` | Text generation through a stored model-provider connection |
| `prefs` | One `(userId, key)` row of core's preferences table |
| `identity` | Which owner this node is bound to. Read-only |
| `projects` | Project identity, scope resolution, importer writes, mapped folders |

Two things to know about `core`. What it hands back for a core entity is a projection, never the
database row: `projects` answers with `ProjectRef`, `tasks` answers with `TaskRef` carrying six fields.
Core can rename a column without breaking you. And there is no HTTP client on it. See
[http-client.md](./http-client.md) for why that gap matters.

## The client API

Your plugin exports a `ClientPlugin`: a `name`, an `init`, and optionally `activate` and `required`.

| `ctx` member | What it gives you |
| --- | --- |
| `panes` | A rectangle inside a task, with a glyph, an order, and an optional default chord |
| `sources` | A rail entry, and the surface the shell renders when it is selected |
| `commands` | A palette entry |
| `keybindings` | A chord bound to a command |
| `integrationFlows` | The connect flow for a provider you own. The id must equal your plugin name |
| `projectImporters` | An importer the first-run onboarding hosts |
| `settingsPages` | A page in Settings, with a group and an order |
| `slots` | A component in a host-owned region of the shell, or inside a task's chrome. The slot id decides which, and which context your component receives |
| `contextSectionSlots` | A component drawn inside a section the node assembled. Not the node's `contextSections`, which declares the section itself |
| `refPanels` | A reference panel for an external item. Not a pane, see [panes.md](./panes.md) |
| `paletteRows` | Rows the palette can search, sourced from your own state |
| `agentContexts` | Context an agent can pull from your plugin |
| `agentToolRenderers` | How your tool's calls draw in an agent transcript. Compiled plugins only |
| `schedules` | Periodic client work with an interval and an optional external refresh trigger |
| `railMarkers` | Status markers the host draws on a rail control |
| `persistedStateSlices` | A slice of state that survives a reload |
| `nodeStats` | One number on a node card on the Fleet home |
| `attentionSources` | Rows for the attention inbox: states on a node that need the owner |
| `collections` | A typed record set a user can compose a dashboard panel over |
| `brandMarks` | A brand logo as one SVG path, drawn wherever a `brand:` glyph name appears |
| `contentLinks` | A recogniser that turns an external URL into an in-app destination |
| `contribute` | Register into a registry another PLUGIN published, with the same ownership check |
| `capabilities` | `provide`, `get`, `require`, `ids`, the same four verbs as the node's. Not the platform gate — that is `requires` on a contribution |

Two rules the host enforces here. A contribution that names a `providerId` must name your own plugin,
so you cannot register under a stranger's provider by typo. And `register` returns nothing, because the
host owns the disposable: re-activating replaces your contributions instead of appending to them.

**Two gates, and where each one belongs.** `requires` is the host's question — `'desktop'` for a shell
affordance, `'terminal'` for a node that runs terminals — and every contribution the host filters before
drawing takes it, so you never have to remember which ones do. `when` is your own predicate, and it
takes whatever context that draw site has: a task for a pane, the shell context for a slot, nothing for
a rail source. It is absent where the host has no context to hand it, such as a client schedule or a
settings page. A rail source has a third, narrower gate: `requiresProvider`, which asks whether the
connected integration behind its `providerId` grants a named capability.

## Import entrypoints

Import the host through `@acorn/plugin-api` and nothing else. The split is enforced by an architecture
test, and each entrypoint exists because of what it can and cannot be loaded into.

| Entrypoint | What it holds |
| --- | --- |
| `@acorn/plugin-api/node` | The node contract, the route toolkit, core service types, provider types, the sync engine |
| `@acorn/plugin-api/client` | The client contract, transport, queries, contribution types, notifications, shell state |
| `@acorn/plugin-api/ui` | Frame-safe components: props in, DOM out |
| `@acorn/plugin-api/ui/host` | Components that need the shell's focus machinery. Never safe inside a sandboxed frame |
| `@acorn/plugin-api/ui/diff` | The diff toolkit's model, virtualizer, and find pass |
| `@acorn/plugin-api/ui/editor` | The Monaco theme and language mapping. Compiled panes only, so 30 MB of editor stays out of other boot graphs |
| `@acorn/plugin-api/ui/sdk` | The frame bridge: `connect`, `mountFrame`, `openLinkOnClick` |
| `@acorn/plugin-api/testkit` | Node-side test scaffolding: `makeTestNodeContext`, `validatePluginConfig` |
| `@acorn/plugin-api/testkit/client` | The client-side half of the same |

The split between `/client` and `/ui` is one question: is it a component? A barrel evaluates every
module on it, so one Solid component on `/client` would make that entrypoint unloadable from a
node-environment test.

## Events

The honest version first. Acorn has no cross-plugin event bus. `ctx.events` is an invalidation channel
between a node and the clients attached to it: no durability, no replay, no delivery guarantee. A client
that misses a frame refetches after the gap, and that is the whole contract. Durable history belongs in
your own tables.

There is a receive side now, and it is narrow: `ctx.events.on` hears the core events in
`NODE_EVENT_CHANNELS`, on this node, whether or not a client is attached. Hearing *another plugin* is
not built — that needs a producer's `emits` declaration, item 3 of
[docs/future/events/](./future/events/README.md). Until then the mechanisms below are what you have.

### Broadcast to clients, from the node

| Call | What it does |
| --- | --- |
| `ctx.events.status()` | The content-free ping. Every client re-pulls what it is showing |
| `ctx.events.send(frame)` | Push one frame to every connected client. The hub skips task-confined sockets |
| `ctx.events.repoConfigTrustNotice(taskId)` | The one notice carrying an action: this repo's committed config needs review |
| `ctx.events.on(event, listener)` | Hear a core event on this node. The event must be one `permissions.events` named |
| `ctx.events.channel(prefix, handler)` | Claim a websocket channel prefix and receive client frames on it. Compiled plugins only |
| `ctx.events.streams(handlers)` | The PTY stream handlers. Exactly one plugin may own these |

The notification bell and the workflow step stream used to sit here too, as `ctx.events.notice` and
`ctx.events.stepEvent`. They were one plugin's domain vocabulary on the surface every plugin receives,
and they moved to the `workflows.notices` capability, where the rest of that plugin's cross-plugin
surface already was.

Prefer `status()` to `send()`. A payload a client can trust is a payload you have to keep correct
across every reconnect and version skew, and re-reading costs one request.

### Subscribe in the renderer

For a compiled plugin, `registerWsChannel(prefix, handler, reattach)` from
`@acorn/plugin-api/client` is the mirror of `ctx.events.channel`. Core routes by the token before the
first colon and never looks inside a payload, so adding a stream touches no core file. The optional
`reattach` returns the frames to replay after a reconnect, recomputed at call time because only you
know what is attached right now.

`wsOnStatus`, `wsOnNotice`, and `wsOnWorkflowStepEvent` cover the three core channels. They are on the
API today and marked as prune candidates: reach for `registerWsChannel` or something on `ctx` first.

### The in-renderer bus

`clientEvents` is a typed emitter inside one renderer. It carries shell presentation intents and
runtime lifecycle facts: `runtime:task-archived`, `runtime:node-switched`,
`presentation:pane-intent`, and a fixed set of others declared in `ClientEventMap`. You can subscribe
with `clientEvents.on(kind, listener)`, and you can emit the kinds that already exist, but you cannot
add your own key. It is renderer-local, so a second window or a paired device never sees your emission.
That is exactly why it is not an event a third party can build on.

### The live channel, for a loaded plugin

A loaded plugin cannot claim a websocket prefix. Core claims the single `plugin` prefix and routes by
the id inside the channel name, which is `plugin:<your-id>:<verb>`. Your node half broadcasts on that
namespace and nothing else, your own frames subscribe to it through `bridge.events.on(channel, cb)`,
and the manifest has to list the channel under `permissions.events`. Chrome gets a coalesced nudge
capped at two passes a second, so a rail row does not cost a network read per frame you send.

### When none of that fits

Register a client schedule. `ctx.schedules.register({ id, intervalMs, run, subscribe })` runs `run` on
an interval, skips it while the document is hidden, and runs it again when the tab becomes visible. The
optional `subscribe` lets a websocket frame trigger an early refresh, which is how you get periodic work
that is cheap when idle and prompt when something happens. Same word as the node's `ctx.schedules`,
raw milliseconds instead of a budgeted cadence: below the node's 300-second floor a schedule is a poll,
and polling is the client's job for a person who is present.

## Talking to another plugin

Four mechanisms, in the order you should reach for them.

**Contracts.** Import only a plugin's `contract/` entrypoint, for types, capability ids, and narrow
pure functions. Anything else is an import edge the architecture test rejects.

**Capabilities.** A typed map with a phantom-typed key, which is the whole point: two packages agree on
a function signature without an import between them. The provider exports the key from its `contract/`,
and the consumer resolves it:

```ts
import { capabilityId } from '@acorn/plugin-api/node'

// In the provider's contract/, so both sides can import the key and neither imports the other.
export const AGENTS_SESSION_EXECUTE = capabilityId<(taskId: string, prompt: string) => Promise<string>>(
  'agents.sessionExecute',
)

// In the provider's init:
ctx.capabilities.provide(AGENTS_SESSION_EXECUTE, execute)

// In the consumer, at call time. Never at init, never at module scope.
const execute = ctx.capabilities.get(AGENTS_SESSION_EXECUTE)
if (!execute) return  // that plugin is disabled. Degrade, do not throw
```

Use `get` by default and treat `undefined` as "that plugin is disabled". Use `require` only for the four
plugins that cannot be disabled: agents, memory, notes, and terminal.

An id you provide has to start with your own plugin id. That is enforced for a loaded plugin and is the
convention for a compiled one; the two exceptions are `core.taskWorktreeCreated` and
`agents.harnessRegistry`, which the host declares as invitations for whichever plugin owns worktree side
effects or agent sessions. Every id the first-party plugins publish is catalogued, with its signature,
as `CapabilityCatalogue` in `acorn-plugin-types`.

Resolve at call time. Resolving during `init`, or in a component body that runs once, can cache
`undefined` for no reason other than registration order, and a dropped feature looks like a backend
problem for a day.

The client mirrors this with the same four verbs on `ctx.capabilities`, plus `clientCapability(id)` and
`requireClientCapability(id)` as free functions for a component that has no `ctx` in hand. That mirror
exists
because the agent sidebar wants workflow steps while workflows' node half wants agents to execute a
session. Two legitimate couplings pointing opposite ways is a package cycle turbo refuses to build, and
routing one direction through a capability breaks it.

**Registries.** Publish a registry, and another plugin contributes to it through
`ctx.contribute(registry, entry)`. That is the line the escape hatch sits on: a registry the HOST owns
has a named `ctx` member above, and `ctx.contribute` is for a registry another plugin published. The
host records the disposable either way, so disabling that plugin removes its
entries. Use the seam rather than calling `registry.register` yourself: a bare register survives
a disable and re-enable cycle, then throws on the duplicate id at the next activation.

**Broadcasts.** Not this. `ctx.events` talks to clients, not to plugins.

Two things stay off limits between plugins: no cross-file foreign keys or transactions spanning plugin
databases, and no importing another plugin's implementation. Cross-plugin work uses explicit ids and
durable state on both sides.

## Notifications

Pick by how long the message should live.

| Call | Lifetime | Use it for |
| --- | --- | --- |
| `toast(message, { tone, durationMs })` | Seconds | "That worked." No actions, no buttons |
| `capabilities.get(WORKFLOWS_NOTICES)?.notice(taskId, kind, title)` | Until read | Something happened while the user was elsewhere. `workflows.notices`, from `plugins/workflows/src/contract/notices.ts` |
| `pushManagedAgentNotice({ taskId, sessionId, kind, title })` | Until read, plus an OS notification | An agent finished, needs input, or failed |
| `ctx.attentionSources.register(source)` | Until resolved | A state on the node that needs the owner to act |
| `bridge.ui.toast(title, detail)` | Seconds | The same, from inside a sandboxed frame |

Toast tones are `neutral`, `success`, and `danger`. A failure gets 8 seconds instead of 4, because it is
the one you might need to read twice.

A notice that should open something when clicked carries a `target`, and you register what happens with
`registerNoticeTargetHandler(kind, handler)`. The same dispatch serves the attention inbox, which uses
the identical target shape.

A toast that needs a button is the wrong control. If the user must act, that is an `Alert`. If it must
persist, that is a notice.

## Attaching to the rail

The rail is `ctx.sources.register(contribution)`. The fields that matter:

| Field | What it decides |
| --- | --- |
| `id`, `label`, `glyph`, `order` | Identity and position. Order is required, never derived from activation order |
| `component` | What the shell renders when your source is selected |
| `providerId` | Gates the source on an integration row existing. Omit it for a local source, which is always shown |
| `when` | An extra gate for relevance that is not an integration question |
| `projectScoped` | Opt in if your surface reads the routed project. The shell shows the project picker only for sources that declare it |
| `routes` | URL patterns to register, with an order so a static path can beat a parameter path |
| `taskPath` | Where a task belongs in the router when your source owns it |
| `tracksRef` | Does this task already track the item a reference panel is showing |
| `promotion` | How a row from your source becomes a task |
| `isDefault` | Your source is the initial browse surface |

One trap worth stating outright. The shell renders from the selected source, not from the URL. Every
contributed route mounts as a `noop` component and the shell picks the surface off the rail, so
navigating to your route while another source is selected changes the address bar and nothing else.
Set the source too.

Status markers are separate, and they are data only. A marker has no click verb:

```ts
ctx.railMarkers.register({
  id: 'tunnels',
  order: 50,
  // Called during the consuming render, for every visible control, so read your own signals here
  // and the rail re-renders when they change.
  markers: (target) => {
    if (target.kind !== 'task') return []
    const open = tunnelsForTask(target.id).length
    if (!open) return []
    return [{
      id: 'open',
      label: `${open} open tunnel${open === 1 ? '' : 's'}`,  // the tooltip legend and the a11y text
      icon: 'radio-tower',       // exactly one of icon or dotTone
      tone: 'accent',            // neutral, accent, warn, or danger
      placements: ['top-end', 'bottom-end'],  // preferences in order, never guarantees
    }]
  },
})
```

Placements are `top-start`, `top-end`, `bottom-start`, and `bottom-end`. The slot under the main
glyph is reserved for host lifecycle and activity, because two things there read as one broken thing.
Priorities are clamped to 100, so you can order your own markers among themselves without outranking a
core lifecycle state.

The host qualifies your marker ids with your contribution id, so two plugins can both call a marker
`running`. A throwing contribution is isolated and logged rather than blanking the rail.

## Example: a compiled plugin, both halves

A plugin that watches something on the node and shows it in the rail.

The node half:

```ts
import type { NodePlugin } from '@acorn/plugin-api/node'
import { Hono } from 'hono'

export const tunnelsPlugin: NodePlugin = {
  name: 'tunnels',
  // Turns ctx.storage on. The host binds the filename to your plugin id and walks from this module
  // for the migration chain, which is how one declaration covers all three runtime layouts.
  migrationsModule: import.meta.url,

  async init(ctx) {
    const db = ctx.storage.open()

    const app = new Hono()
    app.get('/list', async (c) => c.json({ tunnels: await listTunnels(db) }))
    // Mounts at /v2/p/tunnels. The host binds the namespace, so you cannot mount under another id.
    ctx.routes.register(app)

    ctx.schedules.register({
      scheduleId: 'reap',
      name: 'Close idle tunnels',
      // { every: seconds }, { daily: '03:00' }, or { weekly: { day, at } }. Clamped on read to the
      // plugin floor of 300 seconds, because your work hits someone else's rate budget.
      cadence: { every: 600 },
      run: async (signal) => {
        const closed = await reapIdle(db, ctx.core.proc, signal)
        // Content-free. Every client re-reads /list rather than trusting a payload that has to stay
        // correct across reconnects.
        if (closed > 0) ctx.events.status()
        return `closed ${closed}`
      },
    })
  },

  dispose() {
    // What this plugin opened. Not the database: the host closes that after this returns.
    stopWatchers()
  },
}
```

The client half:

```ts
import { lazy } from 'solid-js'
import { toast, wsOnStatus, type ClientPlugin } from '@acorn/plugin-api/client'
import { refreshTunnels, tunnelsForTask } from './store'

const TunnelsSurface = lazy(() => import('./TunnelsSurface'))

export const tunnelsClientPlugin: ClientPlugin = {
  name: 'tunnels',
  init(ctx) {
    ctx.sources.register({
      id: 'tunnels',
      order: 70,
      glyph: 'radio-tower',
      label: 'Tunnels',
      component: TunnelsSurface,
      projectScoped: true,
    })

    ctx.railMarkers.register({
      id: 'open',
      order: 50,
      markers: (target) => {
        if (target.kind !== 'task') return []
        const open = tunnelsForTask(target.id).length
        return open
          ? [{ id: 'open', label: `${open} open`, icon: 'radio-tower', tone: 'accent', placements: ['top-end'] }]
          : []
      },
    })

    ctx.schedules.register({
      id: 'tunnels',
      intervalMs: 30_000,
      run: refreshTunnels,
      // The node's status ping arrives sooner than 30 seconds when something actually changed.
      subscribe: (refresh) => wsOnStatus(refresh),
    })
  },

  activate() {
    // The side-effect pass. Fire and forget, and handle your own rejection: init must stay synchronous.
    refreshTunnels().catch(() => toast('Could not read tunnels', { tone: 'danger' }))
  },
}
```

Two roster lines make it real: one in `apps/node/src/server/plugins.ts`, one in
`apps/desktop/src/app/client/plugins.ts`.

## Example: a loaded plugin pushing to its own frame

A loaded plugin has no Hono and no channel prefix. It serves a fetch handler and broadcasts on its own
namespace.

The node half:

```ts
import { portableCarrier, type NodePlugin } from '@acorn/plugin-api/node'
import { pluginChannel } from '@acorn/protocol/pluginState.ts'
import { Hono } from 'hono'

export default {
  name: 'buildwatch',
  init(ctx) {
    const app = new Hono()
    const { portableFetch, requestContext } = portableCarrier('buildwatch')
    app.get('/status', (c) => c.json({ state: current(), userId: requestContext(c).userId }))
    // The portable carrier, not ctx.routes.register. A Hono instance cannot cross a process
    // boundary. A (Request) to Response function can.
    ctx.routes.fetch(portableFetch(app))

    onBuildChange((state) => {
      // plugin:buildwatch:status. Broadcasting on anything else throws. The manifest has to list this
      // channel under permissions.events before a frame may subscribe.
      ctx.events.send({ channel: pluginChannel('buildwatch', 'status'), state })
    })
  },
} satisfies NodePlugin
```

The frame half:

```tsx
import { mountFrame } from '@acorn/plugin-api/ui/sdk'
import { render } from 'solid-js/web'
// Inlined, not linked: a plugin origin serves one file, so a frame with a separate asset is broken.
import styles from './styles.css?inline'

mountFrame({ styles }, (bridge, root) => {
  const [state, setState] = createSignal('unknown')

  // Returns the unsubscribe. Only your own plugin's channels resolve; another plugin's throws.
  const off = bridge.events.on('plugin:buildwatch:status', (payload) => {
    setState((payload as { state: string }).state)
  })
  onCleanup(off)

  // Your own routes, already authenticated. The path is relative to your mount.
  void bridge.api.get<{ state: string }>('/status').then((r) => setState(r.state))

  // Persists through core prefs under plugin:buildwatch:*, the same namespace the node half's prefs
  // facet is projected into. This is the supported node-to-frame state channel, capped at 1 MiB.
  void bridge.state.set('lastSeen', Date.now())

  render(() => <Status state={state()} />, root)
})
```

## Rules that bite

Collected from the gotchas that cost the most time.

- Resolve a capability at call time, never at `init` or module scope.
- Use the `ctx` seam rather than a bare `registry.register`, so the host owns the disposable.
- Set the rail source when you navigate. Contributed routes mount as `noop`.
- Register through `ctx`, not by importing another plugin.
- The node half does not hot-reload. A change needs a node restart, or
  `POST /v2/core/plugins/:id/reload` for a loaded plugin.
- Declared node permissions on a loaded plugin are disclosure, not containment. A loaded bundle shares
  the node's process and can `import('node:fs')`. See [security.md](./security.md) for the threat model,
  and say "declared" wherever you render them.
- A table-owning package can never change its id. The database filename is bound from it, and renaming
  orphans real rows.

## Where to go next

- [plugins.md](./plugins.md) for the reference: the full API surface rules, activation, task checks,
  harnesses, collaboration rules, and data ownership.
- [plugin-authoring.md](./plugin-authoring.md) for writing a loaded package by hand, including the
  manifest and the install loop.
- [extensibility.md](./extensibility.md) for why the two tiers exist and what each is allowed to become.
- [panes.md](./panes.md) for panes and reference panels.
- [docs/future/events/](./future/events/README.md) for the cross-plugin event design that is not built.
