/** @jsxImportSource @acorn/tui/jsx */
import { describe, expect, it, vi } from 'vitest'
import { TASK } from '../fixture'
import { renderCells } from '../kit/render'
import { focusedRenderable } from '../keys/regions'
import { Button } from '../kit/asking/buttons'
import {
  extensionPointRegistry, extensionRegistry, type ExtensionContribution,
} from '@acorn/client-core/host/registries/extensionPoints/extensionPoints.ts'
import { TERMINAL_TOOLBAR_ACTIONS_POINT, type TerminalToolbarProps } from '@acorn/plugin-terminal/contract/toolbarActions.ts'

const mock = vi.hoisted(() => {
  const write = vi.fn()
  const resize = vi.fn(async () => true)
  const detach = vi.fn()
  const attach = vi.fn(() => detach)
  const setOpen = vi.fn()
  const resume = vi.fn(async () => {})
  const interrupt = vi.fn(async () => true)
  const state: { status: 'running' | 'exited'; agentSessionId?: string } = { status: 'running' }
  const rows: { current: null | Array<{
    id: string; taskId: string; title: string; kind: 'shell'; profileId: string
    backend: 'node-pty'; createdAt: number; status: 'running'
  }> } = { current: null }
  return { write, resize, attach, detach, setOpen, resume, interrupt, state, rows }
})

vi.mock('@acorn/client-core/infra/node/activeNode.ts', () => ({ activeNodeId: () => 'node-1' }))
vi.mock('@acorn/client-core/features/tasks/tasks.ts', () => ({ setTerminalOpen: mock.setOpen }))
vi.mock('@acorn/plugin-agents/contract/handoffClient.ts', () => ({ returnToManagedMode: mock.resume }))
vi.mock('@acorn/plugin-terminal/contract/hostClient.ts', () => ({
  activeTerminal: () => undefined,
  refreshSessions: vi.fn(async () => {}),
  rememberActiveTerminal: vi.fn(),
  sessionNode: () => 'node-1',
  sessions: () => mock.rows.current ?? [{
    id: 'terminal-1', taskId: TASK.id, title: 'Shell for task', kind: 'shell', profileId: 'shell',
    backend: 'node-pty', createdAt: 1, ...mock.state,
  }],
  terminalApi: () => ({
    profiles: async () => [{ id: 'shell', label: 'Shell', kind: 'shell', available: true }],
    attach: mock.attach, write: mock.write, resize: mock.resize,
    create: vi.fn(), interrupt: mock.interrupt, kill: vi.fn(),
  }),
}))

