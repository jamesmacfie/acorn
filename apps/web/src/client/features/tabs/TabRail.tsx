import { createSignal, For, Show } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { integrationsOptions, prefsKey, prefsOptions, pullDetailOptions, tasksKey, tasksOptions, workspacesOptions, type Task } from '../../queries'
import { archiveTask, createTask, renameTask, setPref } from '../../mutations'
import { applyRailOrder, isPinned, moveTask, parseRailOrder, pinTask, serializeRailOrder, unpinTask, type RailOrder } from './railOrder'
import { checksState } from '../../displayMeta'
import { activeTaskId, paneForTask, selectedSource, setActivePane, setActiveTaskId, setSelectedSource, type SourceId } from '../tasks/tasks'
import { availableSources } from './sources'
import { taskStatus } from '../tasks/taskStatus'
import { workingCountFor } from '../terminal/sessions'
import { markTaskRead, unreadForTask } from '../notifications/notifications'
import { workspaceForRepo } from '../workspaces/activeWorkspace'
import { resolveWorkspaceColor } from '../../../shared/workspaceIdentity'
import { dedupeBranch, slugifyBranch } from '../../../shared/branch'
import { terminalApi } from '../terminal/terminalClient'
import './tabrail.css'

// The Tasks zone of the left rail (docs/workspaces). Rows are real Task entities (not path
// bookmarks). Clicking a row makes it active and navigates to its repo/PR; clicking the active row
// opens a popover to rename or archive it. ponytail: create/rename use a small modal reusing the
// shared .overlay shell. (Electron's BrowserWindow has no window.prompt, so we can't shortcut.)

// Origin → glyph; cosmetic, replaces the old cycled icon.
const ORIGIN_GLYPH: Record<Task['origin'], string> = { 'github-pr': '⌥', linear: '◷', rollbar: '◍', local: '●' }

type Draft = { mode: 'new' } | { mode: 'rename'; w: Task }

