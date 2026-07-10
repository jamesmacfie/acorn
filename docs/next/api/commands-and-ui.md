# Commands and live UI control

## 1. Why commands need a new contract

The current client registry stores `{ id, title, when, run: () => ... }`. That is appropriate for
keyboard dispatch but not an API:

- `run` has no input schema;
- commands registered inside mounted components appear and disappear with the view;
- closures capture router params, signals, query clients, and component props;
- `when` returns only a boolean, so an API cannot explain unavailability;
- generated positional commands (`task.activate.1`, `terminal.focus.1`) are UI shortcuts rather
  than stable semantic identities.

Replace the public-facing part with typed command contributions. The keyboard registry can project
these contributions back into zero-argument bindings by obtaining context from the active window.

## 2. Command contribution schema

```ts
type CommandTarget = 'renderer' | 'service'
type CommandCategory =
  | 'navigation'
  | 'workspace'
  | 'task'
  | 'pane'
  | 'terminal'
  | 'editor'
  | 'action'

type CommandAvailability =
  | { available: true }
  | { available: false; reason: string; code: string }

type CommandContribution<I, O> = {
  id: string                         // namespaced, stable
  pluginId: string                   // 'core' for core commands
  title: string
  description: string
  category: CommandCategory
  target: CommandTarget
  scope: 'write'                    // v1 commands all mutate or drive presentation
  input: z.ZodType<I>
  output: z.ZodType<O>
  external: true
  idempotency?: 'required' | 'optional' | 'forbidden'
  deprecated?: { replacement?: string; message: string }
  availability(ctx: CommandContext, input: I): CommandAvailability | Promise<CommandAvailability>
  run(ctx: CommandContext, input: I): O | Promise<O>
}
```

Rules:

- contributions register at app/plugin activation, not component mount;
- ids use `<plugin>.<noun>.<verb>` and are permanent in `v1`;
- inputs and outputs use strict schemas;
- a renderer command receives a serializable window snapshot and injected UI services, never raw
  DOM nodes or component instances;
- an unavailable command returns `409 command_unavailable` with the availability reason;
- exceptions cross the broker as structured errors, not serialized `Error` objects;
- core rejects duplicate ids and plugin-id mismatches;
- plugin unload/absence keeps persisted ids inert and makes discovery omit the command.

“Toggle” is acceptable for a keyboard binding but poor for automation because the result depends on
unknown state. Public commands use deterministic verbs such as `set`, `open`, `close`, `activate`,
or an explicit boolean. A keyboard-only toggle becomes a small adapter that reads current state and
calls the deterministic command.

## 3. HTTP endpoints

| Method | Path | Scope | Purpose |
| --- | --- | --- | --- |
| `GET` | `/commands` | `read` | discover command descriptors and JSON input schemas |
| `GET` | `/commands/:commandId` | `read` | get one descriptor |
| `POST` | `/commands/:commandId` | `write` | validate, check availability, invoke, await acknowledgement |

List filters: `pluginId?`, `category?`, `target?`, `windowId?`, and `available?`. Supplying a window
asks the broker to evaluate contextual availability; without one the descriptor has
`availability: null`.

```ts
const CommandDescriptorSchema = z.strictObject({
  id: z.string().min(3).max(200),
  pluginId: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  description: z.string().max(2000),
  category: z.enum(['navigation', 'workspace', 'task', 'pane', 'terminal', 'editor', 'action']),
  target: z.enum(['renderer', 'service']),
  requiredScope: z.literal('write'),
  inputSchema: z.record(z.string(), z.unknown()), // generated JSON Schema document
  deprecated: z.strictObject({ replacement: z.string().optional(), message: z.string() }).optional(),
  availability: z.discriminatedUnion('available', [
    z.strictObject({ available: z.literal(true) }),
    z.strictObject({ available: z.literal(false), code: z.string(), reason: z.string() }),
  ]).nullable(),
})

const CommandInvocationOuterSchema = z.strictObject({
  input: z.unknown(), // validated again with the contribution's schema
  target: z.strictObject({ windowId: z.string().min(1) }).optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
})

const CommandResultSchema = z.strictObject({
  commandId: z.string(),
  targetWindowId: z.string().nullable(),
  acceptedAt: UnixMillisSchema,
  completedAt: UnixMillisSchema,
  presentationRevision: z.number().int().nonnegative().nullable(),
  result: z.unknown(), // then contribution output schema
})
```

