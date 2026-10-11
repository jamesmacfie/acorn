import { render } from 'solid-js/web'
import { expect, it, vi } from 'vitest'
import AgentErrorCard from './AgentErrorCard'

const events = vi.hoisted(() => ({ emit: vi.fn() }))
vi.mock('@acorn/plugin-api/client', () => ({ clientEvents: events }))

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
