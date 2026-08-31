/** @jsxImportSource @opentui/solid */
import { createMemo, Suspense } from 'solid-js'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import type { Task } from '@acorn/protocol/api.ts'
import { notesClientPlugin } from '@acorn/plugin-notes/client/index.ts'
import { initClientPlugins } from '@acorn/client-core/host/registries/extensionPoints/plugin.ts'
import { paneContributions, type PaneLayoutContribution } from '@acorn/client-core/host/registries/panes/panes.ts'
import { paneModel } from '@acorn/client-core/host/registries/panes/paneModels.ts'
import type { Region } from '@acorn/client-core/host/layouts/regions.ts'
import { ListDetail } from './layouts/ListDetail'

// The toy: one pane, one task, no chrome.
//
// The pane is Notes, unchanged, imported from its own package the way the desktop imports it. It is a
// `list-detail` pane whose three regions share a model the host builds once, so this is the smallest
// thing that exercises the region seam as well as the kit — the list, the header above it and the
// note body are three components that have to agree, and on the desktop they agree through the host.
//
// http and linear are what phase 0 was written against. Both turned out to ship only a tree bundle
// (`plugins/http/src/tree/`, no `client/`), so drawing either means the worker sandbox, which is
// phase 5. Notes is the compiled `list-detail` pane that was wanted here; see
// docs/future/terminal/findings.md.

// No persister: `clientFor` in client-core's fleet.ts builds one over `idb-keyval`, and there is no
// IndexedDB here. Phase 0 keeps nothing across runs, so there is nothing to persist yet and a file
// persister would be a guess at what phase 3 wants.
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } })

// Through the registry rather than by importing the contribution, because that is where a pane comes
// from on the desktop too: the plugin registers, the host reads. It also means the TUI's roster is one
// line per plugin, which is what phase 6 grows.
//
// The cast is the finding. `paneContributions()` hands back the flattened shape, because the registry's
// `drawLayout` has already turned the regions into one component that mounts client-core's own layout
// table — a table this host does not use and cannot supply (registries/panes/panes.ts). The regions
// survive on the entry only because `drawLayout` spreads it through. Making that table host-supplied,
// the way `KIT_COMPONENTS` already is, is phase 2's; see docs/future/terminal/findings.md, "The pane
// registry draws DOM layouts".
initClientPlugins([notesClientPlugin])
const notesPane = paneContributions().find((pane) => pane.id === 'notes') as unknown as PaneLayoutContribution<unknown>

export function App(props: { task: Task }) {
  // The provider is above the model, not beside it: `createNotesModel` opens a query the moment it is
  // built, and a memo evaluated in App's own scope would run outside this context. On the desktop the
  // model registry sits under the provider for the same reason (client-core registries/paneModels.ts).
  return (
    <QueryClientProvider client={queryClient}>
      <NotesPane task={props.task} />
    </QueryClientProvider>
  )
}

function NotesPane(props: { task: Task }) {
  // Through the host's own per-task model root, so the model is built once and disposed with the task,
  // exactly as `drawLayout` does it. That half of the registry is host-neutral already.
  const model = createMemo(() => paneModel(notesPane.id, props.task.id, () => notesPane.model!(props.task)))
  const regionsOf = (): Partial<Record<string, Region>> => {
    const built = model()
    return Object.fromEntries(
      Object.entries(notesPane.regions).map(([id, Region]) => [
        id,
        // Every region is a `lazy()` component (docs/panes.md § Layout model), and a pending `lazy`
        // renders as an empty string. The DOM turns that into an empty text node nobody sees; a cell
        // host refuses it, because a run of text there must have a `text` parent. So the host gives
        // every region a real placeholder rather than asking each pane to.
        (() => (
          <Suspense fallback={<text attributes={2}>loading…</text>}>
            <Region task={props.task} model={built} />
          </Suspense>
        )) satisfies Region,
      ]),
    )
  }

  return (
    <box flexDirection="column" flexGrow={1}>
      <text attributes={1}>{`acorn · ${props.task.title} · notes`}</text>
      <ListDetail
        stateKey={`notes:${props.task.id}`}
        label="Notes"
        regions={regionsOf()}
        hidden={notesPane.hidden?.(props.task) ?? []}
      />
      <text attributes={2}>j/k move · enter open · q quit</text>
    </box>
  )
}
