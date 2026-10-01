/** @jsxImportSource @acorn/tui/jsx */
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js'
import type { Task } from '@acorn/client-core/infra/queries.ts'
import { clientEvents, consumeTerminalFocusIntent } from '@acorn/client-core/host/registries/commands'
import { setTerminalOpen } from '@acorn/client-core/features/tasks/tasks.ts'
import { returnToManagedMode } from '@acorn/plugin-agents/contract/handoffClient.ts'
import {
  activeTerminal, refreshSessions, rememberActiveTerminal, sessionNode, sessions, terminalApi,
} from '@acorn/plugin-terminal/contract/hostClient.ts'
import type { TerminalProfile, TerminalSession } from '@acorn/plugin-terminal/contract/wire.ts'
import { activeNodeId } from '@acorn/client-core/infra/node/activeNode.ts'
import { createArmedConfirm } from '@acorn/client-core/kit/lib/confirm'
import { attachPty } from '../kit/pty'
import { Rectangle } from '../kit/pixels'
import { Line } from '../kit/cells'
import { Alert, Row, Rows } from '../kit/showing'
import type { Renderable } from '../tree/compat'
import { pushScope } from '../keys/regions'
import { trapKeys } from '../keys/trap'
import { sessionPty } from './sessionPty'

type Action = { key: string; label: string; disabled?: boolean }

