import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, onMount, Show, type JSX } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { prefsOptions, tasksKey, tasksOptions, workspacesOptions, type Task } from '../../queries'
import { archiveTask } from '../../mutations'
import PullDetail from '../../PullDetail'
import DiffView from '../../DiffView'
import LinearIssuePanel from '../integrations/LinearIssuePanel'
import RollbarPane from '../integrations/RollbarPane'
import AgentsPanel from '../agents/AgentsPanel'
import EditorPane from '../editor/EditorPane'
import ChangesPane from '../changes/ChangesPane'
import ContextPane from '../context/ContextPane'
import NotesPane from '../notes/NotesPane'
import { workspaceForRepo } from '../workspaces/activeWorkspace'
import { refreshSessions } from '../terminal/sessions'
import { terminalApi } from '../terminal/terminalClient'
import { dispatchLayout, layoutForTask, paneForTask, recipeBrowserUrl, setActivePane, setActiveTaskId, setSelectedSource } from './tasks'
import { defaultLayout, type LayoutAction, type PaneId } from './layout'
import { paneKeymap, paneKeys, type PaneAction } from './paneShortcuts'
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

  // Pane layout: a left→right row of open panes; ⌘/ctrl-click opens a pane beside the others.
  // All transitions via the reducer.
  const layout = () => layoutForTask(props.task.id) ?? defaultLayout()
  const dispatch = (action: LayoutAction) => dispatchLayout(props.task.id, action)
  const visiblePanes = (): PaneId[] => layout().panes
  const showsPane = (p: PaneId) => visiblePanes().includes(p)
  // Switcher click shows just that pane; ⌘/ctrl-click opens it to the right of the open ones.
  const onSwitch = (pane: PaneId, e: MouseEvent) => dispatch(e.metaKey || e.ctrlKey ? { type: 'add', pane } : { type: 'show', pane })
  // Close button (only shown when >1 pane is open), top-right of each slot.
  const CloseBtn = (p: { pane: PaneId }) => (
    <Show when={layout().panes.length > 1}>
      <button type="button" class="pane-close-btn" title="Close pane" aria-label="Close pane" onClick={() => dispatch({ type: 'close', pane: p.pane })}>✕</button>
    </Show>
  )

  // A task can link several Linear tickets (e.g. a PR that resolves multiple). The ◷ icon
  // shows only when there's at least one; the pane lets you switch between them.
  const linearLinks = createMemo(() => props.task.links.filter((l) => l.provider === 'linear'))
  const rollbarLinks = createMemo(() => props.task.links.filter((l) => l.provider === 'rollbar'))
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

  // Open the per-repo config overlay (legacy runCommand/devPort — they map to a 'dev' target).
  function configureRun() {
    const cfg = repoCfg()
    if (!cfg?.path) return window.alert('Open a shell terminal in this task first to map the repo checkout.')
    setCmd(cfg.runCommand ?? 'pnpm dev')
    setPortInput(String(cfg.devPort ?? 3000))
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
  // The `dev` run target is sourced from the workspace dev script (Settings → workspace). Re-fetch
  // the target list when it changes so the ▶ button shows/hides live once the modal saves — the
  // resource is keyed only on task id, so it wouldn't otherwise notice. (defer: the resource already
  // fetches on mount; only react to later edits.)
  createEffect(on(() => previewWs()?.devScript, () => void refetchTargets(), { defer: true }))
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
  const [agentsOpen, setAgentsOpen] = createSignal(false)

  // Pane keyboard shortcuts (overridable via the `pane_shortcuts` pref). A single window listener,
  // scoped to the task view by this component's lifetime. Guards typing targets + modifier chords,
  // like the global handler, so text entry and OS/browser chords are untouched.
  const prefs = createQuery(() => prefsOptions(true))
  const paneKey = createMemo(() => paneKeys(prefs.data?.pane_shortcuts))
  const keymap = createMemo(() => paneKeymap(prefs.data?.pane_shortcuts))
  const activatePane = (a: PaneAction) => {
    if (a === 'agents') return setAgentsOpen((o) => !o)
    if (a === 'terminal') return props.onToggleTerminal()
    if (a === 'pr' && !hasPr()) return
    if (a === 'linear' && !linearLinks().length) return
    if (a === 'rollbar' && !rollbarLinks().length) return
    dispatch({ type: 'show', pane: a })
  }
  const onPaneKey = (e: KeyboardEvent) => {
    const t = e.target
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return
    if (t instanceof HTMLElement && t.isContentEditable) return // editor/notes panes
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const a = keymap().get(e.key.toLowerCase())
    if (!a) return
    e.preventDefault()
    activatePane(a)
  }
  onMount(() => window.addEventListener('keydown', onPaneKey))
  onCleanup(() => window.removeEventListener('keydown', onPaneKey))

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
    if (pane === 'context') return <ContextPane task={props.task} />
    // Preview is rendered wherever it currently sits (active or pinned). Pin it to keep its <webview>
    // mounted while you switch the active pane — the For below reuses the node for an unchanged pin.
    // ponytail: dropped the always-mounted hidden slot; a pinned preview covers the persistent case.
    if (pane === 'preview') return <PreviewPane taskId={props.task.id} url={previewUrl()} hidden={false} onConfigure={configureRun} />
    if (pane === 'rollbar') return <RollbarPane task={props.task} />
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
    <main class="panes panes-workspace task-layout">
      {/* Open panes as an equal-width left→right row (⌘/ctrl-click a switcher icon to add one).
          Each slot shows a close button when >1 is open. */}
      <For each={visiblePanes()}>
        {(pane) => (
          <div class="task-slot" classList={{ 'task-slot-pr': pane === 'pr' && hasPr() }}>
            <CloseBtn pane={pane} />
            {paneBody(pane)}
          </div>
        )}
      </For>

      <nav class="pane-switcher">
        <Show when={hasPr()}>
          <button type="button" class="pane-switch-btn" classList={{ active: showsPane('pr') }} data-tip="PR review" data-tip-key={paneKey().pr} data-tip-sub="Diff, files & review comments · ⌘-click to open beside" aria-label="PR review" onClick={(e) => onSwitch('pr', e)}>⌥</button>
        </Show>
        <Show when={linearLinks().length}>
          <button type="button" class="pane-switch-btn" classList={{ active: showsPane('linear') }} data-tip="Linear" data-tip-key={paneKey().linear} data-tip-sub={linearIds().join(', ')} aria-label="Linear" onClick={(e) => onSwitch('linear', e)}>◷</button>
        </Show>
        <Show when={rollbarLinks().length}>
          <button type="button" class="pane-switch-btn" classList={{ active: showsPane('rollbar') }} data-tip="Rollbar" data-tip-key={paneKey().rollbar} data-tip-sub={`#${rollbarLinks().map((l) => l.identifier).join(', #')}`} aria-label="Rollbar" onClick={(e) => onSwitch('rollbar', e)}>◍</button>
        </Show>
        {/* Run targets only appear when configured (per-workspace dev script, repo config.toml, or the
            repo run-targets JSON) — otherwise the rail shows no run button (docs/next 13 §A). */}
        <Show when={(runTargets() ?? []).length}>
          <For each={runTargets() ?? []}>
            {(t) => (
              <button
                type="button"
                class="pane-switch-btn pane-switch-run"
                classList={{ active: t.running }}
                data-tip={`${t.running ? 'Stop' : 'Run'} ${t.id}`}
                data-tip-sub={t.command}
                aria-label={`${t.running ? 'Stop' : 'Run'} ${t.id}`}
                onClick={() => void toggleTarget(t.id, t.running)}
              >
                {t.running ? '■' : '▶'}<span class="pane-switch-run-id">{t.id}</span>
              </button>
            )}
          </For>
        </Show>
        <button type="button" class="pane-switch-btn" classList={{ active: showsPane('changes') }} data-tip="Changes" data-tip-key={paneKey().changes} data-tip-sub="Uncommitted working tree · ⌘-click to open beside" aria-label="Changes" onClick={(e) => onSwitch('changes', e)}>⎇</button>
        <button type="button" class="pane-switch-btn" classList={{ active: showsPane('notes') }} data-tip="Notes" data-tip-key={paneKey().notes} data-tip-sub="Workspace scratchpad · ⌘-click to open beside" aria-label="Notes" onClick={(e) => onSwitch('notes', e)}>✐</button>
        <button type="button" class="pane-switch-btn" classList={{ active: showsPane('context') }} data-tip="Context" data-tip-key={paneKey().context} data-tip-sub="What an assembled send includes · ⌘-click to open beside" aria-label="Context" onClick={(e) => onSwitch('context', e)}>⊞</button>
        <button type="button" class="pane-switch-btn" classList={{ active: showsPane('preview') }} data-tip="Browser preview" data-tip-key={paneKey().preview} data-tip-sub="Live preview of the app · ⌘-click to open beside" aria-label="Browser preview" onClick={(e) => onSwitch('preview', e)}>◍</button>
        <button type="button" class="pane-switch-btn" classList={{ active: showsPane('editor') }} data-tip="Editor" data-tip-key={paneKey().editor} data-tip-sub="In-app code editor · ⌘-click to open beside" aria-label="Editor" onClick={(e) => onSwitch('editor', e)}>✎</button>
        <button type="button" class="pane-switch-btn" classList={{ active: agentsOpen() }} data-tip="Agents" data-tip-key={paneKey().agents} data-tip-sub="Roster · launcher · feed" aria-label="Agents" onClick={() => setAgentsOpen(!agentsOpen())}>⠿</button>
        <button type="button" class="pane-switch-btn" classList={{ active: props.terminalOpen }} data-tip="Terminal" data-tip-key={paneKey().terminal} data-tip-sub="Shell in the worktree" aria-label="Terminal" onClick={props.onToggleTerminal}>{'>_'}</button>
        <button type="button" class="pane-switch-btn pane-switch-close" data-tip="Close task" aria-label="Close task" onClick={openClose}>✕</button>
      </nav>

      {/* Linear pane reuses the existing ticket panel (a right-anchored overlay). With several linked
          tickets it shows a chip strip to switch between them. */}
      <Show when={agentsOpen()}>
        <AgentsPanel task={props.task} onClose={() => setAgentsOpen(false)} />
      </Show>

      <Show when={showsPane('linear') && linearIds().length}>
        <LinearIssuePanel
          identifier={linearId()}
          identifiers={linearIds()}
          onSelectIdentifier={setPicked}
          onClose={() => dispatch({ type: 'close', pane: 'linear' })}
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
  getWebContentsId(): number
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
      // Bind for agent driving (docs/next 08): main resolves the webContents id → CDP driver.
      el.addEventListener('dom-ready', () => {
        try {
          void window.acorn?.browser?.bind(taskId, captured.getWebContentsId())
        } catch {
          /* driving is optional; the preview still works */
        }
      }, { once: true })
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
