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
import PreviewPane, { evictPreviewWebview } from '../preview/PreviewPane'
import { workspaceForRepo } from '../workspaces/activeWorkspace'
import { refreshSessions } from '../terminal/sessions'
import { terminalApi } from '../terminal/terminalClient'
import { dispatchLayout, layoutForTask, recipeBrowserUrl, setActiveTaskId, setSelectedSource } from './tasks'
import { activateTaskSignals, pathForTask } from './activate'
import { defaultLayout, type LayoutAction, type PaneId } from './layout'
import { eventChord, formatChord, paneKeymap, paneKeys, type PaneAction } from './paneShortcuts'
import { isTerminalTarget, isTypingTarget } from '../../lib/isTypingTarget'
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
    return null
  }
  const [agentsOpen, setAgentsOpen] = createSignal(false)

  // Pane keyboard shortcuts (overridable via the `pane_shortcuts` pref). A single window listener,
  // scoped to the task view by this component's lifetime. Each shortcut is a ⌘/Ctrl chord; the typing-
  // target guard still stands so ⌘A/⌘X/⌘S keep editing inside the editor and notes panes.
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
    if (!(e.metaKey || e.ctrlKey || e.altKey)) return // pane shortcuts are chords, never bare keys
    // Form fields + contentEditable (editor/notes panes) own their keystrokes — except the
    // terminal, where ⌘ chords are safe (Ctrl/Alt chords stay with the shell: Ctrl+C etc.).
    if (isTypingTarget(e.target) && !(e.metaKey && isTerminalTarget(e.target))) return
    const c = eventChord(e)
    if (!c) return
    const a = keymap().get(c)
    if (!a) return
    e.preventDefault()
    activatePane(a)
  }
  onMount(() => window.addEventListener('keydown', onPaneKey))
  onCleanup(() => window.removeEventListener('keydown', onPaneKey))

  const [closeOpen, setCloseOpen] = createSignal(false)
  const [deleteWt, setDeleteWt] = createSignal(true)
  const [closeErr, setCloseErr] = createSignal('')
  // A failed teardown pauses the close (docs/terminal-and-agents.md): offer "close anyway" (skip teardown) or abort.
  const [teardownFailed, setTeardownFailed] = createSignal(false)
  const hasTeardown = () => !!previewWs()?.teardownScript?.trim()
  const hasWorktree = () => !!props.task.worktreePath
  const dirtyCount = () => (st()?.missing ? 0 : st()?.dirty ? (st()?.dirtyCount ?? 0) : 0)
  // Discarding a dirty worktree is force-destructive, so it needs an explicit ack — without it the
  // "discards them" line was decorative and Close would force-remove uncommitted work silently.
  const [discardAck, setDiscardAck] = createSignal(false)
  const needsDiscardAck = () => deleteWt() && dirtyCount() > 0
  const closeBlocked = () => needsDiscardAck() && !discardAck()

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
    setDiscardAck(false)
    setCloseOpen(true)
  }

  async function confirmClose(skipTeardown = false) {
    const next = nextTask() // resolve before archiving — the list still holds this task
    if (api) {
      const res = await api.task.archive(props.task.id, { deleteWorktree: deleteWt(), force: !closeBlocked(), skipTeardown })
      if (!res.ok) {
        setTeardownFailed(!!res.teardownFailed)
        return setCloseErr(res.output ? `${res.reason}\n${res.output}` : res.reason)
      }
    } else {
      await archiveTask(props.task.id)
    }
    evictPreviewWebview(props.task.id) // drop the archived task's kept-alive <webview>
    setCloseOpen(false)
    if (next) {
      activateTaskSignals(next)
      navigate(pathForTask(next))
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
    // Preview is rendered wherever it currently sits; its per-task <webview> lives in
    // features/preview and survives pane/task switches (evicted on archive).
    if (pane === 'preview') return <PreviewPane taskId={props.task.id} url={previewUrl()} />
    if (pane === 'rollbar') return <RollbarPane task={props.task} />
    // Linear renders in its slot like every other provider pane (variant="pane"); the same
    // component still serves PullDetail's Integrations section as a right-anchored overlay.
    if (pane === 'linear' && linearIds().length) {
      return (
        <LinearIssuePanel
          variant="pane"
          identifier={linearId()}
          identifiers={linearIds()}
          onSelectIdentifier={setPicked}
          onClose={() => dispatch({ type: 'close', pane: 'linear' })}
          onContentClick={() => {}}
        />
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
          <button type="button" class="pane-switch-btn" classList={{ active: showsPane('pr') }} data-tip="PR review" data-tip-key={formatChord(paneKey().pr)} data-tip-sub="Diff, files & review comments · ⌘-click to open beside" aria-label="PR review" onClick={(e) => onSwitch('pr', e)}>⌥</button>
        </Show>
        <Show when={linearLinks().length}>
          <button type="button" class="pane-switch-btn" classList={{ active: showsPane('linear') }} data-tip="Linear" data-tip-key={formatChord(paneKey().linear)} data-tip-sub={linearIds().join(', ')} aria-label="Linear" onClick={(e) => onSwitch('linear', e)}>◷</button>
        </Show>
        <Show when={rollbarLinks().length}>
          <button type="button" class="pane-switch-btn" classList={{ active: showsPane('rollbar') }} data-tip="Rollbar" data-tip-key={formatChord(paneKey().rollbar)} data-tip-sub={`#${rollbarLinks().map((l) => l.identifier).join(', #')}`} aria-label="Rollbar" onClick={(e) => onSwitch('rollbar', e)}>◍</button>
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
        <button type="button" class="pane-switch-btn" classList={{ active: showsPane('changes') }} data-tip="Changes" data-tip-key={formatChord(paneKey().changes)} data-tip-sub="Uncommitted working tree · ⌘-click to open beside" aria-label="Changes" onClick={(e) => onSwitch('changes', e)}>⎇</button>
        <button type="button" class="pane-switch-btn" classList={{ active: showsPane('notes') }} data-tip="Notes" data-tip-key={formatChord(paneKey().notes)} data-tip-sub="Workspace scratchpad · ⌘-click to open beside" aria-label="Notes" onClick={(e) => onSwitch('notes', e)}>✐</button>
        <button type="button" class="pane-switch-btn" classList={{ active: showsPane('context') }} data-tip="Context" data-tip-key={formatChord(paneKey().context)} data-tip-sub="What an assembled send includes · ⌘-click to open beside" aria-label="Context" onClick={(e) => onSwitch('context', e)}>⊞</button>
        <button type="button" class="pane-switch-btn" classList={{ active: showsPane('preview') }} data-tip="Browser preview" data-tip-key={formatChord(paneKey().preview)} data-tip-sub="Live preview of the app · ⌘-click to open beside" aria-label="Browser preview" onClick={(e) => onSwitch('preview', e)}>◍</button>
        <button type="button" class="pane-switch-btn" classList={{ active: showsPane('editor') }} data-tip="Editor" data-tip-key={formatChord(paneKey().editor)} data-tip-sub="In-app code editor · ⌘-click to open beside" aria-label="Editor" onClick={(e) => onSwitch('editor', e)}>✎</button>
        <button type="button" class="pane-switch-btn" classList={{ active: agentsOpen() }} data-tip="Agents" data-tip-key={formatChord(paneKey().agents)} data-tip-sub="Roster · launcher · feed" aria-label="Agents" onClick={() => setAgentsOpen(!agentsOpen())}>⠿</button>
        <button type="button" class="pane-switch-btn" classList={{ active: props.terminalOpen }} data-tip="Terminal" data-tip-key={formatChord(paneKey().terminal)} data-tip-sub="Shell in the worktree" aria-label="Terminal" onClick={props.onToggleTerminal}>{'>_'}</button>
        <button type="button" class="pane-switch-btn pane-switch-close" data-tip="Close task" aria-label="Close task" onClick={openClose}>✕</button>
      </nav>

      <Show when={agentsOpen()}>
        <AgentsPanel task={props.task} onClose={() => setAgentsOpen(false)} />
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
                <Show when={needsDiscardAck()}>
                  <label class="close-check action-error">
                    <input type="checkbox" checked={discardAck()} onChange={(e) => setDiscardAck(e.currentTarget.checked)} />
                    <span>⚠ Discard {dirtyCount()} uncommitted change{dirtyCount() === 1 ? '' : 's'} — this can't be undone</span>
                  </label>
                </Show>
              </Show>
              <Show when={closeErr()}><div class="action-error" style={{ 'white-space': 'pre-wrap' }}>{closeErr()}</div></Show>
              <div class="close-actions">
                <button type="button" class="overlay-btn" onClick={() => setCloseOpen(false)}>Cancel</button>
                <Show when={teardownFailed()}>
                  <button type="button" class="overlay-btn close-confirm" disabled={closeBlocked()} onClick={() => void confirmClose(true)}>Close anyway (skip teardown)</button>
                </Show>
                <button type="button" class="overlay-btn close-confirm" disabled={closeBlocked()} onClick={() => void confirmClose()}>Close task</button>
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
