import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { makeTestPluginDb, SecretService, type TestPluginDb } from '@acorn/plugin-api/testkit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '../node/schema'
import type { AgentDriverMcpServer } from './drivers/types'
import { startFakeOauthMcp, type FakeOauthMcp } from './fakeOauthMcp.helper'
import { probeMcpServer } from './mcpProbe'
import { McpReviewManager } from './mcpReviewManager'
import { AgentMcpServerStore } from './mcpServerStore'
import { signInFetch } from './mcpSignIn'
import { closeWhenStopped, relayHandoffServers } from './terminalHandoffRelays'

const SECRETS = new SecretService('44'.repeat(32))
// Nothing listens here. The fake server redirects to it, and the test reads the address it would land on.
const REDIRECT = 'http://127.0.0.1:43123/acorn-oauth/test'

describe('signing in to a remote MCP server', () => {
  let testDb: TestPluginDb
  let store: AgentMcpServerStore
  let fake: FakeOauthMcp
  let redacted: string[]
  const clients: Client[] = []
  let relays: McpReviewManager | null = null

  beforeEach(async () => {
    testDb = makeTestPluginDb('agents')
    redacted = []
    store = new AgentMcpServerStore(testDb.db, SECRETS, undefined, (value) => redacted.push(value))
    fake = await startFakeOauthMcp()
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(clients.splice(0).map((client) => client.close().catch(() => undefined)))
    await relays?.close()
    relays = null
    await fake.close()
    testDb.cleanup()
  })

  const add = async (name = 'fake', url = fake.url, reviewTools = false) => {
    const saved = await store.save(name, {
      transport: 'http',
      url,
      values: [],
      enabled: true,
      auth: 'oauth',
      reviewTools,
    })
    return store.consent(name, saved.revision)
  }
  const signIn = async (name = 'fake') => {
    const started = await store.startSignIn(name, REDIRECT, 'laptop')
    const landed = new URL(await fake.approve(started.authorizationUrl))
    const code = landed.searchParams.get('code')!
    const state = landed.searchParams.get('state')!
    return store.finishSignIn(name, started.attemptId, 'laptop', { code, state })
  }
  const oauthRows = () => testDb.db.select().from(schema.agentMcpOauth)
  // A harness's view: an MCP client on the relay a session would be given.
  const connect = async (owner: string, review = false) => {
    relays ??= new McpReviewManager(store, () => [])
    const resolved = await store.resolve(['fake'], 'test')
    const server = resolved.servers[0] as Extract<AgentDriverMcpServer, { transport: 'http' }>
    const declared = await relays.prepare(server, owner, {
      revision: resolved.revisions.fake!.revision,
      review,
      signedFetch: await store.signedFetch('fake', server.url),
    })
    if (declared.transport !== 'http') throw new Error('The relay did not offer HTTP.')
    const client = new Client({ name: 'harness', version: '1' })
    clients.push(client)
    await client.connect(
      new StreamableHTTPClientTransport(new URL(declared.url), { requestInit: { headers: declared.headers } }),
    )
    return client
  }

  it('signs in, seals what it stores, and never returns a token from the list', async () => {
    await add()
    expect((await store.get('fake'))?.signIn).toEqual({ status: 'signed_out', signedInAt: null })
    const server = await signIn()
    expect(server?.signIn).toMatchObject({ status: 'signed_in' })

    const [row] = await oauthRows()
    const listed = JSON.stringify(await store.list())
    for (const token of fake.issued) {
      expect(row!.stateJson).not.toContain(token)
      expect(listed).not.toContain(token)
    }
    expect(redacted).toContain(fake.issued[0])

    const resolved = await store.resolve(['fake'], 'test')
    expect(resolved.unavailable).toEqual([])
    expect(resolved.revisions.fake).toMatchObject({ signIn: true })
    expect(resolved.secrets).toContain(fake.issued[0])
    // The token is added per request, never written into the server's headers.
    expect(JSON.stringify(resolved.servers)).not.toContain(fake.issued[0])
    const probed = await probeMcpServer(
      resolved.servers[0]!,
      resolved.secrets,
      await store.signedFetch('fake', fake.url),
    )
    expect(probed).toEqual({ ok: true, tools: [{ name: 'echo', description: 'Answers ok.' }] })
  })

  it('leaves a server with no sign-in out of a session start', async () => {
    await add()
    const resolved = await store.resolve(['fake'], 'test')
    expect(resolved.servers).toEqual([])
    expect(resolved.unavailable).toEqual(['fake (not signed in)'])
  })

  it('refreshes once when two relays find the token expired at the same time', async () => {
    await add()
    await signIn()
    const first = await connect('session-a')
    const second = await connect('session-b')
    fake.expireAccessTokens()
    const [a, b] = await Promise.all([first.listTools(), second.listTools()])
    expect(a.tools.map((tool) => tool.name)).toEqual(['echo'])
    expect(b.tools.map((tool) => tool.name)).toEqual(['echo'])
    expect(fake.refreshes()).toBe(1)
  })

  it('signs and reviews through one relay when a server has both on', async () => {
    await add('fake', fake.url, true)
    await signIn()
    const client = await connect('session-a', true)
    // Quarantined until the device approves the catalogue, which the relay could only read signed in.
    expect((await client.listTools()).tools).toEqual([])
    await vi.waitFor(async () =>
      expect((await relays!.pending()).map((review) => review.tools.map((tool) => tool.name))).toEqual([['echo']]),
    )
  })

  it('expires a refused sign-in, tells the agent, and recovers the same relay after a new sign-in', async () => {
    await add()
    await signIn()
    const client = await connect('session-a')
    fake.refuseRefresh(true)
    fake.expireAccessTokens()
    await expect(client.listTools()).rejects.toThrow('Sign in to fake again in Settings → MCP.')
    expect((await store.get('fake'))?.signIn?.status).toBe('expired')
    expect((await store.resolve(['fake'], 'test')).unavailable).toEqual(['fake (not signed in)'])

    fake.refuseRefresh(false)
    await signIn()
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['echo'])
  })

  it('refuses another device, a wrong state, a second use, and an expired attempt', async () => {
    await add()
    const started = await store.startSignIn('fake', REDIRECT, 'laptop')
    const landed = new URL(await fake.approve(started.authorizationUrl))
    const code = landed.searchParams.get('code')!
    const state = landed.searchParams.get('state')!
    await expect(store.finishSignIn('fake', started.attemptId, 'phone', { code, state })).rejects.toThrow(
      'No sign-in is waiting',
    )
    await expect(store.finishSignIn('fake', started.attemptId, 'laptop', { code, state: 'forged' })).rejects.toThrow(
      'different sign-in',
    )
    await expect(store.finishSignIn('fake', started.attemptId, 'laptop', { code, state })).rejects.toThrow(
      'No sign-in is waiting',
    )

    const late = await store.startSignIn('fake', REDIRECT, 'laptop')
    const lateLanded = new URL(await fake.approve(late.authorizationUrl))
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 11 * 60_000)
    await expect(store.finishSignIn('fake', late.attemptId, 'laptop', { address: lateLanded.href })).rejects.toThrow(
      'No sign-in is waiting',
    )
    expect((await store.get('fake'))?.signIn?.status).toBe('signed_out')
  })

  it('finishes with a pasted address, and refuses one for a different return address', async () => {
    await add()
    const wrong = await store.startSignIn('fake', REDIRECT, 'laptop')
    const landed = new URL(await fake.approve(wrong.authorizationUrl))
    landed.pathname = '/elsewhere'
    await expect(store.finishSignIn('fake', wrong.attemptId, 'laptop', { address: landed.href })).rejects.toThrow(
      'not where this sign-in returns',
    )

    const started = await store.startSignIn('fake', REDIRECT, 'laptop')
    const address = await fake.approve(started.authorizationUrl)
    expect((await store.finishSignIn('fake', started.attemptId, 'laptop', { address }))?.signIn?.status).toBe(
      'signed_in',
    )
  })

  it('drops the tokens when the URL changes, the server switches to headers, or it is removed', async () => {
    await add()
    await signIn()
    await store.save('fake', { transport: 'http', url: fake.url, values: [], enabled: false, auth: 'oauth' })
    expect(await oauthRows()).toHaveLength(1)

    await store.save('fake', { transport: 'http', url: `${fake.url}/v2`, values: [], enabled: true, auth: 'oauth' })
    expect(await oauthRows()).toEqual([])

    await add()
    await signIn()
    await store.save('fake', { transport: 'http', url: fake.url, values: [], enabled: true })
    expect(await oauthRows()).toEqual([])

    await add()
    await signIn()
    await store.remove('fake')
    expect(await oauthRows()).toEqual([])
  })

  it('revokes the refresh token on sign-out and forgets the sign-in', async () => {
    await add()
    await signIn()
    const refreshToken = fake.issued[1]!
    const server = await store.signOut('fake')
    expect(fake.revoked).toEqual([refreshToken])
    expect(server?.signIn).toEqual({ status: 'signed_out', signedInAt: null })
    expect(await oauthRows()).toEqual([])
  })

  it('keeps a remote server from pointing sign-in requests at this machine or at plain http', async () => {
    const origin = new URL(fake.url).origin
    await expect(
      signInFetch('https://mcp.example.test/mcp')(`${origin}/.well-known/oauth-authorization-server`),
    ).rejects.toThrow('https')
    const local = signInFetch(fake.url)
    expect((await local(`${origin}/.well-known/oauth-authorization-server`)).status).toBe(200)
    await expect(local(`${origin}/redirect?to=${encodeURIComponent('http://example.invalid/token')}`)).rejects.toThrow(
      'http://example.invalid',
    )
  })

  it('needs consent first, and refuses to sign in over plain http to another machine', async () => {
    await store.save('fake', { transport: 'http', url: fake.url, values: [], enabled: true, auth: 'oauth' })
    await expect(store.startSignIn('fake', REDIRECT, 'laptop')).rejects.toThrow('consent')

    await add('remote', 'http://mcp.example.invalid/mcp')
    await expect(store.startSignIn('remote', REDIRECT, 'laptop')).rejects.toThrow('https')
  })

  it('gives a terminal handoff its own relay, which closes when the terminal stops', async () => {
    await add()
    await signIn()
    relays = new McpReviewManager(store, () => [])
    const manager = relays
    const [server] = await relayHandoffServers(
      await store.resolve(['fake'], 'test'),
      'terminal-handoff-1',
      async () => manager,
      (name, url) => store.signedFetch(name, url),
    )
    if (server?.transport !== 'http') throw new Error('The handoff did not get an HTTP relay.')
    expect(server.url).not.toBe(fake.url)
    const client = new Client({ name: 'terminal', version: '1' })
    clients.push(client)
    await client.connect(
      new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } }),
    )
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['echo'])

    let stop: (terminalId: string) => void = () => undefined
    const running = [{ id: 'terminal-1', status: 'running' }]
    const sessions = {
      onStopped: (listener: (terminalId: string) => void) => {
        stop = listener
        return () => undefined
      },
      list: async () => running as never,
    }
    await closeWhenStopped(sessions, 'terminal-1', () => manager.closeSession('terminal-handoff-1'))
    expect((await client.listTools()).tools).toHaveLength(1)
    stop('terminal-1')
    await vi.waitFor(() => expect(client.listTools()).rejects.toThrow())

    // A terminal that stopped before the watch began closes its relays at once.
    const close = vi.fn(async () => undefined)
    await closeWhenStopped({ ...sessions, list: async () => [] }, 'terminal-2', close)
    expect(close).toHaveBeenCalledOnce()
  })
})
