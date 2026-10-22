import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import {
  activeNodeId,
  queryOwner,
  clientEvents,
  consumeTerminalFocusIntent,
  formatChord,
  onClosePaneWithin,
  PrefKeys,
  prefsOptions,
  registerCommands,
  registerKeybindings,
  type Task,
  termFontSize,
} from '@acorn/plugin-api/client'
import { activeTerminal, addSession, refreshSessions, rememberActiveTerminal, sessions } from './sessionStore'
import { terminalApi } from './terminalClient'
import TerminalSurface from './TerminalSurface'
import type { TerminalProfile, TerminalSession } from '@acorn/plugin-terminal/contract/wire.ts'
import { Alert, Button, DocumentTabs, EmptyState, IconButton, Menu } from '@acorn/plugin-api/ui'
import { Slot } from '@acorn/plugin-api/ui/host'
import {
  interruptRefusal,
  TERMINAL_TOOLBAR_ACTIONS_POINT,
  type TerminalToolbarProps,
  type TerminalToolbarResult,
} from '../contract/toolbarActions'
import { resolveTerminalFontSize } from './preferences'

const PROFILES_STALE_MS = 5 * 60_000

// A task's terminal sessions: the tab strip and a surface per session, drawn by the desktop's drawer
// (./TerminalPanel.tsx) and the phone's pane (./TerminalPane.tsx). The "+" opens a profile menu; the
// node resolves the active project folder/worktree from the task id on a durable tmux backend.
// Sessions are scoped to the active task, not the URL; switching tasks swaps the visible terminals.
//
// `onClose` is the drawer's: given, the strip offers Hide and closing the last tab closes the drawer.
// `root` is the element the sessions draw in, for Cmd+W and for focusing a tab picked by number.
export default function TerminalSessions(props: {
  task: Task | null
  onClose?: () => void
  root?: () => HTMLElement | undefined
}) {
  const queryClient = useQueryClient()
  const owner = queryOwner(queryClient)
  const nodeId = owner === undefined ? activeNodeId() : owner
  const api = terminalApi(nodeId)
  let disposed = false
  onCleanup(() => {
    disposed = true
  })
  const ws = () => props.task
  const taskId = createMemo(() => ws()?.id)
  const view = createMemo(() => ({ taskId: taskId() }))
  const live = (captured = view()) => !disposed && activeNodeId() === nodeId && view() === captured
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

  createEffect(() => {
    view()
    setBusy(false)
    setLaunching(false)
    setPendingTitle(null)
    setError(null)
  })

  onMount(async () => {
    const captured = view()
    const def = prefs.data?.[PrefKeys.terminalRailDefault]
    const willAutoLaunch = !!def && def !== 'empty' && !!ws()
    if (willAutoLaunch) setLaunching(true)
    // Cached for a few minutes. The node answers by running `which` for tmux and every agent profile,
    // which blocks its loop, and the drawer or pane remounts on every return to a task that has it open. The
    // list changes when a harness lands on PATH, which nothing reports, so a short stale time is the
    // refresh.
    try {
      const loaded = await queryClient.fetchQuery({
        queryKey: ['terminal', 'profiles'],
        queryFn: () => api.profiles(),
        staleTime: PROFILES_STALE_MS,
      })
      if (!live(captured)) return
      setProfiles(loaded)
      // A failed roster is not fresh enough to decide whether to auto-launch another session.
      await refreshSessions()
      if (!live(captured)) return
      if (willAutoLaunch && visibleSessions().length === 0) await startProfile(def as string)
    } catch (failure) {
      if (live(captured)) setError(failure instanceof Error ? failure.message : 'Failed to load terminals.')
    } finally {
      if (live(captured)) setLaunching(false)
    }
  })

  // Cmd/Ctrl+W closes the active terminal tab when focus is inside `root`.
  onClosePaneWithin(
    () => props.root?.(),
    () => {
      const s = activeSession()
      if (s) void closeTab(s)
    },
  )

  const focusActiveSurface = () => {
    const captured = view()
    requestAnimationFrame(() => {
      if (live(captured)) props.root?.()?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.focus()
    })
  }

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
      {
        id: 'terminal.focus.previous',
        title: 'Focus previous terminal',
        category: 'terminal',
        run: () => stepTerminal(-1),
      },
      { id: 'terminal.focus.next', title: 'Focus next terminal', category: 'terminal', run: () => stepTerminal(1) },
    ])
    const bindings = registerKeybindings([
      ...numbered.map((command, index) => ({
        id: command.id,
        command: command.id,
        description: command.title,
        category: 'Terminal',
        defaultChord: `meta+shift+${index + 1}`,
        when: 'task' as const,
        active: () => visibleSessions().length > index,
      })),
      {
        id: 'terminal.focus.previous',
        command: 'terminal.focus.previous',
        description: 'Focus previous terminal',
        category: 'Terminal',
        defaultChord: 'meta+shift+[',
        when: 'task',
      },
      {
        id: 'terminal.focus.next',
        command: 'terminal.focus.next',
        description: 'Focus next terminal',
        category: 'Terminal',
        defaultChord: 'meta+shift+]',
        when: 'task',
      },
    ])
    onCleanup(() => {
      bindings.dispose()
      commands.dispose()
    })
  })

  const activeSession = createMemo(() => sessions().find((s) => s.id === activeId()) ?? null)
  const activeRunning = createMemo(() => activeSession()?.status === 'running')

  // Another plugin's Interrupt (docs/plugins/toolbar-actions.md). It names the session it drew beside,
  // and the drawer checks that session is still the selected, running one of the task and Node the
  // contributor was mounted for. Then it sends the same interrupt as the drawer's own Stop.
  const interruptFor =
    (mountedTaskId: string) =>
    async (payload: unknown, invocation: { byPerson: boolean }): Promise<TerminalToolbarResult> => {
      const session = activeSession()
      const refusal = interruptRefusal({
        byPerson: invocation.byPerson,
        payload,
        mountedTaskId,
        live: live() && taskId() === mountedTaskId,
        selected: session && { id: session.id, taskId: session.taskId, running: session.status === 'running' },
      })
      if (refusal) return refusal
      return (await api.interrupt(session!.id)) ? { ok: true } : { ok: false, reason: 'changed' }
    }

  const taskContext = (task?: Task | null): string =>
    task?.github
      ? `${task.github.owner}/${task.github.name}${task.pullNumber != null ? ` #${task.pullNumber}` : ''}`
      : (task?.title ?? '')

  // Shells are numbered, so two of them in one task can be told apart; the task goes in the tab's tip.
  // The title is stored on the node, so the number is picked here, at creation, and older sessions
  // keep the title they were given.
  function titleFor(profileId: string, task?: Task | null): string {
    if (profileId === 'shell') {
      const taken = visibleSessions()
        .map((s) => /^Shell(?: (\d+))?$/.exec(s.title))
        .filter((m) => m !== null)
        .map((m) => Number(m[1] ?? 1))
      return taken.length ? `Shell ${Math.max(...taken) + 1}` : 'Shell'
    }
    const ctx = taskContext(task)
    const label = profiles().find((p) => p.id === profileId)?.label ?? profileId
    return ctx ? `${label} · ${ctx}` : label
  }

  // Spawn into the active task. `checkout` is the base repo path; the node derives the
  // task's lazy worktree from it and cwds the session there (docs/workspaces-and-tasks.md).
  async function spawn(profileId: string) {
    const captured = view()
    const taskId = captured.taskId
    if (!taskId) return
    const title = titleFor(profileId, ws())
    setBusy(true)
    setPendingTitle(title)
    try {
      const createdNode = nodeId ?? ''
      const s = await api.create({ taskId, profileId, title })
      addSession(s, createdNode) // create returns the session — no list round trip before the tab renders
      if (live(captured)) setActiveId(s.id)
    } catch (e) {
      if (live(captured)) setError(e instanceof Error ? e.message : "Couldn't start the terminal.")
    } finally {
      if (live(captured)) {
        setPendingTitle(null)
        setBusy(false)
      }
    }
  }

  // Launch a profile; the node resolves project path/worktree from taskId
  // (docs/workspaces-and-tasks.md § Task). Context comes from the task, not the URL; the node creates
  // the worktree lazily.
  async function startProfile(profileId: string) {
    setError(null)
    const w = ws()
    if (!w) return
    await spawn(profileId)
  }

  // One click closes the tab: remove() kills a running session first, then drops it.
  // Closing the last tab closes the whole drawer, and leaves the pane empty.
  async function closeTab(s: TerminalSession) {
    const captured = view()
    try {
      await api.remove(s.id)
      if (!live(captured)) return
      await refreshSessions()
      if (live(captured) && visibleSessions().length === 0) props.onClose?.()
    } catch (failure) {
      if (live(captured)) setError(failure instanceof Error ? failure.message : 'Failed to close the terminal.')
    }
  }

  return (
    <>
      {/* DocumentTabs owns the tabs and the `actions` slot the +, ^C and ✕ ride in, so this drawer's
          header is the same element at the same height as the editor's file tab bar. */}
      <DocumentTabs
        level="pane"
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
            status:
              session.status === 'exited' ? ('muted' as const) : session.idle ? ('warn' as const) : ('ok' as const),
            title: session.idle
              ? 'Idle. It may be waiting for you.'
              : session.kind === 'shell' && taskContext(ws())
                ? `${session.title} · ${taskContext(ws())}`
                : session.title,
          })),
          // The launching session has no id yet, so it cannot be activated or closed. It is a
          // placeholder tab that the real session replaces.
          ...(pendingTitle() ? [{ id: 'pending', label: pendingTitle()!, pending: true }] : []),
        ]}
        actions={
          <>
            {/* Menu brings click-away, Escape, menu roles, and a portal so no overflow ancestor
                clips it. */}
            <Menu
              ariaLabel="New session"
              trigger={({ toggle, open }) => (
                <IconButton
                  icon="plus"
                  // A disabled button shows no tip, so the reason it is off is in its name.
                  label={ws() ? 'New terminal' : 'New terminal. Open a task first.'}
                  disabled={busy() || !ws()}
                  opens="menu"
                  expanded={open()}
                  onPress={toggle}
                />
              )}
            >
              {(menu) => (
                <For each={profiles()}>
                  {(p) => (
                    <Menu.Item
                      context={menu}
                      disabled={!p.available}
                      title={
                        !p.available
                          ? `acorn can't find ${p.label} on your PATH.`
                          : p.tmuxMissing
                            ? "tmux isn't installed, so this session ends when acorn quits."
                            : undefined
                      }
                      onSelect={() => void startProfile(p.id)}
                      trailing={
                        <>
                          <Show when={!p.available}>Not installed</Show>
                          {/* tmux degrade hint: the profile still
                              works, but the durable backend silently fell back to node-pty. */}
                          <Show when={p.available && p.tmuxMissing}>Closes when acorn quits</Show>
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
              <IconButton
                icon="square"
                label="Stop"
                tip="Stop the running command"
                tipKey={formatChord('ctrl+c')}
                onPress={() => void api.interrupt(activeId()!)}
              />
            </Show>
            {/* Other plugins' controls, between the drawer's own and Hide, which stays last. Keyed on
                the task, so a task switch remounts them and an action can't reach the next task's
                sessions. */}
            <Show when={taskId()} keyed>
              {(mountedTaskId) => (
                <Slot
                  point={TERMINAL_TOOLBAR_ACTIONS_POINT}
                  taskId={mountedTaskId}
                  projectId={ws()?.projectId ?? null}
                  props={(): TerminalToolbarProps => {
                    const session = activeSession()
                    return {
                      taskId: mountedTaskId,
                      ...(ws()?.projectId ? { projectId: ws()!.projectId } : {}),
                      ...(session?.taskId === mountedTaskId
                        ? { session: { id: session.id, title: session.title, running: session.status === 'running' } }
                        : {}),
                    }
                  }}
                  actions={{ interrupt: interruptFor(mountedTaskId) }}
                />
              )}
            </Show>
            <Show when={props.onClose}>
              {(hide) => <IconButton icon="x" onPress={hide()} label="Hide terminals" tipSub="They keep running." />}
            </Show>
          </>
        }
      />

      <Show when={error()}>{(msg) => <Alert variant="banner">{msg()}</Alert>}</Show>

      {/* The session draws its own `Rectangle kind="pty"` (./TerminalSurface.tsx): a terminal is the
          rectangle, and an empty drawer has no pixels for one to hold.

          Every open session gets a surface and all but one is hidden. A hidden xterm stays attached
          and stays current, so a switch is a repaint rather than a new xterm, a new WebGL context and
          a serialized framebuffer from the node. What it costs is one xterm per open tab, which is
          what a terminal application spends.

          `<For>` over the ids rather than over the sessions, and rather than `<Index>`. The sessions
          are replaced wholesale on every roster refresh, so `<For>` over them would rebuild every row
          and take the xterms with it; `<Index>` keys by position, so closing the first tab would hand
          the second session to the first tab's live xterm. An id is a string, which `<For>` compares by
          value, so a refresh that changes nothing keeps every element. */}
      <Show
        when={visibleIds().length > 0}
        fallback={
          <Show when={!launching() && !pendingTitle()} fallback={<EmptyState busy>Starting…</EmptyState>}>
            <EmptyState
              title="No terminals"
              action={
                <Button disabled={busy() || !ws()} onPress={() => void startProfile('shell')}>
                  New terminal
                </Button>
              }
            />
          </Show>
        }
      >
        <For each={visibleIds()}>
          {(id) => (
            <TerminalSurface
              sessionId={id}
              fontSize={surfaceFontSize()}
              hidden={id !== activeId()}
              onExit={() => {
                const captured = view()
                if (live(captured))
                  void refreshSessions().catch((failure) => {
                    if (live(captured))
                      setError(failure instanceof Error ? failure.message : 'Failed to refresh terminals.')
                  })
              }}
            />
          )}
        </For>
      </Show>
    </>
  )
}
