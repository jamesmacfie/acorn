import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { useNavigate, useParams } from '@solidjs/router'
import { tasksOptions, workspacesOptions } from '@acorn/client-core/queries.ts'
import { workspaceForRepo } from '@acorn/client-core/workspaces/activeWorkspace.ts'
import { hasClientCapability } from '@acorn/client-core/capabilities.ts'
import { activeTaskId } from '@acorn/client-core/tasks/tasks.ts'
import { activateTaskSignals, pathForTask } from '@acorn/client-core/tasks/activate.ts'
import { composeItems, fuzzyFilter, type PaletteItem } from '@acorn/client-core/palette/model.ts'
import { paletteRowSources, type PaletteRowSource } from '@acorn/client-core/registries/paletteRows.ts'
import { createOverlayPalette } from '@acorn/client-core/palette/overlay.ts'
import { commandAvailable, commandHint, commandRegistry, commandTitle, executeCommand } from '@acorn/client-core/registries/commands.ts'
import '@acorn/client-core/palette/palette.css'

// ⌘K command palette (docs/command-palette-and-shortcuts.md): fuzzy search over contributed per-task rows,
// registered commands, and go-to-task / switch-workspace navigation. Thin glue over the pure model; keyboard
// and overlay plumbing come from the shared createOverlayPalette hook.
//
// It imports NO plugin. Run targets, layout recipes and committed workflows used to be fetched here — two
// resources, plugins/terminal's recipe executor and the workflow client, all in this file — which is row 3 of
// plugins.md's coupling table. Each is a `paletteRows` contribution now
// (client-core/registries/paletteRows.ts), so the plugin that owns a row owns fetching and invoking it, and
// this component owns the list and the keyboard.
export default function CommandPalette() {
  const navigate = useNavigate()
  const params = useParams()
  const tasks = createQuery(() => tasksOptions(true))
  const workspaces = createQuery(() => workspacesOptions(true))
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
    // Refetch on open so config edits made while the app runs show up without a task switch — the reason this
    // is a resource keyed on `palette.open()` rather than a mount-time fetch.
    onOpen: () => void refetch(),
  })

  // Every eligible source, in parallel, keyed on the palette being open. A source that throws contributes an
  // ERROR ROW rather than taking the palette down: a broken run-target fetch must not also hide the workflow
  // rows, the pane commands and go-to-task. That is also why this is one resource over all sources instead of
  // one resource each — a single fetch generation keeps the list internally consistent.
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

  // Which source produced a row, so `invoke` hands it back to its owner rather than switching on `kind` —
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

  // Go-to-task rows: every other task, jumpable by name (⌘1–9 covers the first nine by position).
  const taskItems = () => {
    const cur = activeTaskId()
    return (tasks.data ?? [])
      .filter((t) => t.id !== cur)
      .map((t) => ({ id: t.id, label: `Go to task: ${t.title}`, hint: `${t.repoOwner}/${t.repoName}` }))
  }

  // Switch-workspace rows: every workspace except the current one (derived from the route repo, like App's
  // activeWorkspace). Picking one navigates to its first repo, mirroring the topbar picker.
  const workspaceItems = () => {
    const active = workspaceForRepo(workspaces.data, params.owner, params.repo)
    return (workspaces.data ?? [])
      .filter((w) => w.id !== active?.id)
      .map((w) => ({ id: w.id, label: `Switch workspace: ${w.name}`, hint: `${(w.repos ?? []).length} repos` }))
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
      // Navigation, not a task-scoped command — no active task required.
      const t = tasks.data?.find((x) => `task:${x.id}` === item.id)
      if (t) {
        activateTaskSignals(t)
        navigate(pathForTask(t))
      }
      return
    }
    if (item.kind === 'workspace') {
      // Navigation — mirror the topbar picker: jump to the workspace's first repo. The rail source is restored
      // per-workspace by the activeWorkspace effect in App.tsx.
      const first = workspaces.data?.find((x) => `workspace:${x.id}` === item.id)?.repos[0]
      if (first) navigate(`/${first.owner}/${first.name}`)
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
    <Show when={palette.open()}>
      <div class="overlay-backdrop" onClick={palette.close}>
        <div class="overlay palette" role="dialog" aria-modal="true" onKeyDown={palette.onKeyDown} onMouseDown={palette.onDialogMouseDown} onClick={(e) => e.stopPropagation()}>
          <input
            ref={palette.setInputRef}
            class="palette-input"
            placeholder="Run a target, switch a pane, task or workspace, archive…"
            value={palette.query()}
            onInput={(e) => palette.setQuery(e.currentTarget.value)}
          />
          <Show when={actionError()}><div class="action-error palette-action-error" role="alert">{actionError()}</div></Show>
          <ul class="palette-list">
            <For each={items()} fallback={<li class="palette-empty muted">No matches.</li>}>
              {(item, i) => (
                <li>
                  <button
                    type="button"
                    class="palette-row"
                    classList={{ selected: i() === palette.sel(), 'palette-error': item.kind === 'error' }}
                    onMouseEnter={() => palette.setSel(i())}
                    onClick={() => void invoke(item)}
                  >
                    <span class="palette-label">{item.label}</span>
                    <Show when={'hint' in item && item.hint}>
                      <span class="palette-hint muted">{'hint' in item ? item.hint : ''}</span>
                    </Show>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </div>
      </div>
    </Show>
  )
}