If `expectedRevision` is supplied and the renderer snapshot has moved, return
`409 presentation_revision_conflict` and include the current revision. This protects read/decide/
write automation from racing a person. Omitting it intentionally means “apply to current state.”

## 4. UI control broker frames

Extend the internal app WebSocket (the `4317` listener, not the public socket) with:

```ts
type UiControlFrame =
  | {
      channel: 'ui:register'
      windowId: string
      primary: boolean
      snapshot: WindowPresentation
    }
  | {
      channel: 'ui:state'
      windowId: string
      snapshot: WindowPresentation
    }
  | {
      channel: 'ui:command'
      requestId: string
      windowId: string
      commandId: string
      input: unknown
      expectedRevision?: number
    }
  | {
      channel: 'ui:command-result'
      requestId: string
      ok: true
      result: unknown
      revision: number
    }
  | {
      channel: 'ui:command-result'
      requestId: string
      ok: false
      error: { code: string; message: string; details?: unknown }
      revision: number
    }
```

Only the authenticated app renderer receives `ui:command`; public clients cannot inject frames onto
the internal socket. The main broker correlates requests and validates the returned output schema.

## 5. Core presentation command schemas

```ts
const WindowTargetSchema = z.strictObject({ windowId: z.string().min(1).optional() })
const TaskTargetSchema = WindowTargetSchema.extend({ taskId: IdSchema })
const PaneTargetSchema = TaskTargetSchema.extend({ paneId: z.string().min(1).max(200) })

const ActivateWorkspaceSchema = WindowTargetSchema.extend({ workspaceId: IdSchema })
const ActivateSourceSchema = WindowTargetSchema.extend({
  sourceId: z.string().min(1).max(200),
  workspaceId: IdSchema.optional(),
})
const ActivateTaskSchema = TaskTargetSchema.extend({ paneId: z.string().min(1).max(200).optional() })
const OpenSettingsSchema = WindowTargetSchema.extend({
  tabId: z.string().min(1).max(200).default('workspaces'),
})
const SetOverlaySchema = WindowTargetSchema.extend({
  overlayId: z.string().min(1).max(200).nullable(),
  query: z.string().max(4096).optional(),
})
const ShowPaneSchema = PaneTargetSchema.extend({ mode: z.enum(['show', 'add']).default('show') })
const PinPaneSchema = PaneTargetSchema.extend({ pinned: z.boolean() })
const MovePaneSchema = PaneTargetSchema.extend({ direction: z.enum(['left', 'right']) })
const ResizePaneSchema = PaneTargetSchema.extend({
  adjacentPaneId: z.string().min(1).max(200),
  deltaPx: z.number().finite(),
  paneWidth: z.number().positive(),
  adjacentWidth: z.number().positive(),
})
const MaximizeSchema = TaskTargetSchema.extend({
  target: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('none') }),
    z.strictObject({ kind: z.literal('pane'), paneId: z.string().min(1).max(200) }),
    z.strictObject({ kind: z.literal('terminal') }),
  ]),
})
const SetPanelSchema = TaskTargetSchema.extend({ open: z.boolean() })
const FocusTerminalSchema = TaskTargetSchema.extend({ sessionId: IdSchema })
const SetRailSchema = WindowTargetSchema.extend({ collapsed: z.boolean() })
```

## 6. Complete core/UI command catalog

Every command returns `{ changed: boolean }` unless a different output is stated.

