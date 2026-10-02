import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { integrationsOptions, prefsOptions, projectsOptions, tasksKey, tasksOptions, workspacesOptions, type Project, type Task } from '../../infra/queries'
import { archiveTask, createTask, patchTask } from '../tasks/taskMutations'
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
import { isSettingUp } from '../tasks/agentSessions'
import { requestTaskAnnotations } from '../../host/annotations/taskAnnotations'
import { unreadForTask } from '../notifications/notifications'
import { workspaceForProject } from '../workspaces/activeWorkspace'
import { resolveProjectColor } from '@acorn/protocol/projectColor.ts'
import { slugifyBranch, withBranchPrefix } from '@acorn/protocol/branch.ts'
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
import { registerContextMenuItems, type TaskRowTarget } from '../../host/registries/panes/contextMenus'
import { ContextMenuHost, ContextMenuItems, type ContextMenuOpening } from '../../host/registries/panes/contextMenuHost'
import IconPicker, { randomIconName } from '../../kit/components/inputs/IconPicker'
import { loadIconNodes } from '../../kit/tokens/iconNodes'
import './tabrail.css'
import { RailTab } from './RailTab'
import { localTaskGlyph, taskOriginAppearance } from '../tasks/origin'
import { Alert, Button, Checkbox, Field, Input, Select } from '../../kit/components/primitives'
import { Inline } from '../../kit/components/layout/Inline'
import { FieldProvider, NO_FIELD } from '../../kit/components/inputs/controlAttrs'
import { Menu } from '../../kit/components/overlays/Menu'
import { Modal } from '../../kit/components/overlays/Modal'
import { Tabs } from '../../kit/components/layout/Tabs'
import { Text } from '../../kit/components/content/Text'
import { readJson } from '../../infra/node/apiClient'
import { projectWorktreeAvailabilityRoute, projectWorktreesRoute, type ProjectWorktree, type WorktreeAvailability } from '@acorn/protocol/api.ts'
import { workflowTaskHierarchy } from '../tasks/taskHierarchy'
import { expandedWorkflowRoots, toggleWorkflowRoot } from '../tasks/taskTreeViewState'
import { createRailDrag } from './createRailDrag'
import type { RailProps } from '@acorn/protocol/chrome.ts'
import { mintSlotRef, NestedChromeSlot } from '../../host/plugins/NestedChromeSlot'

const originIcon = (origin: string) => taskOriginAppearance(origin).glyph

