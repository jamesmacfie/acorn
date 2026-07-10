import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { prefsOptions, type Task } from '../../queries'
import { terminalApi } from './terminalClient'
import { onClosePaneWithin } from '../../lib/onClosePaneWithin'
import { isTerminalMax } from '../tasks/tasks'
import { activeTerminal, rememberActiveTerminal, refreshSessions, sessions } from './sessions'
import TerminalSurface from './TerminalSurface'
import type { TerminalProfile, TerminalSession } from '../../../shared/terminal'
import { registerCommands } from '../../registries/commands'
import { registerKeybindings } from '../../registries/keybindings'
import { clientEvents, consumeTerminalFocusIntent } from '../../registries/clientEvents'
import { savePref } from '../settings/savePref'
import { PrefKeys } from '../../persistence/prefKeys'
import './terminal.css'

// vNext Phase 2: a bottom drawer of persistent local sessions. The "+" opens a profile menu
// (Shell / Claude Code / Codex / Aider, disabled when not on PATH); agents start in the active
// task's mapped checkout (prompting for the path if unmapped — §9) on a durable tmux backend.
// docs/workspaces: sessions are scoped to the active task, not the URL — switching tasks swaps the
// visible terminals.
export default function TerminalPanel(props: { onClose: () => void; task: Task | null }) {
  const api = terminalApi()
  const queryClient = useQueryClient()
  const ws = () => props.task
  const prefs = createQuery(() => prefsOptions(true))

  const [profiles, setProfiles] = createSignal<TerminalProfile[]>([])
  const [activeId, setActiveId] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  // True while the rail-default profile is being auto-launched, so the body shows a loader instead
  // of the empty-state text during the spawn round-trip.
  const [launching, setLaunching] = createSignal(false)
  // Repo-path prompt: set when a launch needs a checkout we don't have mapped yet.
  const [prompt, setPrompt] = createSignal<{ owner: string; repo: string; number?: string } | null>(null)
  const [pendingProfile, setPendingProfile] = createSignal('shell')
  const [pathInput, setPathInput] = createSignal('')
  const [pathError, setPathError] = createSignal<string | null>(null)

  // Scope the strip to the active task (docs/workspaces). A session opened in task A
  // never shows under B, regardless of the URL.
  const visibleSessions = createMemo(() => {
    const id = ws()?.id
    return id ? sessions().filter((s) => s.taskId === id) : []
  })

  // Keep the active session in sync with what's visible (e.g. after switching tasks). On a fresh
  // mount (task/workspace switch back) prefer the tab we last viewed for this task, so you return to
  // the same terminal instead of the first one; fall back to the first visible session.
  createEffect(() => {
    const vis = visibleSessions()
    if (vis.some((s) => s.id === activeId())) return
    const remembered = activeTerminal(ws()?.id ?? '')
    setActiveId((remembered && vis.some((s) => s.id === remembered) ? remembered : vis[0]?.id) ?? null)
  })

  // Remember the viewed tab per task so the effect above can restore it after a remount.
  createEffect(() => {
    const id = ws()?.id
    const a = activeId()
    if (id && a) rememberActiveTerminal(id, a)
  })

  onMount(async () => {
    if (!api) return
    // Rail default (Settings → Terminal): auto-launch a profile when the drawer opens empty.
    // Set the loader flag up front so we never flash the "No sessions" empty state.
    // ponytail: relies on the prefs query being warm by now — App loads it at startup. If it isn't,
    // we just open empty, which is the safe fallback.
    const def = prefs.data?.[PrefKeys.terminalRailDefault]
    const willAutoLaunch = !!def && def !== 'empty' && !!ws()
    if (willAutoLaunch) setLaunching(true)
    setProfiles(await api.profiles())
    // The shared store (init'd in App) owns the onStatus subscription; just ensure we're populated.
    await refreshSessions()
    if (willAutoLaunch && visibleSessions().length === 0) {
      try {
        await startProfile(def as string)
      } finally {
        setLaunching(false)
      }
    } else {
      setLaunching(false)
    }
  })

  // Cmd/Ctrl+W closes the active terminal tab when focus is inside the drawer.
  let drawerRef: HTMLElement | undefined
  onClosePaneWithin(() => drawerRef, () => {
    const s = activeSession()
    if (s) void closeTab(s)
  })

  const focusActiveSurface = () =>
    requestAnimationFrame(() => drawerRef?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.focus())

  const applyTerminalFocus = (sessionId: string) => {
    if (!visibleSessions().some((session) => session.id === sessionId)) return
    setActiveId(sessionId)
    focusActiveSurface()
  }
  onMount(() => {
    const off = clientEvents.on('presentation:terminal-focus', ({ taskId, sessionId }) => {
      if (taskId === ws()?.id) applyTerminalFocus(sessionId)
    })
    onCleanup(off)
  })
  createEffect(() => {
    const taskId = ws()?.id
    if (!taskId) return
    const sessionId = consumeTerminalFocusIntent(taskId)
    if (sessionId) applyTerminalFocus(sessionId)
  })

  const focusTerminalAt = (index: number) => {
    const session = visibleSessions()[index]
    if (!session) return
    setActiveId(session.id)
    focusActiveSurface()
  }
  const stepTerminal = (step: -1 | 1) => {
    const visible = visibleSessions()
    if (!visible.length) return
    const current = visible.findIndex((session) => session.id === activeId())
    focusTerminalAt((Math.max(current, 0) + step + visible.length) % visible.length)
  }
  onMount(() => {
    const numbered = Array.from({ length: 9 }, (_, index) => ({
      id: `terminal.focus.${index + 1}`,
      title: `Focus terminal ${index + 1}`,
      category: 'terminal' as const,
      when: () => visibleSessions().length > index,
      run: () => focusTerminalAt(index),
    }))
    const commands = registerCommands([
      ...numbered,
      { id: 'terminal.focus.previous', title: 'Focus previous terminal', category: 'terminal', run: () => stepTerminal(-1) },
      { id: 'terminal.focus.next', title: 'Focus next terminal', category: 'terminal', run: () => stepTerminal(1) },
    ])
    const bindings = registerKeybindings([
      ...numbered.map((command, index) => ({
        id: command.id, command: command.id, description: command.title, category: 'Terminal',
        defaultChord: `meta+shift+${index + 1}`, when: 'task' as const,
        active: () => visibleSessions().length > index,
      })),
      { id: 'terminal.focus.previous', command: 'terminal.focus.previous', description: 'Focus previous terminal', category: 'Terminal', defaultChord: 'meta+shift+[', when: 'task' },
      { id: 'terminal.focus.next', command: 'terminal.focus.next', description: 'Focus next terminal', category: 'Terminal', defaultChord: 'meta+shift+]', when: 'task' },
    ])
    onCleanup(() => { bindings.dispose(); commands.dispose() })
  })

  const activeSession = createMemo(() => sessions().find((s) => s.id === activeId()) ?? null)
  const activeRunning = createMemo(() => activeSession()?.status === 'running')

  // Maximized (⌘⇧⏎) fills the pane region via CSS (top: --topbar-h); the partial drag-height is ignored.
  const maximized = () => isTerminalMax(ws()?.id)

  // Drawer height, seeded once from the `term_height` pref then dragged + persisted (§10).
  const [height, setHeight] = createSignal(360)
  let seeded = false
  createEffect(() => {
    const saved = Number(prefs.data?.[PrefKeys.terminalHeight])
    if (!seeded && Number.isFinite(saved) && saved > 0) {
      setHeight(saved)
      seeded = true
    }
  })
  // Publish the live drawer height so the task view (`.workspace-wrap`) can reserve that much space
  // at the bottom — the panes shrink to sit above the drawer (keeping their scrollbars) instead of
  // being covered by this fixed overlay. Cleared when the drawer unmounts (terminal closed).
  createEffect(() => document.documentElement.style.setProperty('--term-drawer-h', `${height()}px`))
  onCleanup(() => document.documentElement.style.removeProperty('--term-drawer-h'))

  const onHandleDown = (e: PointerEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = height()
    const onMove = (ev: PointerEvent) => setHeight(Math.min(Math.max(startH + (startY - ev.clientY), 160), window.innerHeight * 0.85))
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      void savePref(queryClient, PrefKeys.terminalHeight, String(Math.round(height())))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function titleFor(profileId: string, owner?: string, repo?: string, number?: string): string {
    const ctx = owner && repo ? `${owner}/${repo}${number ? ` #${number}` : ''}` : ''
    if (profileId === 'shell') return ctx || 'shell'
    const label = profiles().find((p) => p.id === profileId)?.label ?? profileId
    return ctx ? `${label} · ${ctx}` : label
  }

  // Spawn into the active task. `checkout` is the base repo path; the main process derives the
  // task's lazy worktree from it and cwds the session there (docs/workspaces Flow C).
  async function spawn(profileId: string, checkout: string | undefined, owner?: string, repo?: string, number?: string) {
    const taskId = ws()?.id
    if (!api || !taskId) return
    setBusy(true)
    try {
      const s = await api.create({
        taskId,
        profileId,
        cwd: checkout,
        title: titleFor(profileId, owner, repo, number),
      })
      await refreshSessions()
      setActiveId(s.id)
    } finally {
      setBusy(false)
    }
  }

  // Launch a profile in the active task's repo checkout, prompting for the local path the
  // first time we see this repo (validated in main before we spawn). docs/workspaces: context
  // comes from the task, not the URL; the worktree is created lazily in main (Flow C).
  async function startProfile(profileId: string) {
    setMenuOpen(false)
    setError(null)
    const w = ws()
    if (!api || !w) return
    const owner = w.repoOwner
    const repo = w.repoName
    const number = w.pullNumber != null ? String(w.pullNumber) : undefined
    const mapped = await api.repoPath.get(owner, repo)
    if (mapped) return spawn(profileId, mapped.path, owner, repo, number)
    setPendingProfile(profileId)
    setPathError(null)
    setPathInput('')
    setPrompt({ owner, repo, number })
  }

  // Native folder picker — same bridge the onboarding modal uses (api.repoPath.pick). Fills the
  // input so the user can eyeball it before hitting Open; submitPath still validates in main.
  async function pickPath() {
    if (!api) return
    const picked = await api.repoPath.pick()
    if (picked) setPathInput(picked)
  }

  async function submitPath(e: Event) {
    e.preventDefault()
    const ctx = prompt()
    if (!ctx || !api) return
    const res = await api.repoPath.set(ctx.owner, ctx.repo, pathInput().trim())
    if (!res.ok) {
      setPathError(res.reason)
      return
    }
    setPrompt(null)
    await spawn(pendingProfile(), res.repoPath.path, ctx.owner, ctx.repo, ctx.number)
  }

  // One click closes the tab: remove() kills a running session first, then drops it.
  // Closing the last tab closes the whole drawer.
  async function closeTab(s: TerminalSession) {
    if (!api) return
    await api.remove(s.id)
    await refreshSessions()
    if (visibleSessions().length === 0) props.onClose()
  }

  return (
    <Portal>
      <aside ref={drawerRef} class="terminal-drawer" classList={{ maximized: maximized() }} style={{ height: maximized() ? undefined : `${height()}px` }}>
        <Show when={!maximized()}>
          <div class="terminal-resize" onPointerDown={onHandleDown} title="Drag to resize" />
        </Show>
        <header class="terminal-tabs">
          <Show when={api} fallback={<span class="terminal-unavailable">Terminal service unavailable</span>}>
            <div class="terminal-tabstrip">
              <For each={visibleSessions()}>
                {(s) => (
                  <div class="terminal-tab" classList={{ active: s.id === activeId() }} onClick={() => setActiveId(s.id)}>
                    <span class="terminal-tab-dot" classList={{ exited: s.status === 'exited', idle: s.idle }} />
                    <span class="terminal-tab-title">{s.title}</span>
                    <Show when={s.idle}>
                      <span class="terminal-tab-idle" title="Agent idle — may be waiting for input">
                        idle
                      </span>
                    </Show>
                    <button
                      type="button"
                      class="terminal-tab-x"
                      title={s.status === 'running' ? 'Kill session' : 'Dismiss'}
                      onClick={(e) => {
                        e.stopPropagation()
                        void closeTab(s)
                      }}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </For>
            </div>
            <div class="terminal-actions">
              <div class="terminal-new-wrap">
                <button type="button" class="terminal-new" disabled={busy() || !ws()} title={ws() ? 'New session' : 'Select a task first'} onClick={() => setMenuOpen((v) => !v)}>
                  +
                </button>
                <Show when={menuOpen()}>
                  {/* Click-away: a full-screen transparent layer behind the menu closes it. */}
                  <div class="terminal-menu-backdrop" onClick={() => setMenuOpen(false)} />
                  <div class="terminal-menu">
                    <For each={profiles()}>
                      {(p) => (
                        <button
                          type="button"
                          class="terminal-menu-item"
                          disabled={!p.available}
                          title={!p.available ? `${p.label} not found on PATH` : p.tmuxMissing ? 'tmux not found on PATH — this session will not survive an app restart' : undefined}
                          onClick={() => void startProfile(p.id)}
                        >
                          {p.label}
                          <Show when={!p.available}>
                            <span class="terminal-menu-missing">not found</span>
                          </Show>
                          {/* tmux degrade hint (docs/terminal-and-agents.md): the profile still works,
                              but the durable backend silently fell back to node-pty. */}
                          <Show when={p.available && p.tmuxMissing}>
                            <span class="terminal-menu-missing">tmux missing — won't survive restart</span>
                          </Show>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
              <Show when={activeRunning()}>
                <button type="button" class="terminal-interrupt" title="Interrupt (Ctrl-C)" onClick={() => void api!.interrupt(activeId()!)}>
                  ^C
                </button>
              </Show>
            </div>
          </Show>
          <button type="button" class="terminal-close" onClick={props.onClose} title="Close drawer (sessions keep running)" aria-label="Close">
            ✕
          </button>
        </header>

        <Show when={prompt()}>
          {(ctx) => (
            <form class="terminal-prompt" onSubmit={submitPath}>
              <span class="terminal-prompt-label">
                Local checkout for {ctx().owner}/{ctx().repo}:
              </span>
              <input
                class="terminal-prompt-input"
                type="text"
                autofocus
                placeholder="/Users/you/Source/repo"
                value={pathInput()}
                onInput={(e) => setPathInput(e.currentTarget.value)}
              />
              <button type="button" class="terminal-drawer-btn" title="Choose folder…" aria-label="Choose folder" onClick={() => void pickPath()}>
                📁
              </button>
              <button type="submit" class="terminal-drawer-btn">
                Open
              </button>
              <button type="button" class="terminal-drawer-btn" onClick={() => setPrompt(null)}>
                Cancel
              </button>
              <Show when={pathError()}>{(msg) => <span class="terminal-prompt-error">{msg()}</span>}</Show>
            </form>
          )}
        </Show>

        <Show when={error()}>{(msg) => <div class="terminal-prompt-error terminal-error-banner">{msg()}</div>}</Show>

        <div class="terminal-body">
          <Show
            when={activeId()}
            fallback={
              <div class="terminal-empty">
                {launching() ? <span class="terminal-launching">Launching…</span> : 'No sessions. Press + to open one.'}
              </div>
            }
            keyed
          >
            {(id) => <TerminalSurface sessionId={id} onExit={() => void refreshSessions()} />}
          </Show>
        </div>
      </aside>
    </Portal>
  )
}
