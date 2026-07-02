import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { tasksKey, tasksOptions, workspacesOptions, type Task } from '../../queries'
import { archiveTask } from '../../mutations'
import PullDetail from '../../PullDetail'
import DiffView from '../../DiffView'
import LinearIssuePanel from '../integrations/LinearIssuePanel'
import EditorPane from '../editor/EditorPane'
import ChangesPane from '../changes/ChangesPane'
import ContextTray from '../context/ContextTray'
import NotesPane from '../notes/NotesPane'
import { workspaceForRepo } from '../workspaces/activeWorkspace'
import { refreshSessions } from '../terminal/sessions'
import { terminalApi } from '../terminal/terminalClient'
import { dispatchLayout, layoutForTask, paneForTask, recipeBrowserUrl, setActivePane, setActiveTaskId, setSelectedSource } from './tasks'
import { defaultLayout, type LayoutAction, type PaneId } from './layout'
import { taskStatus } from './taskStatus'
import './task-view.css'

// The single-window Task view (docs/workspaces 02/P4/P5): one active pane plus a switcher of
// the panes that apply. PR review reuses PullDetail + DiffView (scoped to the task's PR via the
// URL the rail navigated to); Linear reuses LinearIssuePanel; run targets (docs/next 13 §A) run as
// terminal sessions in the bottom drawer (one ▶ per target — acorn allocates no ports); the
// preview is a <webview> onto the default target's resolved URL.
// ponytail: terminal + run targets stay drawer terminals rather than rebuilt inline panes.
export default function TaskView(props: {
  task: Task
  terminalOpen: boolean
  onToggleTerminal: () => void
  onOpenTerminal: () => void
}) {
  const api = terminalApi()
  const hasPr = () => props.task.pullNumber != null

  // Pane layout (docs/next 03): 1–2 slots + pin + maximise, all transitions via the reducer.
  const layout = () => layoutForTask(props.task.id) ?? defaultLayout()
  const dispatch = (action: LayoutAction) => dispatchLayout(props.task.id, action)
  // Maximised → that single pane fills the view (chrome collapses); else the 1–2 layout slots.
  const visiblePanes = (): PaneId[] => {
    const l = layout()
    return l.maximised ? [l.maximised] : [...l.panes]
  }
  const showsPane = (p: PaneId) => visiblePanes().includes(p)
  const slotIndex = (p: PaneId) => visiblePanes().indexOf(p)
  const ratio = () => layout().ratio ?? 0.5
  const growFor = (p: PaneId) => (visiblePanes().length === 2 ? (slotIndex(p) === 0 ? ratio() : 1 - ratio()) : 1)
  // The pane pin/maximise controls target: the maximised pane, else the right-most slot.
  const currentPane = (): PaneId => {
    const l = layout()
    return l.maximised ?? l.panes[l.panes.length - 1]
  }
  // Switcher click: toggle-close a visible second pane, otherwise show (pin-aware in the reducer).
  function onSwitch(pane: PaneId) {
    const l = layout()
    if (l.maximised == null && l.panes.length === 2 && l.panes.includes(pane)) dispatch({ type: 'close', pane })
    else dispatch({ type: 'show', pane })
  }
  // Esc restores a maximised pane (docs/next 03 P2).
  const onEsc = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && layout().maximised) dispatch({ type: 'restore' })
  }
  onMount(() => window.addEventListener('keydown', onEsc))
  onCleanup(() => window.removeEventListener('keydown', onEsc))

  // Divider drag updates the split ratio (docs/next 03 P3); clamped in the reducer.
  let panesRef: HTMLElement | undefined
  function startDivider(e: PointerEvent) {
    e.preventDefault()
    const onMove = (ev: PointerEvent) => {
      const rect = panesRef?.getBoundingClientRect()
      if (!rect) return
      const usable = rect.width - 44 // minus the switcher rail
      if (usable > 0) dispatch({ type: 'setRatio', ratio: (ev.clientX - rect.left) / usable })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  // A task can link several Linear tickets (e.g. a PR that resolves multiple). The ◷ icon
  // shows only when there's at least one; the pane lets you switch between them.
  const linearLinks = createMemo(() => props.task.links.filter((l) => l.provider === 'linear'))
  const linearIds = () => linearLinks().map((l) => l.identifier)
  const [picked, setPicked] = createSignal<string | null>(null)
  const linearId = () => (picked() && linearIds().includes(picked()!) ? picked()! : linearIds()[0])
  const st = () => taskStatus(props.task.id)

  // Per-repo dev config (legacy run command/port — maps into the default 'dev' run target).
  const [repoCfg, { refetch }] = createResource(
    () => `${props.task.repoOwner}/${props.task.repoName}`,
    () => api?.repoPath.get(props.task.repoOwner, props.task.repoName) ?? null,
  )

  // Run targets (docs/next 13 §A): the merged config list with live status. One ▶ button per
  // target; acorn allocates no ports — isolation is the script's job via ACORN_TASK_SLUG.
  const [runTargets, { refetch: refetchTargets }] = createResource(
    () => props.task.id,
    async (id) => {
      if (!api) return []
      const res = await api.run.targets(id)
      return 'targets' in res ? res.targets : []
    },
  )

  const [cfgOpen, setCfgOpen] = createSignal(false)
  const [cmd, setCmd] = createSignal('')
  const [portInput, setPortInput] = createSignal('')
  const [cfgErr, setCfgErr] = createSignal('')
  const [editorCmd, setEditorCmd] = createSignal('')

  // Open the worktree in the user's external editor (docs/next 01 P2). A resolution failure opens
  // the per-repo config overlay so the command can be fixed in place.
  async function openExternally() {
    if (!api) return
    const res = await api.openInEditor(props.task.id)
    if (res.ok) return
    setEditorCmd(repoCfg()?.editorCommand ?? '')
    setCfgErr(res.reason ?? 'Could not open the editor.')
    setCmd(repoCfg()?.runCommand ?? '')
    setPortInput(repoCfg()?.devPort != null ? String(repoCfg()?.devPort) : '')
    setCfgOpen(true)
  }

  async function saveEditorCmd() {
    if (!api) return
    const res = await api.repoPath.editorCommand(props.task.repoOwner, props.task.repoName, editorCmd())
    if (!res.ok) return setCfgErr(res.reason)
    setCfgErr('')
    await refetch()
  }

  // Open the per-repo config overlay (legacy runCommand/devPort — they map to a 'dev' target).
  function configureRun() {
    const cfg = repoCfg()
    if (!cfg?.path) return window.alert('Open a shell terminal in this task first to map the repo checkout.')
    setCmd(cfg.runCommand ?? 'pnpm dev')
    setPortInput(String(cfg.devPort ?? 3000))
    setEditorCmd(cfg.editorCommand ?? '')
    setCfgErr('')
    setCfgOpen(true)
  }

  // Start / stop a run target through the runtime service (docs/next 13 §A). The instance is a
  // terminal session in the worktree, so the drawer shows its output.
  async function toggleTarget(id: string, running: boolean) {
    if (!api) return
    const res = running ? await api.run.stop(props.task.id, id) : await api.run.start(props.task.id, id)
    if (!res.ok && res.reason) window.alert(res.reason)
    await refreshSessions()
    await refetchTargets()
    if (!running && res.ok) props.onOpenTerminal()
  }

  async function saveCfg(e: Event) {
    e.preventDefault()
    if (!api) return
    const res = await api.repoPath.runConfig(props.task.repoOwner, props.task.repoName, cmd().trim(), Number(portInput()))
    if (!res.ok) return setCfgErr(res.reason)
    setCfgOpen(false)
    await refetch()
    await refetchTargets()
  }

  // Close-task flow (the ✕ at the bottom of the switcher): confirm, tear the task down (killing any
  // running sessions and — if the user opts in — deleting the worktree, discarding a dirty tree),
  // then drop the tab and select the next one down.
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const tasksQuery = createQuery(() => tasksOptions(true))
  const workspacesQuery = createQuery(() => workspacesOptions(true))

  // Browser-preview URL is configured per workspace (Settings → workspace). Falls back to the
  // dev-server port when unset. 'script' mode runs a command in the worktree (via IPC) for its URL.
  const previewWs = () => workspaceForRepo(workspacesQuery.data, props.task.repoOwner, props.task.repoName)
  const [scriptUrl] = createResource(
    () => {
      const ws = previewWs()
      return ws?.previewMode === 'script' && ws.previewValue ? { taskId: props.task.id, script: ws.previewValue } : null
    },
    async (src) => {
      if (!api) return null
      const res = await api.previewUrl(src.taskId, src.script)
      return res.ok ? (res.url ?? null) : null
    },
  )
  // The default run target's resolved URL is the primary browser/preview home (docs/next 13 §A);
  // re-resolved when target status changes (a url_command needs the instance up).
  const [runUrl] = createResource(
    () => ({ id: props.task.id, running: (runTargets() ?? []).map((t) => `${t.id}:${t.running}`).join(',') }),
    async (src) => (api ? ((await api.run.defaultUrl(src.id)) ?? null) : null),
  )
  const previewUrl = () => {
    // A layout recipe's browser=run:<id> resolution wins for this session (docs/next 13 §C).
    const fromRecipe = recipeBrowserUrl(props.task.id)
    if (fromRecipe) return fromRecipe
    const fromTarget = runUrl()
    if (fromTarget) return fromTarget
    // Legacy workspace preview config, kept as the fallback when no run target resolves.
    const ws = previewWs()
    const val = ws?.previewValue?.trim() || null
    if (ws?.previewMode === 'url') return val
    if (ws?.previewMode === 'port') {
      const p = Number(val)
      return val && Number.isInteger(p) && p >= 1 && p <= 65535 ? `http://localhost:${p}` : null
    }
    if (ws?.previewMode === 'script') return scriptUrl() ?? null
    return repoCfg()?.devPort != null ? `http://localhost:${repoCfg()?.devPort}` : null
  }
  const [closeOpen, setCloseOpen] = createSignal(false)
  const [deleteWt, setDeleteWt] = createSignal(true)
  const [closeErr, setCloseErr] = createSignal('')
  // A failed teardown pauses the close (docs/next 02): offer "close anyway" (skip teardown) or abort.
  const [teardownFailed, setTeardownFailed] = createSignal(false)
  const hasTeardown = () => !!previewWs()?.teardownScript?.trim()
  const hasWorktree = () => !!props.task.worktreePath
  const dirtyCount = () => (st()?.missing ? 0 : st()?.dirty ? (st()?.dirtyCount ?? 0) : 0)

  const pathFor = (t: Task) => `/${t.repoOwner}/${t.repoName}${t.pullNumber != null ? `/${t.pullNumber}` : ''}`
  // The workspace-scoped, sort-ordered rail list (mirrors TabRail's visibleTasks) — the task's repo
  // is the current repo, so scope by it. Pick the task just below the one being closed, else above.
  function nextTask(): Task | null {
    const ws = workspaceForRepo(workspacesQuery.data, props.task.repoOwner, props.task.repoName)
    const all = tasksQuery.data ?? []
    const set = ws ? new Set((ws.repos ?? []).map((r) => `${r.owner}/${r.name}`)) : null
    const list = set ? all.filter((t) => set.has(`${t.repoOwner}/${t.repoName}`)) : all
    const i = list.findIndex((t) => t.id === props.task.id)
    if (i < 0) return list[0] ?? null
    return list[i + 1] ?? list[i - 1] ?? null
  }

  function openClose() {
    setCloseErr('')
    setTeardownFailed(false)
    setDeleteWt(true)
    setCloseOpen(true)
  }

  async function confirmClose(skipTeardown = false) {
    const next = nextTask() // resolve before archiving — the list still holds this task
    if (api) {
      const res = await api.task.archive(props.task.id, { deleteWorktree: deleteWt(), force: true, skipTeardown })
      if (!res.ok) {
        setTeardownFailed(!!res.teardownFailed)
        return setCloseErr(res.output ? `${res.reason}\n${res.output}` : res.reason)
      }
    } else {
      await archiveTask(props.task.id)
    }
    setCloseOpen(false)
    if (next) {
      setSelectedSource(null)
      setActiveTaskId(next.id)
      if (paneForTask(next.id) == null) setActivePane('pr')
      navigate(pathFor(next))
    } else {
      setActiveTaskId(null)
      setSelectedSource('github') // no tasks left → fall back to the GitHub browse
      navigate('/')
    }
    await queryClient.invalidateQueries({ queryKey: tasksKey })
  }

  // One layout slot. PR is the only pane with internal structure (navigator + diff); everything
  // else is a single section. Unknown/unbuilt panes fall back to the empty state.
  function paneBody(pane: PaneId): JSX.Element {
    if (pane === 'pr' && hasPr()) {
      return (
        <>
          <section class="pane pane-mid">
            <div class="section-header">Navigator</div>
            <PullDetail />
          </section>
          <section class="pane pane-right">
            <div class="section-header">Diff</div>
            <DiffView />
          </section>
        </>
      )
    }
    if (pane === 'editor') return <EditorPane task={props.task} />
    if (pane === 'changes') return <ChangesPane task={props.task} />
    if (pane === 'notes') return <NotesPane task={props.task} workspace={previewWs()} />
    if (pane === 'linear') {
      return (
        <section class="pane pane-empty">
          <div class="workspace-empty-inner">
            <p class="muted">Linear panel is open on the right.</p>
          </div>
        </section>
      )
    }
    return (
      <section class="pane pane-empty workspace-empty">
        <div class="workspace-empty-inner">
          <Show when={!hasPr()} fallback={<p class="muted">Select a pane.</p>}>
            <p class="muted">No PR linked yet.</p>
            <p class="muted">Open a terminal to start working on <code>{props.task.branch}</code>; a PR is inherited automatically once you open one.</p>
            <button type="button" class="workspace-empty-term" onClick={props.onOpenTerminal}>
              {props.terminalOpen ? 'Hide terminal' : 'Open terminal'}
            </button>
          </Show>
        </div>
      </section>
    )
  }

  return (
    <div class="workspace-wrap">
    <main class="panes panes-workspace task-layout" ref={panesRef}>
      {/* Layout slots (docs/next 03): flex row ordered by slot index; the preview stays mounted
          below (just hidden) so its <webview> and browse state survive layout changes. */}
      <For each={visiblePanes().filter((p) => p !== 'preview')}>
        {(pane) => (
          <div
            class="task-slot"
            classList={{ 'task-slot-pr': pane === 'pr' && hasPr() }}
            style={{ order: slotIndex(pane) * 2, 'flex-grow': growFor(pane) }}
          >
            {paneBody(pane)}
          </div>
        )}
      </For>
      <Show when={visiblePanes().length === 2}>
        <div class="task-divider" style={{ order: 1 }} onPointerDown={startDivider} title="Drag to resize" />
      </Show>
      <div
        class="task-slot task-slot-preview"
        classList={{ 'is-hidden': !showsPane('preview') }}
        style={{ order: showsPane('preview') ? slotIndex('preview') * 2 : undefined, 'flex-grow': showsPane('preview') ? growFor('preview') : 0 }}
      >
        <PreviewPane taskId={props.task.id} url={previewUrl()} hidden={!showsPane('preview')} onConfigure={configureRun} />
      </div>

      <nav class="pane-switcher" style={{ order: 99 }}>
        <Show when={hasPr()}>
          <button type="button" class="pane-switch-btn" classList={{ active: showsPane('pr'), pinned: layout().pinned === 'pr' }} title="PR review" onClick={() => onSwitch('pr')}>⌥</button>
        </Show>
        <Show when={linearLinks().length}>
          <button type="button" class="pane-switch-btn" classList={{ active: showsPane('linear'), pinned: layout().pinned === 'linear' }} title={`Linear (${linearIds().join(', ')})`} onClick={() => onSwitch('linear')}>◷</button>
        </Show>
        <Show when={(runTargets() ?? []).length} fallback={
          <button type="button" class="pane-switch-btn" title="Configure run targets" onClick={configureRun}>▶</button>
        }>
          <For each={runTargets() ?? []}>
            {(t) => (
              <button
                type="button"
                class="pane-switch-btn pane-switch-run"
                classList={{ active: t.running }}
                title={`${t.running ? 'Stop' : 'Run'} ${t.id} — ${t.command}`}
                onClick={() => void toggleTarget(t.id, t.running)}
              >
                {t.running ? '■' : '▶'}<span class="pane-switch-run-id">{t.id}</span>
              </button>
            )}
          </For>
        </Show>
        <button type="button" class="pane-switch-btn" classList={{ active: showsPane('changes'), pinned: layout().pinned === 'changes' }} title="Changes (uncommitted)" onClick={() => onSwitch('changes')}>⎇</button>
        <button type="button" class="pane-switch-btn" classList={{ active: showsPane('notes'), pinned: layout().pinned === 'notes' }} title="Notes (workspace)" onClick={() => onSwitch('notes')}>📝</button>
        <button type="button" class="pane-switch-btn" classList={{ active: showsPane('preview'), pinned: layout().pinned === 'preview' }} title="Browser preview" onClick={() => onSwitch('preview')}>◍</button>
        <button type="button" class="pane-switch-btn" classList={{ active: showsPane('editor'), pinned: layout().pinned === 'editor' }} title="Editor" onClick={() => onSwitch('editor')}>✎</button>
        <button type="button" class="pane-switch-btn" title="Open in external editor" onClick={() => void openExternally()}>↗</button>
        {/* Pin (docs/next 03 P3): fixes the current pane's slot — switcher clicks then open in the
            other slot. Maximise (P2): the current pane fills the view; Esc or a second click restores. */}
        <button
          type="button"
          class="pane-switch-btn"
          classList={{ active: layout().pinned != null }}
          title={layout().pinned ? `Unpin ${layout().pinned}` : `Pin ${currentPane()} pane`}
          onClick={() => (layout().pinned ? dispatch({ type: 'unpin' }) : dispatch({ type: 'pin', pane: currentPane() }))}
        >⌖</button>
        <button
          type="button"
          class="pane-switch-btn"
          classList={{ active: layout().maximised != null }}
          title={layout().maximised ? 'Restore (Esc)' : `Maximise ${currentPane()} pane`}
          onClick={() => dispatch({ type: 'toggleMaximise', pane: currentPane() })}
        >⤢</button>
        <button type="button" class="pane-switch-btn" classList={{ active: props.terminalOpen }} title="Terminal" onClick={props.onToggleTerminal}>{'>_'}</button>
        <button type="button" class="pane-switch-btn pane-switch-close" title="Close task" onClick={openClose}>✕</button>
      </nav>

      {/* Linear pane reuses the existing ticket panel (a right-anchored overlay). With several linked
          tickets it shows a chip strip to switch between them. */}
      <Show when={showsPane('linear') && linearIds().length}>
        <LinearIssuePanel
          identifier={linearId()}
          identifiers={linearIds()}
          onSelectIdentifier={setPicked}
          onClose={() => onSwitch('linear')}
          onContentClick={() => {}}
        />
      </Show>

      <Show when={cfgOpen()}>
        <div class="overlay-backdrop" onClick={() => setCfgOpen(false)}>
          <div class="overlay" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div class="overlay-title">Dev server — {props.task.repoOwner}/{props.task.repoName}</div>
            <div class="overlay-body">
              <p class="muted">Legacy run command + port — becomes the default “dev” run target (URL: localhost:port). For named targets, set them in workspace settings or commit .acorn/config.toml.</p>
              <form class="integration-key-row" onSubmit={saveCfg}>
                <input class="integration-key-input" type="text" placeholder="pnpm dev" value={cmd()} onInput={(e) => setCmd(e.currentTarget.value)} />
                <input class="integration-key-input" type="number" style={{ 'max-width': '90px' }} placeholder="3000" value={portInput()} onInput={(e) => setPortInput(e.currentTarget.value)} />
                <button type="submit" class="overlay-btn" disabled={!cmd().trim() || !portInput().trim()}>Run</button>
              </form>
              <p class="muted">Open in editor — the command for “open externally” (blank = default “code”).</p>
              <div class="integration-key-row">
                <input class="integration-key-input" type="text" placeholder="code" value={editorCmd()} onInput={(e) => setEditorCmd(e.currentTarget.value)} />
                <button type="button" class="overlay-btn" onClick={() => void saveEditorCmd()}>Save editor</button>
              </div>
              <Show when={cfgErr()}><div class="action-error">{cfgErr()}</div></Show>
            </div>
          </div>
        </div>
      </Show>

      <Show when={closeOpen()}>
        <div class="overlay-backdrop" onClick={() => setCloseOpen(false)}>
          <div class="overlay" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div class="overlay-title">Close task</div>
            <div class="overlay-body">
              <p class="muted">Close “{props.task.title}” and remove it from the rail?</p>
              <Show when={hasWorktree() && deleteWt() && hasTeardown()}>
                <p class="muted">Will run the teardown script before removing the worktree.</p>
              </Show>
              <Show when={hasWorktree()}>
                <label class="close-check">
                  <input type="checkbox" checked={deleteWt()} onChange={(e) => setDeleteWt(e.currentTarget.checked)} />
                  <span>Also delete this worktree</span>
                </label>
                <Show when={deleteWt() && dirtyCount() > 0}>
                  <div class="action-error">⚠ {dirtyCount()} uncommitted change{dirtyCount() === 1 ? '' : 's'} — deleting the worktree discards them.</div>
                </Show>
              </Show>
              <Show when={closeErr()}><div class="action-error" style={{ 'white-space': 'pre-wrap' }}>{closeErr()}</div></Show>
              <div class="close-actions">
                <button type="button" class="overlay-btn" onClick={() => setCloseOpen(false)}>Cancel</button>
                <Show when={teardownFailed()}>
                  <button type="button" class="overlay-btn close-confirm" onClick={() => void confirmClose(true)}>Close anyway (skip teardown)</button>
                </Show>
                <button type="button" class="overlay-btn close-confirm" onClick={() => void confirmClose()}>Close task</button>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </main>
    <Show when={!layout().maximised}>
    <ContextTray task={props.task} />
    <footer class="workspace-footer">
      <Show when={props.task.worktreePath} fallback={<span class="muted">No worktree yet — created on first terminal.</span>}>
        {(p) => (
          <>
            <span class="workspace-footer-path" title={p()}>worktree: {p()}</span>
            <Show when={st()?.missing}>
              <span class="workspace-footer-repair">⚠ needs repair (removed on disk)</span>
            </Show>
            <Show when={!st()?.missing && st()?.dirty}>
              <span class="workspace-footer-dirty">● dirty ({st()?.dirtyCount} file{st()?.dirtyCount === 1 ? '' : 's'})</span>
            </Show>
            <Show when={st() && !st()!.missing && !st()!.dirty}>
              <span class="muted">● clean</span>
            </Show>
          </>
        )}
      </Show>
    </footer>
    </Show>
    </div>
  )
}

// Electron's <webview> isn't a typed JSX element; this is the slice of its API the chrome drives.
type WebviewEl = HTMLElement & {
  src: string
  loadURL(url: string): void
  reload(): void
  stop(): void
  goBack(): void
  goForward(): void
  canGoBack(): boolean
  canGoForward(): boolean
  getURL(): string
}
const withScheme = (v: string) => (/^[a-z]+:\/\//i.test(v) ? v : `https://${v}`)

// One live <webview> per task, kept for the whole app session so browse state (page, scroll, form
// input) survives pane and task switches — only a page reload (app restart) starts fresh. Not GC'd
// on task close.
// ponytail: session-lifetime leak; add cleanup on task archive if it ever bites.
const previewWebviews = new Map<string, WebviewEl>()

// The browser-preview pane: browser chrome (back/forward/stop-reload/home + editable URL bar +
// loading spinner) over the per-task <webview>. props.url is the workspace-configured "home"; the
// main process's will-attach-webview guard keeps it to http(s).
function PreviewPane(props: { taskId: string; url: string | null; hidden: boolean; onConfigure: () => void }) {
  let host!: HTMLDivElement
  const [loading, setLoading] = createSignal(false)
  const [addr, setAddr] = createSignal('')
  const [canBack, setCanBack] = createSignal(false)
  const [canFwd, setCanFwd] = createSignal(false)
  const active = () => previewWebviews.get(props.taskId) ?? null
  const isActive = (el: WebviewEl) => previewWebviews.get(props.taskId) === el
  const syncFrom = (el: WebviewEl) => {
    try {
      setAddr(el.getURL() || props.url || '')
      setCanBack(el.canGoBack())
      setCanFwd(el.canGoForward())
    } catch {
      setAddr(props.url ?? '')
      setCanBack(false)
      setCanFwd(false)
    }
  }

  // Show the current task's webview (creating it on first open), hide the others. Re-appends after a
  // TaskView remount (leaving/returning the task view), which reloads that one webview.
  createEffect(() => {
    const taskId = props.taskId
    const url = props.url
    if (!host || !url) return
    let el = previewWebviews.get(taskId)
    if (!el) {
      el = document.createElement('webview') as WebviewEl
      el.setAttribute('src', url)
      el.setAttribute('data-acorn-home', url)
      el.style.width = '100%'
      el.style.height = '100%'
      const captured = el
      el.addEventListener('did-start-loading', () => isActive(captured) && setLoading(true))
      el.addEventListener('did-stop-loading', () => isActive(captured) && (setLoading(false), syncFrom(captured)))
      const onNav = (e: Event) => isActive(captured) && (setAddr((e as Event & { url?: string }).url ?? captured.getURL()), syncFrom(captured))
      el.addEventListener('did-navigate', onNav)
      el.addEventListener('did-navigate-in-page', onNav)
      previewWebviews.set(taskId, el)
    }
    if (el.parentElement !== host) host.appendChild(el) // fresh host after a remount → reload
    // A changed home URL (a layout recipe resolved a run target, docs/next 13 §C) navigates there.
    if (el.getAttribute('data-acorn-home') !== url) {
      el.setAttribute('data-acorn-home', url)
      try {
        el.loadURL(url)
      } catch {
        /* webview not ready yet — the src attribute already points home */
      }
    }
    for (const [id, w] of previewWebviews) w.style.display = id === taskId ? 'flex' : 'none'
    setLoading(false)
    syncFrom(el)
  })

  const go = () => {
    const el = active()
    const v = addr().trim()
    if (el && v) el.loadURL(withScheme(v))
  }

  return (
    <section class="pane workspace-preview" classList={{ 'is-hidden': props.hidden }} style={{ 'grid-column': '1 / 3' }}>
      <Show when={props.url} fallback={
        <div class="workspace-empty-inner">
          <p class="muted">No dev server port configured.</p>
          <button type="button" class="workspace-empty-term" onClick={props.onConfigure}>Configure & run</button>
        </div>
      }>
        <div class="preview-chrome">
          <button type="button" class="preview-nav-btn" title="Back" disabled={!canBack()} onClick={() => active()?.goBack()}>‹</button>
          <button type="button" class="preview-nav-btn" title="Forward" disabled={!canFwd()} onClick={() => active()?.goForward()}>›</button>
          <button type="button" class="preview-nav-btn" title={loading() ? 'Stop' : 'Reload'} onClick={() => (loading() ? active()?.stop() : active()?.reload())}>{loading() ? '✕' : '↻'}</button>
          <button type="button" class="preview-nav-btn" title="Home" onClick={() => props.url && active()?.loadURL(props.url)}>⌂</button>
          <input
            class="preview-url"
            type="text"
            spellcheck={false}
            value={addr()}
            onInput={(e) => setAddr(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && go()}
          />
          <Show when={loading()}><span class="preview-spinner spin">◐</span></Show>
        </div>
      </Show>
      <div class="workspace-preview-host" ref={host} />
    </section>
  )
}
