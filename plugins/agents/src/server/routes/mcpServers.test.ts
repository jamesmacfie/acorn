import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppEnv, Env } from '@acorn/plugin-api/testkit'
import type { AgentMcpServer } from '../../shared/mcpServers'
import { agentMcpServers } from './mcpServers'
import { setAgentMcpServersBridge, type AgentMcpServersBridge } from './mcpServersBridge'

const request = (path: string, method = 'GET', body?: unknown) =>
  new Request(`http://acorn.test${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const as = (principal: Record<string, unknown>) => {
  const app = new Hono<AppEnv>()
  app.use('/api/*', async (c, next) => {
    c.set('principal', principal as never)
    await next()
  })
  return app.route('/api/agents', agentMcpServers)
}
const device = () => as({ kind: 'device', userId: 'james', deviceId: 'laptop' })
// An agent session's own ACORN_API_TOKEN.
const agent = () => as({ kind: 'internal', userId: 'james', scope: 'task', taskId: 'task1' })

const saved: AgentMcpServer = {
  name: 'linear',
  transport: 'stdio',
  command: 'npx',
  args: [],
  url: null,
  values: [],
  enabled: true,
  updatedAt: 1,
  revision: 'a'.repeat(64),
  consented: true,
  reviewTools: false,
  approvedCatalogueDigest: null,
  auth: 'headers',
  signIn: null,
  clientId: null,
  clientSecretStored: false,
}

describe('Settings → MCP servers routes', () => {
  afterEach(() => setAgentMcpServersBridge(null))

  const bridge = (calls: string[]): AgentMcpServersBridge => ({
    list: async () => {
      calls.push('list')
      return [saved]
    },
    save: async (name) => {
      calls.push(`save:${name}`)
      return saved
    },
    remove: async (name) => {
      calls.push(`remove:${name}`)
      return name === 'linear'
    },
    test: async () => null,
    consent: async () => saved,
    planPackage: async () => {
      throw new Error('not called')
    },
    testPackagePlan: async () => {
      throw new Error('not called')
    },
    activatePackage: async () => {
      throw new Error('not called')
    },
    pendingReviews: async () => [],
    approveReview: async () => {
      throw new Error('not called')
    },
    startSignIn: async (name, redirectUri, deviceId) => {
      calls.push(`sign-in:${name}:${redirectUri}:${deviceId}`)
      return { attemptId: 'attempt', authorizationUrl: 'https://auth.example/authorize' }
    },
    finishSignIn: async (name, attemptId, deviceId, input) => {
      calls.push(`finish:${name}:${attemptId}:${deviceId}:${JSON.stringify(input)}`)
      return saved
    },
    cancelSignIn: async (name, attemptId, deviceId) => {
      calls.push(`cancel:${name}:${attemptId}:${deviceId}`)
      return true
    },
    signOut: async (name) => {
      calls.push(`sign-out:${name}`)
      return saved
    },
  })

  // A stdio server is a command the next session runs, so an agent must neither add one nor read them.
  it('refuses every route to a task-scoped agent before reaching the bridge', async () => {
    const calls: string[] = []
    setAgentMcpServersBridge(bridge(calls))
    const app = agent()
    const valid = { transport: 'stdio', command: 'npx', enabled: true }
    expect((await app.fetch(request('/api/agents/mcp-servers'), {} as Env)).status).toBe(403)
    expect((await app.fetch(request('/api/agents/mcp-servers/linear', 'PUT', valid), {} as Env)).status).toBe(403)
    expect((await app.fetch(request('/api/agents/mcp-servers/linear', 'DELETE'), {} as Env)).status).toBe(403)
    expect(
      (
        await app.fetch(
          request('/api/agents/mcp-servers/package-plan', 'POST', { coordinate: 'fixture@1.0.0' }),
          {} as Env,
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await app.fetch(
          request('/api/agents/mcp-servers/package-plan/96de4913-9027-4eaa-987f-6475ec264c94/test', 'POST', {
            name: 'linear',
            bin: 'mcp',
          }),
          {} as Env,
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await app.fetch(
          request('/api/agents/mcp-servers/linear/package-activate', 'POST', {
            planId: '96de4913-9027-4eaa-987f-6475ec264c94',
            bin: 'mcp',
            enabled: true,
          }),
          {} as Env,
        )
      ).status,
    ).toBe(403)
    expect((await app.fetch(request('/api/agents/mcp-servers/linear/test', 'POST'), {} as Env)).status).toBe(403)
    expect(
      (
        await app.fetch(
          request('/api/agents/mcp-servers/linear/consent', 'POST', { revision: 'a'.repeat(64) }),
          {} as Env,
        )
      ).status,
    ).toBe(403)
    expect((await app.fetch(request('/api/agents/mcp-servers/reviews'), {} as Env)).status).toBe(403)
    expect(
      (
        await app.fetch(
          request('/api/agents/mcp-servers/linear/sign-in', 'POST', { redirectUri: 'http://127.0.0.1:5555/cb' }),
          {} as Env,
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await app.fetch(
          request('/api/agents/mcp-servers/linear/sign-in/attempt/finish', 'POST', { code: 'c', state: 's' }),
          {} as Env,
        )
      ).status,
    ).toBe(403)
    expect((await app.fetch(request('/api/agents/mcp-servers/linear/sign-out', 'POST'), {} as Env)).status).toBe(403)
    expect(
      (
        await app.fetch(
          request('/api/agents/mcp-servers/linear/review', 'POST', {
            sessionId: 's',
            revision: 'a'.repeat(64),
            digest: 'b'.repeat(64),
          }),
          {} as Env,
        )
      ).status,
    ).toBe(403)
    expect(calls).toEqual([])
  })

  it.each([
    ['service', { kind: 'internal', userId: 'james', scope: 'service' }],
    ['plugin frame', { kind: 'plugin', pluginId: 'fixture', userId: 'james' }],
  ])('refuses managed installation and catalogue approval to a %s caller', async (_label, principal) => {
    const calls: string[] = []
    setAgentMcpServersBridge(bridge(calls))
    const app = as(principal)
    for (const [path, method, body] of [
      [
        '/api/agents/mcp-servers/package-plan',
        'POST',
        { coordinate: 'fixture@1.0.0', targetName: 'fixture', expectedRevision: null, exceptions: [] },
      ],
      [
        '/api/agents/mcp-servers/package-plan/96de4913-9027-4eaa-987f-6475ec264c94/test',
        'POST',
        { name: 'fixture', bin: 'fixture' },
      ],
      [
        '/api/agents/mcp-servers/fixture/package-activate',
        'POST',
        { planId: '96de4913-9027-4eaa-987f-6475ec264c94', bin: 'fixture', enabled: true },
      ],
      ['/api/agents/mcp-servers/fixture/test', 'POST', undefined],
      [
        '/api/agents/mcp-servers/fixture/review',
        'POST',
        { sessionId: 'session', revision: 'a'.repeat(64), digest: 'b'.repeat(64) },
      ],
    ] as const)
      expect((await app.fetch(request(path, method, body), {} as Env)).status).toBe(403)
    expect(calls).toEqual([])
  })

  it('validates the name and the body at the boundary', async () => {
    const calls: string[] = []
    setAgentMcpServersBridge(bridge(calls))
    const app = device()
    expect(
      (
        await app.fetch(
          request('/api/agents/mcp-servers/acorn', 'PUT', { transport: 'stdio', command: 'x', enabled: true }),
          {} as Env,
        )
      ).status,
    ).toBe(400)
    expect(
      (
        await app.fetch(
          request('/api/agents/mcp-servers/bad%20name', 'PUT', { transport: 'stdio', command: 'x', enabled: true }),
          {} as Env,
        )
      ).status,
    ).toBe(400)
    expect(
      (
        await app.fetch(
          request('/api/agents/mcp-servers/docs', 'PUT', {
            transport: 'http',
            url: 'file:///etc/passwd',
            enabled: true,
          }),
          {} as Env,
        )
      ).status,
    ).toBe(400)
    expect(
      (
        await app.fetch(
          request('/api/agents/mcp-servers/linear', 'PUT', { transport: 'stdio', command: 'npx', enabled: true }),
          {} as Env,
        )
      ).status,
    ).toBe(200)
    expect((await app.fetch(request('/api/agents/mcp-servers/gone', 'DELETE'), {} as Env)).status).toBe(404)
    expect(calls).toEqual(['save:linear', 'remove:gone'])
  })

  // The browser's return trip carries a one-time code, so it may only land on this machine.
  it('accepts only a loopback http return address for a sign-in', async () => {
    const calls: string[] = []
    setAgentMcpServersBridge(bridge(calls))
    const app = device()
    const start = (redirectUri: string) =>
      app.fetch(request('/api/agents/mcp-servers/linear/sign-in', 'POST', { redirectUri }), {} as Env)
    for (const refused of [
      'https://127.0.0.1:5555/cb',
      'http://example.com/cb',
      'http://192.168.1.2:5555/cb',
      'http://user:pass@127.0.0.1:5555/cb',
      'not a url',
    ])
      expect((await start(refused)).status, refused).toBe(400)
    for (const accepted of ['http://127.0.0.1:5555/cb', 'http://[::1]:5555/cb', 'http://localhost/acorn-oauth'])
      expect((await start(accepted)).status, accepted).toBe(200)
    expect(calls).toEqual([
      'sign-in:linear:http://127.0.0.1:5555/cb:laptop',
      'sign-in:linear:http://[::1]:5555/cb:laptop',
      'sign-in:linear:http://localhost/acorn-oauth:laptop',
    ])
  })

  it('passes the calling device to finish and cancel, and takes a pasted address', async () => {
    const calls: string[] = []
    setAgentMcpServersBridge(bridge(calls))
    const app = device()
    const finish = (body: unknown) =>
      app.fetch(request('/api/agents/mcp-servers/linear/sign-in/attempt/finish', 'POST', body), {} as Env)
    expect((await finish({ code: 'c', state: 's' })).status).toBe(200)
    expect((await finish({ address: 'http://127.0.0.1/acorn-oauth?code=c&state=s' })).status).toBe(200)
    expect((await finish({ code: 'c' })).status).toBe(400)
    expect((await finish({ code: 'c', state: 's', address: 'x' })).status).toBe(400)
    expect(
      (await app.fetch(request('/api/agents/mcp-servers/linear/sign-in/attempt', 'DELETE'), {} as Env)).status,
    ).toBe(200)
    expect(calls).toEqual([
      'finish:linear:attempt:laptop:{"code":"c","state":"s"}',
      'finish:linear:attempt:laptop:{"address":"http://127.0.0.1/acorn-oauth?code=c&state=s"}',
      'cancel:linear:attempt:laptop',
    ])
  })
})