describe('native terminal sessions', () => {
  it('reattaches the PTY when the selected session changes', async () => {
    mock.rows.current = [
      { id: 'terminal-1', taskId: TASK.id, title: 'First shell', kind: 'shell', profileId: 'shell', backend: 'node-pty', createdAt: 1, status: 'running' },
      { id: 'terminal-2', taskId: TASK.id, title: 'Second shell', kind: 'shell', profileId: 'shell', backend: 'node-pty', createdAt: 2, status: 'running' },
    ]
    mock.attach.mockClear()
    mock.detach.mockClear()
    const { Sessions } = await import('./Sessions')
    const screen = await renderCells(() => <Sessions task={TASK} onClose={() => {}} />, { width: 80, height: 24 })
    try {
      expect(screen.text).toContain('Second shell')
      expect(mock.attach).toHaveBeenCalledWith('terminal-2', expect.any(Function), expect.any(Object))
      const switched = await screen.press('ARROW_UP')
      expect(switched.text).toContain('First shell')
      expect(mock.detach).toHaveBeenCalled()
      expect(mock.attach).toHaveBeenCalledWith('terminal-1', expect.any(Function), expect.any(Object))
    } finally {
      screen.done()
      mock.rows.current = null
    }
  }, 30_000)

  it('returns from profile selection before closing the session view', async () => {
    mock.state.status = 'running'
    mock.state.agentSessionId = undefined
    const { Sessions } = await import('./Sessions')
    const closed = vi.fn()
    const screen = await renderCells(() => <Sessions task={TASK} onClose={closed} />, { width: 80, height: 24 })
    try {
      await screen.press('TAB')
      expect((await screen.press('RETURN')).text).toContain('Choose a session profile')
      expect((await screen.press('ESCAPE')).text).toContain('New session')
      expect(closed).not.toHaveBeenCalled()
    } finally {
      screen.done()
    }
  }, 30_000)

  it('renders a task session at 80 cells and returns the keys safely after entering the PTY', async () => {
    mock.state.status = 'running'
    mock.state.agentSessionId = undefined
    mock.write.mockClear()
    mock.resize.mockClear()
    const { Sessions } = await import('./Sessions')
    const closed = vi.fn()
    const screen = await renderCells(() => <Sessions task={TASK} onClose={closed} />, { width: 80, height: 24 })
    try {
      expect(screen.text).toContain('Terminal ·')
      expect(screen.text).toContain('Shell for task')
      await screen.resize(120, 40)
      expect(mock.resize).toHaveBeenCalledWith('terminal-1', 118, expect.any(Number))
      for (let step = 0; step < 8 && !String(focusedRenderable()?.props.title).includes('· enter'); step++) {
        await screen.press('TAB')
      }
      expect(String(focusedRenderable()?.props.title)).toContain('· enter')
      await screen.press('RETURN')
      await screen.press('x')
      expect(mock.write).toHaveBeenCalledWith('terminal-1', 'x')
      await screen.press('ESCAPE')
      expect(closed).not.toHaveBeenCalled()
      await screen.press('ESCAPE')
      expect(mock.write).toHaveBeenCalledWith('terminal-1', '\x1b')
      expect(closed).not.toHaveBeenCalled()
      await screen.press('ESCAPE')
      await new Promise((resolve) => setTimeout(resolve, 450))
      await screen.press('ESCAPE')
      expect(closed).toHaveBeenCalledOnce()
      expect(mock.setOpen).toHaveBeenCalledWith(TASK.id, false)
    } finally {
      screen.done()
    }
  }, 30_000)

  it('returns managed control only after the linked terminal has exited', async () => {
    mock.state.status = 'exited'
    mock.state.agentSessionId = 'managed-1'
    mock.resume.mockClear()
    const { Sessions } = await import('./Sessions')
    const closed = vi.fn()
    const screen = await renderCells(() => <Sessions task={TASK} onClose={closed} />, { width: 80, height: 24 })
    try {
      expect(screen.text).toContain('Return to managed mode')
      await screen.press('TAB')
      await screen.press('ARROW_DOWN')
      await screen.press('RETURN')
      await vi.waitFor(() => expect(mock.resume).toHaveBeenCalledWith('managed-1'))
      expect(closed).toHaveBeenCalledOnce()
    } finally {
      screen.done()
    }
  }, 30_000)

  // A plugin's control beside the view's own actions (docs/plugins/toolbar-actions.md). A compiled
  // contributor, so no worker: its button asks through `host.invoke` exactly as a loaded tree's would.
  it('draws a contributor’s control and interrupts only on a press inside it', async () => {
    mock.state.status = 'running'
    mock.state.agentSessionId = undefined
    mock.interrupt.mockClear()
    type Props = TerminalToolbarProps & { host: { invoke(name: string, payload?: unknown): Promise<unknown> } }
    let drawn: Props | undefined
    const answers: unknown[] = []
    const registrations = [
      extensionPointRegistry.register({
        id: TERMINAL_TOOLBAR_ACTIONS_POINT, ownerId: 'terminal', label: 'Terminal toolbar', kind: 'remote', mode: 'stack', max: 4,
        actions: ['interrupt'],
      }),
      extensionRegistry.register({
        id: 'plugin:stopper:interrupt', pluginId: 'stopper', point: TERMINAL_TOOLBAR_ACTIONS_POINT, label: 'Stopper', order: 500,
        carrier: 'component',
        component: (props: Props) => {
          drawn = props
          return <Button onPress={() => { void props.host.invoke('interrupt', { expectedSessionId: props.session?.id }).then((answer) => answers.push(answer)) }}>Stop it</Button>
        },
      } as ExtensionContribution),
    ]
    const { Sessions } = await import('./Sessions')
    const screen = await renderCells(() => <Sessions task={TASK} onClose={() => {}} />, { width: 80, height: 24 })
    try {
      expect(screen.text).toContain('[Stop it]')
      expect(drawn).toMatchObject({ taskId: TASK.id, session: { id: 'terminal-1', title: 'Shell for task', running: true } })

      // A tree asking on its own, with nobody pressing anything, is refused.
      await expect(drawn!.host.invoke('interrupt', { expectedSessionId: 'terminal-1' })).resolves.toEqual({ ok: false, reason: 'needs_person' })
      expect(mock.interrupt).not.toHaveBeenCalled()

      const lines = screen.text.split('\n')
      const row = lines.findIndex((line) => line.includes('[Stop it]'))
      await screen.click(lines[row]!.indexOf('[Stop it]') + 2, row)
      await vi.waitFor(() => expect(answers).toEqual([{ ok: true }]))
      expect(mock.interrupt).toHaveBeenCalledWith('terminal-1')
    } finally {
      screen.done()
      for (const registration of registrations) registration.dispose()
    }
  }, 30_000)
})
