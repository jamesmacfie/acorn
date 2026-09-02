import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { activeTerminal, addSession, clientEvents, consumeTerminalFocusIntent, isTerminalMax, onClosePaneWithin, PrefKeys, prefsOptions, refreshSessions, registerCommands, rememberActiveTerminal, savePref, sessions, type Task, termFontSize } from '@acorn/plugin-api/client'
import { terminalApi } from './terminalClient'
import TerminalSurface from './TerminalSurface'
import type { TerminalProfile, TerminalSession } from '@acorn/protocol/terminal.ts'
import { registerKeybindings } from '@acorn/plugin-api/ui/host'
import { Alert, Button, createSplitDrag, DocumentTabs, EmptyState, Icon, Menu, SplitHandle } from '@acorn/plugin-api/ui'
import { Drawer } from '@acorn/plugin-api/ui/host'
import { resolveTerminalFontSize } from './preferences'

// Bottom drawer of persistent local sessions. The "+" opens a profile menu; the node resolves the
// active project folder/worktree from the task id on a durable tmux backend. Sessions are scoped to
// the active task, not the URL; switching tasks swaps the visible terminals.
export default function TerminalPanel(props: { onClose: () => void; task: Task | null }) {
  const api = terminalApi()
  const queryClient = useQueryClient()
  const ws = () => props.task
  const prefs = createQuery(() => prefsOptions(true))

  const [profiles, setProfiles] = createSignal<TerminalProfile[]>([])
  const [activeId, setActiveId] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  // True while the rail-default profile is being auto-launched, so the body shows a loader instead
  // of the empty-state text during the spawn round-trip.
  const [launching, setLaunching] = createSignal(false)
  // Optimistic tab: the title of a session whose create() is still round-tripping (worktree +
  // spawn can take seconds), so the click gives instant feedback in the tab strip.
  const [pendingTitle, setPendingTitle] = createSignal<string | null>(null)
  const surfaceFontSize = () => resolveTerminalFontSize(prefs.data?.[PrefKeys.terminalFontSize], termFontSize())

  // Scope the strip to the active task (docs/workspaces-and-tasks.md). A session opened in task A
  // never shows under B, regardless of the URL.
  const visibleSessions = createMemo(() => {
    const id = ws()?.id
    return id ? sessions().filter((s) => s.taskId === id) : []
  })

  // The surfaces below are keyed on these, not on the session rows, so a roster refresh that changes
  // nothing does not rebuild an xterm. See the comment on the list itself.
  const visibleIds = createMemo(() => visibleSessions().map((session) => session.id))

  // Keep the active session in sync with what's visible (e.g. after switching tasks). On a fresh
  // mount (task/workspace switch back) prefer the tab we last viewed for this task, so you return to
  // the same terminal instead of the first one; fall back to the first visible session.
  createEffect(() => {
    const vis = visibleSessions()
    if (vis.some((s) => s.id === activeId())) return
    const remembered = activeTerminal(ws()?.id ?? '')
    setActiveId((remembered && vis.some((s) => s.id === remembered) ? remembered : vis[0]?.id) ?? null)
  })

  // Remember the viewed tab per task so the effect above can restore it after a remount. Only
  // remember a session that actually belongs to this task: on a task/workspace switch this effect
  // can fire with the new task id while activeId still holds the old task's tab (effect order vs
  // the restore effect above isn't guaranteed), which would clobber the remembered entry.
  createEffect(() => {
    const id = ws()?.id
    const a = activeId()
    if (id && a && visibleSessions().some((s) => s.id === a)) rememberActiveTerminal(id, a)
  })

  onMount(async () => {
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
  // Snapshotted at pointer-down. Null between drags, so a keyboard nudge measures from the current
  // height instead of the last drag's starting point.
  let dragStartHeight: number | null = null
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

  // Drawer height, seeded once from the `term_height` pref, then dragged and persisted.
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
  // at the bottom. The panes shrink to sit above the drawer (keeping their scrollbars) instead of
  // being covered by this fixed overlay. Cleared when the drawer unmounts (terminal closed).
  createEffect(() => document.documentElement.style.setProperty('--term-drawer-h', `${height()}px`))
  onCleanup(() => document.documentElement.style.removeProperty('--term-drawer-h'))

  // The drawer grows upward, so a downward drag shrinks it: hence the inverted delta and `invert`
  // for the keyboard. Height and its pref stay here; the hook owns the drag and the keys this
  // handle never had.
  const drawerDrag = createSplitDrag({
    axis: 'y',
    label: 'Resize terminal drawer',
    invert: true,
    onStart: () => { dragStartHeight = height() },
    onDelta: (deltaPx) => setHeight(Math.min(Math.max((dragStartHeight ?? height()) - deltaPx, 160), window.innerHeight * 0.85)),
    onCommit: () => {
      dragStartHeight = null
      void savePref(queryClient, PrefKeys.terminalHeight, String(Math.round(height())))
    },
  })

  function titleFor(profileId: string, task?: Task | null): string {
    const ctx = task?.github ? `${task.github.owner}/${task.github.name}${task.pullNumber != null ? ` #${task.pullNumber}` : ''}` : task?.title ?? ''
    if (profileId === 'shell') return ctx || 'shell'
    const label = profiles().find((p) => p.id === profileId)?.label ?? profileId
    return ctx ? `${label} · ${ctx}` : label
  }

  // Spawn into the active task. `checkout` is the base repo path; the node derives the
  // task's lazy worktree from it and cwds the session there (docs/workspaces-and-tasks.md).
  async function spawn(profileId: string) {
    const taskId = ws()?.id
    if (!taskId) return
    const title = titleFor(profileId, ws())
    setBusy(true)
    setPendingTitle(title)
    try {
      const s = await api.create({ taskId, profileId, title })
      addSession(s) // create returns the session — no list round trip before the tab renders
      setActiveId(s.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start the session.')
    } finally {
      setPendingTitle(null)
      setBusy(false)
    }
  }

  // Launch a profile; the node resolves project path/worktree from taskId
  // (docs/workspaces-and-tasks.md § Task). Context comes from the task, not the URL; the worktree is
  // created lazily in main.
  async function startProfile(profileId: string) {
    setError(null)
    const w = ws()
    if (!w) return
    await spawn(profileId)
  }

  // One click closes the tab: remove() kills a running session first, then drops it.
  // Closing the last tab closes the whole drawer.
  async function closeTab(s: TerminalSession) {
    await api.remove(s.id)
    await refreshSessions()
    if (visibleSessions().length === 0) props.onClose()
  }

  return (
    <Drawer ref={(element) => { drawerRef = element }} ariaLabel="Terminal" height={height()} maximized={maximized()}>
      <Show when={!maximized()}>
        <SplitHandle axis="y" drag={drawerDrag} />
      </Show>
      {/* Was a hand-rolled strip inside a hand-rolled header. DocumentTabs owns both halves now,
          the tabs and the `actions` slot the +, ^C and ✕ ride in, so this drawer's header is the
          same element at the same height as the editor's file tab bar. */}
      <DocumentTabs
        idPrefix="terminal"
        ariaLabel="Terminal sessions"
        active={activeId() ?? ''}
        onActivate={setActiveId}
        onClose={(id) => {
          const session = visibleSessions().find((candidate) => candidate.id === id)
          if (session) void closeTab(session)
        }}
        tabs={[
          ...visibleSessions().map((session) => ({
            id: session.id,
            label: session.title,
            status: session.status === 'exited' ? ('muted' as const) : session.idle ? ('warn' as const) : ('ok' as const),
            title: session.idle ? 'Agent idle — may be waiting for input' : session.title,
          })),
          // The launching session has no id yet, so it cannot be activated or closed. It is a
          // placeholder tab that the real session replaces.
          ...(pendingTitle() ? [{ id: 'pending', label: pendingTitle()!, pending: true }] : []),
        ]}
        actions={
          <>
            {/* Was an absolutely-positioned div with a full-viewport transparent backdrop for
                click-away, no Escape, no portal (so any overflow ancestor clipped it) and no menu
                roles. Menu brings all of it. */}
            <Menu
              ariaLabel="New session"
              trigger={({ toggle, open }) => (
                <Button
                  variant="bare"
                  size="sm"
                  iconOnly
                  disabled={busy() || !ws()}
                  title={ws() ? 'New session' : 'Select a task first'}
                  opens="menu"
                  expanded={open()}
                  onPress={toggle}
                >
                  <Icon name="plus" />
                </Button>
              )}
            >
              {(menu) => (
                <For each={profiles()}>
                  {(p) => (
                    <Menu.Item
                      context={menu}
                      disabled={!p.available}
                      title={!p.available ? `${p.label} not found on PATH` : p.tmuxMissing ? 'tmux not found on PATH — this session will not survive an app restart' : undefined}
                      onSelect={() => void startProfile(p.id)}
                      trailing={
                        <>
                          <Show when={!p.available}>not found</Show>
                          {/* tmux degrade hint (docs/terminal-and-agents.md): the profile still
                              works, but the durable backend silently fell back to node-pty. */}
                          <Show when={p.available && p.tmuxMissing}>tmux missing — won't survive restart</Show>
                        </>
                      }
                    >
                      {p.label}
                    </Menu.Item>
                  )}
                </For>
              )}
            </Menu>
            <Show when={activeRunning()}>
              <Button variant="bare" size="sm" title="Interrupt (Ctrl-C)" onPress={() => void api.interrupt(activeId()!)}>
                ^C
              </Button>
            </Show>
            <Button variant="bare" size="sm" iconOnly onPress={props.onClose} title="Close drawer (sessions keep running)" label="Close">
              <Icon name="x" />
            </Button>
          </>
        }
      />

      <Show when={error()}>{(msg) => <Alert>{msg()}</Alert>}</Show>

      {/* The session draws its own `Rectangle kind="pty"` (./TerminalSurface.tsx): a terminal is the
          rectangle, and an empty drawer has no pixels for one to hold.

          Every open session gets a surface and all but one is hidden. This used to mount the active
          tab alone, keyed on its id, so each switch threw away an xterm and its WebGL context, asked
          the node to serialize a thousand-line framebuffer, shipped it as one frame and parsed it into
          a fresh emulator — for the most common thing anyone does in this drawer
          (docs/future/performance/architecture.md § 3). A hidden xterm stays attached and stays
          current, so a switch is a repaint. What it costs is one xterm per open tab, which is what a
          terminal application spends.

          `<For>` over the ids rather than over the sessions, and rather than `<Index>`. The sessions
          are replaced wholesale on every roster refresh, so `<For>` over them would rebuild every row
          and take the xterms with it; `<Index>` keys by position, so closing the first tab would hand
          the second session to the first tab's live xterm. An id is a string, which `<For>` compares by
          value, so a refresh that changes nothing keeps every element. */}
      <Show
        when={visibleIds().length > 0}
        fallback={
          <EmptyState busy={launching() || !!pendingTitle()}>
            {launching() || pendingTitle() ? 'Launching…' : 'No sessions. Press + to open one.'}
          </EmptyState>
        }
      >
        <For each={visibleIds()}>
          {(id) => (
            <TerminalSurface
              sessionId={id}
              fontSize={surfaceFontSize()}
              hidden={id !== activeId()}
              onExit={() => void refreshSessions()}
            />
          )}
        </For>
      </Show>
    </Drawer>
  )
}
