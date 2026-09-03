import { Show } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { activeNodeId } from '../../infra/node/activeNode'
import { nodes } from '../../infra/node/fleet'
import { activeTaskId } from '../../features/tasks/tasks'
import { workspaceForProject } from '../../features/workspaces/activeWorkspace'
import { createFleetWorkspaces } from '../../features/workspaces/fleetWorkspaces'
import { createPaletteRowsProvider } from '../registries/palette/provider'
import type { CommandExecutionContext } from '../registries/commands/commands'
import type { SessionRowProvider } from '../registries/commands/session'
import { registerNavigationCommands } from './navigationCommands'
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
  const navigate = useNavigate()
  const fleetWorkspaces = createFleetWorkspaces()

  const providers: readonly SessionRowProvider[] = [createPaletteRowsProvider()]

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
    // The shell's own navigator, for the closed chrome verbs that address a URL rather than a task
    // layout. Taken here because `useNavigate` needs a router context and the command registry has
    // none (../registries/commands/commands.ts).
    navigate,
  })

  const { session, view } = createCommandPaletteView({
    id: 'commands',
    title: 'Command palette',
    toggleChord: 'meta+k',
    context,
    providers: () => providers,
    // Supplied here because this is the host that has a fleet at all: the terminal draws one node and
    // answers with the one it captured (apps/tui/src/chrome/paletteSession.ts).
    //
    // Empty below two nodes, and that is the answer rather than a shortcut: one machine is not a
    // fleet. An empty roster makes a `fleet` search ask once, against the node it captured, and leaves
    // the node label off every row — which is what the task and workspace lists have always shown on a
    // single-node install.
    fleet: () => (nodes().length > 1 ? nodes().map((node) => ({ nodeId: node.nodeId, label: node.label })) : []),
  })

  // The four navigation searches, which need the session's own open flag: the task fan-out runs only
  // while somebody is looking at the palette.
  registerNavigationCommands({ open: session.open, fleetWorkspaces })

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
