import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { integrationsOptions, prefsOptions, projectsOptions, tasksKey, tasksOptions, workspacesOptions, type Task, type Workspace } from '../../infra/queries'
import { archiveTask } from '../tasks/taskMutations'
import { applyRailOrder, applySourceOrder, moveTask, parseRailOrder, pinTask, unpinTask, type RailDropPosition, type RailOrder } from './railOrder'
import { checksState } from '../../kit/lib/rendering/displayMeta'
import { activeTaskId, selectedSource, setActiveTaskId, setSelectedSource, type SourceId } from '../tasks/tasks'
import { defaultSourceId } from '../../host/registries/sources/sources'
import { schedulePanePrefetch } from '../../host/registries/panes/panes'
import { projectPath } from '../../host/registries/commands/corePaths'
import { activateTaskSignals, pathForTask } from '../tasks/activate'
import { hasHostCapability } from '../../infra/node/hostCapabilities'
import { availableSources } from './railSources'
import { parseRailVisibility, shownInRail } from './railVisibility'
import { createSourceScope } from './sourceScope'
import { taskStatus } from '../tasks/taskStatus'
import { markersFor } from '../../host/registries/rail/railMarkerFeed'
import { railStatusMarkers } from '../tasks/railStatus'
import { createTaskScripts } from '../tasks/taskScripts'
import { requestTaskAnnotations } from '../../host/annotations/taskAnnotations'
import { unreadForTask } from '../notifications/notifications'
import { toast } from '../notifications/toast'
import { workspaceForProject } from '../workspaces/activeWorkspace'
import { resolveProjectColor } from '@acorn/protocol/projectColor.ts'
import { taskBridge } from '../tasks/taskBridge'
import { registerCommands } from '../../host/registries/commands/commands'
import { keybindingRegistry, registerKeybindings, resolveKeybindings } from '../../host/registries/commands/keybindings'
import { formatChord } from '../../kit/lib/rendering/formatChord'
import { confirmTaskArchive } from '../tasks/confirmTaskArchive'
import { saveJsonPref } from '../settings/savePref'
import { PrefKeys } from '../../infra/persistence/prefKeys'
import { completeTaskArchive, isArchiving, withArchiving } from '../tasks/archiveLifecycle'
import ExclusiveSlotHost from '../../host/plugins/ExclusiveSlotHost'
import { registerCoreExclusiveSlot } from '../../host/registries/extensionPoints/exclusiveSlots'
import { registerContextMenuItems, type TaskRowTarget, type RailSourceTarget } from '../../host/registries/panes/contextMenus'
import { ContextMenuHost, ContextMenuItems, type ContextMenuOpening } from '../../host/registries/panes/contextMenuHost'
import { menuPoint } from '../../host/registries/panes/menuPoint'
import { activeNodeId } from '../../infra/node/activeNode'
import { sourceRegistry } from '../../host/registries/sources/sources'
import { loadIconNodes } from '../../kit/tokens/iconNodes'
import './tabrail.css'
import { RailTab } from './RailTab'
import { localTaskGlyph, taskOriginAppearance } from '../tasks/origin'
import { Menu } from '../../kit/components/overlays/Menu'
import { workflowTaskHierarchy } from '../tasks/taskHierarchy'
import { expandedWorkflowRoots, toggleWorkflowRoot } from '../tasks/taskTreeViewState'
import { createRailDrag } from './createRailDrag'
import { TaskDraftDialog } from './TaskDraftDialog'
import type { TaskDraft } from './taskDraftStore'
import type { RailProps } from '@acorn/protocol/chrome.ts'
import { mintSlotRef, NestedChromeSlot } from '../../host/plugins/NestedChromeSlot'

const originIcon = (origin: string) => taskOriginAppearance(origin).glyph

