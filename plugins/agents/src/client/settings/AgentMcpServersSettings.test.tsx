import { render } from 'solid-js/web'
import { createSignal } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentMcpPendingReview, AgentMcpServer } from '../../shared/mcpServers'

// Settings → Agents → MCP servers. What is pinned: the list says settings never changes an open session
// and points at /mcp, a server opens in the same pane rather than editing in place, and removing one
// from its danger zone asks first and names what stays.

const servers: AgentMcpServer[] = [
  {
    name: 'linear',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'linear-mcp'],
    url: null,
    values: [],
    enabled: true,
    updatedAt: 1,
    revision: 'a'.repeat(64),
    consented: true,
    reviewTools: false,
    approvedCatalogueDigest: null,
  },
]
const mocks = vi.hoisted(() => ({
  confirm: vi.fn(async (_question: { title: string; stays?: string }) => false),
  remove: vi.fn(async (_name: string) => ({ ok: true })),
  approve: vi.fn(async (_review: AgentMcpPendingReview) => ({})),
}))
vi.mock('@acorn/plugin-api/ui/host', () => ({
  confirmAction: (question: { title: string }) => mocks.confirm(question),
}))
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
  approveAgentMcpReview: (review: AgentMcpPendingReview) => mocks.approve(review),
  pendingAgentMcpReviews: vi.fn(async () => []),
}))

const { default: AgentMcpServersSettings, CatalogueReview, consentSource } = await import('./AgentMcpServersSettings')

let host: HTMLElement
let dispose: (() => void) | undefined
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const button = (label: string) =>
  [...host.querySelectorAll('button')].find((each) => each.textContent?.trim() === label)

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
  it('hides URL credentials, query values, and command arguments in consent', () => {
    expect(consentSource({ ...servers[0]!, args: ['--token', 'sk_live_example'] })).not.toContain('sk_live_example')
    expect(
      consentSource({
        ...servers[0]!,
        transport: 'http',
        url: 'https://alice:secret@example.test/mcp?token=secret#fragment',
      }),
    ).toBe('https://example.test/… (path and credentials hidden)')
  })

  it('lists servers, says /mcp changes an open session, and opens one in the same pane', () => {
    expect(host.querySelector('[data-settings-section="servers"]')?.textContent).toContain(
      'type /mcp in its message box',
    )
    expect(host.textContent).toContain('npx (2 arguments hidden)')
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
    expect(mocks.confirm).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Remove linear', stays: "Servers set up in a CLI's own config files." }),
    )
    expect(mocks.remove).not.toHaveBeenCalled()

    mocks.confirm.mockResolvedValueOnce(true)
    button('Remove server')!.click()
    await settle()
    expect(mocks.remove).toHaveBeenCalledWith('linear')
    expect(host.querySelector('[data-settings-section="servers"]')).not.toBeNull()
  })
})

it('recomputes the displayed catalogue and approval from changed review props', async () => {
  const first: AgentMcpPendingReview = {
    name: 'fixture',
    sessionId: 'session',
    revision: 'a'.repeat(64),
    digest: 'b'.repeat(64),
    version: 1,
    previousTools: [{ name: 'read', description: 'Old', inputSchema: { type: 'object' } }],
    tools: [{ name: 'read', description: 'New', inputSchema: { type: 'object' } }],
    findings: [],
  }
  let change!: (review: AgentMcpPendingReview) => void
  const container = document.createElement('div')
  document.body.append(container)
  const stop = render(() => {
    const [review, setReview] = createSignal(first)
    change = setReview
    return <CatalogueReview review={review()} onApproved={() => undefined} />
  }, container)
  try {
    expect(container.textContent).toContain('New')
    expect(container.textContent).toContain('Start a new managed session')
    const next = {
      ...first,
      digest: 'c'.repeat(64),
      tools: [
        {
          name: 'read',
          description: 'New',
          inputSchema: { type: 'object', properties: { key: { type: 'string' } } },
          annotations: { readOnlyHint: true },
        },
      ],
    }
    change(next)
    expect(container.textContent).toContain('readOnlyHint')
    expect(container.textContent).toContain(next.digest)
    ;[...container.querySelectorAll('button')]
      .find((node) => node.textContent?.includes('Approve these tool definitions'))!
      .click()
    await settle()
    expect(mocks.approve).toHaveBeenLastCalledWith(next)
  } finally {
    stop()
    container.remove()
  }
})
