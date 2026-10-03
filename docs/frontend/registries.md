# Registries and plugins

This page covers how the renderer activates client plugins, the registries they contribute to, the
gates on a contribution, and the platform seam's verbs. Read it before you add a registry or a
contribution kind. It's part of [frontend](../frontend.md).

## Registries and plugins

The client plugin host activates `apps/desktop/src/client/plugins.ts`. Plugins register panes, rail
sources, commands and keybindings, settings pages, slots, rail markers, reference panels, agent
contexts, extension points and contributions to other plugins' points, schedules, persisted-state
slices, Node stats, attention sources, session sources, brand marks, and content links. The host owns
the returned disposables, so a plugin can be disabled and activated again without duplicate entries.
An `activate` that starts something no registry holds, such as a listener or a reactive root, returns
a function that undoes it, and the host runs it with the plugin's other disposables.

There are two render paths and one component API. A compiled plugin's tree runs in this process, and
the host mounts its components directly. A loaded plugin's runs in a Web Worker with no DOM and emits a
stream of node names that the host draws with the same components. Both produce the same tree, so one
plugin can fill another's slot whichever tier it ships in ([plugins](../plugins.md) § The client half
of a loaded plugin).

A pane registers a `component`, or a `layout` plus a `regions` record. The registry turns a declared
layout into a component, and throws at registration if the regions don't match the layout
([pane layouts](../panes/layout.md#layout-model)).

A compiled session source registers Node-scoped summaries and optional refresh, send, and focus
actions through `ctx.sessionSources`. The source keeps its full rows and fetch logic. Core reads the
summaries for task navigation, send pickers, setup markers, and quit warnings. A selected summary
carries its source's registration version, so a send chosen before a plugin reload can't call the
replacement. Terminal owns its active tab and PTY session list, and the host never stores PTY rows.

The desktop's left source icons and right pane icons use the shared context-menu registry and
`ContextMenuHost`. The rail and pane hosts build targets from the current Node, source or pane, routed
project, and task. Replacement rail and pane switcher providers can request the host menu through
`openContextMenu`, and remote trees send a serializable ID and point through their host action bridge.
The terminal client draws no right-click menu.
[Plugin context menus](../plugins/menus-and-markers.md#context-menus)
own the declaration contract.

### Slots

One slot registry serves two component shapes. `UiSlotId` names five shell slots plus `task.footer`,
and the ID decides what the component gets. A shell slot gets the whole `UiSlotContext`: the active
task, the terminal drawer's toggle and close, `openSettings`, and `selectTask`. A task slot gets only a
`taskId`. `SlotHost` draws the first and `TaskSlotHost` the second, both over `uiSlotRegistry`.

Each shell slot contribution mounts inside a stable DOM root with `display: contents`, and the ordered
list reconciles those roots while lazy content changes inside them. This keeps empty text placeholders
from detaching during startup and aborting queued effects, including the first-run wizard's portal.
`pnpm dev:agent:smoke` checks the wizard on a fresh desktop profile.

### Gates

`requires` on a contribution asks the host a question, in one of three forms:

- `'desktop'` asks whether a desktop shell is hosting this renderer.
- `{ plugin: id }` asks whether the Node runs that plugin.
- `{ seam: group }` asks whether this host installed that platform seam group
  (`packages/client-core/src/infra/platform/contract.ts`).

An array means all of them. `hasHostCapability()` in
`packages/client-core/src/infra/node/hostCapabilities.ts` answers all three. Every contribution the host
filters before drawing takes `requires`, so an author never has to remember which registries support
it.

`when` is the contribution's own predicate over whatever context its draw site has: a task for a pane,
`UiSlotContext` for a shell slot, nothing for a rail source. So it exists only where the host has a
context to hand it. A rail source's `requiresProvider` asks whether a connected integration grants a
capability. None of these is `ctx.capabilities`, which is a plugin publishing a typed function for
another plugin to call.

`'desktop'` means a web client won't have the surface at all. Every `'desktop'` gate was reviewed on
August 28, 2026, and none remains outside a test. Before you add one, check whether the real question
is `{ seam: group }`: `'desktop'` is right for a view about the shell itself, and wrong for one that
needs a capability a shell may or may not install. The preview pane is the example: it's
`{ seam: 'preview' }`, because a desktop shell may ship without preview views.

Every registry's `order` is required. Plugin activation order is invisible in the code, so an
inferred order could change with nothing to catch it. Panes, rail sources, settings pages, shell
slots, and commands all sort on this field.

### Registries without JSX

`slots.ts`, `railMarkers.ts`, `contextMenus.ts`, `extensionPoints.ts`, and `exclusiveSlots.ts` import no
JSX. The `logic` half of client-core's test suite runs in plain Node with no Solid transform, so a
module that imports a `.tsx` file can't load there. Each keeps its rules, ordering, gates, and
resolution in a plain module, beside a thin `.tsx` host that draws what the registry decided. A second
test project, `hosts`, renders those hosts under jsdom ([test layers](../testing/layers.md#client-core)).

## The platform seam

The shell imports no feature UI. `App.tsx`, `TaskView.tsx`, and `CommandPalette.tsx` read registry
entries and client-core contracts. A feature that needs native behavior uses the platform seam
(`packages/client-core/src/infra/platform/`), whose plugin-safe parts `@acorn/plugin-api/client`
re-exports. Plugins never name a shell binding or read the host global.

A missing seam group doesn't always remove its verb. `pickFolder` returns null where no host installs
a picker, and callers check `canPickFolder` first so they can drop the control. `pickFiles` and
`saveFile` carry a fallback, because a page can open its own file input and click its own download
link. A host that installs the `files` group uses native dialogs instead, and its save writes where you
choose. Both verbs move bytes, never paths, so an attachment on this machine can reach a Node on
another.

`notify` works the same way. A page has `Notification`, so `showNotification` falls back to it, keeps
the object until it closes, and asks for permission the first time. A host that installs the group
takes over the banner and adds the badge: `canSetBadge` returns true, Settings shows the app-icon row,
and `trackBadge` puts the bell's number on the icon. Each banner's tag is the notice ID, so a click
resolves to its row ([the renderer bridge](../shell/bridge-and-broker.md#the-renderer-bridge)).
