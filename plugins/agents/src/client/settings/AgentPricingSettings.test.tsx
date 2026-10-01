import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Settings → Limits and cost, its pricing sections. The tables are the reason the kit's row nodes take children rather than
// data: every price cell is an `Input` with a handler, and a row's Reset has to find its own row. Each
// price saves when its field is committed, and the stored record is a signal here so a save is seen by
// the page the way the query cache would show it.

const saveAgentPricing = vi.fn(async (preferences: unknown) => preferences)
const cache = vi.hoisted(() => ({ set: (_value: unknown) => {}, get: (): unknown => undefined }))

vi.mock('../pricingClient', () => ({
  agentPricingQueryKey: ['agents', 'pricing'],
  agentPricingOptions: () => ({}),
  saveAgentPricing: (preferences: unknown) => saveAgentPricing(preferences),
}))

vi.mock('@tanstack/solid-query', async () => {
  const { createSignal } = await import('solid-js')
  const blank = () => ({
    version: 1,
    claude: { overrides: [], customModels: [] },
    codex: { overrides: [], customModels: [] },
  })
  const [data, setData] = createSignal<unknown>(blank())
  cache.set = (value) => setData(() => value)
  cache.get = data
  return {
    createQuery: () => ({ get data() { return data() }, isPending: false }),
    useQueryClient: () => ({ setQueryData: (_key: unknown, value: unknown) => cache.set(value), getQueryData: () => cache.get() }),
    reset: () => setData(blank()),
  }
})

vi.mock('../usage/usageStore', () => ({
  agentUsageStore: { ensure: async () => {}, refresh: async () => {}, snapshot: () => null },
}))

const query = await import('@tanstack/solid-query') as unknown as { reset: () => void }
const { default: AgentPricingSettings } = await import('./AgentPricingSettings')

const hosts: Array<() => void> = []

const draw = () => {
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(() => <AgentPricingSettings />, host)
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
  for (let turn = 0; turn < 10; turn++) await Promise.resolve()
}

const buttonNamed = (scope: ParentNode, text: string) =>
  [...scope.querySelectorAll('button')].find((button) => button.textContent?.trim() === text)!

const bodyRows = (host: HTMLElement) => [...host.querySelectorAll('tr')].filter((row) => !row.closest('thead'))

type Sent = { claude: { overrides: Array<{ price: { input: number } }>; customModels: Array<{ model: string }> } }
const lastSent = () => saveAgentPricing.mock.calls.at(-1)![0] as Sent

afterEach(() => {
  for (const teardown of hosts.splice(0).reverse()) teardown()
  saveAgentPricing.mockClear()
  query.reset()
})

describe('the agent pricing settings page', () => {
  it('draws the built-in prices as kit rows, one head row per table', () => {
    const host = draw()
    const heads = host.querySelectorAll('thead th[scope="col"]')
    expect([...heads].map((head) => head.textContent))
      .toEqual([
        'Model', 'Input', 'Output', 'Cache write', 'Cache read', '',
        'Model', 'Input', 'Output', 'Cache write', 'Cache read', '',
      ])
    // Every model gets a row header and one number field per price.
    const rows = bodyRows(host)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].querySelectorAll('th[scope="row"]')).toHaveLength(1)
    expect(rows[0].querySelectorAll('td input[type="number"]')).toHaveLength(4)
    expect(buttonNamed(host, 'Save pricing')).toBeUndefined()
  })

  it('saves a price when its field is committed, and Reset on the changed row stores the built-in one again', async () => {
    const host = draw()
    const firstPrice = () => bodyRows(host)[0].querySelector<HTMLInputElement>('input[type="number"]')!
    const before = firstPrice().value
    // An untouched row offers no Reset.
    expect(buttonNamed(bodyRows(host)[0], 'Reset')).toBeUndefined()

    commit(firstPrice(), '99')
    await settle()
    expect(saveAgentPricing).toHaveBeenCalledTimes(1)
    expect(lastSent().claude.overrides[0].price.input).toBe(99)
    expect(firstPrice().value).toBe('99')
    expect(host.textContent).toContain('Saved')

    buttonNamed(bodyRows(host)[0], 'Reset').click()
    await settle()
    expect(saveAgentPricing).toHaveBeenCalledTimes(2)
    expect(lastSent().claude.overrides).toEqual([])
    expect(firstPrice().value).toBe(before)
  })

  it('keeps a refused price in the field with the reason beside the table', async () => {
    const host = draw()
    const firstPrice = bodyRows(host)[0].querySelector<HTMLInputElement>('input[type="number"]')!
    commit(firstPrice, '-1')
    await settle()
    expect(saveAgentPricing).not.toHaveBeenCalled()
    expect(firstPrice.value).toBe('-1')
    expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy()
  })

  it('stores an exact model only once its id and all four prices are filled in', async () => {
    const host = draw()
    buttonNamed(host, 'Add model').click()
    const row = bodyRows(host).find((candidate) => candidate.querySelector('input:not([type="number"])'))!
    commit(row.querySelector<HTMLInputElement>('input:not([type="number"])')!, 'claude-next')
    const prices = [...row.querySelectorAll<HTMLInputElement>('input[type="number"]')]
    for (const [index, price] of prices.entries()) {
      commit(price, '1')
      await settle()
      expect(saveAgentPricing).toHaveBeenCalledTimes(index === prices.length - 1 ? 1 : 0)
    }
    expect(lastSent().claude.customModels.map((entry) => entry.model)).toEqual(['claude-next'])
  })
})
