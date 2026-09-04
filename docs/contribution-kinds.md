# Contribution kinds

Every way a plugin can add something to acorn, in one table, with its tier and where it is declared.
This page exists to be seen whole: the vocabulary reached sixty kinds across two plugin APIs that
overlap without nesting, and the health metric is what it would take to add kind sixty-one. If a row
here is hard to justify, that is the finding.

Read [extensibility.md](./extensibility.md) first for why there are two tiers at all, and
[plugins.md](./plugins.md) for how each mechanism works. This page is the index, not the manual.

## How to read it

**Tier** is who can contribute the kind.

- **Both** — a loaded plugin declares it in `acorn-plugin.json` and a compiled plugin registers it
  through a context member. The two feeders build the same registration and nothing downstream can
  tell them apart.
- **Compiled** — first-party only, because the contribution is a live object: a component in the
  host's realm, a stream, a function another plugin calls in-process.
- **Loaded** — declared in a manifest only. There are none: every manifest descriptor has a context
  twin, because the host synthesises the registration through the same seam.

**Where** is the declaration site: a `ctx.*` member, a `contributions.*` array in the manifest, or
both.

**Direction** is only filled in for a single-tier row. It says whether the kind gains a twin in the
other tier or stays where it is, and why. A blank direction on a **Both** row means there is nothing
to decide.

## Client contributions

Drawn by the shell. A loaded plugin's UI is an iframe (`frames`), a tree of the host's own components
emitted from a worker (`remote`), or a descriptor the host renders. It never hands the shell a
component: a tree names one, and the host mounts its own.

| Kind | Tier | Where | Host |
| --- | --- | --- | --- |
| Panes | Both | `ctx.panes` / `contributions.frames` (`target: 'pane'`) | A task's pane layout |
| Project surfaces | Both | `ctx.contribute(projectSurfaceRegistry)` / a project-scoped `frames` entry plus its `contributions.routes` entry | The project view, beside the plugin's rail list |
| Reference panels | Both | `ctx.refPanels` / `frames` (`target: 'refPanel'`) | The side panel over an external item |
| Overlays | Both | `ctx.slots` (`slot: 'overlay'`) / `frames` (`target: 'overlay'`) | A window-level modal |
| Settings pages | Both | `ctx.settingsPages` / `frames` (`target: 'settings'`) | Settings |
| Importers | Both | `ctx.projectImporters` / `frames` (`target: 'importer'`) | The project-import modal |
| Webviews | Both | — / `frames` (`target: 'webview'`) | A pane showing external web content |
| Rail sources | Both | `ctx.sources` / `contributions.sources` | The left rail |
| Slots | Both | `ctx.slots` / `contributions.slots` | See the slot vocabulary below |
| Commands | Both | `ctx.commands` / `contributions.commands`, `contributions.palette` | The command palette and chords. One kind, five shapes: an action, a group, a search, an input, a setting ([command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md)). `contributions.palette` is the older array and is an alias for a command with `palette: true` — it is rewritten into one at registration and never produces a second row |
| Keybindings | Both | `ctx.keybindings` / `contributions.keybindings` | The chord dispatcher |
| Attention sources | Both | `ctx.attentionSources` / `contributions.attention` | The notification inbox. An item of `info` severity is a nudge the owner can retire by acknowledging it; `warn` and `danger` stay until the block is lifted ([notifications.md](./notifications.md) § Acknowledging an attention row) |
| Node stats | Both | `ctx.nodeStats` / `contributions.nodeStats` | A node card on Fleet home |
| Content links | Both | `ctx.contentLinks` / `contributions.contentLinks` | The in-app link router |
| Agent contexts | Both | `ctx.agentContexts` / `contributions.agentContexts` | The context tray on an agent launch |
| Ref resolvers | Both | `ctx.contribute(refResolverRegistry)` / `contributions.refResolvers` | External-item label resolution |
| Themes | Both | `ctx.contribute(themeRegistry)` / `contributions.themes` | The appearance picker |
| Context menus | Both | `ctx.contribute(contextMenuRegistry)` / `contributions.contextMenus` | Host-drawn context menus |
| Extension points | Both | `ctx.extensionPoints` / `contributions.extensionPoints` | A surface a plugin opens to others, in one of five kinds: rows, annotations, remote trees, rectangles, hooks (docs/plugins.md § Cooperative extension points). The host mints `<pluginId>:<id>` from the plugin doing the registering, either way in. A `remote` point may also declare `actions`, the closed list of things a contributor's tree may ask it to do (docs/plugins.md § Asking the owner); the owner binds a handler of the same name per `Slot`, and a name missing from either list is refused. |
| Extensions | Both | `ctx.extensions` / `contributions.extensions` | A contribution into someone else's point. A compiled plugin's carrier is a `component` the host mounts where it would mount a worker's tree; a loaded plugin's is `items`, `remote`, `frame` or `route`. A `remote` one may name `overlay`, one of its own manifest's overlay frames that this tree may ask the host to present (docs/plugins.md § Companion overlays). That is a qualifier on the carrier, not a sixth carrier: a descriptor still names exactly one. |
| Collections | Both | `ctx.collections` / `contributions.collections` | Dashboard panels |
| Brand marks | Both | `ctx.brandMarks` / manifest `icon` and `icons` | The `brand:` glyph namespace |
| Client schedules | Compiled | `ctx.schedules` | The device-local scheduler. **Direction: stays compiled.** A loaded plugin's periodic work belongs on the node, which runs whether or not a client is open (docs/schedules.md § Why the node, and only the node). The client registry exists for work that has no meaning without a window. |
| Integration flows | Compiled | `ctx.integrationFlows` | The connect-a-provider wizard. **Direction: gains a manifest twin.** Named as a blocker on moving `github` out of tree ([compiled-tier.md](./future/compiled-tier.md)); the flow is already a sequence of steps rather than a component, so the descriptor is a shape question, not a seam question. |
| Rail markers | Compiled | `ctx.railMarkers` | A status dot on a rail control. **Direction: gains a manifest twin,** in rail-tab slice 3 ([rail-tab.md](./future/rail-tab.md)). Data only, no click verb, so the descriptor is a route plus a colour. Not landed as of 2026-08-28. |
| Persisted state slices | Compiled | `ctx.persistedStateSlices` | Device-local persisted state. **Direction: stays compiled.** A loaded plugin has `plugin:<id>:*` prefs through `ctx.core.prefs` and its frame's own `state` verb, which is the same capability with the namespace bound by the host. A second mechanism would be a second namespace to police. |
| Client capabilities | Compiled | `ctx.capabilities` | Plugin-to-plugin function calls in the renderer. **Direction: stays compiled, permanently.** A live function cannot cross the iframe boundary. The loaded tier's equivalent is a route, and that is the right shape for it. |

