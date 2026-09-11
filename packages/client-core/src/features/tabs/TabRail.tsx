import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { integrationsOptions, prefsOptions, projectsOptions, tasksKey, tasksOptions, workspacesOptions, type Project, type Task } from '../../infra/queries'
import { archiveTask, createTask, patchTask } from '../tasks/taskMutations'
import { applyRailOrder, isPinned, moveTask, parseRailOrder, pinTask, unpinTask, type RailOrder } from './railOrder'
import { checksState } from '../../kit/lib/displayMeta'
import { createDismissable } from '../../kit/lib/dismissable'
import { activeTaskId, selectedSource, setActiveTaskId, setSelectedSource, type SourceId } from '../tasks/tasks'
import { defaultSourceId } from '../../host/registries/sources/sources'
import { schedulePanePrefetch } from '../../host/registries/panes/panes'
import { projectPath } from '../../host/registries/commands/corePaths'
import { activateTaskSignals, pathForTask } from '../tasks/activate'
import { hasHostCapability } from '../../infra/node/hostCapabilities'
import { availableSources } from './railSources'
import { createSourceScope } from './sourceScope'
import { taskStatus } from '../tasks/taskStatus'
import { markersFor } from '../../host/registries/rail/railMarkerFeed'
import { railStatusMarkers } from '../tasks/railStatus'
import { requestTaskAnnotations } from '../../host/annotations/taskAnnotations'
import { unreadForTask } from '../notifications/notifications'
import { workspaceForProject } from '../workspaces/activeWorkspace'
import { resolveProjectColor } from '@acorn/protocol/projectColor.ts'
import { slugifyBranch } from '@acorn/protocol/branch.ts'
import { taskBridge } from '../tasks/taskBridge'
import { defaultBranchForTask } from '../tasks/defaultBranch'
import { registerCommands } from '../../host/registries/commands/commands'
import { registerKeybindings } from '../../host/registries/commands/keybindings'
import { confirmWillEvent } from '../../host/registries/shell/willPhase'
import { saveJsonPref } from '../settings/savePref'
import { PrefKeys } from '../../infra/persistence/prefKeys'
import { completeTaskArchive, isArchiving, withArchiving } from '../tasks/archiveLifecycle'
import ExclusiveSlotHost from '../../host/plugins/ExclusiveSlotHost'
import { registerContextMenuItems, type TaskRowTarget } from '../../host/registries/panes/contextMenus'
import { ContextMenuHost, ContextMenuItems, type ContextMenuOpening } from '../../host/registries/panes/contextMenuHost'
import IconPicker, { randomIconName } from '../../kit/components/inputs/IconPicker'
import { loadIconNodes } from '../../kit/tokens/iconNodes'
import './tabrail.css'
import { RailTab } from './RailTab'
import { taskOriginAppearance } from '../tasks/origin'
import { Alert, Button, Checkbox, Select } from '../../kit/components/primitives'
import { Menu } from '../../kit/components/overlays/Menu'
import { taskHierarchy } from '../tasks/taskHierarchy'

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
  const [dragId, setDragId] = createSignal<string | null>(null)
  // The right-click door onto the same row actions. One menu for the whole list, with the row it
  // belongs to travelling in the signal.
  const [rowMenu, setRowMenu] = createSignal<ContextMenuOpening | null>(null)
  let rowMenuReturnFocus: HTMLElement | undefined

  // Rail order: pin-to-top plus drag-reorder in a dedicated pref, never tasks.sort. The pure model
  // lives in railOrder.ts.
  const railOrder = () => parseRailOrder(prefs.data?.[PrefKeys.railOrder])
  const saveOrder = async (o: RailOrder) => {
    await saveJsonPref(queryClient, PrefKeys.railOrder, o)
  }
  async function onDrop(targetId: string | null) {
    const id = dragId()
    setDragId(null)
    if (!id || id === targetId) return
    await saveOrder(moveTask(railOrder(), visibleTasks().map((t) => t.id), id, targetId))
  }
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
  // a de-duped slug of the title until the user edits the field, then their value wins.
  const [branchText, setBranchText] = createSignal('')
  const [branchTouched, setBranchTouched] = createSignal(false)
  // Opt out of the branch entirely: a task with no branch runs in the project folder on whatever is
  // already checked out, no worktree (docs/workspaces-and-tasks.md § Worktrees and setup). Non-git
  // projects are always like this, so the toggle only shows for git.
  const [noBranch, setNoBranch] = createSignal(false)
  // The selected project's branch prefix. Desktop only, because project config sits behind the
  // main-process bridge and the web build has no checkout. Read through taskBridge rather than the
  // terminal plugin's client, because core must not import plugins (core/boundaries.test.ts).
  const [prefixRow] = createResource(
    () => (draft()?.mode === 'new' ? newProject() : undefined),
    (id) => id ? taskBridge().project.get(id) : null,
  )
  const branchPrefix = () => prefixRow()?.config.branchPrefix ?? null

  const selectedProject = () => projects.data?.find((project) => project.id === newProject())
  const branchesInProject = (projectId: string) =>
    (query.data ?? []).filter((task) => task.projectId === projectId).flatMap((task) => task.branch ? [task.branch] : [])
  const defaultBranch = (title: string) =>
    defaultBranchForTask(title, branchPrefix(), branchesInProject(newProject()))
  const effectiveBranch = () => (branchTouched() ? slugifyBranch(branchText()) : defaultBranch(text()))
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
  const taskRows = createMemo(() => taskHierarchy(orderedTasks()))
  const visibleTasks = () => taskRows().map((row) => row.task)
  const taskDepths = createMemo(() => new Map(taskRows().map((row) => [row.task.id, row.depth])))

  // What other plugins know about the rows on screen (`core:task`, ../tasks/taskAnnotations.ts). One
  // request per contributor for the whole list, re-asked when the list changes and not when the rail
  // merely re-renders. The answers arrive as rail markers through `markersFor` below, so nothing here
  // reads them.
  createEffect(() => requestTaskAnnotations(visibleTasks().map((task) => task.id)))

  const sources = () => availableSources(integrations.data?.integrations, sourceScope())
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
    pinned: isPinned(railOrder(), w.id),
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
    setNoBranch(false)
    setDraft({ mode: 'new' })
  }

  function openRename(w: Task) {
    setMenuId(null)
    setText(w.title)
    setIconDraft(w.icon)
    setDraft({ mode: 'rename', w })
  }

  async function submitDraft(e: Event) {
    e.preventDefault()
    setDraftErr('')
    const d = draft()
    const value = text().trim()
    if (!d || !value) return setDraft(null)
    try {
      if (d.mode === 'new') {
        const project = selectedProject()
        if (!project) return setDraft(null)
        const branch = project.vcs === 'git' && !noBranch() ? effectiveBranch() : undefined
        const seed = { origin: 'local' as const, projectId: project.id, branch, title: value, icon: iconDraft() ?? undefined }
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
    }
  }

  // Archive confirm and error use the same modal shell as create and rename, because the webview
  // has no window.prompt. With the bridge present the archive runs through the guarded teardown
  // flow (docs/workspaces-and-tasks.md § Worktrees and setup); the plain HTTP flip is only for the
  // browser dev build.
  const [archiveErr, setArchiveErr] = createSignal('')
  const [draftErr, setDraftErr] = createSignal('')
  let draftDialog!: HTMLDivElement
  const draftDismiss = createDismissable({ onDismiss: () => setDraft(null), container: () => draftDialog })

  async function openArchive(w: Task) {
    setMenuId(null)
    setArchiveErr('')
    const decision = await confirmWillEvent({
      kind: 'task:archive', payload: { taskId: w.id }, title: 'Archive task', actionLabel: 'Archive task',
    })
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
      if (res.cleanupFailed?.length) setArchiveErr(`Archived, but cleanup failed for: ${res.cleanupFailed.join(', ')}`)
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

  return (
    <nav class="tabrail">
      <div class="tabrail-zone tabrail-sources">
        <For each={sources()}>
          {(s) => (
            <RailTab
              class="tabrail-source"
              label={s.label}
              glyph={s.glyph}
              active={selectedSource() === s.id}
              markers={markersFor({ kind: 'source', id: s.id })}
              data-tip-sub="Browse"
              aria-current={selectedSource() === s.id ? 'page' : undefined}
              onClick={() => selectSource(s.id)}
            />
          )}
        </For>
      </div>
      <div class="tabrail-sep" />
      {/* The one core surface a plugin may offer to replace (registries/exclusiveSlots.ts).
          Registering an offer seizes nothing: the list below draws unless the owner picked a working
          provider in Settings > Plugins. `core` is a getter, so the subtree and its queries cost
          nothing while a replacement is up. */}
      <ExclusiveSlotHost slot="rail.taskList" core={() => (
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
                pinned: isPinned(railOrder(), w.id),
              }),
              ...markersFor({ kind: 'task', id: w.id }),
            ]
            // Project identity owns the optional 3px accent. The task's projectId is the stable join;
            // workspace membership only scopes which task rows are visible.
            const project = () => projects.data?.find((candidate) => candidate.id === w.projectId)
            const accent = () => resolveProjectColor(project()?.color) ?? undefined
            return (
            <div
              class="tabrail-item"
              data-task-depth={taskDepths().get(w.id) || undefined}
              style={{ '--task-depth': String(taskDepths().get(w.id) ?? 0) }}
              draggable={true}
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
              onDragStart={(e) => {
                setDragId(w.id)
                e.dataTransfer?.setData('text/plain', w.id)
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                void onDrop(w.id)
              }}
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
                    glyph={w.icon ?? originIcon(w.origin)}
                    active={!selectedSource() && w.id === activeTaskId()}
                    accent={accent()}
                    markers={markers()}
                    data-tip-sub={[
                      w.branch ?? 'project folder',
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
                    <Menu.Label>{w.title}</Menu.Label>
                    <Menu.Label>{w.branch ?? 'Project folder'}</Menu.Label>
                    <Menu.Separator />
                    {/* Both doors onto a task row draw from the same registry (docs/plugins.md
                        § Context menus), so they cannot offer different things. */}
                    <ContextMenuItems context={menu} location="task.row" target={rowTarget(w)} />
                  </>
                )}
              </Menu>
            </div>
            )
          }}
        </For>
      </div>
      )} />
      {/* One right-click menu for the whole list. Focus returns to the row's own button on dismiss,
          which is what keeps it usable from the keyboard. */}
      <ContextMenuHost
        location="task.row"
        ariaLabel={rowMenu() ? `Actions for ${rowMenu()!.target.title}` : 'Task actions'}
        opening={rowMenu}
        onClose={() => setRowMenu(null)}
        returnFocus={() => rowMenuReturnFocus}
      />
      <RailTab
        class="tabrail-bottom"
        label="New task"
        glyph="plus"
        data-tip-sub="Start a task on a new branch"
        onClick={openNew}
      />
      <Show when={archiveErr()}><Alert>{archiveErr()}</Alert></Show>
      <Show when={draft()}>
        {(d) => (
          <div class="overlay-backdrop" onClick={draftDismiss.onBackdropClick}>
            <div ref={draftDialog} class="overlay" role="dialog" aria-modal="true" onClick={draftDismiss.onContainerClick} onKeyDown={draftDismiss.onKeyDown}>
              <div class="overlay-title">{d().mode === 'new' ? 'New task' : 'Rename task'}</div>
              <div class="overlay-body">
                <Show when={d().mode === 'new'}>
                  <p class="muted">{selectedProject()?.vcs === 'git' && !noBranch() ? 'A local-first task on a new branch.' : 'Runs in the project folder.'}</p>
                  <Select value={newProject()} onChange={(value) => setNewProject(value)} options={[...newProjectOptions().map((project) => ({ value: project.id, label: project.name }))]} />
                </Show>
                <form class="integration-key-row" style={{ 'flex-direction': 'column', 'align-items': 'stretch', gap: '6px' }} onSubmit={submitDraft}>
                  <Show when={draftErr()}><Alert>{draftErr()}</Alert></Show>
                  <div style={{ display: 'flex', 'align-items': 'center', gap: '6px' }}>
                    <IconPicker value={iconDraft()} fallback={draftFallbackIcon()} onSelect={setIconDraft} />
                    <input
                      class="ui-input"
                      style={{ flex: 1, 'min-width': 0 }}
                      type="text"
                      ref={(el) => queueMicrotask(() => el.focus())}
                      placeholder={d().mode === 'new' ? 'Task title' : 'Task name'}
                      value={text()}
                      onInput={(e) => setText(e.currentTarget.value)}
                    />
                  </div>
                  <Show when={d().mode === 'new' && selectedProject()?.vcs === 'git'}>
                    <Show when={!noBranch()}>
                      <input
                        class="ui-input"
                        type="text"
                        placeholder="branch (from title)"
                        title="Branch name — defaults to a slug of the title"
                        value={branchTouched() ? branchText() : effectiveBranch()}
                        onInput={(e) => {
                          setBranchTouched(true)
                          setBranchText(e.currentTarget.value)
                        }}
                        />
                    </Show>
                    <Checkbox
                      size="sm"
                      label="Use the project folder and its current branch"
                      title="The task works in the project folder on whatever branch is checked out, with no worktree"
                      checked={noBranch()}
                      onChange={(checked) => setNoBranch(checked)}
                    />
                  </Show>
                  <Button submit disabled={!text().trim() || (d().mode === 'new' && selectedProject()?.vcs === 'git' && !noBranch() && !effectiveBranch())}>
                    {d().mode === 'new' ? 'Create' : 'Save'}
                  </Button>
                </form>
              </div>
            </div>
          </div>
        )}
      </Show>
    </nav>
  )
}
