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
  afterEach(() => {
    vi.restoreAllMocks()
    testDb.cleanup()
  })

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
    await store.consent('linear', saved.revision)
    expect(saved.values).toEqual([
      { name: 'LINEAR_API_KEY', value: null, secret: true },
      { name: 'LOG_LEVEL', value: 'warn', secret: false },
    ])
    const [row] = await testDb.db.select().from(schema.agentMcpServers)
    expect(row!.configJson).not.toContain('lin_api_0123456789')

    const resolved = await store.resolve(['linear'], 'test')
    expect(resolved.servers).toEqual([
      {
        transport: 'stdio',
        name: 'linear',
        command: 'npx',
        args: ['-y', '@example/linear-mcp'],
        env: { LINEAR_API_KEY: 'lin_api_0123456789', LOG_LEVEL: 'warn' },
      },
    ])
    expect(resolved.secrets).toEqual(['lin_api_0123456789'])
  })

  // How the form edits a server without ever holding its secrets.
  it('keeps a stored secret when an edit leaves its value out, and refuses one it never had', async () => {
    await store.save('linear', linear)
    const edited = await store.save('linear', {
      ...linear,
      values: [{ name: 'LINEAR_API_KEY', secret: true }],
      enabled: false,
    })
    await store.consent('linear', edited.revision)
    expect((await store.resolve(['linear'], 'test')).servers[0]).toMatchObject({
      env: { LINEAR_API_KEY: 'lin_api_0123456789' },
    })
    expect(await store.enabledNames()).toEqual([])

    await expect(store.save('linear', { ...linear, values: [{ name: 'OTHER_KEY', secret: true }] })).rejects.toThrow(
      'OTHER_KEY needs a value.',
    )
  })

  // A session keeps the names it switched on; one removed in Settings since then simply is not there.
  it('drops a name that no longer has a server, and starts without one whose secret will not open', async () => {
    const linearServer = await store.save('linear', linear)
    await store.consent('linear', linearServer.revision)
    const docs = await store.save('docs', {
      transport: 'http',
      url: 'https://docs.example/mcp',
      values: [],
      enabled: true,
    })
    await store.consent('docs', docs.revision)
    const otherKey = new AgentMcpServerStore(testDb.db, new SecretService('44'.repeat(32)))

    const resolved = await otherKey.resolve(['linear', 'docs', 'gone'], 'test')
    expect(resolved.servers).toEqual([
      { transport: 'http', name: 'docs', url: 'https://docs.example/mcp', headers: {} },
    ])
    expect(resolved.unavailable).toEqual(['linear'])
  })

  it('does not read another server after cancellation during a secret reveal', async () => {
    const linearServer = await store.save('linear', linear)
    await store.consent('linear', linearServer.revision)
    const docs = await store.save('docs', {
      transport: 'http',
      url: 'https://docs.example/mcp',
      values: [],
      enabled: true,
    })
    await store.consent('docs', docs.revision)
    let finish!: (value: string) => void
    const reveal = vi.spyOn(SECRETS, 'reveal').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const controller = new AbortController()
    const cancelled = new Error('cancel MCP startup')
    const resolving = store.resolve(['linear', 'docs'], 'test', controller.signal).catch((error: unknown) => error)
    await vi.waitFor(() => expect(reveal).toHaveBeenCalledOnce())
    controller.abort(cancelled)
    testDb.cleanup()
    finish('synthetic secret')
    expect(await resolving).toBe(cancelled)
  })

  it('holds a saved command until the device consents to the exact secret revision', async () => {
    const saved = await store.save('linear', linear)
    expect(saved.consented).toBe(false)
    expect(await store.resolve(['linear'], 'start')).toMatchObject({ servers: [], unavailable: ['linear'] })
    await expect(store.consent('linear', '0'.repeat(64))).rejects.toThrow('changed')
    expect((await store.consent('linear', saved.revision))?.consented).toBe(true)
    expect((await store.resolve(['linear'], 'start')).servers).toHaveLength(1)
    const changed = await store.save('linear', {
      ...linear,
      values: [{ name: 'LINEAR_API_KEY', value: 'another secret', secret: true }],
    })
    expect(changed.revision).not.toBe(saved.revision)
    expect(changed.consented).toBe(false)
    expect(await store.resolve(['linear'], 'start')).toMatchObject({ servers: [], unavailable: ['linear'] })
  })

  it('binds catalogue approval to the sealed configuration revision separately from consent', async () => {
    const saved = await store.save('linear', { ...linear, reviewTools: true })
    await store.consent('linear', saved.revision)
    await store.approveCatalogue('linear', saved.revision, {
      digest: 'a'.repeat(64),
      version: 1,
      tools: [{ name: 'read', description: 'Read' }],
    })
    expect((await store.get('linear'))?.approvedCatalogueDigest).toBe('a'.repeat(64))
    const changed = await store.save('linear', {
      ...linear,
      reviewTools: true,
      values: [{ name: 'LINEAR_API_KEY', value: 'new secret', secret: true }],
    })
    expect(changed.consented).toBe(false)
    expect(changed.approvedCatalogueDigest).toBeNull()
    expect((await store.previousCatalogue('linear'))?.tools).toEqual([{ name: 'read', description: 'Read' }])
    await expect(
      store.approveCatalogue('linear', saved.revision, { digest: 'b'.repeat(64), version: 1, tools: [] }),
    ).rejects.toThrow('changed')
  })
})
