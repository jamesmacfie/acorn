import { createEffect, createMemo, createResource, createSignal, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { tasksKey, tasksOptions, workspacesOptions, type Task } from '../../queries'
import { archiveTask } from '../../mutations'
import PullDetail from '../../PullDetail'
import DiffView from '../../DiffView'
import LinearIssuePanel from '../integrations/LinearIssuePanel'
import EditorPane from '../editor/EditorPane'
import { workspaceForRepo } from '../workspaces/activeWorkspace'
import { refreshSessions, sessions } from '../terminal/sessions'
import { terminalApi } from '../terminal/terminalClient'
import { activePane, paneForTask, setActivePane, setActiveTaskId, setSelectedSource } from './tasks'
import { taskStatus } from './taskStatus'
import './task-view.css'

// The single-window Task view (docs/workspaces 02/P4/P5): one active pane plus a switcher of
// the panes that apply. PR review reuses PullDetail + DiffView (scoped to the task's PR via the
// URL the rail navigated to); Linear reuses LinearIssuePanel; the dev server runs as a terminal in
// the bottom drawer (▶, with a per-task PORT); the preview is a <webview> onto that port.
// ponytail: terminal + dev server stay drawer terminals rather than rebuilt inline panes.
export default function TaskView(props: {
  task: Task
  terminalOpen: boolean
  onToggleTerminal: () => void
  onOpenTerminal: () => void
}) {
  const api = terminalApi()
  const hasPr = () => props.task.pullNumber != null
  // A task can link several Linear tickets (e.g. a PR that resolves multiple). The ◷ icon
  // shows only when there's at least one; the pane lets you switch between them.
  const linearLinks = createMemo(() => props.task.links.filter((l) => l.provider === 'linear'))
  const linearIds = () => linearLinks().map((l) => l.identifier)
  const [picked, setPicked] = createSignal<string | null>(null)
  const linearId = () => (picked() && linearIds().includes(picked()!) ? picked()! : linearIds()[0])
  const st = () => taskStatus(props.task.id)

  // Per-repo dev config (run command + base port). Re-loaded when the task's repo changes.
  const [repoCfg, { refetch }] = createResource(
    () => `${props.task.repoOwner}/${props.task.repoName}`,
    () => api?.repoPath.get(props.task.repoOwner, props.task.repoName) ?? null,
  )
  // Per-task port: base + the task's rail offset, so two tasks don't fight over a port.
  const port = () => {
    const base = repoCfg()?.devPort
    return base != null ? base + props.task.sort : null
  }

  const [cfgOpen, setCfgOpen] = createSignal(false)
  const [cmd, setCmd] = createSignal('')
  const [portInput, setPortInput] = createSignal('')
  const [cfgErr, setCfgErr] = createSignal('')

  const devSession = () => sessions().find((s) => s.taskId === props.task.id && s.title.startsWith('▶ '))

  // Start (or focus) the dev server. Needs a mapped checkout + a configured run command + port.
  async function startDev() {
    if (!api) return
    const cfg = repoCfg()
    if (!cfg?.path) return window.alert('Open a shell terminal in this task first to map the repo checkout.')
    if (!cfg.runCommand || cfg.devPort == null) {
      setCmd(cfg.runCommand ?? 'pnpm dev')
      setPortInput(String(cfg.devPort ?? 3000))
      setCfgErr('')
      setCfgOpen(true)
      return
    }
    if (!devSession()) {
      await api.create({
        taskId: props.task.id,
        profileId: 'shell',
        cwd: cfg.path,
        command: cfg.runCommand,
        env: { PORT: String(cfg.devPort + props.task.sort) },
        title: `▶ ${cfg.runCommand}`,
      })
      await refreshSessions()
    }
    props.onOpenTerminal()
  }

  async function saveCfg(e: Event) {
    e.preventDefault()
    if (!api) return
    const res = await api.repoPath.runConfig(props.task.repoOwner, props.task.repoName, cmd().trim(), Number(portInput()))
    if (!res.ok) return setCfgErr(res.reason)
    setCfgOpen(false)
    await refetch()
    await startDev()
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
  const previewUrl = () => {
    const ws = previewWs()
    const val = ws?.previewValue?.trim() || null
    if (ws?.previewMode === 'url') return val
    if (ws?.previewMode === 'port') {
      const p = Number(val)
      return val && Number.isInteger(p) && p >= 1 && p <= 65535 ? `http://localhost:${p}` : null
    }
    if (ws?.previewMode === 'script') return scriptUrl() ?? null
    return port() != null ? `http://localhost:${port()}` : null
  }
  const [closeOpen, setCloseOpen] = createSignal(false)
  const [deleteWt, setDeleteWt] = createSignal(true)
  const [closeErr, setCloseErr] = createSignal('')
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
    setDeleteWt(true)
    setCloseOpen(true)
  }

  async function confirmClose() {
    const next = nextTask() // resolve before archiving — the list still holds this task
    if (api) {
      const res = await api.task.archive(props.task.id, { deleteWorktree: deleteWt(), force: true })
      if (!res.ok) return setCloseErr(res.reason)
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

  return (
    <div class="workspace-wrap">
    <main class="panes panes-workspace">
      {/* Preview stays mounted (just hidden) so its <webview> and browse state survive pane switches;
          the other panes render only when preview isn't active. */}
      <Show when={activePane() !== 'preview'}>
        <Show when={activePane() === 'editor'} fallback={
          <Show
            when={activePane() === 'pr' && hasPr()}
            fallback={
              <section class="pane pane-mid pane-empty workspace-empty">
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
            }
          >
            <section class="pane pane-mid">
              <div class="section-header">Navigator</div>
              <PullDetail />
            </section>
            <section class="pane pane-right">
              <div class="section-header">Diff</div>
              <DiffView />
            </section>
          </Show>
        }>
          <EditorPane task={props.task} />
        </Show>
      </Show>
      <PreviewPane taskId={props.task.id} url={previewUrl()} hidden={activePane() !== 'preview'} onConfigure={startDev} />

      <nav class="pane-switcher">
        <Show when={hasPr()}>
          <button type="button" class="pane-switch-btn" classList={{ active: activePane() === 'pr' }} title="PR review" onClick={() => setActivePane('pr')}>⌥</button>
        </Show>
        <Show when={linearLinks().length}>
          <button type="button" class="pane-switch-btn" classList={{ active: activePane() === 'linear' }} title={`Linear (${linearIds().join(', ')})`} onClick={() => setActivePane('linear')}>◷</button>
        </Show>
        <button type="button" class="pane-switch-btn" classList={{ active: !!devSession() }} title="Run dev server" onClick={() => void startDev()}>▶</button>
        <button type="button" class="pane-switch-btn" classList={{ active: activePane() === 'preview' }} title="Browser preview" onClick={() => setActivePane('preview')}>◍</button>
        <button type="button" class="pane-switch-btn" classList={{ active: activePane() === 'editor' }} title="Editor" onClick={() => setActivePane('editor')}>✎</button>
        <button type="button" class="pane-switch-btn" classList={{ active: props.terminalOpen }} title="Terminal" onClick={props.onToggleTerminal}>{'>_'}</button>
        <button type="button" class="pane-switch-btn pane-switch-close" title="Close task" onClick={openClose}>✕</button>
      </nav>

      {/* Linear pane reuses the existing ticket panel (a right-anchored overlay). With several linked
          tickets it shows a chip strip to switch between them. */}
      <Show when={activePane() === 'linear' && linearIds().length}>
        <LinearIssuePanel
          identifier={linearId()}
          identifiers={linearIds()}
          onSelectIdentifier={setPicked}
          onClose={() => setActivePane('pr')}
          onContentClick={() => {}}
        />
      </Show>

      <Show when={cfgOpen()}>
        <div class="overlay-backdrop" onClick={() => setCfgOpen(false)}>
          <div class="overlay" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div class="overlay-title">Dev server — {props.task.repoOwner}/{props.task.repoName}</div>
            <div class="overlay-body">
              <p class="muted">Run command (in the worktree) and base port. PORT becomes base + this task's offset.</p>
              <form class="integration-key-row" onSubmit={saveCfg}>
                <input class="integration-key-input" type="text" placeholder="pnpm dev" value={cmd()} onInput={(e) => setCmd(e.currentTarget.value)} />
                <input class="integration-key-input" type="number" style={{ 'max-width': '90px' }} placeholder="3000" value={portInput()} onInput={(e) => setPortInput(e.currentTarget.value)} />
                <button type="submit" class="overlay-btn" disabled={!cmd().trim() || !portInput().trim()}>Run</button>
              </form>
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
              <Show when={hasWorktree()}>
                <label class="close-check">
                  <input type="checkbox" checked={deleteWt()} onChange={(e) => setDeleteWt(e.currentTarget.checked)} />
                  <span>Also delete this worktree</span>
                </label>
                <Show when={deleteWt() && dirtyCount() > 0}>
                  <div class="action-error">⚠ {dirtyCount()} uncommitted change{dirtyCount() === 1 ? '' : 's'} — deleting the worktree discards them.</div>
                </Show>
              </Show>
              <Show when={closeErr()}><div class="action-error">{closeErr()}</div></Show>
              <div class="close-actions">
                <button type="button" class="overlay-btn" onClick={() => setCloseOpen(false)}>Cancel</button>
                <button type="button" class="overlay-btn close-confirm" onClick={() => void confirmClose()}>Close task</button>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </main>
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
