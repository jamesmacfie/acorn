import { describe, expect, it, vi } from 'vitest'

const readJson = vi.hoisted(() => vi.fn())
vi.mock('@acorn/plugin-api/client', () => ({
  readJson, activeNodeId: () => 'selected-node', readBytes: vi.fn(), sendForm: vi.fn(), writeJson: vi.fn(),
}))
import { managedAgentApi } from './managedClient'

describe('session roster client compatibility', () => {
  it('continues an older Node numeric response with tuple opt-in on the captured Node', async () => {
    const owner = { nodeId: 'origin-node' }
    readJson.mockResolvedValueOnce({ sessions: [], delegations: [], nextCursor: '1000' })
    const first = await managedAgentApi.sessions({ limit: 5 }, owner)
    readJson.mockResolvedValueOnce({ sessions: [], delegations: [], nextCursor: null })
    await managedAgentApi.sessions({ cursor: first.nextCursor!, limit: 5 }, owner)
    const [path, options] = readJson.mock.calls[1]!
    const query = new URL(path, 'http://acorn.test').searchParams
    expect(query.get('cursor')).toBe('1000')
    expect(query.get('cursorFormat')).toBe('tuple-v1')
    expect(query.get('limit')).toBe('5')
    expect(options).toEqual(owner)
  })
})