/** Raw sessions belong to Terminal on the Node; this is only the cell host's presentation. */
export function Sessions(props: { task: Task; onClose: () => void }) {
  const api = terminalApi()
  const [profiles, setProfiles] = createSignal<TerminalProfile[]>([])
  const [activeId, setActiveId] = createSignal<string | null>(null)
  const [focusTarget, setFocusTarget] = createSignal<string | null>(null)
  const [choosingProfile, setChoosingProfile] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const endConfirm = createArmedConfirm()
  const taskId = () => props.task.id
  const visible = createMemo(() => sessionNode() === (activeNodeId() ?? '')
    ? sessions().filter((session) => session.taskId === taskId())
    : [])
  const active = createMemo(() => visible().find((session) => session.id === activeId()) ?? null)

  const select = (id: string, clearRequest = true): void => {
    if (!visible().some((session) => session.id === id)) return
    setActiveId(id)
    if (clearRequest) setFocusTarget(null)
    endConfirm.disarm()
    rememberActiveTerminal(taskId(), id)
  }

  createEffect(() => {
    const rows = visible()
    const requested = focusTarget()
    if (requested && rows.some((session) => session.id === requested)) {
      select(requested)
      return
    }
    if (rows.some((session) => session.id === activeId())) return
    const remembered = activeTerminal(taskId())
    const next = (remembered ? rows.find((session) => session.id === remembered) : undefined)
      ?? rows.reduce<TerminalSession | undefined>((latest, session) =>
        !latest || session.createdAt > latest.createdAt ? session : latest, undefined)
    if (next) select(next.id, !requested)
  })

  onMount(() => {
    let live = true
    void api.profiles().then((rows) => { if (live) setProfiles(rows) }, (cause: unknown) => {
      if (live) setError(message(cause, 'Unable to load terminal profiles.'))
    })
    void refreshSessions().catch((cause: unknown) => {
      if (live) setError(message(cause, 'Unable to load terminal sessions.'))
    })
    const focused = (sessionId: string): void => {
      setFocusTarget(sessionId)
      select(sessionId)
      setChoosingProfile(false)
    }
    const off = clientEvents.on('presentation:terminal-focus', ({ taskId: target, sessionId }) => {
      if (target === taskId()) focused(sessionId)
    })
    const pending = consumeTerminalFocusIntent(taskId())
    if (pending) focused(pending)
    onCleanup(() => { live = false; off() })
  })

  const run = async (work: () => Promise<void>): Promise<void> => {
    if (busy()) return
    setBusy(true)
    setError('')
    try { await work() }
    catch (cause) { setError(message(cause, 'Terminal operation failed.')) }
    finally { setBusy(false) }
  }

  const launch = (profile: TerminalProfile): void => {
    if (!profile.available) return
    void run(async () => {
      const created = await api.create({ taskId: taskId(), profileId: profile.id, title: profile.label })
      await refreshSessions()
      select(created.id)
      setChoosingProfile(false)
    })
  }

  const close = (): void => {
    setTerminalOpen(taskId(), false)
    props.onClose()
  }
  // The rectangle's higher priority intercept keeps Escape while entered. A profile picker is one
  // level below the session list, so its Escape goes back there before a later Escape closes.
  trapKeys(() => { if (choosingProfile()) setChoosingProfile(false); else close() })

  const actions = createMemo<Action[]>(() => {
    const session = active()
    return [
      { key: 'new', label: 'New session' },
      ...(session?.status === 'running' ? [
        { key: 'interrupt', label: 'Interrupt (Ctrl+C)' },
        { key: 'end', label: endConfirm.armed() === 'end'
          ? 'End session — press Enter again to confirm'
          : 'End session' },
      ] : []),
      ...(session?.agentSessionId ? [{
        key: 'managed',
        label: session.status === 'running'
          ? 'Return to managed mode (end this terminal first)'
          : 'Return to managed mode',
        disabled: session.status === 'running',
      }] : []),
      { key: 'close', label: 'Close view (sessions keep running)' },
    ]
  })

  const act = (key: string): void => {
    const session = active()
    if (key === 'new') { setChoosingProfile(true); return }
    if (key === 'close') { close(); return }
    if (!session || busy()) return
    if (key === 'interrupt' && session.status === 'running') {
      void run(async () => { if (!await api.interrupt(session.id)) throw new Error('The terminal could not be interrupted.') })
    } else if (key === 'end' && session.status === 'running') {
      if (!endConfirm.request('end')) return
      void run(async () => {
        if (!await api.kill(session.id)) throw new Error('The terminal could not be ended.')
        await refreshSessions()
      })
    } else if (key === 'managed' && session.agentSessionId && session.status === 'exited') {
      void run(async () => {
        await returnToManagedMode(session.agentSessionId!)
        await refreshSessions()
        close()
      })
    }
  }

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}
      ref={(element: Renderable) => onCleanup(pushScope(element))}>
      <Line role="strong" wrap>Terminal · {props.task.title}</Line>
      <Line role="muted" wrap>Tab to the PTY, Enter to type, Escape to leave; close keeps sessions running.</Line>
      <Show when={error()}>{(found) => <Alert>{found()}</Alert>}</Show>
      <Show when={busy()}><Line role="muted">Working…</Line></Show>
      <Show when={choosingProfile()} fallback={
        <>
          <Show when={visible().length} fallback={<Line role="muted">No sessions in this task. Choose New session.</Line>}>
            <box height={Math.min(4, visible().length)} flexShrink={0}>
              <Rows id={`terminal.sessions.${taskId()}`} ariaLabel="Terminal sessions" virtual
                items={visible().map((session) => ({ key: session.id, label: session.title, session }))}
                selected={activeId()} onSelect={select}>
                {(entry, item) => <Row item={item} selected={entry.key === activeId()}
                  meta={`${entry.session.status} · ${entry.session.backend}`}>
                  {entry.label}
                </Row>}
              </Rows>
            </box>
          </Show>
          <Rows id={`terminal.actions.${taskId()}`} ariaLabel="Terminal actions" items={actions()}
            onSelect={(key) => { if (key !== 'end') endConfirm.disarm() }} onActivate={act}>
            {(entry, item) => <Row item={item}>{entry.label}</Row>}
          </Rows>
          <Show when={active()?.id} keyed fallback={<box flexGrow={1} />}>
            {(sessionId) => (
              <box flexDirection="column" flexGrow={1} minHeight={0}>
                <Line role="strong" wrap>{active()?.title}</Line>
                <Rectangle kind="pty" label={active()?.title ?? 'Terminal'}
                  mount={(handle) => attachPty(handle,
                    sessionPty(api, sessionId, setError, () => { void refreshSessions().catch(() => {}) }))} />
              </box>
            )}
          </Show>
        </>
      }>
        <Line role="strong">Choose a session profile</Line>
        <Show when={!profiles().some((profile) => profile.available)}>
          <Line role="muted">No terminal profiles are available on this Node.</Line>
        </Show>
        <Rows id={`terminal.profiles.${taskId()}`} ariaLabel="Terminal profiles"
          items={profiles().map((profile) => ({ key: profile.id, label: profile.label, disabled: !profile.available, profile }))}
          onActivate={(id) => { const profile = profiles().find((row) => row.id === id); if (profile) launch(profile) }}>
          {(entry, item) => <Row item={item} meta={entry.profile.available
            ? entry.profile.tmuxMissing ? 'tmux unavailable; will not survive Node restart' : entry.profile.kind
            : 'not found on PATH'}>{entry.label}</Row>}
        </Rows>
        <Rows id={`terminal.profiles.back.${taskId()}`} items={[{ key: 'back', label: 'Back to sessions' }]}
          onActivate={() => setChoosingProfile(false)}>
          {(entry, item) => <Row item={item}>{entry.label}</Row>}
        </Rows>
      </Show>
    </box>
  )
}

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}
