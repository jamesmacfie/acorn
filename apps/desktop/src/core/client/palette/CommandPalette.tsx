import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { useNavigate, useParams } from '@solidjs/router'
import type { RunTargetInfo } from '../../shared/terminal'
import { tasksOptions, workspacesOptions } from '../queries'
import { workspaceForRepo } from '../workspaces/activeWorkspace'
import { refreshSessions } from '../../../plugins/terminal/client/sessions'
import { terminalApi } from '../../../plugins/terminal/client/terminalClient'
import { runApi } from '../../../plugins/terminal/client/runClient'
import { workflowApi } from '../../../plugins/agents/client/workflowClient'
import { activeTaskId, dispatchLayout, setRecipeBrowserUrl, setTerminalOpen } from '../tasks/tasks'
import { activateTaskSignals, pathForTask } from '../tasks/activate'
import { invokeLayoutRecipe, type RecipeSpec } from '../../../plugins/terminal/client/recipes'
import { composeItems, fuzzyFilter, type PaletteItem } from './model'
import { createOverlayPalette } from './overlay'
import { commandAvailable, commandHint, commandRegistry, commandTitle, executeCommand } from '../registries/commands'
import './palette.css'

// Normalized run-targets payload (the resource resolves to the data shape or `{ error }`, and is
// `undefined` while the palette is closed) — unwrapped once, with empty defaults.
type RunSources = { targets: RunTargetInfo[]; errors: { source: string; message: string }[]; layouts: RecipeSpec[] }
const EMPTY_RUN_SOURCES: RunSources = { targets: [], errors: [], layouts: [] }

// ⌘K command palette (docs/command-palette-and-shortcuts.md): fuzzy search over run targets, built-in actions, and
// config parse-error rows (13 §B — a broken .acorn/config.toml is visible, not silent). Thin glue
// over the pure model; keyboard/overlay plumbing comes from the shared createOverlayPalette hook.
export default function CommandPalette() {
  const api = terminalApi()
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
    // Refetch both config-backed resources on open so run-target AND workflow edits made while
    // the app runs show up without a task switch.
    onOpen: () => {
      void refetch()
      void refetchWf()
    },
  })

  const [runData, { refetch }] = createResource(
    () => (palette.open() ? activeTaskId() : null),
    async (id) => (id && api ? await runApi.targets(id) : null),
  )
  // Committed workflows for the task (docs/workflows.md); their parse/cycle errors join the rows.
  const [wfData, { refetch: refetchWf }] = createResource(
    () => (palette.open() ? activeTaskId() : null),
    async (id) => (id && api ? await workflowApi.defs(id) : null),
  )
  const runInfo = createMemo<RunSources>(() => {
    const data = runData()
    return data && 'targets' in data ? data : EMPTY_RUN_SOURCES
  })

  const actions = () => {
    return commandRegistry.entries()
      .filter((command) => command.palette && commandAvailable(command))
      .map((command) => ({ id: command.id, label: commandTitle(command), hint: commandHint(command) }))
  }

  // Go-to-task rows: every other task, jumpable by name (⌘1–9 covers the first nine by position).
  const taskItems = () => {
    const cur = activeTaskId()
    return (tasks.data ?? [])
      .filter((t) => t.id !== cur)
      .map((t) => ({ id: t.id, label: `Go to task: ${t.title}`, hint: `${t.repoOwner}/${t.repoName}` }))
  }

  // Switch-workspace rows: every workspace except the current one (derived from the route repo, like
  // App's activeWorkspace). Picking one navigates to its first repo, mirroring the topbar picker.
  const workspaceItems = () => {
    const active = workspaceForRepo(workspaces.data, params.owner, params.repo)
    return (workspaces.data ?? [])
      .filter((w) => w.id !== active?.id)
      .map((w) => ({ id: w.id, label: `Switch workspace: ${w.name}`, hint: `${(w.repos ?? []).length} repos` }))
  }

  const items = createMemo<PaletteItem[]>(() => {
    const { targets, errors, layouts } = runInfo()
    const wf = wfData()
    return fuzzyFilter(
      composeItems({ targets, errors: [...errors, ...(wf?.errors ?? [])], layouts, workflows: wf?.workflows ?? [], actions: actions(), workspaces: workspaceItems(), tasks: taskItems() }),
      palette.query(),
    )
  })

  async function invoke(item: PaletteItem) {
    setActionError('')
    const taskId = activeTaskId()
    if (item.kind === 'error') return // visible, not invocable
    palette.close()
    if (item.kind === 'task') {
      // Navigation, not a task-scoped command — no active task / terminal API required.
      const t = tasks.data?.find((x) => `task:${x.id}` === item.id)
      if (t) {
        activateTaskSignals(t)
        navigate(pathForTask(t))
      }
      return
    }
    if (item.kind === 'workspace') {
      // Navigation, not task-scoped — mirror the topbar picker: jump to the workspace's first repo.
      const w = workspaces.data?.find((x) => `workspace:${x.id}` === item.id)
      const first = w?.repos[0]
      if (first) {
        // Rail source is restored per-workspace by the activeWorkspace effect in App.tsx.
        navigate(`/${first.owner}/${first.name}`)
      }
      return
    }
    if (item.kind === 'action') {
      await executeCommand(item.id)
      return
    }
    if (!taskId || !api) return
    if (item.kind === 'run') {
      const targetId = item.id.slice('run:'.length)
      if (item.running) await runApi.stop(taskId, targetId)
      else {
        await runApi.start(taskId, targetId)
        setTerminalOpen(taskId, true)
      }
      await refreshSessions()
      return
    }
    if (item.kind === 'workflow') {
      const wf = wfData()?.workflows.find((w) => `workflow:${w.id}` === item.id)
      if (!wf) return
      const res = await workflowApi.start(taskId, wf)
      if (res.error) setActionError(res.error)
      return
    }
    if (item.kind === 'layout') {
      // Layout recipe (docs/workflows.md §3): seed panes, auto-start the named target, resolve the
      // browser URL — all through the pure executor.
      const recipe = runInfo().layouts.find((r) => `layout:${r.id}` === item.id)
      if (!recipe) return
      const res = await invokeLayoutRecipe(taskId, recipe, {
        setLayout: (tid, layout) => dispatchLayout(tid, { type: 'replace', layout }),
        startTarget: (tid, targetId) => runApi.start(tid, targetId),
        targetUrl: async (tid, targetId) => (await runApi.status(tid, targetId)).url,
        setBrowserUrl: setRecipeBrowserUrl,
        openTerminal: (tid) => setTerminalOpen(tid, true),
      })
      if (!res.ok && res.reason) setActionError(res.reason)
      await refreshSessions()
      return
    }
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