## Node contributions

Run by the node, with or without a client attached.

| Kind | Tier | Where | Host |
| --- | --- | --- | --- |
| Routes | Both | `ctx.routes.register` (compiled, Hono) / `ctx.routes.fetch` (both, portable) | `/v2/p/<pluginId>/` |
| Schedules | Both | `ctx.schedules` / `contributions.schedules` | The node scheduler (docs/schedules.md) |
| Collections | Both | `ctx.collections` / `contributions.collections` | The measure sampler |
| Task checks | Both | `ctx.taskChecks` / `contributions.taskChecks` | The archive gate |
| Runs | Both | `ctx.runs` | The merged run list at Settings → Runs. A pointer at a route that lists this plugin's runs |
| Audit actions | Both | `ctx.audit` / `contributions.auditActions` | The owner-readable trail, qualified `<pluginId>:<actionId>` (docs/security.md § Audit) |
| Extension points | Both | `ctx.extensionPoints` (`declare` / `handle` / `handlers`) | The node's many-to-many seam for typed values: one plugin declares a point, any number fill it |
| Hooks | Both | `ctx.hooks` / `contributions.extensionPoints` (`kind: 'hook'`) and `contributions.extensions` (a `route` plus a `mode`) | A turn in one plugin's decision before it happens, in a chain the host runs with a timeout and a verdict (docs/plugins.md § Hooks) |
| Harnesses | Both | host seam / `contributions.harnesses` | Managed agent sessions (docs/managed-agents.md) |
| Node actions | Both | host seam / a `commands` entry whose verb is `runNodeAction` | Work a plugin does when something asks. A user schedule is what asks today |
| Agent tools | Compiled | `ctx.tools` | The MCP, harness and renderer projections. **Direction: gains a manifest twin.** The blocker is the input schema: a tool's `input` is a Zod object, and the manifest carries JSON. A JSON Schema field is the obvious shape and the work is validating it, not designing it. |
| Context sections | Compiled | `ctx.contextSections` | The assembled task-context prompt. **Direction: gains a manifest twin** alongside agent tools, and for the same reason: a section is a label plus a route that returns text, which is descriptor-shaped. Today only the client half (`agentContexts`) has one. |
| Providers | Compiled for `model`, both for the rest | `ctx.providers` | Connection, integration, model-provider and node registries. **Direction: stays compiled for the adapter, gains a descriptor for the flow.** An adapter is a set of functions the host calls; a loaded plugin serves the same thing over its own routes, which is why `providers.integration` already accepts a fetch handler. `providers.nodes` is the exception that already works loaded, because a node provider is functions and nothing else — no routes, no descriptor (docs/plugins.md § Node providers). Only `model` is on `CompiledPluginProviderRegistry`; `integration`, `connection`, `nodes` and `withConnection` are on the loaded one. |
| Capabilities | Both | `ctx.capabilities` | Cross-plugin typed functions. A loaded plugin may provide only ids inside its own `<pluginId>.` namespace |
| Storage | Both | `ctx.storage` | One host-opened, host-migrated SQLite file per plugin |
| Core services | Both | `ctx.core` | Path confinement, git, the process broker, credentials, the core read models |
| Broadcasts | Both | `ctx.events` | The WebSocket hub. A loaded plugin sends on `plugin:<id>:*` only, and hears core events by manifest grant |

