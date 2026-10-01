import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Settings → Limits and cost's concurrency section saves each ceiling when its field is committed, on blur or Enter,
// which the browser reports as one `change` event. A number the route would refuse stays in the
// field with the reason beside it, and so does one the node failed to store.

const saveAgentConcurrency = vi.fn(async (limits: unknown) => limits)

vi.mock('./concurrencyClient', () => ({
  agentConcurrencyQueryKey: ['agents', 'concurrency'],
  agentConcurrencyOptions: () => ({}),
  saveAgentConcurrency: (limits: unknown) => saveAgentConcurrency(limits),
}))

vi.mock('@tanstack/solid-query', () => ({
  createQuery: () => ({ data: { provider: 2, workspace: 4 } }),
  useQueryClient: () => ({ setQueryData: () => {} }),
}))

const { default: AgentConcurrencySettings } = await import('./AgentConcurrencySettings')

const hosts: Array<() => void> = []

const draw = () => {
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(() => <AgentConcurrencySettings />, host)
  hosts.push(() => { dispose(); host.remove() })
  return host
}

// What the browser fires on blur, and on Enter, for a field whose text changed.
const commit = (input: HTMLInputElement, value: string) => {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

const settle = async () => {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve()
}

afterEach(() => {
  for (const teardown of hosts.splice(0).reverse()) teardown()
  saveAgentConcurrency.mockClear()
})

describe('the agent concurrency settings page', () => {
  it('saves a ceiling when its field is committed, with the other one as stored', async () => {
    const host = draw()
    const [provider] = host.querySelectorAll<HTMLInputElement>('input[type="number"]')
    commit(provider, '3')
    await settle()
    expect(saveAgentConcurrency).toHaveBeenCalledWith({ provider: 3, workspace: 4 })
    expect(host.textContent).toContain('Saved')
    expect([...host.querySelectorAll('button')].some((button) => button.textContent?.includes('Save'))).toBe(false)
  })

  it('refuses a bad number beside the field and keeps what was typed', async () => {
    const host = draw()
    const [provider] = host.querySelectorAll<HTMLInputElement>('input[type="number"]')
    commit(provider, '0')
    await settle()
    expect(saveAgentConcurrency).not.toHaveBeenCalled()
    expect(provider.value).toBe('0')
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/provider/i)
  })

  it('keeps the typed value when the node fails to store it', async () => {
    saveAgentConcurrency.mockRejectedValueOnce(new Error('agent concurrency 500'))
    const host = draw()
    const [, workspace] = host.querySelectorAll<HTMLInputElement>('input[type="number"]')
    commit(workspace, '6')
    await settle()
    expect(workspace.value).toBe('6')
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('agent concurrency 500')
  })
})
