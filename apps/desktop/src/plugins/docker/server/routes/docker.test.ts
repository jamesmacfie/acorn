import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import type { DockerBridge } from './docker'
import type { AppEnv } from '../../../../core/server/middleware/auth'
import { requireUser } from '../../../../core/server/middleware/requireUser'
import { docker, setDockerBridge } from './docker'
import { BridgeError } from '../../../../core/server/bridge'

// Transport contract for the docker routes: auth + ref validation (nothing dash-leading reaches
// argv) + body validation + BridgeError passthrough + bridge-unavailable. The CLI/daemon behaviors
// live in main/ and are covered by parse.test.ts + the live pass.

const req = (url: string, method = 'GET', body?: unknown) =>
  new Request(`http://acorn.test${url}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const authed = () => {
  const app = new Hono<AppEnv>()
  app.use('/api/*', async (c, next) => {
    c.set('principal', { kind: 'user', user: { token: 't', login: 'james', name: '', avatar: '', scopes: [] } })
    await next()
  })
  return app.route('/api/docker', docker)
}

const summary = {
  id: 'abc123', name: 'web-1', image: 'nginx', state: 'running', status: 'Up', createdAt: null,
  ports: [], composeProject: null, composeService: null, composeWorkingDir: null, labels: {},
}

const fake = (over: Partial<DockerBridge> = {}): DockerBridge => ({
  info: async () => ({ available: true, version: '29.4.0', context: 'orbstack' }),
  containers: async () => [summary],
  inspectContainer: async () => ({
    ...summary, command: 'nginx', startedAt: null, finishedAt: null, exitCode: null,
    restartCount: 0, health: null, env: [], mounts: [], networks: [], imageId: 'sha256:x',
  }),
  containerAction: async () => ({ ok: true }),
  removeContainer: async () => ({ ok: true }),
  images: async () => [],
  removeImage: async () => ({ ok: true }),
  volumes: async () => [],
  removeVolume: async () => ({ ok: true }),
  networks: async () => [],
  removeNetwork: async () => ({ ok: true }),
  prune: async () => ({ reclaimed: '1.2GB' }),
  composeAction: async () => ({ ok: true }),
  taskSummary: async () => [{ taskId: 't1', running: 2, total: 3, projects: ['runn_x'] }],
  taskContainers: async () => [summary],
  taskTeardown: async () => ({ ok: true }),
  ...over,
})

describe('docker routes', () => {
  afterEach(() => setDockerBridge(null))

  it('serves info and containers', async () => {
    setDockerBridge(fake())
    const app = authed()
    expect(await (await app.fetch(req('/api/docker/info'), {} as Env)).json()).toEqual({ available: true, version: '29.4.0', context: 'orbstack' })
    expect(await (await app.fetch(req('/api/docker/containers'), {} as Env)).json()).toEqual([summary])
  })

  it('forwards actions with validated refs and bodies', async () => {
    let got: unknown = null
    setDockerBridge(fake({
      containerAction: async (ref, action) => ((got = { ref, action }), { ok: true }),
      removeContainer: async (ref, force) => ((got = { ref, force }), { ok: true }),
    }))
    const app = authed()
    await app.fetch(req('/api/docker/containers/web-1/action', 'POST', { action: 'stop' }), {} as Env)
    expect(got).toEqual({ ref: 'web-1', action: 'stop' })
    await app.fetch(req('/api/docker/containers/web-1/remove', 'POST', { force: true }), {} as Env)
    expect(got).toEqual({ ref: 'web-1', force: true })
  })

  it('400s dash-leading refs and malformed bodies', async () => {
    setDockerBridge(fake())
    const app = authed()
    expect((await app.fetch(req('/api/docker/containers/--rm/inspect'), {} as Env)).status).toBe(400)
    expect((await app.fetch(req('/api/docker/containers/-f/action', 'POST', { action: 'stop' }), {} as Env)).status).toBe(400)
    expect((await app.fetch(req('/api/docker/containers/web-1/action', 'POST', { action: 'explode' }), {} as Env)).status).toBe(400)
    expect((await app.fetch(req('/api/docker/compose/action', 'POST', { project: '--evil', action: 'down' }), {} as Env)).status).toBe(400)
    expect((await app.fetch(req('/api/docker/prune', 'POST', { kind: 'everything' }), {} as Env)).status).toBe(400)
    expect((await app.fetch(req('/api/docker/images/--all/remove', 'POST', {}), {} as Env)).status).toBe(400)
  })

  it('forwards compose actions and prune', async () => {
    let compose: unknown = null
    let pruned: string | null = null
    setDockerBridge(fake({
      composeAction: async (project, action) => ((compose = { project, action }), { ok: true }),
      prune: async (kind) => ((pruned = kind), { reclaimed: '2GB' }),
    }))
    const app = authed()
    await app.fetch(req('/api/docker/compose/action', 'POST', { project: 'runn_x', action: 'down' }), {} as Env)
    expect(compose).toEqual({ project: 'runn_x', action: 'down' })
    expect(await (await app.fetch(req('/api/docker/prune', 'POST', { kind: 'images' }), {} as Env)).json()).toEqual({ reclaimed: '2GB' })
    expect(pruned).toBe('images')
  })

  it('serves task summaries and forwards teardown', async () => {
    let torn: string | null = null
    setDockerBridge(fake({ taskTeardown: async (id) => ((torn = id), { ok: true }) }))
    const app = authed()
    expect(await (await app.fetch(req('/api/docker/task-summary'), {} as Env)).json()).toEqual([{ taskId: 't1', running: 2, total: 3, projects: ['runn_x'] }])
    expect(await (await app.fetch(req('/api/docker/tasks/t1/containers'), {} as Env)).json()).toEqual([summary])
    await app.fetch(req('/api/docker/tasks/t1/teardown', 'POST'), {} as Env)
    expect(torn).toBe('t1')
  })

  it('passes BridgeError statuses through', async () => {
    setDockerBridge(fake({ inspectContainer: async () => { throw new BridgeError(404, 'docker_not_found') } }))
    expect((await authed().fetch(req('/api/docker/containers/gone/inspect'), {} as Env)).status).toBe(404)
  })

  it('401s without a principal; 503s without a bridge', async () => {
    const gated = new Hono<AppEnv>().use('/api/*', requireUser).route('/api/docker', docker)
    expect((await gated.fetch(req('/api/docker/containers'), {} as Env)).status).toBe(401)
    expect((await authed().fetch(req('/api/docker/containers'), {} as Env)).status).toBe(503)
  })
})
