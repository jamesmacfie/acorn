import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { prefsOptions, tasksKey, tasksOptions, workspacesOptions, type Task } from '@acorn/client-core/queries.ts'
import { archiveTask } from '@acorn/client-core/tasks/mutations.ts'
import { paneAvailable, paneContribution, paneContributions } from '@acorn/client-core/registries/panes.ts'
import { registerCommands } from '@acorn/client-core/registries/commands.ts'
import { registerKeybindings, resolveKeybindings, keybindingRegistry } from '@acorn/client-core/registries/keybindings.tsx'
import { workspaceForRepo } from '@acorn/client-core/workspaces/activeWorkspace.ts'
import { addSession, refreshSessions, requestTerminalFocus } from '@acorn/client-core/tasks/agentSessions.ts'
import { terminalApi } from '@acorn/plugin-terminal/client/terminalClient.ts'
import { taskBridge } from '@acorn/client-core/tasks/taskBridge.ts'
import { runApi } from '@acorn/plugin-terminal/client/runClient.ts'
import { dispatchLayout, layoutForTask, maximizedPane, setActiveTaskId, setMaximizedPane, setSelectedSource } from '@acorn/client-core/tasks/tasks.ts'
import { activateTaskSignals, pathForTask } from '@acorn/client-core/tasks/activate.ts'
import { formatChord } from '@acorn/client-core/tasks/paneShortcuts.ts'
import { taskStatus } from '@acorn/client-core/tasks/taskStatus.ts'
import TaskPaneHost from '@acorn/client-core/tasks/TaskPaneHost.tsx'
import { confirmWillEvent } from '@acorn/client-core/registries/willPhase.tsx'
import { TaskSlotHost } from '@acorn/client-core/registries/uiSlots.tsx'
import { completeTaskArchive } from '@acorn/client-core/tasks/archiveLifecycle.ts'
import CopyButton from '@acorn/client-core/ui/CopyButton.tsx'
import '@acorn/client-core/tasks/task-view.css'

