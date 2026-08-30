import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Settings → Agent pricing after its tables moved onto the kit's row nodes
// (docs/future/before-terminal-ui/phase-1-kit-table-rows.md). The page is the reason the nodes take
// children rather than data: every price cell is an `Input` with a handler, and a row's Reset button
// has to still find the row it belongs to.

const saveAgentPricing = vi.fn(async (preferences: unknown) => preferences)

vi.mock('./pricingClient', () => ({
  agentPricingQueryKey: ['agents', 'pricing'],
  agentPricingOptions: () => ({}),
  saveAgentPricing: (preferences: unknown) => saveAgentPricing(preferences),
}))

vi.mock('@tanstack/solid-query', () => ({
  createQuery: () => ({ data: { version: 1, claude: { overrides: [], customModels: [] } } }),
  useQueryClient: () => ({ setQueryData: () => {} }),
}))

vi.mock('../usage/usageStore', () => ({
  agentUsageStore: { ensure: async () => {}, snapshot: () => null },
}))

const { default: AgentPricingSettings } = await import('./AgentPricingSettings')

const hosts: Array<() => void> = []

const draw = () => {
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(() => <AgentPricingSettings />, host)
  hosts.push(() => { dispose(); host.remove() })
  return host
}

const type = (input: HTMLInputElement, value: string) => {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const buttonNamed = (scope: ParentNode, text: string) =>
  [...scope.querySelectorAll('button')].find((button) => button.textContent?.trim() === text)!

afterEach(() => {
  for (const teardown of hosts.splice(0).reverse()) teardown()
  saveAgentPricing.mockClear()
})

describe('the agent pricing settings page', () => {
  it('draws the built-in prices as kit rows, one head row per table', () => {
    const host = draw()
    const heads = host.querySelectorAll('thead th[scope="col"]')
    expect([...heads].map((head) => head.textContent))
      .toEqual(['Model', 'Input', 'Output', 'Cache write', 'Cache read', ''])
    // Every model gets a row header and one number field per price.
    const rows = [...host.querySelectorAll('tr')].filter((row) => !row.closest('thead'))
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].querySelectorAll('th[scope="row"]')).toHaveLength(1)
    expect(rows[0].querySelectorAll('td input[type="number"]')).toHaveLength(4)
  })

  it('edits a price and resets that row back to the built-in one', () => {
    const host = draw()
    // Re-read the row every time: an edit rebuilds the draft's array, so `<For>` remounts the rows
    // and a held reference goes stale. Pre-existing, and the reason `<Index>` exists.
    const firstRow = () => [...host.querySelectorAll('tr')].find((row) => !row.closest('thead'))!
    const firstPrice = () => firstRow().querySelector<HTMLInputElement>('input[type="number"]')!
    const before = firstPrice().value

    expect(buttonNamed(firstRow(), 'Reset').disabled).toBe(true)
    type(firstPrice(), '99')
    expect(buttonNamed(firstRow(), 'Reset').disabled).toBe(false)

    buttonNamed(firstRow(), 'Reset').click()
    expect(firstPrice().value).toBe(before)
  })

  it('saves the edited price from the page button', async () => {
    const host = draw()
    const row = [...host.querySelectorAll('tr')].find((candidate) => !candidate.closest('thead'))!
    type(row.querySelector<HTMLInputElement>('input[type="number"]')!, '99')
    buttonNamed(host, 'Save pricing').click()
    await Promise.resolve()
    expect(saveAgentPricing).toHaveBeenCalledTimes(1)
    const [sent] = saveAgentPricing.mock.calls[0] as [{ claude: { overrides: Array<{ price: { input: number } }> } }]
    expect(sent.claude.overrides[0].price.input).toBe(99)
  })
})
