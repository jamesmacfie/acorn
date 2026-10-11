import { Hono } from 'hono'
import { afterEach, expect, it } from 'vitest'
import type { AppEnv, Env } from '@acorn/plugin-api/testkit'
import { agentSecurityDiagnostics, setAgentSecurityDiagnosticsBridge } from './securityDiagnostics'

const app = (kind: 'device' | 'task' | 'service') => {
  const router = new Hono<AppEnv>()
  router.use('/api/*', async (c, next) => {
    c.set(
      'principal',
      (kind === 'device'
        ? { kind: 'device', userId: 'owner' }
        : { kind: 'internal', userId: 'owner', scope: kind, taskId: 'task' }) as never,
    )
    await next()
  })
  return router.route('/api/agents', agentSecurityDiagnostics)
}
const env = { NODE_ID: 'node-1' } as Env
const get = (path: string) => new Request(`http://acorn.test/api/agents${path}`)
afterEach(() => setAgentSecurityDiagnosticsBridge(null))

it('keeps reports and scope choices device only, including reads', async () => {
  const calls: string[] = []
  setAgentSecurityDiagnosticsBridge({
    scopes: async () => {
      calls.push('scopes')
      return { projects: [], sessions: [] }
    },
    check: async () => {
      calls.push('check')
      return { nodeId: 'node-1', projectId: null, sessionId: null, checkedAt: 0, expiresAt: 1, findings: [] }
    },
  })
  for (const kind of ['task', 'service'] as const) {
    expect((await app(kind).fetch(get('/security-diagnostics/scopes'), env)).status).toBe(403)
    expect((await app(kind).fetch(get('/security-diagnostics'), env)).status).toBe(403)
  }
  expect(calls).toEqual([])
  expect((await app('device').fetch(get('/security-diagnostics/scopes'), env)).status).toBe(200)
  const response = await app('device').fetch(get('/security-diagnostics?projectId=project-1'), env)
  expect(response.status).toBe(200)
  expect((await response.json()).nodeId).toBe('node-1')
  expect(calls).toEqual(['scopes', 'check'])
})

it('rejects malformed scope before a collector runs', async () => {
  const calls: string[] = []
  setAgentSecurityDiagnosticsBridge({
    scopes: async () => ({ projects: [], sessions: [] }),
    check: async () => {
      calls.push('check')
      throw new Error('unexpected')
    },
  })
  expect((await app('device').fetch(get('/security-diagnostics?projectId=../other'), env)).status).toBe(400)
  expect(calls).toEqual([])
})
