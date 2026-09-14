// Stays with the composition root for the same reason as App.tsx: it arranges pane, keybinding and
// slot contributions into the task screen this app draws. Every part it arranges comes from
// client-core; the layout of them is the app's.
import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { prefsOptions, tasksKey, tasksOptions, workspacesOptions, type Task } from '@acorn/client-core/infra/queries.ts'
import { archiveTask } from '@acorn/client-core/features/tasks/taskMutations.ts'
import { paneAvailable, paneContributions } from '@acorn/client-core/host/registries/panes/panes.ts'
import { registerCommands } from '@acorn/client-core/host/registries/commands/commands.ts'
import { registerKeybindings, resolveKeybindings, keybindingRegistry } from '@acorn/client-core/host/registries/commands/keybindings.ts'
import { workspaceForProject } from '@acorn/client-core/features/workspaces/activeWorkspace.ts'
import { addSession, refreshSessions, requestTerminalFocus } from '@acorn/client-core/features/tasks/agentSessions.ts'
import { hasHostCapability } from '@acorn/client-core/infra/node/hostCapabilities.ts'
import { terminalSessions } from '@acorn/plugin-terminal/contract/sessionsClient.ts'
import { taskBridge } from '@acorn/client-core/features/tasks/taskBridge.ts'
import { runApi } from '@acorn/client-core/features/tasks/runClient.ts'
import { activeTaskId, dispatchLayout, layoutForTask, maximizedPane, setActiveTaskId, setMaximizedPane, setSelectedSource } from '@acorn/client-core/features/tasks/tasks.ts'
import { activateTaskSignals, pathForTask } from '@acorn/client-core/features/tasks/activate.ts'
import { formatChord } from '@acorn/client-core/features/tasks/paneShortcuts.ts'
import { taskStatus } from '@acorn/client-core/features/tasks/taskStatus.ts'
import TaskPaneHost from '@acorn/client-core/features/tasks/TaskPaneHost.tsx'
import { confirmWillEvent } from '@acorn/client-core/host/registries/shell/willPhase.tsx'
import { Alert, Button } from '@acorn/client-core/kit/components/primitives.tsx'
import { TaskSlotHost } from '@acorn/client-core/host/registries/extensionPoints/uiSlots.tsx'
import { completeTaskArchive, isArchiving, withArchiving } from '@acorn/client-core/features/tasks/archiveLifecycle.ts'
import { defaultSourceId } from '@acorn/client-core/host/registries/sources/sources.ts'
import CopyButton from '@acorn/client-core/kit/components/inputs/CopyButton.tsx'
import '@acorn/client-core/features/tasks/task-view.css'
import { RailTab } from '@acorn/client-core/features/tabs/RailTab.tsx'
import { createLogger } from '@acorn/client-core/infra/telemetry/logger.ts'

const log = createLogger('tasks')

// The two task-scoped groups this view owns in the command graph. Core's, like every command below,
// so they may hold core's children and no plugin's (docs/command-palette-and-shortcuts.md).
const PANES_GROUP = 'core.panes'
const TERMINAL_GROUP = 'core.terminal'

