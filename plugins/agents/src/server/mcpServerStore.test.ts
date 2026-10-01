import { SecretService } from '@acorn/plugin-api/testkit'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '../node/schema'
import { AgentMcpServerStore } from './mcpServerStore'

const SECRETS = new SecretService('33'.repeat(32))

describe('the MCP servers acorn hands to sessions', () => {
  let testDb: TestPluginDb
  let store: AgentMcpServerStore

  beforeEach(() => {
    testDb = makeTestPluginDb('agents')
    store = new AgentMcpServerStore(testDb.db, SECRETS)
  })
  afterEach(() => { vi.restoreAllMocks(); testDb.cleanup() })

  const linear = {
    transport: 'stdio' as const,
    command: 'npx',
    args: ['-y', '@example/linear-mcp'],
    values: [
      { name: 'LINEAR_API_KEY', value: 'lin_api_0123456789', secret: true },
      { name: 'LOG_LEVEL', value: 'warn', secret: false },
    ],
    enabled: true,
  }

  // The plaintext exists at spawn time and nowhere else: not in the row, not in what the settings page
  // reads back.
  it('seals a secret, never returns it, and reveals it only for a session start', async () => {
    const saved = await store.save('linear', linear)
    expect(saved.values).toEqual([
      { name: 'LINEAR_API_KEY', value: null, secret: true },
      { name: 'LOG_LEVEL', value: 'warn', secret: false },
    ])
    const [row] = await testDb.db.select().from(schema.agentMcpServers)
    expect(row!.configJson).not.toContain('lin_api_0123456789')

    const resolved = await store.resolve(['linear'], 'test')
    expect(resolved.servers).toEqual([{
      transport: 'stdio',
      name: 'linear',
      command: 'npx',
      args: ['-y', '@example/linear-mcp'],
      env: { LINEAR_API_KEY: 'lin_api_0123456789', LOG_LEVEL: 'warn' },
    }])
    expect(resolved.secrets).toEqual(['lin_api_0123456789'])
  })

  // How the form edits a server without ever holding its secrets.
  it('keeps a stored secret when an edit leaves its value out, and refuses one it never had', async () => {
    await store.save('linear', linear)
    await store.save('linear', { ...linear, values: [{ name: 'LINEAR_API_KEY', secret: true }], enabled: false })
    expect((await store.resolve(['linear'], 'test')).servers[0]).toMatchObject({ env: { LINEAR_API_KEY: 'lin_api_0123456789' } })
    expect(await store.enabledNames()).toEqual([])

    await expect(store.save('linear', { ...linear, values: [{ name: 'OTHER_KEY', secret: true }] }))
      .rejects.toThrow('OTHER_KEY needs a value.')
  })

  // A session keeps the names it switched on; one removed in Settings since then simply is not there.
  it('drops a name that no longer has a server, and starts without one whose secret will not open', async () => {
    await store.save('linear', linear)
    await store.save('docs', { transport: 'http', url: 'https://docs.example/mcp', values: [], enabled: true })
    const otherKey = new AgentMcpServerStore(testDb.db, new SecretService('44'.repeat(32)))

    const resolved = await otherKey.resolve(['linear', 'docs', 'gone'], 'test')
    expect(resolved.servers).toEqual([{ transport: 'http', name: 'docs', url: 'https://docs.example/mcp', headers: {} }])
    expect(resolved.unavailable).toEqual(['linear'])
  })

  it('does not read another server after cancellation during a secret reveal', async () => {
    await store.save('linear', linear)
    await store.save('docs', { transport: 'http', url: 'https://docs.example/mcp', values: [], enabled: true })
    let finish!: (value: string) => void
    const reveal = vi.spyOn(SECRETS, 'reveal').mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const controller = new AbortController()
    const cancelled = new Error('cancel MCP startup')
    const resolving = store.resolve(['linear', 'docs'], 'test', controller.signal).catch((error: unknown) => error)
    await vi.waitFor(() => expect(reveal).toHaveBeenCalledOnce())
    controller.abort(cancelled)
    testDb.cleanup()
    finish('synthetic secret')
    expect(await resolving).toBe(cancelled)
  })
})
