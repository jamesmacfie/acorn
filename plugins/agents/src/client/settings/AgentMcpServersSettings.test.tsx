import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentMcpServer } from '../../shared/mcpServers'

// Settings → Agents → MCP servers. What is pinned: the list says settings never changes an open session
// and points at /mcp, a server opens in the same pane rather than editing in place, and removing one
// from its danger zone asks first and names what stays.

const servers: AgentMcpServer[] = [
  { name: 'linear', transport: 'stdio', command: 'npx', args: ['-y', 'linear-mcp'], url: null, values: [], enabled: true, updatedAt: 1 },
]
const mocks = vi.hoisted(() => ({
  confirm: vi.fn(async (_question: { title: string; stays?: string }) => false),
  remove: vi.fn(async (_name: string) => ({ ok: true })),
}))
vi.mock('@acorn/plugin-api/ui/host', () => ({ confirmAction: (question: { title: string }) => mocks.confirm(question) }))
vi.mock('@tanstack/solid-query', () => ({
  createQuery: () => ({ data: servers, isPending: false }),
  useQueryClient: () => ({ setQueryData: vi.fn() }),
}))
vi.mock('./mcpServersClient', () => ({
  agentMcpServersOptions: () => ({}),
  agentMcpServersQueryKey: ['agents', 'mcp-servers'],
  saveAgentMcpServer: vi.fn(),
  removeAgentMcpServer: (name: string) => mocks.remove(name),
  testAgentMcpServer: vi.fn(async () => ({ ok: true, tools: [] })),
}))

const { default: AgentMcpServersSettings } = await import('./AgentMcpServersSettings')

let host: HTMLElement
let dispose: (() => void) | undefined
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const button = (label: string) => [...host.querySelectorAll('button')].find((each) => each.textContent?.trim() === label)

beforeEach(() => {
  mocks.confirm.mockReset()
  mocks.confirm.mockResolvedValue(false)
  mocks.remove.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => <AgentMcpServersSettings />, host)
})
afterEach(() => {
  dispose?.()
  host.remove()
})

describe('the MCP servers page', () => {
  it('lists servers, says /mcp changes an open session, and opens one in the same pane', () => {
    expect(host.querySelector('[data-settings-section="servers"]')?.textContent).toContain('type /mcp in its message box')
    expect(host.textContent).toContain('npx -y linear-mcp')
    button('Edit')!.click()
    expect(host.querySelector('[data-settings-section="servers"]')).toBeNull()
    expect(host.querySelector('[data-settings-section="server"]')).not.toBeNull()
    // Outside settings there is no header, so the page draws its own way back.
    button('‹ MCP servers')!.click()
    expect(host.querySelector('[data-settings-section="servers"]')).not.toBeNull()
  })

  it('removes a server from its danger zone only after asking', async () => {
    button('Edit')!.click()
    button('Remove server')!.click()
    await settle()
    expect(mocks.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Remove linear', stays: "Servers set up in a CLI's own config files." }))
    expect(mocks.remove).not.toHaveBeenCalled()

    mocks.confirm.mockResolvedValueOnce(true)
    button('Remove server')!.click()
    await settle()
    expect(mocks.remove).toHaveBeenCalledWith('linear')
    expect(host.querySelector('[data-settings-section="servers"]')).not.toBeNull()
  })
})
