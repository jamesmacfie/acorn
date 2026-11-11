import { render } from 'solid-js/web'
import { expect, it, vi } from 'vitest'
import AgentErrorCard from './AgentErrorCard'

const events = vi.hoisted(() => ({ emit: vi.fn() }))
const terminal = vi.hoisted(() => ({ setTerminalOpen: vi.fn(), requestTerminalFocusIntent: vi.fn() }))
const openAccountTerminal = vi.hoisted(() => vi.fn(async () => ({ terminalSessionId: 'term-1' })))
const snapshotFor = vi.hoisted(() => vi.fn())
vi.mock('@acorn/plugin-api/client', () => ({ clientEvents: events, ...terminal }))
vi.mock('./managedClient', () => ({ managedAgentApi: { openAccountTerminal } }))
vi.mock('./managedStore', () => ({ managedAgentStore: { snapshotFor } }))

const EXPIRED =
  'Internal error: Failed to authenticate: this login reached its time limit and cannot be renewed. Run `claude auth login` to sign in again.'

function mount(sessionConfig: Record<string, unknown>) {
  snapshotFor.mockReturnValue({ session: { providerId: 'claude-code', config: sessionConfig } })
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(
    () => (
      <AgentErrorCard
        error={{ type: 'error', code: 'claude-code_turn_failed', message: EXPIRED, retryable: false }}
        taskId="task-1"
        sessionId="session-1"
      />
    ),
    host,
  )
  return { host, dispose: () => (dispose(), host.remove()) }
}

it("opens a sign-in terminal on the session's account when its login expired", async () => {
  const { host, dispose } = mount({ account: 'personal' })
  try {
    expect(host.textContent).toContain('Sign in to the personal account to continue')
    host.querySelector('button')!.click()
    await vi.waitFor(() => expect(terminal.requestTerminalFocusIntent).toHaveBeenCalledWith('task-1', 'term-1'))
    expect(openAccountTerminal).toHaveBeenCalledWith('task-1', 'claude-code', 'personal', true)
    expect(terminal.setTerminalOpen).toHaveBeenCalledWith('task-1', true)
  } finally {
    dispose()
  }
})

it("offers no sign-in button for the CLI's own login, which has no account folder", () => {
  const { host, dispose } = mount({})
  try {
    expect(host.textContent).toContain('Agent error')
    expect(host.querySelector('button')).toBeNull()
  } finally {
    dispose()
  }
})

it.each(['instruction_review_required', 'turn_dispatch_failed'])(
  'links %s instruction refusals, including saved legacy events, to their settings',
  (code) => {
    events.emit.mockClear()
    const host = document.createElement('div')
    document.body.append(host)
    const dispose = render(
      () => (
        <AgentErrorCard
          error={{
            type: 'error',
            code,
            message: 'Instruction review required: no approved baseline.',
            retryable: false,
          }}
        />
      ),
      host,
    )
    try {
      expect(host.textContent).toContain('Review instructions to continue')
      expect(host.textContent).toContain('send your message again')
      expect(host.textContent).not.toContain('no approved baseline')
      host.querySelector('button')!.click()
      expect(events.emit).toHaveBeenCalledWith('presentation:open-settings', { tab: 'security#agent-instructions' })
    } finally {
      dispose()
      host.remove()
    }
  },
)

it('does not suggest instruction approval for an unrelated driver failure', () => {
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(
    () => (
      <AgentErrorCard
        error={{ type: 'error', code: 'turn_dispatch_failed', message: 'Provider disconnected.', retryable: false }}
      />
    ),
    host,
  )
  try {
    expect(host.textContent).toContain('The agent could not start this turn')
    expect(host.textContent).toContain('Provider disconnected')
    expect(host.querySelector('button')).toBeNull()
  } finally {
    dispose()
    host.remove()
  }
})
