import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Settings → Agent concurrency saves from its button and from nothing else. The page dropped its
// `<form>` wrapper when the plugin's client half went kit-only, which took Enter-to-submit with
// it. That is a deliberate behaviour change, so it is recorded here rather than left to be
// rediscovered as a bug.

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

const type = (input: HTMLInputElement, value: string) => {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const saveButton = (host: HTMLElement) =>
  [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Save'))!

afterEach(() => {
  for (const teardown of hosts.splice(0).reverse()) teardown()
  saveAgentConcurrency.mockClear()
})

describe('the agent concurrency settings page', () => {
  it('saves when the button is pressed', async () => {
    const host = draw()
    const [provider] = host.querySelectorAll<HTMLInputElement>('input[type="number"]')
    type(provider, '3')
    saveButton(host).click()
    await Promise.resolve()
    expect(saveAgentConcurrency).toHaveBeenCalledWith({ provider: 3, workspace: 4 })
  })

  it('does not save on Enter in a field, because the page has no form', () => {
    const host = draw()
    const [provider] = host.querySelectorAll<HTMLInputElement>('input[type="number"]')
    type(provider, '3')
    expect(host.querySelector('form')).toBeNull()
    provider.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(saveAgentConcurrency).not.toHaveBeenCalled()
  })

  it('refuses a bad number in the field rather than sending it', () => {
    const host = draw()
    const [provider] = host.querySelectorAll<HTMLInputElement>('input[type="number"]')
    type(provider, '0')
    saveButton(host).click()
    expect(saveAgentConcurrency).not.toHaveBeenCalled()
    expect(host.textContent).toMatch(/provider/i)
  })
})
