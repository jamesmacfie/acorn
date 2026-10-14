# Contribution kinds

This page lists every way a plugin can add something to acorn, in one table, with its tier and where
it's declared. Read it before you add a contribution kind, because a kind may already do what you
want. [Extensibility](./extensibility.md) explains why there are two tiers, and the
[plugin reference](./plugins.md) explains how each mechanism works. This page is the index.

`tools/arch/contributionKinds.test.ts` holds the table against the code. It fails when a manifest
contribution key or a `ctx` member on either context type is missing from the page, and when a
single-tier row has no direction.

## How to read it

**Tier** says who can contribute the kind:

- **Both**: a loaded plugin declares it in `acorn-plugin.json`, and a compiled plugin registers it
  through a context member. The two build the same registration, and nothing downstream can tell
  them apart.
- **Compiled**: first-party only, because the contribution is a live host object with no
  structured-clone contract, such as a component or a stream.
- **Loaded**: declared in a manifest only.

**Where** is the declaration site: a `ctx.*` member, a `contributions.*` key in the manifest, or both.

**Direction** appears only on a single-tier row. It says whether the kind gains a twin in the other
tier or stays where it is, and why.

## Client contributions

The shell draws these. A loaded plugin's UI is an iframe (`frames`), a tree of the host's components
from a worker (`remote`), or a descriptor the host renders. It never hands the shell a component.

