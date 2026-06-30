import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import { useParams } from '@solidjs/router'
import { createQuery } from '@tanstack/solid-query'
import { prefsOptions } from '../../queries'
import { setPref } from '../../mutations'
import { terminalApi } from './terminalClient'
import TerminalSurface from './TerminalSurface'
import type { TerminalProfile, TerminalSession } from '../../../shared/terminal'
import './terminal.css'

// vNext Phase 2: a bottom drawer of persistent local sessions. The "+" opens a profile menu
// (Shell / Claude Code / Codex / Aider, disabled when not on PATH); agents start in the current
// PR's mapped checkout (prompting for the path if unmapped — §9) on a durable tmux backend. tmux
// sessions survive an app restart and are rediscovered by the main process.
export default function TerminalPanel(props: { onClose: () => void }) {
  const api = terminalApi()
  const params = useParams()
  const prefs = createQuery(() => prefsOptions(true))

  const [sessions, setSessions] = createSignal<TerminalSession[]>([])
  const [profiles, setProfiles] = createSignal<TerminalProfile[]>([])
  const [activeId, setActiveId] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [useWorktree, setUseWorktree] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  // Repo-path prompt: set when a launch needs a checkout we don't have mapped yet.
  const [prompt, setPrompt] = createSignal<{ owner: string; repo: string; number?: string } | null>(null)
  const [pendingProfile, setPendingProfile] = createSignal('shell')
  const [pathInput, setPathInput] = createSignal('')
  const [pathError, setPathError] = createSignal<string | null>(null)

  const refresh = async () => {
    if (!api) return
    const list = await api.list()
    setSessions(list)
    if (!list.some((s) => s.id === activeId())) setActiveId(list[0]?.id ?? null)
  }

  onMount(async () => {
    if (!api) return
    setProfiles(await api.profiles())
    await refresh()
    // Background idle/exit changes for any session → re-pull the list to refresh tab state.
    const off = api.onStatus(() => void refresh())
    onCleanup(off)
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

  async function spawn(profileId: string, cwd: string | undefined, owner?: string, repo?: string, number?: string, isWorktree = false) {
    if (!api) return
    setBusy(true)
    try {
      const s = await api.create({
        profileId,
        cwd,
        isWorktree,
        title: titleFor(profileId, owner, repo, number),
        repo: owner && repo ? { owner, name: repo } : undefined,
        pull: number ? { number: Number(number) } : undefined,
      })
      await refresh()
      setActiveId(s.id)
    } finally {
      setBusy(false)
    }
  }

  // Given a resolved checkout, optionally create/reuse a PR worktree (§9) then spawn there.
  async function launch(profileId: string, checkout: string, owner: string, repo: string, number?: string) {
    if (useWorktree() && number) {
      const wt = await api!.worktree.ensure(owner, repo, Number(number))
      if (!wt.ok) return setError(wt.reason)
      return spawn(profileId, wt.path, owner, repo, number, true)
    }
    return spawn(profileId, checkout, owner, repo, number)
  }

  // Launch a profile: shell with no repo → $HOME; otherwise the current PR's checkout, prompting
  // for the local path the first time we see this repo (validated in main before we spawn).
  async function startProfile(profileId: string) {
    setMenuOpen(false)
    setError(null)
    if (!api) return
    const { owner, repo, number } = params
    if (!owner || !repo) return spawn(profileId, undefined)
    const mapped = await api.repoPath.get(owner, repo)
    if (mapped) return launch(profileId, mapped.path, owner, repo, number)
    setPendingProfile(profileId)
    setPathError(null)
    setPathInput('')
    setPrompt({ owner, repo, number })
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
    await launch(pendingProfile(), res.repoPath.path, ctx.owner, ctx.repo, ctx.number)
  }

  // Clean up the active session's PR worktree. Refuses a dirty tree unless the user confirms discard.
  async function removeActiveWorktree() {
    const s = activeSession()
    if (!s || !s.isWorktree || !s.repo) return
    let res = await api!.worktree.remove(s.repo.owner, s.repo.name, s.cwd, false)
    if (!res.ok && /uncommitted/i.test(res.reason)) {
      if (!window.confirm(`${res.reason}`)) return
      res = await api!.worktree.remove(s.repo.owner, s.repo.name, s.cwd, true)
    }
    if (!res.ok) setError(res.reason)
  }

  // Single contextual control: kill a running session (it stays as an exited tab), dismiss an
  // exited one (drops it) — vNext §12 "stay visible until dismissed".
  async function closeTab(s: TerminalSession) {
    if (!api) return
    if (s.status === 'running') await api.kill(s.id)
    else await api.remove(s.id)
    await refresh()
  }

  return (
    <Portal>
      <aside class="terminal-drawer" style={{ height: `${height()}px` }}>
        <div class="terminal-resize" onPointerDown={onHandleDown} title="Drag to resize" />
        <header class="terminal-tabs">
          <Show when={api} fallback={<span class="terminal-unavailable">Terminal service unavailable</span>}>
            <div class="terminal-tabstrip">
              <For each={sessions()}>
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
                <button type="button" class="terminal-new" disabled={busy()} title="New session" onClick={() => setMenuOpen((v) => !v)}>
                  +
                </button>
                <Show when={menuOpen()}>
                  <div class="terminal-menu">
                    <Show when={params.number}>
                      <label class="terminal-menu-wt">
                        <input type="checkbox" checked={useWorktree()} onChange={(e) => setUseWorktree(e.currentTarget.checked)} />
                        PR worktree (isolated)
                      </label>
                    </Show>
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
              <Show when={activeSession()?.isWorktree}>
                <button type="button" class="terminal-interrupt" title="Remove this PR worktree" onClick={() => void removeActiveWorktree()}>
                  rm wt
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
            {(id) => <TerminalSurface sessionId={id} onExit={() => void refresh()} />}
          </Show>
        </div>
      </aside>
    </Portal>
  )
}
