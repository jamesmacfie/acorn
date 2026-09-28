import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CustomAgent } from '../../shared/customAgents'

// Settings → Custom agents. What is pinned: a plugin's agent offers Duplicate and nothing that writes
// it, and the editor sends the record with the harness's own profile and the options a recent session
// advertised.

const saveCustomAgent = vi.fn(async (_client: unknown, _id: string | null, input: unknown) => input)
const agents: CustomAgent[] = [
  { id: 'a1', name: 'Bug reviewer', providerId: 'codex', profileId: 'codex', options: { reasoning: 'high' }, source: { kind: 'user' } },
  { id: 'lint:tidy', name: 'Tidy', providerId: 'codex', profileId: 'codex', options: {}, source: { kind: 'plugin', pluginId: 'lint' } },
]

vi.mock('./customAgentsClient', () => ({
  customAgentsOptions: () => ({}),
  saveCustomAgent: (client: unknown, id: string | null, input: unknown) => saveCustomAgent(client, id, input),
  deleteCustomAgent: vi.fn(),
}))
vi.mock('@tanstack/solid-query', () => ({
  createQuery: () => ({ data: agents }),
  useQueryClient: () => ({}),
}))
vi.mock('../sessions/managedClient', () => ({
  managedAgentApi: {
    providers: async () => [{ id: 'codex', profileId: 'codex', label: 'Codex', installed: true, diagnostics: [] }],
    sessions: async () => ({
      sessions: [{
        providerId: 'codex',
        config: { configOptions: [{ id: 'reasoning', label: 'Reasoning', category: 'reasoning', currentValue: 'medium', values: [{ value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }] }] },
      }],
    }),
  },
}))

const { default: CustomAgentsSettings } = await import('./CustomAgentsSettings')

const hosts: Array<() => void> = []
const draw = () => {
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(() => <CustomAgentsSettings />, host)
  hosts.push(() => { dispose(); host.remove() })
  return host
}
const buttons = (root: ParentNode, label: string) =>
  [...root.querySelectorAll('button')].filter((button) => button.textContent?.trim() === label)
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  for (const teardown of hosts.splice(0).reverse()) teardown()
  saveCustomAgent.mockClear()
})

describe('the custom agents settings page', () => {
  it('lets the owner edit their own agents and only duplicate a plugin’s', async () => {
    const host = draw()
    await settle()
    expect(host.textContent).toContain('From lint')
    // Two Duplicates, one per agent, but Edit and Delete only for the owner's.
    expect(buttons(host, 'Duplicate')).toHaveLength(2)
    expect(buttons(host, 'Edit')).toHaveLength(1)
    expect(buttons(host, 'Delete')).toHaveLength(1)
  })

  it('saves a duplicate as a new agent with the harness’s profile and its options', async () => {
    const host = draw()
    await settle()
    buttons(host, 'Duplicate')[0]!.click()
    await settle()
    expect(document.body.textContent).toContain('Reasoning')
    buttons(document.body, 'Save')[0]!.click()
    await settle()
    expect(saveCustomAgent).toHaveBeenCalledWith(expect.anything(), null, expect.objectContaining({
      name: 'Bug reviewer copy', providerId: 'codex', profileId: 'codex', options: { reasoning: 'high' },
    }))
  })

  it('refuses to save an agent with no name', async () => {
    const host = draw()
    await settle()
    buttons(host, 'New agent')[0]!.click()
    await settle()
    buttons(document.body, 'Save')[0]!.click()
    await settle()
    expect(saveCustomAgent).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Give the agent a name.')
  })
})
