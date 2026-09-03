import { Show } from 'solid-js'
import { useParams } from '@solidjs/router'
import { activeNodeId } from '../../infra/node/activeNode'
import { nodes } from '../../infra/node/fleet'
import { activeTaskId } from '../../features/tasks/tasks'
import { workspaceForProject } from '../../features/workspaces/activeWorkspace'
import { createFleetWorkspaces } from '../../features/workspaces/fleetWorkspaces'
import { createPaletteRowsProvider } from '../registries/palette/provider'
import type { CommandExecutionContext } from '../registries/commands/commands'
import type { SessionRowProvider } from '../registries/commands/session'
import { createTaskRowsProvider, createWorkspaceRowsProvider } from './navigationRows'
import { createCommandPaletteView } from './paletteView'
import { Alert } from '../../kit/components/primitives'
import { PaletteSurface } from './PaletteSurface'

// ⌘K, as a renderer over the shared session.
//
// This component used to be the palette: it fetched every `paletteRows` source, composed them with
// the registry's actions and the task and workspace lists, filtered them, kept a row-to-source map
// and invoked the pick. All of that is `host/registries/commands/session.ts` now, and the terminal
// runs on the same object (apps/tui/src/chrome/Palette.tsx). What is left here is what only this host
// can answer: which identity a session captures, which compatibility rows this host can produce, and
// the dialog it draws them in.

export default function CommandPalette() {
  const params = useParams()
  const fleetWorkspaces = createFleetWorkspaces()

  // Filled in below the view, and read only when a session opens. `createTaskRowsProvider` fans out
  // over the fleet keyed on the palette being open, so it needs the session that does not exist yet;
  // a thunk over a `let` is the smallest way to tie the knot, and it is only ever read after both
  // halves exist.
  let providers: readonly SessionRowProvider[] = []

  const context = (): CommandExecutionContext => ({
    host: 'desktop',
    nodeId: activeNodeId() ?? null,
    workspaceId: workspaceForProject(
      fleetWorkspaces().entries.filter((entry) => entry.nodeId === activeNodeId()).map((entry) => entry.workspace),
      params.projectId,
    )?.id ?? null,
    projectId: params.projectId ?? null,
    taskId: activeTaskId() ?? null,
    paneId: null,
    surfaceId: null,
  })

  const { session, view } = createCommandPaletteView({
    id: 'commands',
    title: 'Command palette',
    toggleChord: 'meta+k',
    context,
    providers: () => providers,
    // Read only by a `fleet`-scoped search, which nothing declares yet. Supplied here because this is
    // the host that has a fleet at all: the terminal draws one node and answers with the one it
    // captured (apps/tui/src/chrome/paletteSession.ts).
    fleet: () => nodes().map((node) => ({ nodeId: node.nodeId, label: node.label })),
  })

  providers = [createPaletteRowsProvider(), createWorkspaceRowsProvider(fleetWorkspaces), createTaskRowsProvider(session.open)]

  const announce = () => {
    if (session.busy()) return 'Loading…'
    if (session.status()) return session.status()
    const count = session.rows().length
    return count === 1 ? '1 result' : `${count} results`
  }

  return (
    <PaletteSurface
      palette={view}
      items={session.rows()}
      ariaLabel="Command palette"
      // A search or an input frame asks for its own thing; the root and a group are still this list.
      placeholder={session.placeholder() || 'Run a target, switch a pane, task or workspace, archive…'}
      emptyText="No matches."
      breadcrumb={session.breadcrumb()}
      busy={session.busy()}
      announce={announce()}
      onComposing={session.setComposing}
      status={<Show when={session.status()}><Alert>{session.status()}</Alert></Show>}
      onPick={(row) => session.activateRow(row.id)}
      rowClassList={(row) => ({ 'palette-error': row.action.effect === 'none' })}
      row={(row) => (
        <>
          <span class="palette-label">{row.label}</span>
          <Show when={row.badge}>
            <span class="palette-badge muted">{row.badge}</span>
          </Show>
          <Show when={row.breadcrumb?.length}>
            <span class="palette-crumb muted">{row.breadcrumb?.join(' › ')}</span>
          </Show>
          <Show when={row.hint}>
            <span class="palette-hint muted">{row.hint}</span>
          </Show>
        </>
      )}
    />
  )
}
