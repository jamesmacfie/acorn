# Contributions

This page lists every key in a manifest's `contributions` block with its cap, the action verbs a
descriptor can run, and how to write a task check. It's part of [the manifest](./the-manifest.md).

## Contributions

`contributions` is a loose object: a manifest written for a newer acorn contributes less on an older
one instead of failing to parse. It has 26 named keys, each capped. A cap is the point where a
contribution stops being an integration and becomes an app inside someone else's chrome.

Pick the key by asking which of three things a surface is, in this order: a fact the host draws, UI
built from the host's components, or pixels the host can't draw
([choosing how a plugin draws](../plugins/ui-tiers.md)). A chip, badge, menu row, or palette entry is a
descriptor. A pane, panel body, settings page, or card in another plugin's list is a tree. A frame is
for pixels.

| Key | Cap | What it declares |
| --- | --- | --- |
| `frames` | 32 | A surface: `pane` (task or project scoped), `refPanel`, `settings`, `importer`, `webview`, `overlay`, `inline`, or `coreSlot`. A `pane`, `refPanel`, or `settings` surface must name a `layout` and its `regions`. A region is a tree (`{ "kind": "remote", "entry": "…" }`), a rectangle (`"frame"`), or a host-drawn document. See the frame keys below |
| `sources` | 8 | A rail source whose rows come from a route on your node half ([rail sources](../plugins/descriptors.md#rail-sources)). The source `id` keys the person's **Show in left rail** choice, so keep it stable |
| `slots` | 8 | A badge in `footer`, the task footer, or `topbar`, the status bar's right end ([descriptor slots](../plugins/ui-tiers.md#descriptor-slots)) |
| `commands` | 32 | A command, qualified to `plugin.<id>.<command>`. `kind` is required: `action`, `group`, `search`, `input`, or `setting` ([command kinds](../plugins/commands.md#command-kinds)) |
| `keybindings` | 32 | A chord for a command in this manifest ([keybindings](../plugins/commands.md#keybindings)) |
| `attention` | 4 | An attention-inbox feed, fetched per Node from your route |
| `nodeStats` | 4 | A Node statistic, with a singular and plural label pair so a card reads "1 card stuck" |
| `contentLinks` | 16 | An `https://` URL recognizer that delivers one captured segment to a task pane, your reference panel, or both ([content links](../plugins/descriptors.md#content-links)) |
| `routes` | 8 | A renderer URL for a project-scoped pane, confined to `/p/:projectId/x/<id>/` |
| `agentContexts` | 4 | An entry in the agent composer's context picker ([agent contexts](../plugins/more-descriptors.md#agent-contexts)) |
| `refResolvers` | 4 | A batch enrichment route that turns identifiers of your items into a label and a state chip |
| `themes` | 8 | A color theme ([UI contributions](./ui-contributions.md#themes)) |
| `styles` | 8 | A style pack of shape, density, and typography tokens ([style packs](./ui-contributions.md#style-packs)) |
| `contextMenus` | 32 | A row on a host-drawn menu ([context menus](./ui-contributions.md#context-menus)) |
| `extensionPoints` | 16 | A place inside one of your surfaces other plugins may fill ([extensions](./extensions.md)) |
| `extensions` | 16 | What you bring to another plugin's point ([extensions](./extensions.md)) |
| `dataSources` | 32 | A Node-owned typed record source: `{ sourceId, name, singular, plural, identityScope, handler, icon?, providerId?, titlePointer?, urlPointer? }` ([typed data sources](../data-sources.md)) |
| `dataSourceDiscoveries` | 8 | A bounded source catalogue for resources unknown at install: `{ discoveryId, handler, providerId? }` |
| `schedules` | 4 | Work the Node runs on a timer: `{ id, name, run, cadence, timeout? }`. `timeout` defaults to 60 seconds ([schedules](../plugins/more-descriptors.md#schedules)) |
| `taskChecks` | 4 | What you say when the owner archives a task. See [task checks](#task-checks) |
| `auditActions` | 8 | A verb you write to the Node's audit trail: `{ id, label }`, qualified as `<id>:<action>`. `ctx.audit.record` refuses an undeclared verb |
| `harnesses` | 4 | A managed agent acorn starts and drives ([harnesses](./harnesses.md)) |
| `customAgents` | 8 | A saved start for a managed session ([custom agents](./custom-agents.md)) |
| `agentTools` | 16 | A task-scoped agent tool with a bounded JSON Schema and a handler in your namespace, named `<pluginId>_<id>` at runtime ([loaded tools](../agent-tools/loaded-tools.md#loaded-manifest-carriers)) |
| `contextSections` | 8 | Bounded reference data for the task prompt: `{ id, label, order, read, maxBytes, maxTokens, scope?, defaultIncluded?, timeoutMs? }` |
| `cliCommands` | 16 | Typed headless commands under `acorn plugin <id> <name>` ([CLI command authoring](./cli-commands.md)) |

## Frame keys

A `frames` entry can also carry these keys:

- A `list-detail` pane may set `collapsible: true`. A loaded pane collapses to an empty rail with the
  host's expand control.
- A task pane may set `showInSwitcher: false` when only a command opens it.
- `readsArchived: true` opts a task pane into the archived-task preview. Set it only when the pane
  reads stored history without a worktree and disables actions that start work.
- `availability` names a route that answers `{ [taskId]: boolean }` for the Node's active tasks. The
  pane is hidden on any task the answer doesn't mark `true` ([pane contributions](../panes/contributions.md)).
- `claimsKeys` lists modified chords the frame's own UI handles ([keys a frame
  claims](../plugins/commands.md#keys-a-frame-claims)).
- `destinations` declares up to eight cooperative notification destinations.
- A `settings` surface takes placement keys ([settings pages](./settings-pages.md)).
- A `coreSlot` surface names the core surface it offers to replace
  ([UI contributions](./ui-contributions.md#replacing-a-core-surface)).

## The action verbs

A descriptor doesn't run plugin code. It hands the host a verb from a closed set, and the host runs
it. The full set belongs to a rail source's `onSelect`, the one click site with a selected row, a
routed project, and the host's promotion callback:

| Verb | Effect |
| --- | --- |
| `openPane` | Push a task-scoped pane from this manifest into the active task's layout, with the clicked row's id as a pane intent |
| `openTask` | Go to the task the row names. A row that names no task gets a toast saying so |
| `navigate` | Change the URL to the route this manifest declared for a project-scoped pane, with the row as the item |
| `runNodeAction` | POST to a path inside `/v1/p/<id>/` |
| `createTask` | Host-owned promotion: the row supplies the task seed, and the host owns the modal, the ownership check, and the ordering |
| `openUrl` | Open an `https` URL in the browser |
| `openOverlay` | Open a full-screen picker this manifest declares |
| `surfaceAction` | Deliver this command's id to a frame or tree region of one of your own panes |

Commands, slot badges, context-menu rows, and a source's `emptyState` take six of them: `openPane`,
`openTask`, `runNodeAction`, `openUrl`, `openOverlay`, and `surfaceAction`. A `search` command's
`onSelect` also takes `navigate`. A verb that parses and then always fails is worse than one the
manifest refuses.

## Task checks

A `taskChecks` entry, `{ id, check, apply?, timeout? }`, runs when a person is about to lose
something. Archiving a task removes its worktree, so the host asks every plugin first and draws the
answers in one dialog. Your `check` route is called with `?taskId=` and answers `{ concern: null }`,
the common case that must stay cheap, or:

```json
{ "concern": { "id": "containers", "severity": "warn",
               "message": "8 running containers are linked to this task",
               "details": ["api", "db", "worker"], "detailsMore": 5,
               "action": { "label": "Also stop its containers", "checked": true } } }
```

`details` is listed under the message, at most five entries, and `detailsMore` counts the rest. If the
checkbox from `action` is still ticked when the owner confirms, the host posts `{ taskId }` to your
`apply` while the worktree still exists. With no `apply`, no checkbox is drawn, which is the right
mode for anything you shouldn't do on someone's behalf.

Your check has two seconds and your cleanup has sixty. The host stops waiting either way, so a check
must be quick, not only interruptible. A check that's slow, throws, or answers with something the host
can't draw adds no row, and the archive is never blocked by a broken plugin. Both routes appear in the
trust prompt ([task checks](../plugins/task-checks.md)).
