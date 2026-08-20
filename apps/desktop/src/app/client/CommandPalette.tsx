import { createMemo, createResource, createSignal, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { useNavigate, useParams } from '@solidjs/router'
import { tasksOptions } from '@acorn/client-core/queries.ts'
import { tasksRoute, type Task } from '@acorn/protocol/api.ts'
import { readJson } from '@acorn/client-core/apiClient.ts'
import { workspaceForProject } from '@acorn/client-core/workspaces/activeWorkspace.ts'
import { createFleetWorkspaces, selectFleetWorkspace } from '@acorn/client-core/workspaces/fleetWorkspaces.ts'
import { createFleetQuery } from '@acorn/client-core/node/fanout.ts'
import { activeNodeId, setActiveNode } from '@acorn/client-core/node/activeNode.ts'
import { nodes } from '@acorn/client-core/node/fleet.ts'
import { hasClientCapability } from '@acorn/client-core/capabilities.ts'
import { activeTaskId } from '@acorn/client-core/tasks/tasks.ts'
import { activateTaskSignals, pathForTask } from '@acorn/client-core/tasks/activate.ts'
import { composeItems, fuzzyFilter, type PaletteItem } from '@acorn/client-core/palette/model.ts'
import { paletteRowSources, type PaletteRowSource } from '@acorn/client-core/registries/paletteRows.ts'
import { createOverlayPalette } from '@acorn/client-core/palette/overlay.ts'
import { commandAvailable, commandHint, commandRegistry, commandTitle, executeCommand } from '@acorn/client-core/registries/commands.ts'
import { Alert } from '@acorn/client-core/ui/primitives.tsx'
import { PaletteSurface } from '@acorn/client-core/palette/PaletteSurface.tsx'

export default function CommandPalette() {
  const navigate = useNavigate()
  const params = useParams()
  const tasks = createQuery(() => tasksOptions(true))
  const fleetWorkspaces = createFleetWorkspaces()
  const [actionError, setActionError] = createSignal('')
  const palette = createOverlayPalette({
    id: 'commands',
    title: 'Command palette',
    toggleChord: 'meta+k',
    count: () => items().length,
    onPick: (index) => {
      const item = items()[index]
      if (item) void invoke(item).catch((error) => setActionError(error instanceof Error ? error.message : String(error)))
    },
    // Refetch on open so config edits made while the app runs show up without a task switch, which is why
    // this is a resource keyed on `palette.open()` rather than a mount-time fetch.
    onOpen: () => void refetch(),
  })

  // Below `palette`, not above it: createFleetQuery reads its dependency during setup, so a fanTasks
  // declared earlier would touch `palette` in its temporal dead zone and take the whole contribution down
  // with "Cannot access 'palette' before initialization".
  const fanTasks = () => palette.open() && nodes().length > 1
  const [fleetTasks] = createFleetQuery(
    () => ['tasks', 'palette', 'fleet'] as const,
    async (nodeId, dep: boolean, signal) => (dep ? await readJson<Task[]>(tasksRoute, { nodeId, signal }) : []),
    fanTasks,
  )

  // Every eligible source, in parallel, keyed on the palette being open. A source that throws contributes
  // an error row rather than taking the palette down: a broken run-target fetch must not also hide the
  // workflow rows, the pane commands and go-to-task. That's also why this is one resource over all
  // sources rather than one each, since a single fetch generation keeps the list consistent.
  const eligible = () => paletteRowSources().filter((source) => hasClientCapability(source.requires))
  const [contributed, { refetch }] = createResource(
    () => (palette.open() ? (activeTaskId() ?? '') : null),
    (taskKey) => {
      const taskId = taskKey || null
      return Promise.all(
        eligible().map(async (source) => {
          try {
            return { source, result: await source.rows(taskId) }
          } catch (error) {
            return {
              source,
              result: { rows: [], errors: [{ source: source.id, message: error instanceof Error ? error.message : String(error) }] },
            }
          }
        }),
      )
    },
    { initialValue: [] },
  )

  // Which source produced a row, so `invoke` hands it back to its owner rather than switching on `kind`,
  // which is what let this component stop knowing that a 'run' row means a terminal.
  const ownerOf = createMemo(() => {
    const map = new Map<string, PaletteRowSource>()
    for (const { source, result } of contributed()) for (const row of result.rows) map.set(row.id, source)
    return map
  })

  const actions = () =>
    commandRegistry
      .entries()
      .filter((command) => command.palette && commandAvailable(command))
      .map((command) => ({ id: command.id, label: commandTitle(command), hint: commandHint(command) }))

  // Every task the fleet knows, with the node that owns it. Keyed `${nodeId}:${taskId}` because a task id
  // is only unique within a node, and this list puts two nodes' ids side by side, so a bare task id would
  // make one of two colliding rows unreachable.
  const fleetTaskRows = createMemo(() => {
    const active = activeNodeId() ?? ''
    if (!fanTasks()) return (tasks.data ?? []).map((task) => ({ task, nodeId: active, nodeLabel: '' }))
    return fleetTasks().rows.flatMap((row) =>
      row.data.map((task) => ({ task, nodeId: row.nodeId, nodeLabel: nodes().length > 1 ? row.node.label : '' })),
    )
  })
  const taskByKey = createMemo(() => new Map(fleetTaskRows().map((row) => [`${row.nodeId}:${row.task.id}`, row])))

  // Go-to-task rows: every other task, jumpable by name. Cmd+1 to Cmd+9 covers the first nine by position.
  const taskItems = () => {
    const cur = activeTaskId()
    const active = activeNodeId() ?? ''
    return fleetTaskRows()
      .filter((row) => !(row.task.id === cur && row.nodeId === active))
      .map((row) => ({
        id: `${row.nodeId}:${row.task.id}`,
        label: `Go to task: ${row.task.title}`,
        hint: `${row.task.github ? `${row.task.github.owner}/${row.task.github.name}` : row.task.projectId}${row.nodeLabel ? ` · ${row.nodeLabel}` : ''}`,
      }))
  }

  // Switch-workspace rows: every workspace on every node except the current one. Same key shape and the
  // same reason, since two nodes may hold the same workspace UUID.
  const workspaceItems = () => {
    const active = workspaceForProject(fleetWorkspaces().entries.filter((entry) => entry.nodeId === activeNodeId()).map((entry) => entry.workspace), params.projectId)
    const activeNode = activeNodeId() ?? ''
    return fleetWorkspaces().entries
      .filter((entry) => !(entry.workspace.id === active?.id && entry.nodeId === activeNode))
      .map((entry) => ({
        id: `${entry.nodeId}:${entry.workspace.id}`,
        label: `Switch workspace: ${entry.workspace.name}`,
        hint: `${entry.workspace.projects.length} projects${fleetWorkspaces().grouped ? ` · ${entry.node.label}` : ''}`,
      }))
  }

  const items = createMemo<PaletteItem[]>(() => {
    const rows = contributed().flatMap(({ result }) => result.rows)
    const errors = contributed().flatMap(({ result }) => result.errors ?? [])
    return fuzzyFilter(
      composeItems({ rows, errors, actions: actions(), workspaces: workspaceItems(), tasks: taskItems() }),
      palette.query(),
    )
  })

  async function invoke(item: PaletteItem) {
    setActionError('')
    if (item.kind === 'error') return // visible, not invocable
    palette.close()
    if (item.kind === 'task') {
      // Navigation, not a task-scoped command, so no active task is required.
      const row = taskByKey().get(item.id.slice('task:'.length))
      if (row) {
        // The node first: `activateTaskSignals` and the route both resolve against the active node, so a
        // remote task opened without switching addresses the wrong machine.
        if (row.nodeId && row.nodeId !== activeNodeId()) setActiveNode(row.nodeId)
        activateTaskSignals(row.task)
        navigate(pathForTask(row.task))
      }
      return
    }
    if (item.kind === 'workspace') {
      // Navigation. Mirrors the topbar picker, including the node switch (fleetWorkspaces.ts explains the
      // order). The rail source is restored per-workspace by the activeWorkspace effect in App.tsx.
      const key = item.id.slice('workspace:'.length)
      const entry = fleetWorkspaces().entries.find((candidate) => `${candidate.nodeId}:${candidate.workspace.id}` === key)
      if (entry) selectFleetWorkspace(entry, navigate)
      return
    }
    if (item.kind === 'action') {
      await executeCommand(item.id)
      return
    }
    // Anything else came from a contributed source, so it goes back to that source.
    const result = await ownerOf().get(item.id)?.invoke(item, activeTaskId() ?? null)
    if (result?.error) setActionError(result.error)
  }

  return (
    <PaletteSurface
      palette={palette}
      items={items()}
      ariaLabel="Command palette"
      placeholder="Run a target, switch a pane, task or workspace, archive…"
      emptyText="No matches."
      status={<Show when={actionError()}><Alert>{actionError()}</Alert></Show>}
      onPick={(item) => void invoke(item)}
      rowClassList={(item) => ({ 'palette-error': item.kind === 'error' })}
      row={(item) => (
        <>
          <span class="palette-label">{item.label}</span>
          <Show when={'hint' in item && item.hint}>
            <span class="palette-hint muted">{'hint' in item ? item.hint : ''}</span>
          </Show>
        </>
      )}
    />
  )
}
