import { createEffect, createMemo, createSignal, For, onMount, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import { createQuery } from '@tanstack/solid-query'
import { prefsOptions, type Task } from '../../queries'
import { setPref } from '../../mutations'
import { terminalApi } from './terminalClient'
import { refreshSessions, sessions } from './sessions'
import TerminalSurface from './TerminalSurface'
import type { TerminalProfile, TerminalSession } from '../../../shared/terminal'
import './terminal.css'

// vNext Phase 2: a bottom drawer of persistent local sessions. The "+" opens a profile menu
// (Shell / Claude Code / Codex / Aider, disabled when not on PATH); agents start in the active
// task's mapped checkout (prompting for the path if unmapped — §9) on a durable tmux backend.
// docs/workspaces: sessions are scoped to the active task, not the URL — switching tasks swaps the
// visible terminals.
export default function TerminalPanel(props: { onClose: () => void; task: Task | null }) {
  const api = terminalApi()
  const ws = () => props.task
  const prefs = createQuery(() => prefsOptions(true))

  const [profiles, setProfiles] = createSignal<TerminalProfile[]>([])
  const [activeId, setActiveId] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
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

  // Keep the active session in sync with what's visible (e.g. after switching tasks).
  createEffect(() => {
    const vis = visibleSessions()
    if (!vis.some((s) => s.id === activeId())) setActiveId(vis[0]?.id ?? null)
  })

  onMount(async () => {
    if (!api) return
    setProfiles(await api.profiles())
    // The shared store (init'd in App) owns the onStatus subscription; just ensure we're populated.
    await refreshSessions()
  })

  const activeSession = createMemo(() => sessions().find((s) => s.id === activeId()) ?? null)
  const activeRunning = createMemo(() => activeSession()?.status === 'running')

  // Drawer height, seeded once from the `term_height` pref then dragged + persisted (§10).
  const [height, setHeight] = createSignal(360)
  let seeded = false
  createEffect(() => {
    const saved = Number(prefs.data?.term_height)
    if (!seeded && Number.isFinite(saved) && saved > 0) {
      setHeight(saved)
      seeded = true
    }
  })
  const onHandleDown = (e: PointerEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = height()
    const onMove = (ev: PointerEvent) => setHeight(Math.min(Math.max(startH + (startY - ev.clientY), 160), window.innerHeight * 0.85))
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      void setPref('term_height', String(Math.round(height())))
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

  // Single contextual control: kill a running session (it stays as an exited tab), dismiss an
  // exited one (drops it) — vNext §12 "stay visible until dismissed".
  async function closeTab(s: TerminalSession) {
    if (!api) return
    if (s.status === 'running') await api.kill(s.id)
    else await api.remove(s.id)
    await refreshSessions()
  }

  return (
    <Portal>
      <aside class="terminal-drawer" style={{ height: `${height()}px` }}>
        <div class="terminal-resize" onPointerDown={onHandleDown} title="Drag to resize" />
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
                          title={p.available ? undefined : `${p.label} not found on PATH`}
                          onClick={() => void startProfile(p.id)}
                        >
                          {p.label}
                          <Show when={!p.available}>
                            <span class="terminal-menu-missing">not found</span>
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
          <Show when={activeId()} fallback={<div class="terminal-empty">No sessions. Press + to open one.</div>} keyed>
            {(id) => <TerminalSurface sessionId={id} onExit={() => void refreshSessions()} />}
          </Show>
        </div>
      </aside>
    </Portal>
  )
}