## The slot vocabulary

There is no separate agent tool renderer row above, and there was one until phase 9 of the layout
programme. A tool card is a contribution to `agents:tool-card`, an ordinary `remote` point, and the
changes plugin fills it with a `component` carrier the same way a loaded plugin fills it with a tree.
Both render paths, one kind, one arbitration, one settings picker. That is the pattern for anything
that looks like a private renderer registry: open a point instead.

**This is not the five extension kinds, and it was not replaced by them.** A slot is a place in the
*shell's* own chrome that a plugin may put a badge in; an extension point is a place in *another
plugin's* surface, and its five kinds are in [plugins.md](./plugins.md) § Cooperative extension
points. The layout programme was expected to fold this table into that one and did not, because the
descriptor slot registry outlived it: a topbar chip has to be live when no plugin UI is mounted
anywhere, which is the one thing a tree cannot be.

Two spellings, deliberately, and this is where they meet. The manifest's `slots[].slot` is a short
enum a descriptor may name; `UiSlotId` is the full set of places the shell draws a slot, most of
which have no descriptor form because what goes in them is a component.

| Manifest `slot` | `UiSlotId` | Notes |
| --- | --- | --- |
| `topbar` | `topbar.right` | The app's status bar, and the only topbar slot with a host. A chip sits after the notification bell |
| `footer` | `task.footer` | Inside a task's layout |
| — | `topbar.left` | No host draws it today |
| — | `task.switcher.extra` | Compiled only |
| — | `overlay` | Reached from the manifest as a `frames` entry with `target: 'overlay'`, not as a slot |
| — | `drawer` | The terminal drawer. Compiled only, permanently: it holds a PTY stream |

A slot name this client does not know is skipped rather than mapped to a default. A roster row is
bytes a node sent, and a newer node's `topbar.left` must not silently become the footer.

## Adding kind sixty-one

The question to answer before adding one, in order:

1. **Does an existing kind already draw this?** A pane with a route is most things.
2. **Which tier?** If the answer is "compiled, because it is a component", say so in the row and
   name what would have to change for that to stop being true. A permanent single-tier kind is a
   fine answer; an unexamined one is not.
3. **Is there a descriptor shape?** If a loaded plugin cannot express it, the kind is a first-party
   surface with a plugin-shaped name, and calling it a contribution kind makes the vocabulary longer
   without making the platform wider.
4. **What does it cost a reader?** One row here, one entry in the manifest schema, one registration
   site, and one thing every future author has to scan past.

## Related

- [extensibility.md](./extensibility.md) — why two tiers, and where the line is drawn
- [plugins.md](./plugins.md) — how each mechanism works
- [plugin-authoring.md](./plugin-authoring.md) — writing one
- [future/compiled-tier.md](./future/compiled-tier.md) — the plan for shrinking the compiled-only column