| Command id | Input | Effect / availability |
| --- | --- | --- |
| `core.settings.open` | `OpenSettings` | Open settings on a registered tab |
| `core.settings.close` | `WindowTarget` | Close settings |
| `core.shortcuts.open` | `WindowTarget` | Open Settings → Shortcuts |
| `core.cache.clear-and-reload` | `WindowTarget` | Clear TanStack/IndexedDB browser caches and reload the target window |
| `core.session.logout` | `WindowTarget` | End the target browser session and clear its persisted client cache; API tokens remain valid |
| `core.overlay.set` | `SetOverlay` | Open/close a registered overlay with optional initial query |
| `core.rail.collapsed.set` | `SetRail` | Set left-rail collapsed state deterministically |
| `core.workspace.activate` | `ActivateWorkspace` | Navigate to the workspace's remembered view or first repo; workspace must exist and have a navigable view |
| `core.source.activate` | `ActivateSource` | Select a registered rail source in a workspace |
| `core.task.activate` | `ActivateTask` | Select task, mark notices read, restore/default its layout, navigate to its route |
| `core.task.create-form.open` | `WindowTarget + { workspaceId? }` | Open the existing New Task form; semantic creation remains `POST /tasks` |
| `core.pane.show` | `ShowPane(mode='show')` | Preserve pinned panes and make the pane the shown unpinned pane |
| `core.pane.add` | `ShowPane(mode='add')` | Add pane without removing others |
| `core.pane.close` | `PaneTarget` | Close; first close unpins a pinned pane; reducer keeps at least one pane |
| `core.pane.pin.set` | `PinPane` | Set pin state deterministically |
| `core.pane.move` | `MovePane` | Move one position; unavailable at the edge |
| `core.pane.resize` | `ResizePane` | Apply the existing min-width-aware reducer action |
| `core.pane.equalize` | `TaskTarget` | Set all open-pane weights to `1` |
| `core.pane.focus` | `PaneTarget` | Focus pane host/surface when focusable |
| `core.surface.maximize.set` | `Maximize` | Deterministically maximize none, one open pane, or terminal drawer |
| `core.agents-panel.set` | `SetPanel` | Open/close the task's agents panel |
| `core.terminal-drawer.set` | `SetPanel` | Open/close task terminal drawer |
| `core.terminal.focus` | `FocusTerminal` | Open drawer, select session, request xterm focus |
| `core.window.navigate` | `WindowTarget + { path: relative app path }` | Navigate only to a validated internal app route; no external URL |

Pane commands validate both registry presence and `paneAvailable(pane, task)`. Source and settings
commands likewise validate their registries. Unknown ids return `404`; installed but contextually
unavailable contributions return `409`.

The built-in pane ids at the design baseline are `pr`, `changes`, `notes`, `context`, `editor`,
`search`, `database`, `preview`, `linear`, and `rollbar`. The built-in rail source ids are `github`,
`linear`, and `rollbar`. These remain registry values rather than closed API enums so plugins can
add ids without changing core schemas; discovery is the authoritative installed list.

## 7. Plugin UI commands required for current parity

### GitHub

| Command id | Strict input | Effect |
| --- | --- | --- |
| `github.pull.select` | `{ windowId?, owner, repo, number: positive int }` | navigate to a PR |
| `github.pull.step` | `{ windowId?, direction: next or previous }` | select adjacent loaded PR; requires PR list context |
| `github.pull.create-form.open` | `{ windowId?, owner, repo }` | open create-PR route |
| `github.changed-file.select` | `{ windowId?, owner, repo, number, path }` | select and scroll to changed file |
| `github.changed-file.step` | `{ windowId?, direction: next or previous }` | cycle changed file |
| `github.changed-file-finder.open` | `{ windowId?, query?: string }` | open PR file finder |
| `github.diff-find.open` | `{ windowId?, query?: string }` | open in-diff search |
| `github.permissions.open` | `{ windowId? }` | navigate the target browser through the existing OAuth permissions flow |
| `github.pull.refresh` | `{ windowId?, owner, repo, number }` | force refresh/invalidate the current PR and linked visible provider data |

### Editor

| Command id | Strict input | Effect |
| --- | --- | --- |
| `editor.file.open` | `{ windowId?, taskId, path, line?: positive int, ephemeral?: boolean }` | show/add editor pane and reveal file |
| `editor.file-palette.open` | `{ windowId?, taskId, query?: string }` | open worktree file palette |
| `editor.search.open` | `{ windowId?, taskId, query?: string }` | show search pane and seed query |

### Notes and integrations

| Command id | Strict input | Effect |
| --- | --- | --- |
| `notes.note.open` | `{ windowId?, taskId, scope, slug }` | show notes pane and select note |
| `linear.issue.open` | `{ windowId?, taskId, connectionId, identifier }` | show Linear pane and select linked issue |
| `rollbar.item.open` | `{ windowId?, taskId, connectionId, identifier }` | show Rollbar pane and select linked item |
| `preview.url.open` | `{ windowId?, taskId, url: http(s) URL }` | show preview pane and navigate its owned view |

