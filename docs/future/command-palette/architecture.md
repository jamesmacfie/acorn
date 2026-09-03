# Command palette target architecture

Designed 2026-09-03 against `7d62e3ec`. This is the target after phase 6, not the current API.

## Boundaries

- **Protocol** owns loaded-manifest descriptors and the bounded wire shapes returned by plugin routes.
- **Client-core command host** owns registration, graph validation, availability, execution context,
  and the palette session state machine.
- **Desktop and TUI** own rendering and host adapters only.
- **Compiled plugins** register typed command callbacks.
- **Loaded plugins** declare descriptors and implement routes inside their own namespace.
- **Feature state** remains with its owner. A command calls the same task, pane, preference, or plugin
  service as the existing surface; the palette stores no durable product state.

## Command graph

`CommandContribution` becomes a discriminated union with these common fields:

| Field | Meaning |
| --- | --- |
| `id` | Stable global ID after host qualification. |
| `kind` | `action`, `group`, `search`, `input`, or `setting`; omitted means `action` for compatibility. |
| `title`, `hint`, `keywords` | Search and display copy. Dynamic compiled values receive the captured context. |
| `category` | Existing shortcut/help classification; it does not create hierarchy. |
| `order` | Stable sibling ordering before fuzzy relevance. |
| `parentId` | Optional static parent; the target must be a group owned by the same contributor. |
| `palette` | Whether the command is discoverable in the palette; an interactive shortcut may still target a non-root command. |
| `requires`, `when` | Host capability and contextual availability. Ancestor availability is inherited. |
| `scope` | `none`, `task`, `project`, `workspace`, `node`, or `fleet`; default `node`. |

Ownership is host-stamped. Core registrations are core-owned, compiled plugin registrations inherit
the `ClientPluginContext` owner, and loaded IDs become `plugin.<pluginId>.<localId>`. A plugin cannot
name another plugin's parent or supply its own ownership metadata.

The five variants add:

- `action`: `run(context) -> CommandOutcome`.
- `group`: no executor; children are commands whose `parentId` names it.
- `search`: placeholder, minimum query length, debounce, `query(text, context, signal)`, and
  `select(item, context)`.
- `input`: placeholder, optional synchronous validation, and
  `submit(text, context, signal) -> CommandOutcome`.
- `setting`: `read(context, signal)`, two or more labelled options, and
  `write(value, context, signal) -> canonical value`.

An action or successful input returns `close` by default. `stay` carries optional status text. A
throw or rejected promise is an error and keeps the current frame open. Search selection defaults to
close after its owner-declared action succeeds. Setting writes always stay and refresh the current
marker.

### Graph validation

Registration refuses duplicate IDs. A child must name a registered group belonging to the same
owner; plugin code registers parents before children. Whole loaded manifests receive an additional
cross-field validation pass for missing parents, non-group parents, and cycles before any command is
registered. If a parent is disposed before a child during development reload, the projection hides
the orphan and reports one diagnostic until reverse-order disposal completes.

The empty root lists available commands without a parent. A non-empty root query indexes all
available commands, including descendants, against title, keywords, hint, and the joined breadcrumb.
Results show the breadcrumb as secondary text. A hidden or unavailable ancestor makes its descendants
unavailable.

## Execution context

The host captures one immutable `CommandExecutionContext` when a session opens:

- host kind (`desktop` or `tui`) and active node ID;
- optional workspace, project, task, pane, and surface identity;
- navigation, pane, Settings, and fleet adapters required by core and closed chrome actions.

The context is passed to availability predicates, providers, and executors. An external change to
node/workspace/project/task identity closes the session and aborts outstanding work; a command-driven
change succeeds and closes through the ordinary outcome. This prevents results fetched for one
scope from being invoked in another.

A scoped command is unavailable when its required identity is absent. `node` sends requests only to
the captured active node. `fleet` asks the host fan-out adapter for capable nodes, executes one
request per node, namespaces result identity as `<nodeId>:<itemId>`, adds the node label, and reports
partial failures without erasing successful nodes.

## Palette session

The session is a host-neutral store with:

- `open`, captured context, and a stack of frames;
- query, selected index/ID, status, and invocation state per frame;
- one active abort controller and monotonically increasing request generation;
- commands to open root, open directly at a command, set query, move selection, activate, pop, and
  close.

Frame kinds are root/group/search/input/setting. Pushing preserves the complete parent frame. Popping
restores it. A result refresh preserves selection by stable ID when possible and otherwise clamps to
the first selectable row. Error and explanatory rows are never selectable.

Keyboard rules:

- Enter activates the selected command/result, or submits non-empty valid input.
- Up/Down use the shared collection intents and wrap exactly as the current palette does.
- Escape aborts pending work, then pops; at root it closes.
- Backspace edits an empty query rather than implicitly popping; Escape is the single back action.
- IME composition does not schedule search until composition ends.
- While a submission or invocation is pending, duplicate Enter is ignored.

Desktop renders a dialog with combobox/listbox semantics, `aria-activedescendant`, `aria-busy`, a
breadcrumb, and announced result counts/errors. TUI renders the same fields with its modal, input,
rows, and status line. Neither renderer fetches or invokes data itself.