export default function TaskView(props: {
  task: Task
  terminalOpen: boolean
  onToggleTerminal: () => void
  onOpenTerminal: () => void
}) {
  // "Does this node run terminals", from the node's plugin roster, not "is this Electron", which is
  // what it used to mean and why the whole run-target/agent block vanished off-desktop.
  // `terminalSessions` is terminal's contract surface (create + list), not its renderer client: the
  // shell has no business holding write/attach/kill/resize, which is what importing
  // client/terminalClient handed it.
  const hasEngine = () => hasHostCapability({ plugin: 'terminal' })
  const bridge = taskBridge()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const tasksQuery = createQuery(() => tasksOptions(true))
  const workspacesQuery = createQuery(() => workspacesOptions(true))
  const prefs = createQuery(() => prefsOptions(true))
  const workspace = () => workspaceForProject(workspacesQuery.data, props.task.projectId)
  const status = () => taskStatus(props.task.id)

  const [runTargets, { refetch: refetchTargets }] = createResource(
    () => props.task.id,
    async (id) => {
      if (!hasEngine()) return []
      const result = await runApi.targets(id)
      return 'targets' in result ? result.targets : []
    },
  )
  const [runError, setRunError] = createSignal('')
  async function toggleTarget(id: string, running: boolean) {
    if (!hasEngine()) return
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
    const projectSet = currentWorkspace ? new Set(currentWorkspace.projects.map((project) => project.id)) : null
    const list = projectSet ? all.filter((task) => projectSet.has(task.projectId)) : all
    const index = list.findIndex((task) => task.id === props.task.id)
    if (index < 0) return list[0] ?? null
    return list[index + 1] ?? list[index - 1] ?? null
  }

  async function openClose() {
    setCloseError('')
    setTeardownFailed(false)
    const decision = await confirmWillEvent({
      kind: 'task:archive', payload: { taskId: props.task.id },
      title: 'Archive task', actionLabel: 'Archive task',
    })
    if (!decision.confirmed) return
    // Held rather than passed straight through, because the teardown-failed path re-invokes the
    // archive from a button and the cleanups the owner ticked are still the cleanups they ticked.
    setPendingChecks(decision.checked)
    await confirmClose()
  }

  async function openProfile(profileId: string) {
    if (!hasEngine()) return
    const session = await terminalSessions.create({ taskId: props.task.id, profileId })
    props.onOpenTerminal()
    addSession(session) // create returns the session, no list round trip before focusing it
    requestTerminalFocus(props.task.id, session.id)
  }

  onMount(() => {
    // The pane operations hang under one group rather than filling the root with five rows per pane
    // (docs/command-palette-and-shortcuts.md). Their conditions are untouched: each
    // still answers for itself, and the group only says where they are.
    const paneCommands = paneContributions().flatMap((pane) => [
      {
        id: `pane.show.${pane.id}`, title: `Show pane: ${pane.label}`, category: 'pane' as const,
        hint: pane.description, palette: true, parentId: PANES_GROUP,
        when: () => paneAvailable(pane, props.task),
        run: () => dispatchLayout(props.task.id, { type: 'show', pane: pane.id }),
      },
      {
        id: `pane.close.${pane.id}`, title: `Close pane: ${pane.label}`, category: 'pane' as const,
        palette: true, parentId: PANES_GROUP,
        when: () => paneAvailable(pane, props.task) && layoutForTask(props.task.id)?.panes.includes(pane.id) === true && (layoutForTask(props.task.id)?.panes.length ?? 0) > 1,
        run: () => dispatchLayout(props.task.id, { type: 'close', pane: pane.id }),
      },
      {
        id: `pane.pin.${pane.id}`,
        title: () => `${layoutForTask(props.task.id)?.pinned?.includes(pane.id) ? 'Unpin' : 'Pin'} pane: ${pane.label}`,
        category: 'pane' as const, palette: true, parentId: PANES_GROUP,
        when: () => layoutForTask(props.task.id)?.panes.includes(pane.id) === true,
        run: () => dispatchLayout(props.task.id, { type: 'pin', pane: pane.id }),
      },
      {
        id: `pane.move-left.${pane.id}`, title: `Move pane left: ${pane.label}`, category: 'pane' as const, palette: true, parentId: PANES_GROUP,
        when: () => (layoutForTask(props.task.id)?.panes.indexOf(pane.id) ?? -1) > 0,
        run: () => dispatchLayout(props.task.id, { type: 'move', pane: pane.id, direction: -1 }),
      },
      {
        id: `pane.move-right.${pane.id}`, title: `Move pane right: ${pane.label}`, category: 'pane' as const, palette: true, parentId: PANES_GROUP,
        when: () => {
          const panes = layoutForTask(props.task.id)?.panes ?? []
          const index = panes.indexOf(pane.id)
          return index >= 0 && index < panes.length - 1
        },
        run: () => dispatchLayout(props.task.id, { type: 'move', pane: pane.id, direction: 1 }),
      },
    ])
    const commands = registerCommands([
      // Both groups are task-scoped, so a palette opened over a browse source does not offer them at
      // all: there is no task for either to be about.
      {
        id: PANES_GROUP, kind: 'group', title: 'Panes', hint: 'show, close, pin and move the panes on this task',
        category: 'pane', palette: true, scope: 'task', order: 200,
      },
      ...paneCommands,
      {
        id: TERMINAL_GROUP, kind: 'group', title: 'Terminal', hint: 'the drawer and a shell in the worktree',
        category: 'terminal', palette: true, scope: 'task', order: 300, requires: { plugin: 'terminal' },
      },
      { id: 'task.terminal.toggle', parentId: TERMINAL_GROUP, title: () => props.terminalOpen ? 'Hide terminal drawer' : 'Show terminal drawer', category: 'terminal', palette: true, requires: { plugin: 'terminal' }, run: props.onToggleTerminal },
      // A plain shell only. A terminal running a harness CLI is that harness's command and is
      // registered by the agents plugin (plugins/agents/src/client/terminalProfileCommands.ts), which
      // is a different owner and so cannot hang inside this group
      // (docs/command-palette-and-shortcuts.md § What the palette refuses).
      { id: 'task.terminal.new-shell', parentId: TERMINAL_GROUP, title: 'New terminal', hint: 'open a shell in the task worktree', category: 'terminal', palette: true, requires: { plugin: 'terminal' }, run: () => openProfile('shell') },
      // Top-level, and deliberately: one guarded action with a confirmation behind it is not a group,
      // and burying it a keystroke deeper would not make it safer.
      { id: 'task.archive', title: 'Archive task', hint: 'guarded teardown', category: 'task', palette: true, scope: 'task', run: openClose },
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

  // While the guarded teardown runs (it can take seconds: teardown script plus worktree removal),
  // this task's close button and its rail row both spin, off the one shared flag in
  // client-core/features/tasks/archiveLifecycle.ts.
  const closing = () => isArchiving(props.task.id)
  // The plugin cleanups this archive is carrying, from the dialog to the request (and to the retry).
  const [pendingChecks, setPendingChecks] = createSignal<string[]>([])

  async function confirmClose(skipTeardown = false) {
    if (closing()) return
    const archivedTaskId = props.task.id
    // Held to the end, not just around the request: the spinner runs until the row leaves the rail.
    await withArchiving(archivedTaskId, async () => {
      // The guarded teardown (stop sessions → teardown script → remove worktree) is served through the
      // node's TASK_SESSIONS bridge, which the terminal plugin fills; without it the route 503s, so a node
      // that does not run terminals gets the plain status flip instead.
      if (hasEngine()) {
        const result = await bridge.task.archive(archivedTaskId, {
          deleteWorktree: true, force: true, skipTeardown, applyChecks: pendingChecks(),
        })
        if (!result.ok) {
          setTeardownFailed(!!result.teardownFailed)
          setCloseError(result.output ? `${result.reason}\n${result.output}` : result.reason)
          return
        }
        // Archived either way (`ok` is true), but the owner ticked something that did not happen.
        if (result.cleanupFailed?.length) log.warn(`cleanup failed for: ${result.cleanupFailed.join(', ')}`)
        setPendingChecks([])
      } else {
        await archiveTask(archivedTaskId)
      }
      completeTaskArchive(archivedTaskId, () => {
        // Only when the archived task is still the one being looked at. A guarded teardown takes
        // seconds, and the owner is free to move to another task while it runs; moving them again
        // when it finishes takes them off whatever they went to, which they chose and this did not.
        if (activeTaskId() !== archivedTaskId) return
        // Read now rather than before the request, so the task moved to is one that still exists.
        const next = nextTask()
        if (next) {
          activateTaskSignals(next)
          navigate(pathForTask(next))
        } else {
          const source = defaultSourceId()
          if (source) setSelectedSource(source)
          setActiveTaskId(null)
          navigate('/')
        }
      })
      await queryClient.invalidateQueries({ queryKey: tasksKey })
    })
  }

  const extraButtons = () => (
    <>
      <Show when={(runTargets() ?? []).length}>
        <For each={runTargets() ?? []}>
          {(target) => (
            <RailTab
              class="pane-switch-run"
              label={`${target.running ? 'Stop' : 'Run'} ${target.id}`}
              glyph={target.running ? 'square' : 'play'}
              sublabel={target.id}
              active={target.running}
              data-tip-sub={target.command}
              aria-pressed={target.running}
              onClick={() => void toggleTarget(target.id, target.running)}
            />
          )}
        </For>
      </Show>
      <RailTab
        label="Terminal"
        glyph="square-terminal"
        active={props.terminalOpen}
        data-tip-key={shortcutFor('task.terminal.toggle') ? formatChord(shortcutFor('task.terminal.toggle')!) : undefined}
        data-tip-sub="Shell in the worktree"
        aria-expanded={props.terminalOpen}
        onClick={props.onToggleTerminal}
      />
    </>
  )

  return (
    <div class="workspace-wrap">
      <main class="panes panes-workspace task-layout">
        <TaskPaneHost task={props.task} extraButtons={extraButtons()} onCloseTask={openClose} closing={closing()} shortcutFor={shortcutFor} />

        <Show when={runError() || closeError()}>
          <Alert
            variant="banner"
            actions={
              <Show when={teardownFailed()}>
                <Button onPress={() => void confirmClose(true)}>Archive anyway (skip teardown)</Button>
              </Show>
            }
          >
            <span style={{ 'white-space': 'pre-wrap' }}>{runError() || closeError()}</span>
          </Alert>
        </Show>
      </main>
      <footer class="workspace-footer">
        <Show when={props.task.worktreePath} fallback={<span class="workspace-footer-worktree">no worktree</span>}>
          {(path) => (
            <>
              <span class="workspace-footer-worktree">
                worktree
                <CopyButton text={path} title="Copy worktree path" />
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
