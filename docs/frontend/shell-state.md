# Shell state

This page covers what the desktop shell shows and owns, the order it restores state in, what the
renderer measures, and how Node switches and the preview pane keep their resources. It's part of
[frontend](../frontend.md).

## Shell state

The TabRail is source, then workspace, then task. The main region shows Fleet home, a source, or the
active task. Task panes are an ordered, resizable row with persisted widths, pinning, and layout
recipes ([pane layouts](../panes/layout.md)). The terminal drawer is a task surface, available when the
desktop terminal capability exists.

The shell owns overlays: the command palette, Settings, onboarding, notices, confirmations, and
secret entry. Pane content never draws them. The shell positions native preview views over a pane
host. `observeNativePage` owns page geometry, native overlay presentation, and the overlap fallback for
preview and loaded-plugin pages, and the optional `rendererLayer.update` platform group sends geometry
and input policy to the shell. The Solid tree keeps content, callbacks, drafts, and queries
([native overlays](../native-overlays.md)).

Focus is shell state too. `packages/client-core/src/host/keys/focusRegions.ts` holds which region of
which pane has the keyboard and what each region last focused. It's the one place that writes
`focusedPane` and emits `runtime:focus-changed`. `keys/collectionState.ts` holds every list's `active`,
`selected`, and `offset`, keyed by item. Both are module-level signals and aren't persisted
([state ownership](../state-ownership.md),
[focus and typing](../command-palette-and-shortcuts/focus-and-typing.md)).

The bell in the top bar draws notices and attention items. [Notifications](../notifications.md) owns
the model.

## Restore and persistence

Launch restore runs in this order: fleet membership and Node records, the active Node, the selection
and main view, the task, the task layout, then pane state. Missing Nodes and unknown pane IDs draw
repair states instead of throwing.

Device preferences include theme, style pack, keybindings, and layout. Node preferences include
operational settings and setup state. Draft text stays on the client and isn't treated as saved. The
renderer never persists secret fields.

## Telemetry

The renderer collects the same five record kinds as the Node and posts them in batches.
[Renderer telemetry](../telemetry/renderer.md) owns the seams. The renderer had to invent three things:

- **An interaction is the trace.** A browser has no async context, so a command or a page change
  writes the open span into a module variable (`packages/client-core/src/infra/telemetry/emitter.ts`),
  and `apiClient.send()` reads it. One click is one trace across both processes: the command span, the
  `api.request` span under it, and the Node's `http.request` span under that. Work that continues after
  the span ends gets no parent.
- **A page change is a signal write.** `App.tsx` draws from `selectedSource()` and `activeTaskId()`,
  so there's no navigation event. `nav.change` starts in
  `packages/client-core/src/features/tasks/pageChange.ts` where the signal is written and ends on the
  second `requestAnimationFrame`. Two writes in one change collapse into one span. A pane region still
  fetching at that frame gets its own `pane.region` span, which ends at the child's `onMount`.
- **An owner for contributions without one.** Eight contribution types carry no plugin ID, so
  `Registry` in `kit/lib/state/registry.ts` keeps one in a side map, and `ownerOf(id)` answers. The
  three registration passes that know the owner fill it: `host/chrome/chromeRegister.ts`,
  `host/frames/register.ts`, and `makeContext` in `host/registries/extensionPoints/plugin.ts`. Core
  registers without one and reads as `core`.

`kit/` can't reach the emitter, so its error boundary reports through
`kit/lib/telemetry/contributionErrors.ts`, and the client's telemetry startup installs the handler.

### Processing and responsiveness telemetry

Shared work hooks cover JSON decoding, query-cache saving and restoring, Markdown, row reconciling and
mounting, highlighting, diff preparation, tree backlog, and terminal write completion. The kit calls a
host-installed callback in `kit/lib/telemetry/workTelemetry.ts` and never imports the collector. The
desktop installs responsiveness monitoring in the renderer entry, not the preload bridge, so it sees
the same consent and interaction state as the app
([diagnosing an unresponsive view](../telemetry.md#diagnosing-an-unresponsive-view)).

## Node shell navigation lifetime

The desktop's keyed `QueryCacheProvider` contains `PaneModelHost` before the router. The query provider
owns persistence, and `PaneModelHost` leases the selected Node generation for detached pane models
([pane models](../panes/models.md)). `setActiveNode` declares transport interest even for the same
selection, then batches the signal change, the device memory, and `runtime:node-switched`. Listeners
see the new Node before the incoming tree builds, while the outgoing DOM still exists. Scope eviction
carries `from` and `to`, and owners retire the captured outgoing generation. Removing one region or
pane keeps its model, and destroying the provider retires observers and drawn marks.

TabRail memoizes the stored `railOrder` value, parses it once per change, and shares one set of pinned
IDs. Selection changes and unrelated preference writes reuse that projection.

## Preview pane lifetime

The preview pane mounts its toolbar and observers for the selected task. The desktop shell keeps the
browser document when the pane unmounts. The bridge registers a native state listener before `ensure`
asks for a replay, so the toolbar resumes the URL and history controls without navigating again.
Visibility changes hide or show the kept page. A pending URL read keeps the record, and resolution and
capacity failures offer a retry ([host-owned webviews](../shell/webviews.md#host-owned-webviews)).