type Draft = { mode: 'new' } | { mode: 'rename'; w: Task }

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
  const [draft, setDraft] = createSignal<Draft | null>(null)
  const [text, setText] = createSignal('')
  // Chosen icon for the task being created/renamed. null = let the origin derive it.
  const [iconDraft, setIconDraft] = createSignal<string | null>(null)
  const [newProject, setNewProject] = createSignal('')
  // Project options are snapshotted when the modal opens rather than bound to activeWorkspace().
  // A workspace switch mid-modal would repopulate the <select> while newRepo() stays on the repo
  // already selected, and the task lands in the wrong workspace.
  const [newProjectOptions, setNewProjectOptions] = createSignal<Project[]>([])
  // Custom branch name (docs/workspaces-and-tasks.md § Task creation and navigation). Defaults to
  // a slug of the title until the user edits the field, then their value wins.
  const [branchText, setBranchText] = createSignal('')
  const [branchTouched, setBranchTouched] = createSignal(false)
  // Where a git task's files come from, one tab each (docs/workspaces-and-tasks.md § Task creation and
  // navigation). `folder` opts out of the branch entirely: the task runs in the project folder on
  // whatever is already checked out, no worktree. `worktree` adopts a linked worktree git already
  // has. Non-git projects are always `folder`, so the tabs only show for git.
  const [source, setSource] = createSignal<'new' | 'folder' | 'worktree'>('new')
  const noBranch = () => source() === 'folder'
  const [pickedWorktree, setPickedWorktree] = createSignal('')
  const [skipSetup, setSkipSetup] = createSignal(false)
  // The selected project's branch prefix. Desktop only, because project config sits behind the
  // main-process bridge and the web build has no checkout. Read through taskBridge rather than the
  // terminal plugin's client, because core must not import plugins (core/boundaries.test.ts).
  const [prefixRow] = createResource(
    () => (draft()?.mode === 'new' ? newProject() : undefined),
    (id) => id ? taskBridge().project.get(id) : null,
  )
  const branchPrefix = () => prefixRow()?.config.branchPrefix ?? null

  const selectedProject = () => projects.data?.find((project) => project.id === newProject())
  // Fetched while the dialog is open on a git project, not only on the tab, so the tab can show a count.
  const [freeWorktrees] = createResource(
    () => (draft()?.mode === 'new' && selectedProject()?.vcs === 'git' ? newProject() : undefined),
    // null on failure: a resource that errors throws on read and would take the dialog down with it.
    (id) => readJson<ProjectWorktree[]>(projectWorktreesRoute(id)).catch(() => null),
  )
  // The pick if it is still in the list, else the first one, so a project switch never submits a
  // worktree from the previous project.
  const chosenWorktree = () => {
    const list = freeWorktrees() ?? []
    return list.find((wt) => wt.path === pickedWorktree()) ?? list[0]
  }
  const defaultBranch = (title: string) =>
    withBranchPrefix(branchPrefix(), slugifyBranch(title))
  const effectiveBranch = () => (branchTouched() ? slugifyBranch(branchText()) : defaultBranch(text()))
  const [availability] = createResource(
    () => {
      if (draft()?.mode !== 'new' || selectedProject()?.vcs !== 'git' || source() !== 'new' || !effectiveBranch()) return undefined
      // Recheck when another window creates or archives a task while this dialog is open.
      query.data
      return { projectId: newProject(), branch: effectiveBranch() }
    },
    async (request) => ({
      ...request,
      result: await readJson<WorktreeAvailability>(projectWorktreeAvailabilityRoute(request.projectId, request.branch))
        .catch((): WorktreeAvailability => ({ available: false, reason: 'Could not check existing worktrees. Try again.' })),
    }),
  )
  const branchAvailability = () => {
    const checked = availability()
    return checked?.projectId === newProject() && checked.branch === effectiveBranch() ? checked.result : undefined
  }
  const branchError = () => {
    const result = branchAvailability()
    return !availability.loading && result && !result.available ? result.reason : ''
  }
  const [savingDraft, setSavingDraft] = createSignal(false)
  // What the icon picker shows while no icon is chosen: the same default the rail row would derive.
  const draftFallbackIcon = () => {
    const d = draft()
    return originIcon(d?.mode === 'rename' ? d.w.origin : 'local')
  }

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
  const activeWorkspace = () => workspaceForProject(workspaces.data, activeProjectId())
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

  // What a right-click on a task row is about (docs/plugins.md § Context menus). `origin`,
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
    // Core's own row actions, registered rather than written inline (docs/plugins.md § Context
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
      setArchiveErr('This workspace has no visible projects yet. Add one in Projects settings first.')
      return
    }
    const current = params.projectId
    setNewProjectOptions(options)
    setNewProject(options.some((project) => project.id === current) ? current! : options[0].id)
    setText('')
    setIconDraft(randomIconName())
    setBranchText('')
    setBranchTouched(false)
    setSource('new')
    setPickedWorktree('')
    setSkipSetup(false)
    setDraftErr('')
    setDraft({ mode: 'new' })
  }

  function openRename(w: Task) {
    setMenuId(null)
    setText(w.title)
    setIconDraft(w.icon)
    setDraft({ mode: 'rename', w })
  }

  // Enter in a field and the footer button both land here, so it checks what the button's
  // `disabled` checks.
  const canSubmitDraft = () => {
    if (savingDraft() || !text().trim()) return false
    if (draft()?.mode !== 'new' || selectedProject()?.vcs !== 'git') return true
    if (source() === 'worktree') return !!chosenWorktree()
    return noBranch() || (!!effectiveBranch() && !prefixRow.loading && !availability.loading && branchAvailability()?.available === true)
  }

  async function submitDraft() {
    if (!canSubmitDraft()) return
    setDraftErr('')
    const d = draft()
    const value = text().trim()
    if (!d || !value) return setDraft(null)
    setSavingDraft(true)
    try {
      if (d.mode === 'new') {
        const project = selectedProject()
        if (!project) return setDraft(null)
        const git = project.vcs === 'git'
        const worktreePath = git && source() === 'worktree' ? chosenWorktree()?.path : undefined
        const branch = git && source() === 'new' ? effectiveBranch() : undefined
        const seed = { origin: 'local' as const, projectId: project.id, branch, worktreePath, title: value, icon: iconDraft() ?? undefined, skipSetup: !!branch && skipSetup() }
        const w = await createTask(seed)
        await invalidate()
        activateTaskSignals(w, { pane: 'pr' }) // fresh local task → start on the PR/default pane
        navigate(pathForTask(w))
      } else {
        // One PATCH for whichever of title or icon changed. Nothing changed means no request.
        const body: { title?: string; icon?: string | null } = {}
        if (value !== d.w.title) body.title = value
        if (iconDraft() !== d.w.icon) body.icon = iconDraft()
        if (Object.keys(body).length) {
          await patchTask(d.w.id, body)
          await invalidate()
        }
      }
      setDraft(null)
    } catch (error) {
      setDraftErr(error instanceof Error ? error.message : 'Could not save the task.')
    } finally {
      setSavingDraft(false)
    }
  }

  // Archive confirm and error use the same modal shell as create and rename, because the webview
  // has no window.prompt. With the bridge present the archive runs through the guarded teardown
  // flow (docs/workspaces-and-tasks.md § Worktrees and setup); the plain HTTP flip is only for the
  // browser dev build.
  const [archiveErr, setArchiveErr] = createSignal('')
  const [draftErr, setDraftErr] = createSignal('')
  // The title, not the project picker above it, is where a person starts typing.
  let draftTitle: HTMLInputElement | undefined

  async function openArchive(w: Task) {
    setMenuId(null)
    setArchiveErr('')
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
      if (!res.ok) return setArchiveErr(res.output ? `${res.reason}\n${res.output}` : res.reason)
      const warnings: string[] = []
      if (res.cleanupFailed?.length) warnings.push(`cleanup failed for: ${res.cleanupFailed.join(', ')}`)
      if (warnings.length) setArchiveErr(`Archived, but ${warnings.join('; ')}.`)
    } else {
      await archiveTask(w.id)
    }
    completeTaskArchive(w.id, () => {
      if (activeTaskId() === w.id) {
        setActiveTaskId(null)
        const source = defaultSourceId()
        if (source) setSelectedSource(source) // archived the active task → fall back to the default browse
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
                archiving: isArchiving(w.id),
                settingUp: isSettingUp(w.id),
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
                        doors onto a task row draw from the same registry (docs/plugins.md § Context
                        menus), so they cannot offer different things. */}
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
                label={source.label}
                glyph={source.icon}
                active={source.selected}
                markers={[...source.markers]}
                aria-current={source.selected ? 'page' : undefined}
                onClick={() => value().selectSource(source.id)}
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
      <Show when={archiveErr()}><Alert>{archiveErr()}</Alert></Show>
      <Show when={draft()}>
        {(d) => (
          <Modal title={d().mode === 'new' ? 'New task' : 'Rename task'} autoFocus={() => draftTitle} onDismiss={() => setDraft(null)}>
            <Show when={d().mode === 'new' && selectedProject()?.vcs === 'git'}>
              <Tabs
                tabs={[
                  { id: 'new', label: 'New worktree' },
                  { id: 'folder', label: 'Project folder' },
                  { id: 'worktree', label: 'Existing worktree', count: freeWorktrees()?.length },
                ]}
                active={source()}
                onChange={(id) => setSource(id as 'new' | 'folder' | 'worktree')}
                idPrefix="new-task"
                ariaLabel="Where the task works"
              />
            </Show>
            <Modal.Body>
              <Show when={draftErr()}><Alert>{draftErr()}</Alert></Show>
              <Show when={d().mode === 'new'}>
                <Field label="Project">
                  <Select value={newProject()} onChange={(value) => setNewProject(value)} options={[...newProjectOptions().map((project) => ({ value: project.id, label: project.name }))]} />
                </Field>
              </Show>
              <Field label="Title">
                <Inline gap="inline">
                  {/* Kept out of the field, which would otherwise name the icon button "Title". It
                      has its own name, "Task icon". */}
                  <FieldProvider value={NO_FIELD}>
                    <IconPicker value={iconDraft()} fallback={draftFallbackIcon()} onSelect={setIconDraft} />
                  </FieldProvider>
                  <Input
                    ref={(el) => (draftTitle = el)}
                    value={text()}
                    onInput={(value) => setText(value)}
                    onSubmit={() => void submitDraft()}
                  />
                </Inline>
              </Field>
              <Show when={d().mode === 'new' && selectedProject()?.vcs === 'git'}>
                {/* The body's column gap, again, so the wrapper does not squash the fields inside it together. */}
                <div id={`new-task-panel-${source()}`} role="tabpanel" aria-labelledby={`new-task-tab-${source()}`} style={{ display: 'flex', 'flex-direction': 'column', gap: 'var(--space-5)' }}>
                  <Show when={source() === 'new'}>
                    <Field label="Branch" error={branchError()} hint={availability.loading ? 'Checking worktree availability…' : undefined}>
                      <Input
                        value={branchTouched() ? branchText() : effectiveBranch()}
                        onInput={(value) => {
                          setBranchTouched(true)
                          setBranchText(value)
                        }}
                        onSubmit={() => void submitDraft()}
                      />
                    </Field>
                    <Checkbox size="sm" label="Skip setup script" checked={skipSetup()} onChange={setSkipSetup} />
                  </Show>
                  <Show when={source() === 'folder'}>
                    <Text tone="muted" wrap>No new branch. The task uses whatever is checked out in the project folder.</Text>
                  </Show>
                  <Show when={source() === 'worktree'}>
                    <Field
                      label="Worktree"
                      hint={freeWorktrees.loading ? 'Asking git for worktrees.' : freeWorktrees() === null ? 'Could not list the worktrees for this project.' : freeWorktrees()?.length ? 'The task uses this folder and its branch. Setup does not run.' : 'Every worktree git lists for this project is already a task.'}
                    >
                      <Select
                        value={chosenWorktree()?.path ?? ''}
                        onChange={setPickedWorktree}
                        disabled={!freeWorktrees()?.length}
                        options={(freeWorktrees() ?? []).map((wt) => ({ value: wt.path, label: wt.branch, description: wt.path }))}
                      />
                    </Field>
                  </Show>
                </div>
              </Show>
            </Modal.Body>
            <Modal.Actions>
              <Button variant="ghost" onPress={() => setDraft(null)}>Cancel</Button>
              <Button variant="solid" disabled={!canSubmitDraft()} onPress={() => void submitDraft()}>
                {d().mode === 'new' ? 'Create task' : 'Rename'}
              </Button>
            </Modal.Actions>
          </Modal>
        )}
      </Show>
    </div>
  )
}