export default function TaskView(props: {
  task: Task
  terminalOpen: boolean
  onToggleTerminal: () => void
  onOpenTerminal: () => void
}) {
  const api = terminalApi()
  const bridge = taskBridge()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const tasksQuery = createQuery(() => tasksOptions(true))
  const workspacesQuery = createQuery(() => workspacesOptions(true))
  const prefs = createQuery(() => prefsOptions(true))
  const workspace = () => workspaceForRepo(workspacesQuery.data, props.task.repoOwner, props.task.repoName)
  const status = () => taskStatus(props.task.id)

  const [runTargets, { refetch: refetchTargets }] = createResource(
    () => props.task.id,
    async (id) => {
      if (!api) return []
      const result = await runApi.targets(id)
      return 'targets' in result ? result.targets : []
    },
  )
  // ponytail: run targets refetch on task open + after a toggle. Dev script is repo-level config now
  // (edited in a separate resource in settings), so there's no shared signal to live-watch here.
  const [runError, setRunError] = createSignal('')
  async function toggleTarget(id: string, running: boolean) {
    if (!api) return
    setRunError('')
    const result = running ? await runApi.stop(props.task.id, id) : await runApi.start(props.task.id, id)
    if (!result.ok) setRunError(result.reason ?? `Unable to ${running ? 'stop' : 'start'} ${id}`)
    await refreshSessions()
    await refetchTargets()
    if (!running && result.ok) props.onOpenTerminal()
  }

  const resolvedShortcuts = createMemo(() => resolveKeybindings(keybindingRegistry.entries(), prefs.data ?? {}))
  const shortcutFor = (id: string) => resolvedShortcuts().find((binding) => binding.id === id)?.chord

  const [closeError, setCloseError] = createSignal('')
  const [teardownFailed, setTeardownFailed] = createSignal(false)

  function nextTask(): Task | null {
    const currentWorkspace = workspace()
    const all = tasksQuery.data ?? []
    const repoSet = currentWorkspace ? new Set(currentWorkspace.repos.map((repo) => `${repo.owner}/${repo.name}`)) : null
    const list = repoSet ? all.filter((task) => repoSet.has(`${task.repoOwner}/${task.repoName}`)) : all
    const index = list.findIndex((task) => task.id === props.task.id)
    if (index < 0) return list[0] ?? null
    return list[index + 1] ?? list[index - 1] ?? null
  }

  async function openClose() {
    setCloseError('')
    setTeardownFailed(false)
    const confirmed = await confirmWillEvent({
      kind: 'task:archive', payload: { taskId: props.task.id },
      title: 'Archive task', actionLabel: 'Archive task',
    })
    if (confirmed) await confirmClose()
  }

  async function openProfile(profileId: string) {
    if (!api) return
    const session = await api.create({ taskId: props.task.id, profileId })
    props.onOpenTerminal()
    addSession(session) // create returns the session — no list round trip before focusing it
    requestTerminalFocus(props.task.id, session.id)
  }

  onMount(() => {
    const paneCommands = paneContributions().flatMap((pane) => [
      {
        id: `pane.show.${pane.id}`, title: `Show pane: ${pane.label}`, category: 'pane' as const,
        hint: pane.description, palette: true,
        when: () => paneAvailable(pane, props.task),
        run: () => dispatchLayout(props.task.id, { type: 'show', pane: pane.id }),
      },
      {
        id: `pane.close.${pane.id}`, title: `Close pane: ${pane.label}`, category: 'pane' as const,
        palette: true,
        when: () => paneAvailable(pane, props.task) && layoutForTask(props.task.id)?.panes.includes(pane.id) === true && (layoutForTask(props.task.id)?.panes.length ?? 0) > 1,
        run: () => dispatchLayout(props.task.id, { type: 'close', pane: pane.id }),
      },
      {
        id: `pane.pin.${pane.id}`,
        title: () => `${layoutForTask(props.task.id)?.pinned?.includes(pane.id) ? 'Unpin' : 'Pin'} pane: ${pane.label}`,
        category: 'pane' as const, palette: true,
        when: () => layoutForTask(props.task.id)?.panes.includes(pane.id) === true,
        run: () => dispatchLayout(props.task.id, { type: 'pin', pane: pane.id }),
      },
      {
        id: `pane.move-left.${pane.id}`, title: `Move pane left: ${pane.label}`, category: 'pane' as const, palette: true,
        when: () => (layoutForTask(props.task.id)?.panes.indexOf(pane.id) ?? -1) > 0,
        run: () => dispatchLayout(props.task.id, { type: 'move', pane: pane.id, direction: -1 }),
      },
      {
        id: `pane.move-right.${pane.id}`, title: `Move pane right: ${pane.label}`, category: 'pane' as const, palette: true,
        when: () => {
          const panes = layoutForTask(props.task.id)?.panes ?? []
          const index = panes.indexOf(pane.id)
          return index >= 0 && index < panes.length - 1
        },
        run: () => dispatchLayout(props.task.id, { type: 'move', pane: pane.id, direction: 1 }),
      },
    ])
    const commands = registerCommands([
      ...paneCommands,
      { id: 'task.terminal.toggle', title: () => props.terminalOpen ? 'Hide terminal drawer' : 'Show terminal drawer', category: 'terminal', palette: true, requires: 'desktop', run: props.onToggleTerminal },
      { id: 'task.terminal.new-shell', title: 'New terminal', hint: 'open a shell in the task worktree', category: 'terminal', palette: true, requires: 'desktop', run: () => openProfile('shell') },
      { id: 'task.terminal.new-claude', title: 'New Claude Code terminal', hint: 'run claude in the task worktree', category: 'terminal', palette: true, requires: 'desktop', run: () => openProfile('claude-code') },
      { id: 'task.terminal.new-codex', title: 'New Codex terminal', hint: 'run codex in the task worktree', category: 'terminal', palette: true, requires: 'desktop', run: () => openProfile('codex') },
      { id: 'task.archive', title: 'Archive task', hint: 'guarded teardown', category: 'task', palette: true, run: openClose },
      ...paneContributions().map((pane) => ({
        id: `pane.restore.${pane.id}`, title: `Restore ${pane.label} pane row`, category: 'pane' as const,
        when: () => maximizedPane(props.task.id) === pane.id,
        run: () => setMaximizedPane(props.task.id, null),
      })),
    ])
    const bindings = registerKeybindings([
      ...paneContributions().flatMap((pane) => pane.defaultChord ? [{
        id: `pane.show.${pane.id}`, command: `pane.show.${pane.id}`, description: `Show ${pane.label} pane`, category: 'Panes',
        defaultChord: pane.defaultChord, when: 'task' as const, legacyPaneAction: pane.id,
        active: () => paneAvailable(pane, props.task),
      }] : []),
      { id: 'task.terminal.toggle', command: 'task.terminal.toggle', description: 'Toggle terminal drawer', category: 'Panes', defaultChord: 'meta+shift+t', when: 'task', legacyPaneAction: 'terminal' },
      ...paneContributions().map((pane) => ({
        id: `pane.restore.${pane.id}`, command: `pane.restore.${pane.id}`, description: `Restore ${pane.label} pane row`, category: 'Panes',
        defaultChord: 'escape', when: 'pane' as const, pane: pane.id,
        active: () => maximizedPane(props.task.id) === pane.id,
      })),
    ])
    onCleanup(() => { bindings.dispose(); commands.dispose() })
  })

  // While the guarded teardown runs (it can take seconds — teardown script + worktree removal),
  // the pane-switcher's close button shows a spinner so the archive visibly has feedback.
  const [archiving, setArchiving] = createSignal(false)

  async function confirmClose(skipTeardown = false) {
    if (archiving()) return
    const archivedTaskId = props.task.id
    const next = nextTask()
    if (bridge) {
      setArchiving(true)
      try {
        const result = await bridge.task.archive(archivedTaskId, {
          deleteWorktree: true, force: true, skipTeardown,
        })
        if (!result.ok) {
          setTeardownFailed(!!result.teardownFailed)
          setCloseError(result.output ? `${result.reason}\n${result.output}` : result.reason)
          return
        }
      } finally {
        setArchiving(false)
      }
    } else {
      await archiveTask(archivedTaskId)
    }
    completeTaskArchive(archivedTaskId, () => {
      if (next) {
        activateTaskSignals(next)
        navigate(pathForTask(next))
      } else {
        setSelectedSource('github')
        setActiveTaskId(null)
        navigate('/')
      }
    })
    await queryClient.invalidateQueries({ queryKey: tasksKey })
  }

  const extraButtons = () => (
    <>
      <Show when={(runTargets() ?? []).length}>
        <For each={runTargets() ?? []}>
          {(target) => (
            <button
              type="button"
              class="pane-switch-btn pane-switch-run"
              classList={{ active: target.running }}
              data-tip={`${target.running ? 'Stop' : 'Run'} ${target.id}`}
              data-tip-sub={target.command}
              aria-label={`${target.running ? 'Stop' : 'Run'} ${target.id}`}
              onClick={() => void toggleTarget(target.id, target.running)}
            >
              {target.running ? '■' : '▶'}<span class="pane-switch-run-id">{target.id}</span>
            </button>
          )}
        </For>
      </Show>
      <button type="button" class="pane-switch-btn" classList={{ active: props.terminalOpen }} data-tip="Terminal" data-tip-key={shortcutFor('task.terminal.toggle') ? formatChord(shortcutFor('task.terminal.toggle')!) : undefined} data-tip-sub="Shell in the worktree" aria-label="Terminal" onClick={props.onToggleTerminal}>{'>_'}</button>
    </>
  )

  return (
    <div class="workspace-wrap">
      <main class="panes panes-workspace task-layout">
        <TaskPaneHost task={props.task} extraButtons={extraButtons()} onCloseTask={openClose} closing={archiving()} shortcutFor={shortcutFor} />

        <Show when={runError() || closeError()}>
          <div class="task-run-error action-error" role="alert">
            <span style={{ 'white-space': 'pre-wrap' }}>{runError() || closeError()}</span>
            <Show when={teardownFailed()}>
              <button type="button" class="ui-btn close-confirm" onClick={() => void confirmClose(true)}>Archive anyway (skip teardown)</button>
            </Show>
          </div>
        </Show>
      </main>
      <footer class="workspace-footer">
        <Show when={props.task.worktreePath} fallback={<span class="workspace-footer-worktree">no worktree</span>}>
          {(path) => (
            <>
              <span class="workspace-footer-worktree">
                worktree
                <CopyButton class="workspace-footer-copy" text={path} title="Copy worktree path" />
              </span>
              <span class="workspace-footer-branch">⎇ {props.task.branch}</span>
              <TaskSlotHost slot="task.footer" taskId={props.task.id} />
              <Show when={status()?.missing}><span class="workspace-footer-repair">⚠ needs repair (removed on disk)</span></Show>
              <Show when={!status()?.missing && status()?.dirty}>
                <span class="workspace-footer-dirty">● dirty ({status()?.dirtyCount} file{status()?.dirtyCount === 1 ? '' : 's'})</span>
              </Show>
              <Show when={status() && !status()!.missing && !status()!.dirty}><span class="muted">● clean</span></Show>
            </>
          )}
        </Show>
      </footer>
    </div>
  )
}
