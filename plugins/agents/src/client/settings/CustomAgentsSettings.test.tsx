import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CustomAgent } from '../../shared/customAgents'

// Settings → Custom agents. What is pinned: a plugin's agent offers Duplicate and nothing that writes
// it, the editor sends the record with the harness's own profile and the options a recent session
// advertised, going back asks before it drops an edit, and delete asks first and names what goes.

const saveCustomAgent = vi.fn(async (_client: unknown, _id: string | null, input: unknown) => input)
const agents: CustomAgent[] = [
  { id: 'a1', name: 'Bug reviewer', providerId: 'codex', profileId: 'codex', options: { reasoning: 'high' }, source: { kind: 'user' } },
  { id: 'lint:tidy', name: 'Tidy', providerId: 'codex', profileId: 'codex', options: {}, source: { kind: 'plugin', pluginId: 'lint' } },
]

const confirmAction = vi.fn(async (_question: { title: string }) => false)
vi.mock('@acorn/plugin-api/ui/host', async (importOriginal) => ({
  ...await importOriginal<typeof import('@acorn/plugin-api/ui/host')>(),
  confirmAction: (question: { title: string }) => confirmAction(question),
}))

const deleteCustomAgent = vi.fn(async (_client: unknown, _id: string) => {})
vi.mock('./customAgentsClient', () => ({
  customAgentsOptions: () => ({}),
  saveCustomAgent: (client: unknown, id: string | null, input: unknown) => saveCustomAgent(client, id, input),
  deleteCustomAgent: (client: unknown, id: string) => deleteCustomAgent(client, id),
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
  deleteCustomAgent.mockClear()
  confirmAction.mockReset()
  confirmAction.mockResolvedValue(false)
})

const nameField = () => document.querySelector<HTMLInputElement>('[data-settings-section="agent"] input')

describe('the custom agents settings page', () => {
  it('lets the owner edit their own agents and only duplicate a plugin’s', async () => {
    const host = draw()
    await settle()
    expect(host.textContent).toContain('From lint')
    expect(host.querySelector('[data-settings-section="from-plugins"]')?.textContent).toContain('Tidy')
    // Two Duplicates, one per agent, but Edit only for the owner's.
    expect(buttons(host, 'Duplicate')).toHaveLength(2)
    expect(buttons(host, 'Edit')).toHaveLength(1)
  })

  it('saves a duplicate as a new agent with the harness’s profile and its options', async () => {
    const host = draw()
    await settle()
    buttons(host, 'Duplicate')[0]!.click()
    await settle()
    // The editor replaces the list in the same pane, with no dialog.
    expect(document.querySelector('.overlay')).toBeNull()
    expect(host.querySelector('[data-settings-section="agents"]')).toBeNull()
    expect(host.textContent).toContain('Reasoning')
    buttons(host, 'Save')[0]!.click()
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
    buttons(host, 'Save')[0]!.click()
    await settle()
    expect(saveCustomAgent).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Give the agent a name.')
  })

  it('goes back from an untouched editor at once, and asks first once it holds changes', async () => {
    const host = draw()
    await settle()
    buttons(host, 'New agent')[0]!.click()
    await settle()
    // Drawn outside settings there is no header, so the page draws its own way back.
    buttons(host, '‹ Custom agents')[0]!.click()
    await settle()
    expect(confirmAction).not.toHaveBeenCalled()
    expect(nameField()).toBeNull()

    buttons(host, 'New agent')[0]!.click()
    await settle()
    const name = nameField()!
    name.value = 'Reviewer'
    name.dispatchEvent(new Event('input', { bubbles: true }))
    buttons(host, '‹ Custom agents')[0]!.click()
    await settle()
    expect(confirmAction).toHaveBeenCalledTimes(1)
    // Keep was the answer, so the edit is still there.
    expect(nameField()!.value).toBe('Reviewer')
  })

  it('deletes an agent from its danger zone only after asking', async () => {
    const host = draw()
    await settle()
    buttons(host, 'Edit')[0]!.click()
    await settle()
    buttons(host, 'Delete agent')[0]!.click()
    await settle()
    expect(confirmAction).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Delete Bug reviewer' }))
    expect(deleteCustomAgent).not.toHaveBeenCalled()

    confirmAction.mockResolvedValueOnce(true)
    buttons(host, 'Delete agent')[0]!.click()
    await settle()
    expect(deleteCustomAgent).toHaveBeenCalledWith(expect.anything(), 'a1')
    // Back on the list.
    expect(host.querySelector('[data-settings-section="agents"]')).not.toBeNull()
  })
})