### Terminal plugin conveniences

Terminal creation and execution use resource endpoints. These commands only present/focus results:

| Command id | Strict input | Effect |
| --- | --- | --- |
| `terminal.profile.launch-and-focus` | `{ windowId?, taskId, profileId }` | create via terminal service, open drawer, focus result; idempotency key required at HTTP command layer |
| `terminal.session.step-focus` | `{ windowId?, taskId, direction: next or previous }` | focus adjacent visible task session |

The built-in profile ids are `shell`, `claude-code`, `codex`, and `aider`; callers must use terminal
profile discovery because availability depends on executables installed on the machine and plugins
may add profiles.

## 8. Mapping every current registered UI command

This table prevents accidental parity gaps while replacing contextual/toggle ids.

| Current command(s) | Public `v1` operation |
| --- | --- |
| `core.settings.open` | `core.settings.open` |
| `core.surface.toggle-maximize` | `core.surface.maximize.set` after reading `/ui/primary` |
| `help.shortcuts.open` | `core.shortcuts.open` |
| `overlay.commands.toggle`, `overlay.files.toggle`, `overlay.workspaces.toggle` | `core.overlay.set` with `commands`, `files`, or `workspaces` |
| `github.files.find` | `github.changed-file-finder.open` |
| `github.files.next`, `github.files.previous` | `github.changed-file.step` |
| `github.pull.create` | `github.pull.create-form.open` |
| `github.pull.next`, `github.pull.previous` | `github.pull.step` |
| `github.diff.find` | `github.diff-find.open` |
| `task.create` | `core.task.create-form.open`; `POST /tasks` for direct creation |
| `source.github.open` | `core.source.activate { sourceId: 'github' }` |
| `task.activate.1` … `.9` | `core.task.activate { taskId }`; numeric positions remain keyboard aliases only |
| `pane.show.<id>` | `core.pane.show { taskId, paneId }` |
| `pane.close.<id>` | `core.pane.close { taskId, paneId }` |
| `pane.pin.<id>` | `core.pane.pin.set { taskId, paneId, pinned }` |
| `pane.move-left.<id>`, `pane.move-right.<id>` | `core.pane.move` |
| `pane.restore.<id>` | `core.surface.maximize.set { target: { kind: 'none' } }` |
| `task.agents.toggle` | `core.agents-panel.set` |
| `task.terminal.toggle` | `core.terminal-drawer.set` |
| `task.terminal.new-shell`, `.new-claude`, `.new-codex` | terminal session create or `terminal.profile.launch-and-focus` |
| `task.archive` | `POST /tasks/:taskId/archive`; optionally activate the next task separately |
| `terminal.focus.1` … `.9` | `core.terminal.focus { sessionId }`; numeric positions remain keyboard aliases only |
| `terminal.focus.previous`, `.next` | `terminal.session.step-focus` |

The implementation must also wire existing pointer-only pane add/close/pin/move/resize/equalize,
task selection, file reveal, note reveal, integration reveal, terminal focus, and source selection to
the same command/reducer services. The account-menu Clear cache and Logout actions map to the core
commands above; GitHub permission and explicit pull refresh actions map to the GitHub commands. The
command catalog is not complete if only keyboard paths use it.

## 9. Tests

- registry rejects duplicate ids and plugin namespace violations;
- every public command has strict input/output JSON Schema in discovery;
- unknown input keys return `422` before dispatch;
- read token invocation returns `403`;
- absent renderer returns `409 ui_unavailable`;
- stale expected revision returns `409` without execution;
- unavailable pane/source/settings/profile returns `409` with stable code;
- command timeout cleans its pending broker entry;
- renderer disconnect fails pending requests promptly;
- output is validated before returning;
- keyboard, pointer, and API paths reach the same reducer/service in focused unit tests;
- one Electron E2E test invokes task activate, pane add/move/pin/close, terminal drawer open, and
  editor reveal through HTTP and asserts the visible UI after each acknowledgement.