A device-held, client-only package may declare client contributions that need no Node handler. Its
rail source uses `tree: { list, detail }`, and route-backed kinds are refused
([device-held plugins](./plugins/client-half.md#device-held-plugins)). Every loaded client kind
registers from the current Node's active declaration and selected bundle, so a failed, stale, absent,
or unaccepted runtime leaves nothing visible ([distribution](./plugins/distribution.md)).

| Kind | Tier | Where | Host |
| --- | --- | --- | --- |
| Panes | Both | `ctx.panes` / `contributions.frames` (`target: 'pane'`) | A task's pane layout |
| Project surfaces | Both | `ctx.contribute(projectSurfaceRegistry)` / a project-scoped `frames` entry plus its `contributions.routes` entry | The project view, beside the plugin's rail list |
| Reference panels | Both | `ctx.refPanels` / `frames` (`target: 'refPanel'`) | The side panel over an external item |
| Overlays | Both | `ctx.slots` (`slot: 'overlay'`) / `frames` (`target: 'overlay'`) | A window-level picker |
| Settings pages | Both | `ctx.settingsPages` / `frames` (`target: 'settings'`) | Settings, in the group the page names as `category`, or Features. `keywords` and `sections` feed settings search, and `railSourceVisibility` puts **Show in left rail** switches on the plugin strip ([settings pages](./plugin-authoring/settings-pages.md)). A compiled page that absorbed another lists the old id in `aliases` |
| Importers | Both | `ctx.projectImporters` / `frames` (`target: 'importer'`) | The project-import modal |
| Webviews | Both | — / `frames` (`target: 'webview'`) | A pane showing external web content |
| Rail sources | Both | `ctx.sources` / `contributions.sources` | The left rail ([rail source visibility](./frontend/rail-and-routing.md#rail-source-visibility)) |
| Session sources | Compiled | `ctx.sessionSources` | Node-scoped session summaries and send and focus actions for shared pickers, quit concerns, and navigation. **Direction: stays compiled.** Loaded plugins use commands and attention, and no loaded session carrier is needed without a consumer |
| Reference targets | Compiled | `ctx.referenceTargets` | Where **Add to agent** drops a file reference from the editor or the Changes tab. Targets are tried from the highest `priority` down, and the first that answers takes it. Core's fallback is the task's latest running agent session, at priority 0. **Direction: stays compiled.** A target is an in-process function |
| Slots | Both | `ctx.slots` / `contributions.slots` | See [the slot vocabulary](#the-slot-vocabulary) |
| Commands | Both | `ctx.commands` / `contributions.commands` | The command palette and chords, in five shapes: action, group, search, input, and setting ([commands](./plugins/commands.md)) |
| Keybindings | Both | `ctx.keybindings` / `contributions.keybindings` | The chord dispatcher |
| Attention sources | Both | `ctx.attentionSources` / `contributions.attention` | The notification inbox. An `info` item can be acknowledged, and `warn` and `danger` stay until resolved ([the notification gate](./notifications/gate.md)). A loaded plugin's items get their target from the host |
| Node stats | Both | `ctx.nodeStats` / `contributions.nodeStats` | A Node card on Fleet home |
| Content links | Both | `ctx.contentLinks` / `contributions.contentLinks` | The in-app link router |
| Agent contexts | Both | `ctx.agentContexts` / `contributions.agentContexts` | The context tray on an agent launch. The capture scope includes the task ID and optional workspace and target session IDs; the agents contribution uses the session ID to exclude the receiving session |
| Ref resolvers | Both | `ctx.contribute(refResolverRegistry)` / `contributions.refResolvers` | External-item label resolution |
| Themes | Both | `ctx.contribute(themeRegistry)` / `contributions.themes` | The appearance picker |
| Style packs | Loaded | `contributions.styles` | **Settings > Appearance**. The host validates token data and generates the CSS. **Direction: stays loaded, as validated data.** |
| Context menus | Both | `ctx.contextMenus` (or `ctx.contribute(contextMenuRegistry)`) / `contributions.contextMenus` | Host-drawn context menus on task rows, item rows, the plugin's own rail icons, Editor's files and tabs, transcript messages and turns, and selected text ([context menus](./plugins/menus-and-markers.md#context-menus)) |
| Document services | Both | — / `contributions.documentServices` | Hover and diagnostics for Editor's files in one language, from the plugin's own routes. On a tie the person picks one per Node ([language smarts](./editor/document-surface.md#language-smarts)) |
| Extension points | Both | `ctx.extensionPoints` / `contributions.extensionPoints` | A surface a plugin opens to others, in one of five kinds ([cooperative extension points](./plugins/cooperative-extension-points.md)). A `remote` point may declare `actions` a contributor's tree may ask for, and a loaded owner's `mounts` places it above or below its own detail views ([detail regions](./plugins/detail-regions.md)) |
| Extensions | Both | `ctx.extensions` / `contributions.extensions` | A contribution into another plugin's point. A compiled carrier is a `component` or a `marks` function, and a loaded one is `items`, `remote`, `frame`, or `route`. `matches` narrows a tree or rectangle to the keys it draws. See [places to fill](#places-to-fill) |
| Brand marks | Both | `ctx.brandMarks` / manifest `icon` and `icons` | The `brand:` glyph namespace |
| Client schedules | Compiled | `ctx.schedules` | The device-local scheduler. **Direction: stays compiled.** A loaded plugin's periodic work belongs on the Node, which runs with no client open |
| Integration flows | Compiled | `ctx.integrationFlows` | The connect-a-provider wizard. **Direction: gains a manifest twin.** The flow is a sequence of steps, not a component ([compiled tier](./future/compiled-tier.md)) |
| Rail markers | Compiled | `ctx.railMarkers` | A status marker on a task, source, or pane control. **Direction: stays compiled.** Loaded plugins mark tasks, sources, and task panes through the `core:task`, `core:source`, and `core:pane` annotation points |
| Persisted state slices | Compiled | `ctx.persistedStateSlices` | Device-local persisted state. **Direction: stays compiled.** A loaded plugin has `plugin:<id>:*` preferences through `ctx.core.prefs` and its frame's `state` verbs |
| Client capabilities | Compiled | `ctx.capabilities` | Plugin-to-plugin function calls in the renderer. **Direction: stays compiled, permanently.** A live function can't cross the iframe boundary, and the loaded equivalent is a route |

## Node contributions

The Node runs these, with or without a client attached.

| Kind | Tier | Where | Host |
| --- | --- | --- | --- |
| Routes | Both | `ctx.routes.register` (compiled, Hono) / `ctx.routes.fetch` (both, portable) | `/v1/p/<pluginId>/` |
| Schedules | Both | `ctx.schedules` / `contributions.schedules` | The Node scheduler ([schedules](./schedules.md)) |
| Typed data sources | Both | `ctx.dataSources.register` / `contributions.dataSources` | Bounded typed record reads |
| Dataset writes | Compiled | `ctx.datasets` | A task-scoped host call for workflow output. **Direction: stays compiled.** Loaded plugins and frames cannot write host datasets; the Node validates the task, feeder, version, and row schema |
| Source discovery | Both | `ctx.dataSources.discover` / `contributions.dataSourceDiscoveries` | Scoped dynamic source catalogues |
| Task checks | Both | `ctx.taskChecks` / `contributions.taskChecks` | The archive gate |
| Search providers | Compiled | `ctx.search` | The grouped archive search ([search providers](./plugins/search-providers.md)). **Direction: gains a manifest twin** when a loaded plugin wants to be searchable, as a route the host calls |
| Runs | Both | `ctx.runs` | The merged list at **Settings > Run history** |
| Audit actions | Both | `ctx.audit` / `contributions.auditActions` | The owner-readable trail, qualified `<pluginId>:<actionId>` ([audit](./security/audit.md)) |
| Extension points | Both | `ctx.extensionPoints` (`declare`, `handle`, `handlers`) | The Node's many-to-many seam for typed values |
| Hooks | Both | `ctx.hooks` / `contributions.extensionPoints` (`kind: 'hook'`) and `contributions.extensions` (a `route` plus a `mode`) | A turn in one plugin's decision before it happens ([hooks](./plugins/hooks.md)) |
| Harnesses | Both | Host seam / `contributions.harnesses` | Managed agent sessions ([harnesses](./managed-agents/harnesses.md)) |
| Custom agents | Both | Host seam / `contributions.customAgents` | Saved agents under **New** ([custom agents](./managed-agents/custom-agents.md)) |
| Skills | Loaded | `contributions.skills` | Named procedures every managed session can load, qualified `<pluginId>:<id>` ([skills](./managed-agents/skills.md)). **Direction: stays loaded-only**, because a skill is a folder in a package and a compiled plugin's text ships with acorn |
| Node actions | Both | Host seam / a `commands` entry whose verb is `runNodeAction` | Work a plugin does when a user schedule asks |
| Agent tools | Both | `ctx.tools` / `contributions.agentTools` | The MCP, harness HTTP, and renderer projections. The host qualifies a loaded tool as `<pluginId>_<localId>` and applies authority, permissions, risk, and limits before dispatch |
| Context sections | Both | `ctx.contextSections` / `contributions.contextSections` | The assembled task-context prompt |
| Code hosts | Both | `NodePlugin.codeHost` / `contributions.codeHost` | Which plugin owns a project's Git remote, by host, and how core checks out and shows its change requests ([code hosts](./plugins/code-hosts.md)) |
| Browser handoffs | Both | `NodePlugin.browserHandoffs` / `contributions.browserHandoffs` | Buttons the browser extension draws on websites, each resolved by the plugin's own route ([browser handoffs](./plugin-authoring/browser-handoffs.md)) |
| Task addresses | Loaded | `contributions.taskAddresses` | One route listing the exact origins the plugin's tasks' apps answer at while they run, which the browser extension matches pages against ([task addresses](./plugin-authoring/browser-handoffs.md#task-addresses)). **Direction: gains a compiled twin** on `NodePlugin` when a compiled plugin runs an app for a task |
| CLI commands | Loaded | `contributions.cliCommands` | Headless `acorn plugin` commands, dispatched to the plugin's `/cli/<name>` route ([CLI command authoring](./plugin-authoring/cli-commands.md)). **Direction: stays loaded-only**, because the host validates static manifest metadata before activation |
| Providers | Both | `ctx.providers` | Connection, integration, model-provider, and Node registries. A model adapter's `generateText` crosses the worker as data, and `providers.integration` takes a fetch handler for routes ([Node providers](./plugins/node-providers.md)) |
| Capabilities | Both | `ctx.capabilities` | Cross-plugin typed functions. A loaded plugin provides only ids in its own `<pluginId>.` namespace |
| Storage | Both | `ctx.storage` | One host-opened, host-migrated SQLite file per plugin |
| Core services | Both | `ctx.core` | Path confinement, Git, the process broker, credentials, and core read models |
| Broadcasts | Both | `ctx.events` | The WebSocket hub. A loaded plugin sends on `plugin:<id>:*` only, and hears events by manifest grant |
| Telemetry | Both | `ctx.telemetry` | Spans, events, counts, gauges, and errors about the plugin's own work, with no permission ([telemetry](./telemetry.md)) |
| Logging | Both | `ctx.log` | A line prefixed with the plugin id, and a log record when telemetry is on ([logging](./telemetry/logging.md)) |

## Places to fill

Each row is a shipped place a plugin can add UI to another plugin's surface. **Consent** says what
the owner declared. The `plugin_authoring` tool lists every point's props and key on the running Node.

| Need | Point or location | Carrier | Consent | Terminal |
| --- | --- | --- | --- | --- |
| A row on a file or a document tab | `file.row`, `document.tab` | Menu descriptor | Editor's menus take any plugin | **Actions** button or Shift+F10 |
| A row on a message or a finished turn | `agent.message`, `agent.turn` | Menu descriptor | Agents' menus take any plugin | The same menus |
| A row on selected text | `content.selection` | Menu descriptor | An owner wraps its content in `SelectionActions` | A message's whole text only |
| A mark on a file | `editor:file` | `items` route | Registered by Editor | Dots and a legend |
| Text after the cursor line, with a tooltip | `editor:line` | `items` route or compiled `marks` | Registered by Editor | None |
| A mark on a task, source, or task pane | `core:task`, `core:source`, `core:pane` | `items` route | None for `core:task`. A source or pane sets `statusAnnotations: true` | Counts and a legend |
| A preview of an HTTPS link | `core:link-preview` | Tree | Core | From the link's menu |
| A view of a code fence | `core:markdown-fence` | Tree | Transcripts and pane regions | Under a **Source** line |
| A view of a file | `editor:document` | Tree | Editor | The same |
| A view of transcript media | `agents:transcript-attachment`, `agents:artifact` | Tree | Agents | The same |
| A view of a workflow step's result | `workflows:step-body` | Tree | Workflows | The same |
| A tool call's card | `agents:tool-card` | Tree | Agents | The same |
| A toolbar control | `preview:toolbar-actions`, `terminal:toolbar-actions` | Tree | The owner declares `reload` or `interrupt` | Terminal's only |
| A section above a loaded owner's detail view | `linear:issue-summary`, `rollbar:item-summary` | Tree | The owner declares `mounts` | The same |
| Hover and diagnostics for a language | `documentServices` | Routes | Editor; a tie needs the person's pick | **Diagnostics** checks the saved file |

Every tree runs in the contributor's worker with its own permissions and reads through its own
routes. [An extension example](./plugin-authoring/extension-example.md) declares nine of these.

## The slot vocabulary

A slot is a place in the shell's own chrome where a plugin may put a badge. An extension point is a
place in another plugin's surface ([cooperative extension
points](./plugins/cooperative-extension-points.md)). Slots outlived the move to extension points
because a topbar chip has to be live when no plugin UI is mounted, which a tree can't be.

The manifest's `slots[].slot` is a short enum a descriptor may name. `UiSlotId` is the full set of
places the shell draws a slot, and most have no descriptor form, because what goes in them is a
component.

| Manifest `slot` | `UiSlotId` | Notes |
| --- | --- | --- |
| `topbar` | `topbar.right` | The status bar, and the only topbar slot with a host. A chip sits after the notification bell |
| `footer` | `task.footer` | Inside a task's layout |
| — | `topbar.left` | No host draws it |
| — | `task.switcher.extra` | Compiled only |
| — | `overlay` | Reached from the manifest as a `frames` entry with `target: 'overlay'` |
| — | `drawer` | The terminal drawer. Compiled only, permanently, because it holds a PTY stream |

A slot name this client doesn't know is skipped, not mapped to a default, because a newer Node's slot
name must not become the footer. A tool card isn't a slot: it's a contribution to `agents:tool-card`,
an ordinary `remote` point. Anything that looks like a private renderer registry should be a point.

## Adding a kind

Answer these questions, in order, before adding a kind:

1. **Does an existing kind already draw this?** A pane with a route covers most things.
2. **Which tier?** If it's compiled because it's a component, say so in the row and name what would
   have to change. A permanent single-tier kind is a fine answer, and an unexamined one isn't.
3. **Is there a descriptor shape?** If a loaded plugin can't express it, the kind is a first-party
   surface with a plugin-shaped name.
4. **What does it cost a reader?** One row here, one schema entry, one registration site, and one more
   thing every author scans past.

A Node kind's registry function returns a `Disposable`, and its `ctx` member passes that to `onUndo`
in `server/pluginHost/context.ts`, so teardown takes it back with everything else.
`server/pluginHost/teardown.test.ts` fails until the new member has a probe there.

## Related

- [Extensibility](./extensibility.md): why two tiers, and where the line is.
- [Plugin authoring](./plugin-authoring.md): writing a plugin.
- [Compiled tier](./future/compiled-tier.md): the plan for shrinking the compiled-only rows.
