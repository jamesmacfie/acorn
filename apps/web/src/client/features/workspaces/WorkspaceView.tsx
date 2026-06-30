import { createMemo, createResource, createSignal, onCleanup, onMount, Show } from 'solid-js'
import type { Workspace } from '../../queries'
import PullDetail from '../../PullDetail'
import DiffView from '../../DiffView'
import LinearIssuePanel from '../integrations/LinearIssuePanel'
import { refreshSessions, sessions } from '../terminal/sessions'
import { terminalApi } from '../terminal/terminalClient'
import { activePane, setActivePane } from './workspaces'
import { workspaceStatus } from './workspaceStatus'
import './workspace-view.css'

// The single-window Workspace view (docs/workspaces 02/P4/P5): one active pane plus a switcher of
// the panes that apply. PR review reuses PullDetail + DiffView (scoped to the workspace's PR via the
// URL the rail navigated to); Linear reuses LinearIssuePanel; the dev server runs as a terminal in
// the bottom drawer (▶, with a per-workspace PORT); the preview is a <webview> onto that port.
// ponytail: terminal + dev server stay drawer terminals rather than rebuilt inline panes.
export default function WorkspaceView(props: {
  workspace: Workspace
  terminalOpen: boolean
  onToggleTerminal: () => void
  onOpenTerminal: () => void
}) {
  const api = terminalApi()
  const hasPr = () => props.workspace.pullNumber != null
  // A workspace can link several Linear tickets (e.g. a PR that resolves multiple). The ◷ icon
  // shows only when there's at least one; the pane lets you switch between them.
  const linearLinks = createMemo(() => props.workspace.links.filter((l) => l.provider === 'linear'))
  const linearIds = () => linearLinks().map((l) => l.identifier)
  const [picked, setPicked] = createSignal<string | null>(null)
  const linearId = () => (picked() && linearIds().includes(picked()!) ? picked()! : linearIds()[0])
  const st = () => workspaceStatus(props.workspace.id)

  // Per-repo dev config (run command + base port). Re-loaded when the workspace's repo changes.
  const [repoCfg, { refetch }] = createResource(
    () => `${props.workspace.repoOwner}/${props.workspace.repoName}`,
    () => api?.repoPath.get(props.workspace.repoOwner, props.workspace.repoName) ?? null,
  )
  // Per-workspace port: base + the workspace's rail offset, so two workspaces don't fight over a port.
  const port = () => {
    const base = repoCfg()?.devPort
    return base != null ? base + props.workspace.sort : null
  }

  const [cfgOpen, setCfgOpen] = createSignal(false)
  const [cmd, setCmd] = createSignal('')
  const [portInput, setPortInput] = createSignal('')
  const [cfgErr, setCfgErr] = createSignal('')

  const devSession = () => sessions().find((s) => s.workspaceId === props.workspace.id && s.title.startsWith('▶ '))

  // Start (or focus) the dev server. Needs a mapped checkout + a configured run command + port.
  async function startDev() {
    if (!api) return
    const cfg = repoCfg()
    if (!cfg?.path) return window.alert('Open a shell terminal in this workspace first to map the repo checkout.')
    if (!cfg.runCommand || cfg.devPort == null) {
      setCmd(cfg.runCommand ?? 'pnpm dev')
      setPortInput(String(cfg.devPort ?? 3000))
      setCfgErr('')
      setCfgOpen(true)
      return
    }
    if (!devSession()) {
      await api.create({
        workspaceId: props.workspace.id,
        profileId: 'shell',
        cwd: cfg.path,
        command: cfg.runCommand,
        env: { PORT: String(cfg.devPort + props.workspace.sort) },
        title: `▶ ${cfg.runCommand}`,
      })
      await refreshSessions()
    }
    props.onOpenTerminal()
  }

  async function saveCfg(e: Event) {
    e.preventDefault()
    if (!api) return
    const res = await api.repoPath.runConfig(props.workspace.repoOwner, props.workspace.repoName, cmd().trim(), Number(portInput()))
    if (!res.ok) return setCfgErr(res.reason)
    setCfgOpen(false)
    await refetch()
    await startDev()
  }

  return (
    <div class="workspace-wrap">
    <main class="panes panes-workspace">
      <Show when={activePane() === 'preview'} fallback={
        <Show
          when={activePane() === 'pr' && hasPr()}
          fallback={
            <section class="pane pane-mid pane-empty workspace-empty">
              <div class="workspace-empty-inner">
                <Show when={!hasPr()} fallback={<p class="muted">Select a pane.</p>}>
                  <p class="muted">No PR linked yet.</p>
                  <p class="muted">Open a terminal to start working on <code>{props.workspace.branch}</code>; a PR is inherited automatically once you open one.</p>
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
        <PreviewPane url={port() != null ? `http://localhost:${port()}` : null} onConfigure={startDev} running={!!devSession()} />
      </Show>

      <nav class="pane-switcher">
        <Show when={hasPr()}>
          <button type="button" class="pane-switch-btn" classList={{ active: activePane() === 'pr' }} title="PR review" onClick={() => setActivePane('pr')}>⌥</button>
        </Show>
        <Show when={linearLinks().length}>
          <button type="button" class="pane-switch-btn" classList={{ active: activePane() === 'linear' }} title={`Linear (${linearIds().join(', ')})`} onClick={() => setActivePane('linear')}>◷</button>
        </Show>
        <button type="button" class="pane-switch-btn" classList={{ active: !!devSession() }} title="Run dev server" onClick={() => void startDev()}>▶</button>
        <button type="button" class="pane-switch-btn" classList={{ active: activePane() === 'preview' }} title="Browser preview" onClick={() => setActivePane('preview')}>◍</button>
        <button type="button" class="pane-switch-btn" classList={{ active: props.terminalOpen }} title="Terminal" onClick={props.onToggleTerminal}>{'>_'}</button>
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
            <div class="overlay-title">Dev server — {props.workspace.repoOwner}/{props.workspace.repoName}</div>
            <div class="overlay-body">
              <p class="muted">Run command (in the worktree) and base port. PORT becomes base + this workspace's offset.</p>
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
    </main>
    <footer class="workspace-footer">
      <Show when={props.workspace.worktreePath} fallback={<span class="muted">No worktree yet — created on first terminal.</span>}>
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

// The preview <webview> is created imperatively (it isn't a typed JSX element) and pinned to the
// localhost dev-server URL. The main process's will-attach-webview guard enforces localhost-only.
function PreviewPane(props: { url: string | null; running: boolean; onConfigure: () => void }) {
  let host!: HTMLDivElement
  onMount(() => {
    if (!props.url) return
    const wv = document.createElement('webview')
    wv.setAttribute('src', props.url)
    wv.style.width = '100%'
    wv.style.height = '100%'
    host.appendChild(wv)
    onCleanup(() => wv.remove())
  })
  return (
    <section class="pane workspace-preview" style={{ 'grid-column': '1 / 3' }}>
      <Show when={props.url} fallback={
        <div class="workspace-empty-inner">
          <p class="muted">No dev server port configured.</p>
          <button type="button" class="workspace-empty-term" onClick={props.onConfigure}>Configure & run</button>
        </div>
      }>
        <div class="workspace-preview-host" ref={host} />
      </Show>
    </section>
  )
}
