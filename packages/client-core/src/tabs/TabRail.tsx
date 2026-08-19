import { createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { integrationsOptions, prefsOptions, projectsOptions, tasksKey, tasksOptions, workspacesOptions, type Project, type Task } from '../queries'
import { archiveTask, createTask, patchTask } from '../tasks/mutations'
import { applyRailOrder, isPinned, moveTask, parseRailOrder, pinTask, unpinTask, type RailOrder } from './railOrder'
import { checksState } from '../ui/displayMeta'
import { createDismissable } from '../ui/dismissable'
import { activeTaskId, selectedSource, setActiveTaskId, setSelectedSource, type SourceId } from '../tasks/tasks'
import { defaultSourceId } from '../registries/sources'
import { projectPath } from '../registries/corePaths'
import { activateTaskSignals, pathForTask } from '../tasks/activate'
import { capabilities } from '../capabilities'
import { availableSources } from './sources'
import { taskStatus } from '../tasks/taskStatus'
import { railStatusItems } from '../tasks/railStatus'
import { workingCountFor } from '../tasks/agentSessions'
import { unreadForTask } from '../notifications/notifications'
import { workspaceForProject } from '../workspaces/activeWorkspace'
import { resolveWorkspaceColor } from '@acorn/protocol/workspaceIdentity.ts'
import { dedupeBranch, slugifyBranch, withBranchPrefix } from '@acorn/protocol/branch.ts'
import { taskBridge } from '../tasks/taskBridge'
import { registerCommands } from '../registries/commands'
import { registerKeybindings } from '../registries/keybindings'
import { confirmWillEvent } from '../registries/willPhase'
import { saveJsonPref } from '../settings/savePref'
import { PrefKeys } from '../persistence/prefKeys'
import { completeTaskArchive } from '../tasks/archiveLifecycle'
import { TaskSlotHost } from '../registries/uiSlots'
import ExclusiveSlotHost from '../plugins/ExclusiveSlotHost'
import { registerContextMenuItems, type TaskRowTarget } from '../registries/contextMenus'
import { ContextMenuHost, ContextMenuItems, type ContextMenuOpening } from '../registries/contextMenuHost'
import Icon from '../ui/Icon'
import IconPicker, { randomIconName } from '../ui/IconPicker'
import './tabrail.css'
import { taskOriginAppearance } from '../tasks/origin'
import { Alert, Button, Select, StatusDot } from '../ui/primitives'
import { Menu } from '../ui/Menu'

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
  // The right-click door onto the same row actions. One menu for the whole list rather than one per
  // row, and the row it belongs to travels in the signal — the same reason `menuId` is rail state.
  const [rowMenu, setRowMenu] = createSignal<ContextMenuOpening | null>(null)
  let rowMenuReturnFocus: HTMLElement | undefined

  // Rail order (docs/panes.md): pin-to-top + drag-reorder in a dedicated pref — never
  // tasks.sort. The pure model lives in railOrder.ts.
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
  // Project options are snapshotted when the modal opens, not bound to the reactive activeWorkspace().
  // Otherwise a workspace switch mid-modal (App.tsx restore-nav / workspaces refetch) repopulates the
  // <select> while newRepo() stays on the previously selected repo → the task is created in the wrong
  // workspace.
  const [newProjectOptions, setNewProjectOptions] = createSignal<Project[]>([])
  // Custom branch name (docs/terminal-and-agents.md): defaults to a de-duped slug of the title until the user
  // edits the branch field directly, then their value wins.
  const [branchText, setBranchText] = createSignal('')
  const [branchTouched, setBranchTouched] = createSignal(false)
  // The selected project's branch prefix. Desktop-only — project config is behind the
  // main-process bridge; on web there's no checkout to prefix branches for. Read through taskBridge,
  // not the terminal plugin's client: core must not import plugins (core/boundaries.test.ts).
  const [prefixRow] = createResource(
    () => (draft()?.mode === 'new' ? newProject() : undefined),
    (id) => id ? taskBridge().project.get(id) : null,
  )
  const branchPrefix = () => prefixRow()?.config.branchPrefix ?? null

  const selectedProject = () => projects.data?.find((project) => project.id === newProject())
  const branchesInProject = (projectId: string) =>
    (query.data ?? []).filter((task) => task.projectId === projectId).flatMap((task) => task.branch ? [task.branch] : [])
  // Prefix first, then de-dupe: existing branches are already prefixed, so the suffix has to be
  // chosen against the final name (`me/fix`, `me/fix-2`), not the bare slug.
  const defaultBranch = (title: string) => {
    const slug = withBranchPrefix(branchPrefix(), slugifyBranch(title))
    return slug ? dedupeBranch(slug, branchesInProject(newProject())) : ''
  }
  const effectiveBranch = () => (branchTouched() ? slugifyBranch(branchText()) : defaultBranch(text()))
  // What the icon picker shows while no icon is chosen: the same default the rail row would derive.
  const draftFallbackIcon = () => {
    const d = draft()
    return originIcon(d?.mode === 'rename' ? d.w.origin : 'local')
  }

  const invalidate = () => queryClient.invalidateQueries({ queryKey: tasksKey })

  // Scope the rail to the active workspace through project IDs. Tasks whose project is not in the
  // active workspace are hidden so switching workspaces swaps the roster.
  const activeProjectId = () => params.projectId ?? query.data?.find((task) => task.id === activeTaskId())?.projectId
  const activeWorkspace = () => workspaceForProject(workspaces.data, activeProjectId())
  const visibleTasks = () => {
    const ws = activeWorkspace()
    const all = query.data ?? []
    const inWs = ws ? new Set(ws.projects.map((project) => project.id)) : null
    const scoped = inWs ? all.filter((task) => inWs.has(task.projectId) && !projects.data?.find((project) => project.id === task.projectId)?.hidden) : all
    return applyRailOrder(scoped, railOrder())
  }

  // Sources are contributed by plugins and filtered by their own integration/capability gates.
  // Selecting one fills the main area with that source's browse view.
  const sources = () => availableSources(integrations.data?.integrations)
  function selectSource(id: SourceId) {
    setMenuId(null)
    setSelectedSource(id)
    // From a task view the URL is /t/:taskId, which carries no project — and every browse Source scopes
    // itself to the routed project. Without this the rail swaps to a Source that then reports it has
    // nothing to show. Selecting a Source keeps the project you were working in.
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

  // What a right-click on a task row is ABOUT, in the host's own vocabulary
  // (registries/contextMenus.ts). Flat scalars, because a contributed `when` is a map of literals
  // compared against these fields — `origin`, `projectId` and `pinned` are the three a contribution
  // may match on, and `id`/`title` are the payload the action receives rather than a predicate.
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
    // Core's own row actions, registered rather than written inline — this registry's first consumers.
    // The point of moving them is the contract: a menu contribution is a label, an order, a predicate
    // over the target and one action, and that is only true if core's items fit it too. Pin and Unpin
    // are two contributions with opposite `when`s rather than one row with a computed label, which is
    // the shape a manifest can express.
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
        // Re-read from the query rather than closed over: a contribution receives the flat target, and
        // the modal wants the whole row. The task can have gone away between the click and the read.
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
        const branch = project.vcs === 'git' ? effectiveBranch() : undefined
        const seed = { origin: 'local' as const, projectId: project.id, branch, title: value, icon: iconDraft() ?? undefined }
        const w = await createTask(seed)
        await invalidate()
        activateTaskSignals(w, { pane: 'pr' }) // fresh local task → start on the PR/default pane
        navigate(pathForTask(w))
      } else {
        // One PATCH for whichever of title/icon actually changed; nothing changed → no request.
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

  // Archive confirm/error use the same modal shell as create/rename (Electron has no window.prompt/
  // confirm-styling; the rail's dialogs stay consistent). When the bridge is present the archive
  // ALWAYS runs through the guarded main-process teardown (main decides "no worktree → plain flip",
  // refuses while sessions run or the worktree is dirty); the plain HTTP flip exists only for the
  // bridge-absent browser dev build (capabilities()).
  const [archiveErr, setArchiveErr] = createSignal('')
  const [draftErr, setDraftErr] = createSignal('')
  let draftDialog!: HTMLDivElement
  const draftDismiss = createDismissable({ onDismiss: () => setDraft(null), container: () => draftDialog })

  async function openArchive(w: Task) {
    setMenuId(null)
    setArchiveErr('')
    const confirmed = await confirmWillEvent({
      kind: 'task:archive', payload: { taskId: w.id }, title: 'Archive task', actionLabel: 'Archive task',
    })
    if (confirmed) await archive(w)
  }

  async function archive(w: Task) {
    if (capabilities().terminal) {
      const res = await taskBridge().task.archive(w.id)
      if (!res.ok) return setArchiveErr(res.output ? `${res.reason}\n${res.output}` : res.reason)
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
            <button
              type="button"
              class="tabrail-tab tabrail-source"
              classList={{ active: selectedSource() === s.id }}
              data-tip={s.label}
              data-tip-sub="Browse"
              aria-label={s.label}
              onClick={() => selectSource(s.id)}
            >
              <Icon name={s.glyph} />
            </button>
          )}
        </For>
      </div>
      <div class="tabrail-sep" />
      {/* The one designated core surface a plugin may offer to replace (registries/exclusiveSlots.ts).
          Registering an offer seizes nothing: unless the owner picked a provider in Settings -> Plugins,
          and that provider is installed, enabled here and has not thrown, the list below is what draws.
          `core` is a getter so the subtree and its queries cost nothing while a replacement is up. */}
      <ExclusiveSlotHost slot="rail.taskList" core={() => (
      <div class="tabrail-list">
        <For each={visibleTasks()}>
          {(w) => {
            // CI checks are provider-owned data. The shared rail no longer reaches through a
            // repository source seam; the GitHub PR pane remains the authoritative check surface.
            const checks = () => []
            const st = () => taskStatus(w.id)
            // Active rail markers — one source of truth for the overlay icons below and the hover
            // tooltip's legend, so the two never drift.
            const statusItems = () =>
              railStatusItems({
                checks: w.pullNumber != null && checks().length ? checksState(checks()) : null,
                working: workingCountFor(w.id),
                unread: !!unreadForTask(w.id),
                status: st(),
              })
            // Workspace identity derived onto the row (docs/workspaces-and-tasks.md): 3px accent in the
            // workspace's colour, matching the active-row accent convention in docs/ui-design.md.
            const ws = () => workspaceForProject(workspaces.data, w.projectId)
            const accent = () => {
              const g = ws()
              return g ? resolveWorkspaceColor(g.color, g.name) : undefined
            }
            const wsGlyph = () => {
              const icon = ws()?.icon
              return icon?.kind === 'emoji' ? icon.value : null
            }
            return (
            <div
              class="tabrail-item"
              draggable={true}
              // The second door onto the row's actions. `contextmenu` is also what the platform
              // dispatches for Shift+F10 and the menu key, so this is the keyboard path too — and the
              // button menu beside it still offers the identical list, from the identical registry.
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
              <Show when={isPinned(railOrder(), w.id)}>
                <span class="tabrail-pin" title="Pinned to top"><Icon name="pin" /></span>
              </Show>
              {/* Gains Escape, outside-click and menu roles, none of which this had. The rail
                  keeps owning WHICH menu is open — ⌘1-9 navigation closes it, and that decision
                  cannot live inside one menu instance. */}
              <Menu
                class="tabrail-menu"
                ariaLabel={`Actions for ${w.title}`}
                placement="right-start"
                open={() => menuId() === w.id}
                onOpenChange={(open) => setMenuId(open ? w.id : null)}
                trigger={() => (
                  <button
                    type="button"
                    class="tabrail-tab tabrail-task"
                    classList={{ active: !selectedSource() && w.id === activeTaskId() }}
                    style={accent() ? { 'border-left-color': accent() } : undefined}
                    data-tip={w.title}
                    data-tip-sub={[
                      w.branch ?? 'project folder',
                      taskOriginAppearance(w.origin).tooltip,
                    ].filter(Boolean).join(' · ')}
                    data-tip-legend={statusItems().length ? JSON.stringify(statusItems().map((s) => ({ g: s.glyph, d: s.dotTone, t: s.tone, l: s.label }))) : undefined}
                    aria-label={w.title}
                    aria-haspopup="menu"
                    aria-expanded={menuId() === w.id}
                    onClick={() => onRowClick(w)}
                  >
                    {/* The task's own icon wins, then the workspace's, then the origin default. */}
                    <Icon
                      name={w.icon ?? wsGlyph() ?? originIcon(w.origin)}
                      title={taskOriginAppearance(w.origin).tooltip}
                    />
                  </button>
                )}
              >
                {(menu) => (
                  <>
                    <Menu.Label>{w.title}</Menu.Label>
                    <Menu.Label>{w.branch ?? 'Project folder'}</Menu.Label>
                    <Menu.Separator />
                    {/* The rows come from the registry, core's own included, so this menu and the
                        right-click one can never offer different things. */}
                    <ContextMenuItems context={menu} location="task.row" target={rowTarget(w)} />
                  </>
                )}
              </Menu>
              {/* Live status markers (docs/workspaces-and-tasks.md): CI dot, agent-working spinner,
                  needs-you notice, dirty/repair — from railStatus.ts, mirrored in the hover tooltip. */}
              <For each={statusItems()}>
                {(s) => (
                  <span class={s.overlayCls} title={s.label}>
                    {/* The CI marker has no glyph — it is a StatusDot, whose colour used to come
                        from a class defined in the GitHub plugin's stylesheet. */}
                    <Show when={s.glyph} fallback={<Show when={s.dotTone}>{(tone) => <StatusDot tone={tone()} />}</Show>}>
                      {(g) => <Icon name={g()} />}
                    </Show>
                  </span>
                )}
              </For>
              <TaskSlotHost slot="tabrail.task-row" taskId={w.id} />
            </div>
            )
          }}
        </For>
      </div>
      )} />
      {/* One right-click menu for the whole list. Focus goes back to the row's own button on dismiss,
          which is what keeps this usable from the keyboard rather than a mouse-only affordance. */}
      <ContextMenuHost
        location="task.row"
        ariaLabel={rowMenu() ? `Actions for ${rowMenu()!.target.title}` : 'Task actions'}
        opening={rowMenu}
        onClose={() => setRowMenu(null)}
        returnFocus={() => rowMenuReturnFocus}
      />
      <button type="button" class="tabrail-add" data-tip="New task" data-tip-sub="Start a task on a new branch" aria-label="New task" onClick={openNew}>
        +
      </button>
      {/* `.tabrail-action-error` was never defined in any stylesheet — dropped with the migration. */}
      <Show when={archiveErr()}><Alert>{archiveErr()}</Alert></Show>
      <Show when={draft()}>
        {(d) => (
          <div class="overlay-backdrop" onClick={draftDismiss.onBackdropClick}>
            <div ref={draftDialog} class="overlay" role="dialog" aria-modal="true" onClick={draftDismiss.onContainerClick} onKeyDown={draftDismiss.onKeyDown}>
              <div class="overlay-title">{d().mode === 'new' ? 'New task' : 'Rename task'}</div>
              <div class="overlay-body">
                <Show when={d().mode === 'new'}>
                  <p class="muted">{selectedProject()?.vcs === 'git' ? 'A local-first task on a new branch.' : 'Runs in the project folder.'}</p>
                  <Select value={newProject()} onChange={(e) => setNewProject(e.currentTarget.value)}>
                    <For each={newProjectOptions()}>
                      {(project) => <option value={project.id}>{project.name}</option>}
                    </For>
                  </Select>
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
                  <Button type="submit" disabled={!text().trim() || (d().mode === 'new' && selectedProject()?.vcs === 'git' && !effectiveBranch())}>
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