## Search semantics

Compiled search defaults may be overridden for a local provider. Loaded search is fixed to safe
bounds:

- default debounce 250 ms, accepted manifest range 150–1,000 ms;
- default minimum two trimmed characters, accepted range 0–20;
- at most 50 displayed results, with excess truncated by the host;
- no cross-session cache in the command engine; feature/provider caches remain authoritative.

Changing the query immediately clears selectable results and schedules a new generation. Below the
minimum it shows instruction text. During a request it shows loading. Abort errors are silent. Other
errors become an inline retryable state. A response is applied only when its generation and frame
identity are still current.

`CommandSearchItem` contains bounded display and identity facts: `id`, `title`, optional `subtitle`,
`icon`, `badge`, and optional task seed/reference data needed by an existing closed action. It has no
action field. The provider owns ordering; the host does not re-rank a remote response.

## Loaded-plugin descriptor and wire

The manifest command schema becomes an additive discriminated union. Existing descriptors with
`action` and no `kind` parse as action commands. Common loaded fields use local IDs; `chromeRegister`
qualifies command and parent IDs and stamps the plugin owner.

### Search

A loaded search descriptor declares `route`, scope, query presentation fields, and one static
`select` chrome action. The route must pass the existing plugin-route confinement checks.

The host GETs the route with `q` and only the captured scope identifiers it owns: `taskId`,
`projectId`, or `workspaceId`. Node selection remains an API-client option, not a caller-supplied URL
field. The response is `{ items: CommandSearchItem[] }`; malformed items are dropped and logged,
and the host caps the accepted set. The static action receives the sanitized selected item.

### Input

A loaded input descriptor declares a plugin-owned submit route and a static success action. The host
POSTs `{ input, taskId?, projectId?, workspaceId? }`. The route validates its own domain input and
answers `{ ok: true, item?, message? }` or the normal error envelope. The optional sanitized item is
available to the success action.

### Setting

A loaded setting descriptor declares two plugin-owned routes and 2–32 static `{ value, label,
keywords? }` options. GET read returns `{ value }`. PUT write receives `{ value }` plus derived scope
and returns `{ value }`; the returned canonical value must name a declared option. Secrets and
free-form values are not supported by this variant.

### Actions

The palette awaits loaded actions. `runChromeAction` therefore needs an async result for the command
path, including `runNodeAction` response failure. Existing click sites may continue to discard the
promise with `void`. Route ownership, URL policy, surface ownership, task lookup, and project
navigation checks remain unchanged.

## Settings integration

There is no automatic settings-page projection. Owners factor a small domain accessor and use it in
both places:

- Appearance exposes style, follow-system, and the applicable theme choice through the same
  `savePref` path as its page.
- Notifications exposes sound/system/badge/event switches through the same parsed JSON value and
  `saveJsonPref` merge.
- Terminal, Docker, and simple Agent defaults follow their existing preference helpers.

A Boolean is represented by explicit On and Off options rather than a blind toggle, making the
command idempotent and showing current state. Complex forms, numeric tables, provider secrets, and
settings with dependent fields remain pages.

## Migration and compatibility

1. Add the graph and session without removing the existing action shape.
2. Adapt current static commands and current `PaletteRowSource` output into the new root while parity
   tests are green.
3. Migrate terminal/workflow sources to searches with zero minimum and zero debounce because their
   data is fetched once on entry and filtered locally.
4. Move the editor and GitHub finders to interactive commands; retain their shortcuts and result
   ordering.
5. Remove the palette-row adapter only after the registry census is zero.
6. Keep `createOverlayPalette` for remaining non-command pickers.

The plugin API major does not change for this additive manifest work. The committed JSON Schema is
regenerated from the Zod contract with the existing test workflow. A future removal of the legacy
manifest `palette` alias follows its own advertised compatibility window and is not smuggled into
this programme.

## Security and resource limits

- Loaded response data is untrusted wire input and is field-validated before rendering or action use.
- Result data never chooses a route, URL, command ID, or action verb.
- Scope identifiers are host-derived; a manifest cannot cause a project search to inherit an
  unrelated task or fleet scope.
- Search and write routes remain under `/v2/p/<plugin>/...`, use existing authentication and owner
  context, and re-check project/task ownership on the node.
- Search strings and display fields receive protocol length bounds; responses are capped before they
  enter reactive state.
- Abort is an optimization, not a correctness guarantee; the generation check is mandatory.
- No plugin frame, remote tree, or arbitrary DOM mounts inside the palette.

## Verify before building

- Confirm command registry and keybinding execution have not gained a context or interactive path.
- Confirm the active host can produce every context identity without importing plugin state.
- Check current manifest API compatibility policy before changing the Zod union or JSON Schema.
- Re-read `runChromeAction` call sites; changing its return type must leave non-palette clicks honest.
- Confirm fleet fan-out still exposes per-node partial failures and cancellation.
- Compare the current desktop and TUI palette keyboard tests before declaring a shared transition.