export default function TabRail() {
  const navigate = useNavigate()
  const params = useParams()
  const queryClient = useQueryClient()
  const query = createQuery(() => tasksOptions(true))
  const workspaces = createQuery(() => workspacesOptions(true))
  const integrations = createQuery(() => integrationsOptions(true))
  const prefs = createQuery(() => prefsOptions(true))
  const [menuId, setMenuId] = createSignal<string | null>(null)
  const [dragId, setDragId] = createSignal<string | null>(null)

  // Rail order (docs/next 03 §rail): pin-to-top + drag-reorder in a dedicated pref — never
  // tasks.sort. The pure model lives in railOrder.ts.
  const railOrder = () => parseRailOrder(prefs.data?.rail_order)
  const saveOrder = async (o: RailOrder) => {
    await setPref('rail_order', serializeRailOrder(o))
    await queryClient.invalidateQueries({ queryKey: prefsKey })
  }
  async function onDrop(targetId: string | null) {
    const id = dragId()
    setDragId(null)
    if (!id || id === targetId) return
    await saveOrder(moveTask(railOrder(), visibleTasks().map((t) => t.id), id, targetId))
  }
  const [draft, setDraft] = createSignal<Draft | null>(null)
  const [text, setText] = createSignal('')
  const [newRepo, setNewRepo] = createSignal('') // "owner/name" for the new-task repo selector
  // Custom branch name (docs/next 02 P2): defaults to a de-duped slug of the title until the user
  // edits the branch field directly, then their value wins.
  const [branchText, setBranchText] = createSignal('')
  const [branchTouched, setBranchTouched] = createSignal(false)

  const branchesInRepo = (repoKey: string) =>
    (query.data ?? []).filter((t) => `${t.repoOwner}/${t.repoName}` === repoKey).map((t) => t.branch)
  const defaultBranch = (title: string) => {
    const slug = slugifyBranch(title)
    return slug ? dedupeBranch(slug, branchesInRepo(newRepo())) : ''
  }
  const effectiveBranch = () => (branchTouched() ? slugifyBranch(branchText()) : defaultBranch(text()))

  const invalidate = () => queryClient.invalidateQueries({ queryKey: tasksKey })

  // Scope the rail to the active workspace (partition: derived from the current repo). Tasks whose
  // repo isn't in the active workspace are hidden so switching workspaces swaps the roster.
  const activeWorkspace = () => workspaceForRepo(workspaces.data, params.owner, params.repo)
  const visibleTasks = () => {
    const ws = activeWorkspace()
    const all = query.data ?? []
    const scoped = ws ? all.filter((t) => new Set((ws.repos ?? []).map((r) => `${r.owner}/${r.name}`)).has(`${t.repoOwner}/${t.repoName}`)) : all
    return applyRailOrder(scoped, railOrder())
  }

  function pathFor(w: Task): string {
    return `/${w.repoOwner}/${w.repoName}${w.pullNumber != null ? `/${w.pullNumber}` : ''}`
  }

  // Sources: GitHub always; Linear/Rollbar when connected (docs/workspaces 04, docs/next 10).
  // Selecting one fills the main area with that source's browse view.
  const sources = () => availableSources(integrations.data?.integrations)
  function selectSource(id: SourceId) {
    setMenuId(null)
    setSelectedSource(id)
  }

  function onRowClick(w: Task) {
    if (w.id === activeTaskId() && !selectedSource()) {
      setMenuId((v) => (v === w.id ? null : w.id))
      return
    }
    setMenuId(null)
    setSelectedSource(null)
    setActiveTaskId(w.id)
    markTaskRead(w.id) // viewing acknowledges its notices (docs/next 05)
    // Restore the pane last used for this task; only pick a default the first time it's opened.
    if (paneForTask(w.id) == null) setActivePane(w.pullNumber != null ? 'pr' : w.links.some((l) => l.provider === 'linear') ? 'linear' : 'pr')
    navigate(pathFor(w))
  }

  function openNew() {
    setMenuId(null)
    const repos = activeWorkspace()?.repos ?? []
    if (!repos.length) {
      window.alert('This workspace has no repos yet. Add one in the workspace setup first.')
      return
    }
    // Default the repo to the current one if it's in this workspace, else the first.
    const cur = `${params.owner}/${params.repo}`
    setNewRepo(repos.some((r) => `${r.owner}/${r.name}` === cur) ? cur : `${repos[0].owner}/${repos[0].name}`)
    setText('')
    setBranchText('')
    setBranchTouched(false)
    setDraft({ mode: 'new' })
  }

  function openRename(w: Task) {
    setMenuId(null)
    setText(w.title)
    setDraft({ mode: 'rename', w })
  }

  async function submitDraft(e: Event) {
    e.preventDefault()
    const d = draft()
    const value = text().trim()
    if (!d || !value) return setDraft(null)
    if (d.mode === 'new') {
      const [owner, repo] = newRepo().split('/')
      if (!owner || !repo) return setDraft(null)
      const branch = effectiveBranch()
      if (!branch) return
      const w = await createTask({ origin: 'local', repoOwner: owner, repoName: repo, branch, title: value })
      await invalidate()
      setSelectedSource(null)
      setActiveTaskId(w.id)
      setActivePane('pr')
      navigate(pathFor(w))
    } else if (value !== d.w.title) {
      await renameTask(d.w.id, value)
      await invalidate()
    }
    setDraft(null)
  }

  // Archive runs through the guarded main-process teardown when on desktop (refuses while sessions
  // run or the worktree is dirty, removes the worktree); falls back to the plain HTTP flip otherwise.
  async function onArchive(w: Task) {
    setMenuId(null)
    if (!window.confirm(`Archive "${w.title}"?`)) return
    const api = terminalApi()
    if (api) {
      const res = await api.task.archive(w.id)
      if (!res.ok) return window.alert(res.reason)
    } else {
      await archiveTask(w.id)
    }
    if (activeTaskId() === w.id) {
      setActiveTaskId(null)
      setSelectedSource('github') // archived the active task → fall back to the GitHub browse
    }
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
              title={s.label}
              onClick={() => selectSource(s.id)}
            >
              {s.glyph}
            </button>
          )}
        </For>
      </div>
      <div class="tabrail-sep" />
      <div class="tabrail-list">
        <For each={visibleTasks()}>
          {(w) => {
            // PR checks dot (warmed/fetched detail) and live worktree status (dirty / vanished).
            const detail = createQuery(() => pullDetailOptions(w.repoOwner, w.repoName, w.pullNumber != null ? String(w.pullNumber) : '', w.pullNumber != null))
            const checks = () => detail.data?.checks ?? []
            const st = () => taskStatus(w.id)
            // Workspace identity derived onto the row (docs/next 01): 3px accent in the
            // workspace's colour, matching the active-row accent convention in docs/ui-design.md.
            const ws = () => workspaceForRepo(workspaces.data, w.repoOwner, w.repoName)
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
                <span class="tabrail-pin" title="Pinned to top">⌖</span>
              </Show>
              <button
                type="button"
                class="tabrail-tab tabrail-task"
                classList={{ active: !selectedSource() && w.id === activeTaskId() }}
                style={accent() ? { 'border-left-color': accent() } : undefined}
                title={`${w.title}\n${w.branch}${st()?.dirty ? ` · ${st()?.dirtyCount} uncommitted` : ''}`}
                onClick={() => onRowClick(w)}
              >
                {wsGlyph() ?? ORIGIN_GLYPH[w.origin] ?? '●'}
              </button>
              <Show when={w.pullNumber != null && checks().length}>
                <span class={`tabrail-checks checks-dot checks-dot-${checksState(checks())}`} title="PR checks" />
              </Show>
              {/* Agent-working spinner (docs/next 05 — workingCountFor, finally wired) and the
                  needs-you marker for unread notices, cleared when the task is viewed. */}
              <Show when={workingCountFor(w.id)}>
                <span class="tabrail-spinner spin" title={`${workingCountFor(w.id)} agent(s) working`}>⠿</span>
              </Show>
              <Show when={unreadForTask(w.id)}>
                <span class="tabrail-needs" title="An agent needs you — unread notifications">‼</span>
              </Show>
              <Show when={st()?.missing} fallback={
                <Show when={st()?.dirty}>
                  <span class="tabrail-dirty" title={`Uncommitted changes (${st()?.dirtyCount})`}>✎</span>
                </Show>
              }>
                <span class="tabrail-dirty tabrail-repair" title="Worktree missing — needs repair">⚠</span>
              </Show>
              <Show when={menuId() === w.id}>
                <div class="tabrail-menu">
                  <div class="tabrail-menu-title">{w.title}</div>
                  <div class="tabrail-menu-title">{w.branch}</div>
                  <button
                    type="button"
                    class="tabrail-close"
                    onClick={() => {
                      setMenuId(null)
                      void saveOrder(isPinned(railOrder(), w.id) ? unpinTask(railOrder(), w.id) : pinTask(railOrder(), w.id))
                    }}
                  >
                    {isPinned(railOrder(), w.id) ? 'Unpin' : 'Pin to top'}
                  </button>
                  <button type="button" class="tabrail-close" onClick={() => openRename(w)}>
                    Rename
                  </button>
                  <button type="button" class="tabrail-close" onClick={() => void onArchive(w)}>
                    Archive
                  </button>
                </div>
              </Show>
            </div>
            )
          }}
        </For>
      </div>
      <button type="button" class="tabrail-add" title="New task" onClick={openNew}>
        +
      </button>
      <Show when={draft()}>
        {(d) => (
          <div class="overlay-backdrop" onClick={() => setDraft(null)}>
            <div class="overlay" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div class="overlay-title">{d().mode === 'new' ? 'New task' : 'Rename task'}</div>
              <div class="overlay-body">
                <Show when={d().mode === 'new'}>
                  <p class="muted">A local-first task on a new branch.</p>
                  <select class="integration-key-input" value={newRepo()} onChange={(e) => setNewRepo(e.currentTarget.value)}>
                    <For each={activeWorkspace()?.repos ?? []}>
                      {(r) => <option value={`${r.owner}/${r.name}`}>{r.owner}/{r.name}</option>}
                    </For>
                  </select>
                </Show>
                <form class="integration-key-row" style={{ 'flex-direction': 'column', 'align-items': 'stretch', gap: '6px' }} onSubmit={submitDraft}>
                  <input
                    class="integration-key-input"
                    type="text"
                    autofocus
                    placeholder={d().mode === 'new' ? 'Task title' : 'Task name'}
                    value={text()}
                    onInput={(e) => setText(e.currentTarget.value)}
                    onKeyDown={(e) => e.key === 'Escape' && setDraft(null)}
                  />
                  <Show when={d().mode === 'new'}>
                    <input
                      class="integration-key-input"
                      type="text"
                      placeholder="branch (from title)"
                      title="Branch name — defaults to a slug of the title"
                      value={branchTouched() ? branchText() : effectiveBranch()}
                      onInput={(e) => {
                        setBranchTouched(true)
                        setBranchText(e.currentTarget.value)
                      }}
                      onKeyDown={(e) => e.key === 'Escape' && setDraft(null)}
                    />
                  </Show>
                  <button type="submit" class="overlay-btn" disabled={!text().trim() || (d().mode === 'new' && !effectiveBranch())}>
                    {d().mode === 'new' ? 'Create' : 'Save'}
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}
      </Show>
    </nav>
  )
}