export default function TabRail() {
  const navigate = useNavigate()
  const params = useParams()
  const queryClient = useQueryClient()
  const query = createQuery(() => tasksOptions(true))
  const workspaces = createQuery(() => workspacesOptions(true))
  const projects = createQuery(() => projectsOptions(true))
  const integrations = createQuery(() => integrationsOptions(true))
  const prefs = createQuery(() => prefsOptions(true))
  const [menuId, setMenuId] = createSignal<string | null>(null)
  // The right-click door onto the same row actions. One menu for the whole list, with the row it
  // belongs to travelling in the signal.
  const [rowMenu, setRowMenu] = createSignal<ContextMenuOpening | null>(null)
  let rowMenuReturnFocus: HTMLElement | undefined
  const [sourceMenu, setSourceMenu] = createSignal<ContextMenuOpening | null>(null)
  let sourceMenuReturnFocus: HTMLElement | undefined
  let openedSource: unknown

  // Rail order: pin-to-top plus drag-reorder in a dedicated pref, never tasks.sort. The pure model
  // lives in railOrder.ts.
  const rawRailOrder = createMemo(() => prefs.data?.[PrefKeys.railOrder])
  const railOrder = createMemo(() => parseRailOrder(rawRailOrder()))
  const pinnedTasks = createMemo(() => new Set(railOrder().pinned))
  const saveOrder = async (o: RailOrder) => {
    await saveJsonPref(queryClient, PrefKeys.railOrder, o)
  }
  async function commitDrop(id: string, targetId: string, position: RailDropPosition) {
    if (id === targetId) return
    await saveOrder(moveTask(railOrder(), orderedTasks().map((t) => t.id), id, targetId, position))
  }
  const railDrag = createRailDrag({
    items: () => visibleTasks(),
    onDrop: (id, targetId, position) => void commitDrop(id, targetId, position),
  })
  const [draft, setDraft] = createSignal<TaskDraft | null>(null)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: tasksKey })

  // One pending hover at a time: the pointer is in one row, and a row left before the delay is up
  // never fetches, so scrolling the rail costs nothing.
  let prefetching: { cancel: () => void } | undefined
  const cancelPrefetch = () => {
    prefetching?.cancel()
    prefetching = undefined
  }
  onCleanup(cancelPrefetch)

  // Scope the rail to the active workspace through project IDs, so switching workspaces swaps the
  // roster.
  const activeProjectId = () => params.projectId ?? query.data?.find((task) => task.id === activeTaskId())?.projectId
  // A task refresh can remove the active row before archive navigation reaches its project.
  // Retain the workspace through that gap, as the desktop shell does for its topbar.
  const activeWorkspace = createMemo<Workspace | null>((previous) =>
    workspaceForProject(workspaces.data, activeProjectId()) ?? previous ?? null)
  const sourceScope = createSourceScope(() => activeWorkspace()?.id)
  const orderedTasks = () => {
    const ws = activeWorkspace()
    const all = query.data ?? []
    const inWs = ws ? new Set(ws.projects.map((project) => project.id)) : null
    const scoped = inWs ? all.filter((task) => inWs.has(task.projectId) && !projects.data?.find((project) => project.id === task.projectId)?.hidden) : all
    return applyRailOrder(scoped, railOrder())
  }
  // The New task button's key cap, read from the live binding so a rebound chord shows as rebound.
  const newTaskChord = createMemo(() => {
    const chord = resolveKeybindings(keybindingRegistry.entries(), prefs.data ?? {}).find((binding) => binding.id === 'task.create')?.chord
    return chord ? formatChord(chord) : undefined
  })
  const taskRows = createMemo(() => workflowTaskHierarchy(orderedTasks(), expandedWorkflowRoots(), activeTaskId()))
  const visibleTasks = () => taskRows().map((row) => row.task)
  const taskDepths = createMemo(() => new Map(taskRows().map((row) => [row.task.id, row.depth])))
  const workflowGroups = createMemo(() => new Map(taskRows().map((row) => [row.task.id, row])))

  // What other plugins know about the rows on screen (`core:task`, ../tasks/taskAnnotations.ts). One
  // request per contributor for the whole list, re-asked when the list changes and not when the rail
  // merely re-renders. The answers arrive as rail markers through `markersFor` below, so nothing here
  // reads them.
  createEffect(() => requestTaskAnnotations(visibleTasks().map((task) => task.id)))

  // Every source that can open, then the ones this device draws an icon for. The palette opens the
  // rest (./railVisibility.ts), so a hidden source is still one click away from somewhere.
  const openableSources = () => applySourceOrder(availableSources(integrations.data?.integrations, sourceScope()), railOrder())
  const sources = () => {
    const visibility = parseRailVisibility(prefs.data?.[PrefKeys.railVisibility])
    return openableSources().filter((source) => shownInRail(source.id, visibility))
  }
  function selectSource(id: SourceId) {
    setMenuId(null)
    setSelectedSource(id)
    // A task URL is /t/:taskId, which carries no project, and every browse Source scopes itself to
    // the routed project. Without this the rail swaps to a Source that reports it has nothing to
    // show.
    if (params.projectId) return
    const projectId = query.data?.find((task) => task.id === activeTaskId())?.projectId
    if (projectId) navigate(projectPath(projectId))
  }
  const openSourceMenu = (id: string, at: { x: number; y: number }) => {
    const source = sources().find((candidate) => candidate.id === id)
    const nodeId = activeNodeId()
    if (!source || !nodeId) return
    setMenuId(null)
    setRowMenu(null)
    const projectId = params.projectId ?? query.data?.find((task) => task.id === activeTaskId())?.projectId ?? ''
    const target: RailSourceTarget = { location: 'rail.source', id, title: source.label, nodeId, projectId }
    openedSource = sourceRegistry.get(id)
    setSourceMenu({ at, target })
  }
  const sourceAction = registerContextMenuItems< 'rail.source'>([{
    id: 'core:rail-source-open', location: 'rail.source', label: 'Open', order: 100,
    run: (target) => { if (target.nodeId === activeNodeId() && sources().some((source) => source.id === target.id)) selectSource(target.id) },
  }])
  onCleanup(() => sourceAction.dispose())
  createEffect(() => {
    const opened = sourceMenu()?.target
    if (opened?.location === 'rail.source' &&
      (opened.nodeId !== activeNodeId() || !sources().some((source) => source.id === opened.id) ||
        sourceRegistry.get(opened.id) !== openedSource)) setSourceMenu(null)
  })

  function onRowClick(w: Task) {
    if (railDrag.consumeClick(w.id)) return
    if (w.id === activeTaskId() && !selectedSource()) {
      setMenuId((v) => (v === w.id ? null : w.id))
      return
    }
    setMenuId(null)
    activateTaskSignals(w)
    navigate(pathForTask(w))
  }

  // What a right-click on a task row is about (docs/plugins/menus-and-markers.md § Context menus). `origin`,
  // `projectId`, and `pinned` are the only facts a contribution may match on; `id` and `title` are
  // payload for the action, not predicates.
  const rowTarget = (w: Task): TaskRowTarget => ({
    location: 'task.row',
    id: w.id,
    title: w.title,
    origin: w.origin,
    projectId: w.projectId,
    pinned: pinnedTasks().has(w.id),
    branch: w.branch,
  })
  const taskById = (id: string) => (query.data ?? []).find((task) => task.id === id)

  onMount(() => {
    // Every row here can draw an icon the owner picked, which is any of Lucide's 1,756 rather than the
    // 87 the chrome spells for itself, and only the eager 87 are in the startup chunk. Asked for as
    // soon as the rail exists, so a picked icon is drawn rather than briefly spelled
    // (kit/tokens/iconNodes.ts). Not awaited: the rail draws its rows either way.
    void loadIconNodes()
    // Core's own row actions, registered rather than written inline (docs/plugins/menus-and-markers.md § Context
    // menus).
    const rowActions = registerContextMenuItems([
      {
        id: 'task.pin', location: 'task.row', label: 'Pin to top', icon: 'pin', order: 10,
        when: (target) => !target.pinned,
        run: (target) => void saveOrder(pinTask(railOrder(), target.id)),
      },
      {
        id: 'task.unpin', location: 'task.row', label: 'Unpin', icon: 'pin-off', order: 10,
        when: (target) => target.pinned,
        run: (target) => void saveOrder(unpinTask(railOrder(), target.id)),
      },
      {
        id: 'task.rename', location: 'task.row', label: 'Rename', icon: 'square-pen', order: 20,
        // Re-read from the query rather than closed over: a contribution gets the flat target and
        // the modal wants the whole row, which can have gone away in between.
        run: (target) => { const task = taskById(target.id); if (task) openRename(task) },
      },
      {
        id: 'task.archive', location: 'task.row', label: 'Archive', icon: 'archive', order: 30, tone: 'danger',
        run: (target) => { const task = taskById(target.id); if (task) void openArchive(task) },
      },
    ])
    const numbered = Array.from({ length: 9 }, (_, index) => ({
      id: `task.activate.${index + 1}`,
      title: `Activate task ${index + 1}`,
      category: 'navigation' as const,
      when: () => visibleTasks().length > index,
      run: () => {
        const task = visibleTasks()[index]
        if (!task) return
        setMenuId(null)
        // The right-click menu closes on any pointerdown, so this is the one path that can leave it
        // open: a chord navigating away underneath it.
        setRowMenu(null)
        activateTaskSignals(task)
        navigate(pathForTask(task))
      },
    }))
    const commands = registerCommands([
      { id: 'task.create', title: 'New task', category: 'task', palette: true, run: openNew },
      ...numbered,
    ])
    const bindings = registerKeybindings([
      { id: 'task.create', command: 'task.create', description: 'New task', category: 'Tasks', defaultChord: 'meta+shift+n', when: 'global' },
      ...numbered.map((command, index) => ({
        id: command.id, command: command.id, description: command.title, category: 'Tasks',
        defaultChord: `meta+${index + 1}`, when: 'global' as const,
        active: () => visibleTasks().length > index,
      })),
    ])
    onCleanup(() => { bindings.dispose(); commands.dispose(); rowActions.dispose() })
  })

  function openNew() {
    setMenuId(null)
    const options = (projects.data ?? []).filter((project) => !project.hidden && project.workspaceId === activeWorkspace()?.id)
    if (!options.length) {
      toast('This workspace has no visible projects yet. Add one in Projects settings first.')
      return
    }
    const current = params.projectId
    setDraft({ mode: 'new', nodeId: activeNodeId(), projects: options, projectId: options.some((project) => project.id === current) ? current! : options[0].id })
  }

  function openRename(task: Task) {
    setMenuId(null)
    setDraft({ mode: 'rename', nodeId: activeNodeId(), task })
  }

  // A dialog belongs to the Node on which it opened. A fleet switch discards its local draft.
  createEffect(() => {
    const open = draft()
    if (open && open.nodeId !== activeNodeId()) setDraft(null)
  })

  // Archive uses the guarded teardown flow when the bridge is available. The plain HTTP flip is
  // for the browser dev build (docs/workspaces-and-tasks/archive.md § Archive a task).
  async function openArchive(w: Task) {
    setMenuId(null)
    const decision = await confirmTaskArchive(w)
    if (decision.confirmed) await archive(w, decision.checked)
  }

  async function archive(w: Task, applyChecks: string[] = []) {
    if (isArchiving(w.id)) return
    // Wrapped so the row keeps a spinner for the whole teardown, the same one the task pane's
    // close button shows (tasks/archiveLifecycle.ts).
    await withArchiving(w.id, () => archiveInner(w, applyChecks))
  }

  async function archiveInner(w: Task, applyChecks: string[]) {
    if (hasHostCapability({ plugin: 'terminal' })) {
      // `force`, matching the task pane's own archive. With no options, a dirty worktree came back
      // "uncommitted changes, confirm to discard" after the owner had already confirmed that on the
      // danger row.
      const res = await taskBridge().task.archive(w.id, { deleteWorktree: true, force: true, applyChecks })
      if (!res.ok) return toast(res.output ? `${res.reason}\n${res.output}` : res.reason, { tone: 'danger' })
      const warnings: string[] = []
      if (res.cleanupFailed?.length) warnings.push(`cleanup failed for: ${res.cleanupFailed.join(', ')}`)
      if (warnings.length) toast(`Archived, but ${warnings.join('; ')}.`, { tone: 'danger' })
    } else {
      await archiveTask(w.id)
    }
    completeTaskArchive(w.id, () => {
      if (activeTaskId() === w.id) {
        setActiveTaskId(null)
        const source = defaultSourceId()
        if (source) setSelectedSource(source) // archived the active task → fall back to the default browse
        navigate(projectPath(w.projectId))
      }
    })
    await invalidate()
  }

  const CoreTaskList = () => (
      <div class="tabrail-list">
        <For each={visibleTasks()}>
          {(w) => {
            // CI checks are provider-owned data. The shared rail no longer reaches through a
            // repository source seam; the GitHub PR pane remains the authoritative check surface.
            const scripts = createTaskScripts(() => w.id)
            const checks = () => []
            const st = () => taskStatus(w.id)
            // Core's own states plus whatever plugins publish for this task. RailTab orders them,
            // picks a free corner for each, and legends the lot in the hover tooltip, so the icons
            // and the words cannot drift.
            const markers = () => [
              ...railStatusMarkers({
                checks: w.pullNumber != null && checks().length ? checksState(checks()) : null,
                unread: !!unreadForTask(w.id),
                status: st(),
                archiving: isArchiving(w.id) || scripts.freshness() === 'live' && !!scripts.query.data?.archiveInProgress,
                settingUp: scripts.freshness() === 'live' && ['starting', 'running'].includes(scripts.query.data?.setup.state ?? ''),
                pinned: pinnedTasks().has(w.id),
              }),
              ...markersFor({ kind: 'task', id: w.id }),
            ]
            // Project identity owns the optional 3px accent. The task's projectId is the stable join;
            // workspace membership only scopes which task rows are visible.
            const project = () => projects.data?.find((candidate) => candidate.id === w.projectId)
            const accent = () => resolveProjectColor(project()?.color) ?? undefined
            const group = () => workflowGroups().get(w.id)
            return (
            <div
              class="tabrail-item"
              data-task-id={w.id}
              data-task-depth={taskDepths().get(w.id) || undefined}
              data-dragging={railDrag.dragId() === w.id || undefined}
              data-drop-position={railDrag.dropTarget()?.id === w.id ? railDrag.dropTarget()?.position : undefined}
              style={{ '--task-depth': String(taskDepths().get(w.id) ?? 0) }}
              // Warm the panes this task can show, once the pointer has settled on the row
              // (registries/panes/panes.ts). The tasks themselves are already cached; what is cold is
              // each pane's own first read, and a task switch disposes the whole task scope, so
              // nothing else is holding it.
              onPointerEnter={() => {
                cancelPrefetch()
                prefetching = schedulePanePrefetch(w, queryClient)
              }}
              onPointerLeave={cancelPrefetch}
              // The second door onto the row's actions. The platform also dispatches `contextmenu`
              // for Shift+F10 and the menu key, so this is the keyboard path too.
              onContextMenu={(e) => {
                e.preventDefault()
                setMenuId(null)
                rowMenuReturnFocus = e.currentTarget.querySelector<HTMLElement>('.tabrail-task') ?? undefined
                setRowMenu({ at: { x: e.clientX, y: e.clientY }, target: rowTarget(w) })
              }}
              onMouseDown={(e) => railDrag.begin(e, w.id)}
            >
              {/* The rail keeps owning which menu is open, because Cmd+1-9 navigation closes it and
                  that decision cannot live inside one menu instance. */}
              <Menu
                ariaLabel={`Actions for ${w.title}`}
                placement="right-start"
                open={() => menuId() === w.id}
                onOpenChange={(open) => setMenuId(open ? w.id : null)}
                trigger={() => (
                  /* The task's own icon, independent of workspace/project grouping. */
                  <RailTab
                    class="tabrail-task"
                    label={w.title}
                    glyph={w.icon ?? (w.origin === 'local' ? localTaskGlyph(w.title) : originIcon(w.origin))}
                    active={!selectedSource() && w.id === activeTaskId()}
                    accent={accent()}
                    markers={markers()}
                    data-tip-sub={[
                      w.branch ?? 'Project folder',
                      taskOriginAppearance(w.origin).tooltip,
                    ].filter(Boolean).join(' · ')}
                    aria-haspopup="menu"
                    aria-expanded={menuId() === w.id}
                    onClick={() => onRowClick(w)}
                  />
                )}
              >
                {(menu) => (
                  <>
                    {/* No heading rows: the tab's tip already names the task and its branch. Both
                        doors onto a task row draw from the same registry (docs/plugins/menus-and-markers.md
                        § Context menus), so they cannot offer different things. */}
                    <ContextMenuItems context={menu} location="task.row" target={rowTarget(w)} />
                  </>
                )}
              </Menu>
              <Show when={group()?.workflowDescendants}>
                <button
                  type="button"
                  class="tabrail-task-disclosure"
                  aria-label={`${group()?.expanded ? 'Collapse' : 'Show'} ${group()?.workflowDescendants} workflow tasks under ${w.title}`}
                  aria-expanded={group()?.expanded}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => { event.stopPropagation(); toggleWorkflowRoot(w.id) }}
                >
                  {group()?.expanded ? '▾' : '▸'}<span>{group()?.workflowDescendants}</span>
                </button>
              </Show>
            </div>
            )
          }}
        </For>
      </div>
  )
  const coreTaskList = registerCoreExclusiveSlot('rail.taskList', CoreTaskList)
  onCleanup(() => coreTaskList.dispose())

  const taskListRef = mintSlotRef()
  const railProps = (): RailProps => ({
    sources: sources().map((source) => ({
      id: source.id, label: source.label, icon: source.glyph,
      selected: selectedSource() === source.id,
      markers: markersFor({ kind: 'source', id: source.id }),
    })),
    workspaces: (workspaces.data ?? []).filter((workspace) => workspace.projects.length).map((workspace) => ({
      id: workspace.id, label: workspace.name, active: workspace.id === activeWorkspace()?.id,
    })),
    collapsed: prefs.data?.[PrefKeys.leftCollapsed] === 'true',
    formFactor: 'desktop',
    slots: { taskList: taskListRef },
    selectSource: (id) => { if (sources().some((source) => source.id === id)) selectSource(id) },
    openContextMenu: openSourceMenu,
    openWorkspace: (id) => {
      const workspace = workspaces.data?.find((candidate) => candidate.id === id)
      const first = workspace?.projects[0]
      if (first) navigate(projectPath(first.id))
    },
    toggleCollapsed: () => void saveJsonPref(queryClient, PrefKeys.leftCollapsed, prefs.data?.[PrefKeys.leftCollapsed] !== 'true'),
    reorderSources: (ids) => {
      const available = sources().map((source) => source.id)
      if (ids.length !== available.length || new Set(ids).size !== available.length || ids.some((id) => !available.includes(id))) return
      // The drawn icons take the drawn slots in their new order, and a hidden source keeps its own
      // slot, so showing it again puts it back where it was.
      const drawn = [...ids]
      const merged = openableSources().map((source) => available.includes(source.id) ? drawn.shift()! : source.id)
      void saveOrder({ ...railOrder(), sources: merged })
    },
    createTask: openNew,
  })

  const CoreRail = (own: { value?: unknown }) => {
    const value = () => own.value as RailProps
    return (
      <nav class="tabrail" data-collapsed={value().collapsed || undefined}>
        <div class="tabrail-zone tabrail-sources">
          <For each={value().sources}>
            {(source) => (
              <RailTab
                class="tabrail-source"
                data-source-id={source.id}
                label={source.label}
                glyph={source.icon}
                active={source.selected}
                markers={[...source.markers]}
                aria-current={source.selected ? 'page' : undefined}
                onClick={() => value().selectSource(source.id)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  sourceMenuReturnFocus = event.currentTarget
                  value().openContextMenu?.(source.id, menuPoint(event))
                }}
              />
            )}
          </For>
        </div>
        <div class="tabrail-sep" />
        <NestedChromeSlot slotRef={value().slots.taskList} />
        <RailTab class="tabrail-bottom" label="New task" glyph="plus"
          data-tip-key={newTaskChord()} onClick={value().createTask} />
      </nav>
    )
  }
  const coreRail = registerCoreExclusiveSlot('rail', CoreRail)
  onCleanup(() => coreRail.dispose())

  return (
    <div class="rail-host" data-collapsed={railProps().collapsed || undefined}>
      <ExclusiveSlotHost slot="rail" value={railProps()}
        nestedSlots={[{ ref: taskListRef, render: () => <ExclusiveSlotHost slot="rail.taskList" /> }]} />
      {/* One right-click menu for the whole list. Focus returns to the row's own button on dismiss,
          which is what keeps it usable from the keyboard. */}
      <ContextMenuHost
        location="task.row"
        ariaLabel={rowMenu() ? `Actions for ${rowMenu()!.target.title}` : 'Task actions'}
        opening={rowMenu}
        onClose={() => setRowMenu(null)}
        returnFocus={() => rowMenuReturnFocus}
      />
      <ContextMenuHost
        location="rail.source"
        ariaLabel={sourceMenu() ? `Actions for ${sourceMenu()!.target.title}` : 'Source actions'}
        opening={sourceMenu}
        onClose={() => setSourceMenu(null)}
        returnFocus={() => sourceMenuReturnFocus?.isConnected ? sourceMenuReturnFocus : undefined}
      />
      <Show when={draft()} keyed>
        {(open) => <TaskDraftDialog draft={open} tasks={() => query.data} onClose={() => setDraft(null)} />}
      </Show>
    </div>
  )
}
