// Synthetic daemon data only: neither the CLI nor the inventory service ever touches Docker.
import { Hono } from 'hono'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestNodeContext, type AppEnv, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { TaskRef } from '@acorn/plugin-api/node'
import { dockerPlugin } from '../node/index'
import type { DockerContainerSummary } from '../shared/model'
import { dockerBridge } from './dockerBridge'
import { dockerArchiveConcern } from './archiveCheck'
import { docker as routes, setDockerBridge } from './routes/docker'
import { docker, DockerCliError } from './cli'

const mocks = vi.hoisted(() => ({ containers: vi.fn(), invalidate: vi.fn(), config: vi.fn() }))
vi.mock('./dockerService', () => ({
  getDockerService: () => ({ containers: mocks.containers, invalidate: mocks.invalidate }),
  disposeDocker: vi.fn(),
}))
vi.mock('./dockerConfig', () => ({
  loadDockerOverrides: mocks.config,
  loadDockerLayers: vi.fn(),
}))
vi.mock('./cli', async (original) => ({ ...await original<typeof import('./cli')>(), docker: vi.fn() }))
vi.mock('./wsChannel', () => ({ registerDockerWsChannel: vi.fn() }))

const root = '/synthetic/worktrees/task'
const task: TaskRef = { id: 't1', title: 'Synthetic task', projectId: 'p1', branch: 'matching-branch', skipSetup: false, worktreePath: root, pullNumber: null }
const c = (char: string, over: Partial<DockerContainerSummary> = {}): DockerContainerSummary => ({
  id: char.repeat(64), name: `container-${char}`, image: 'synthetic', state: 'running', status: 'Up', createdAt: null,
  ports: [], labels: {}, composeWorkingDir: root, composeProject: 'shared-project', composeService: 'web', ...over,
})
const own = c('a')
const foreign = c('b', { composeWorkingDir: '/synthetic/worktrees/foreign', name: 'matching-branch', labels: { task: 'matching-branch' } })
const unverified = c('c', { composeWorkingDir: null, name: 'matching-branch' })
const loose = c('d', { composeProject: null, composeWorkingDir: `${root}/service` })
const ps = (containers: DockerContainerSummary[]) => containers.map((c) => JSON.stringify({
  ID: c.id, Names: c.name, State: c.state, Labels: [
    ...(c.composeProject ? [`com.docker.compose.project=${c.composeProject}`] : []),
    ...(c.composeWorkingDir !== null ? [`com.docker.compose.project.working_dir=${c.composeWorkingDir}`] : []),
  ].join(','),
})).join('\n')

let ctx: TestNodeContext
beforeEach(() => {
  vi.clearAllMocks()
  ctx = makeTestNodeContext({ plugin: { name: 'docker' } })
  vi.spyOn(ctx.core.tasks, 'load').mockImplementation(async (id) => id === task.id ? task : undefined)
  vi.spyOn(ctx.core.tasks, 'active').mockResolvedValue([task])
  mocks.containers.mockResolvedValue([own, foreign, unverified, loose])
  mocks.config.mockResolvedValue({ composeProject: 'shared-project', matchLabels: ['task'], matchName: true })
  vi.mocked(docker).mockImplementation(async (args) => args[0] === 'ps' ? ps([own, foreign, unverified, loose]) : '')
})
afterEach(() => { setDockerBridge(null); ctx.cleanup() })

describe('Docker task authority', () => {
  it('lists only root-associated containers and never consults repository hints', async () => {
    expect(await dockerBridge(ctx.core).taskContainers(task.id)).toEqual([own, loose])
    expect(mocks.config).not.toHaveBeenCalled()
  })

  it('preserves display-only hints in the device summary but excludes explicit foreign roots', async () => {
    const [summary] = await dockerBridge(ctx.core).taskSummary()
    expect(summary).toMatchObject({ taskId: task.id, running: 3, total: 3 })
    expect(mocks.config).toHaveBeenCalledWith(root)
  })

  it('stops associated IDs, removes only their Compose containers, and preserves volumes/networks', async () => {
    const broadcast = vi.fn()
    await expect(dockerBridge(ctx.core, broadcast).taskTeardown(task.id)).resolves.toEqual({ ok: true })
    expect(vi.mocked(docker).mock.calls.map(([args]) => args)).toEqual([
      ['ps', '-a', '--no-trunc', '--format', '{{json .}}'],
      ['stop', own.id], ['rm', own.id], ['stop', loose.id],
    ])
    expect(mocks.config).not.toHaveBeenCalled()
    expect(mocks.invalidate).toHaveBeenCalledWith('containers')
    expect(broadcast).toHaveBeenCalledWith({ channel: pluginChannel('docker', 'task-teardown'), taskId: task.id })
  })

  it('unpauses before stopping paused containers and removes already stopped Compose containers', async () => {
    vi.mocked(docker).mockImplementation(async (args) => args[0] === 'ps' ? ps([c('a', { state: 'paused' }), c('b', { state: 'exited' })]) : '')
    await dockerBridge(ctx.core).taskTeardown(task.id)
    expect(vi.mocked(docker).mock.calls.slice(1).map(([args]) => args)).toEqual([
      ['unpause', own.id], ['stop', own.id], ['rm', own.id], ['rm', foreign.id],
    ])
  })

  it('fails closed for a missing task root or invalid full ID', async () => {
    vi.mocked(ctx.core.tasks.load).mockResolvedValue({ ...task, worktreePath: null })
    expect(await dockerBridge(ctx.core).taskContainers(task.id)).toEqual([])
    await dockerBridge(ctx.core).taskTeardown(task.id)
    expect(vi.mocked(docker).mock.calls.map(([args]) => args[0])).toEqual(['ps'])
    vi.mocked(ctx.core.tasks.load).mockResolvedValue(task)
    vi.mocked(docker).mockResolvedValue(ps([c('a', { id: 'short-id' })]))
    await expect(dockerBridge(ctx.core).taskTeardown(task.id)).rejects.toMatchObject({ status: 422 })
    expect(vi.mocked(docker).mock.calls.every(([args]) => args[0] === 'ps')).toBe(true)
  })

  it('404s missing tasks before consulting the daemon', async () => {
    await expect(dockerBridge(ctx.core).taskTeardown('unknown')).rejects.toMatchObject({ status: 404 })
    expect(docker).not.toHaveBeenCalled()
  })

  it('rechecks daemon association instead of trusting the cached display snapshot', async () => {
    mocks.containers.mockResolvedValue([own])
    const bridge = dockerBridge(ctx.core)
    expect(await bridge.taskContainers(task.id)).toEqual([own])
    vi.mocked(docker).mockResolvedValue(ps([{ ...own, composeWorkingDir: '/foreign' }, unverified]))
    await bridge.taskTeardown(task.id)
    expect(vi.mocked(docker).mock.calls.map(([args]) => args[0])).toEqual(['ps'])
  })

  it('invalidates partial changes and propagates failure without claiming success or forcing removal', async () => {
    vi.mocked(docker).mockImplementation(async (args) => {
      if (args[0] === 'ps') return ps([own])
      if (args[0] === 'rm') throw new DockerCliError('failed', 'container is running', 1, 'container is running')
      return ''
    })
    const broadcast = vi.fn()
    await expect(dockerBridge(ctx.core, broadcast).taskTeardown(task.id)).rejects.toMatchObject({ status: 409 })
    expect(mocks.invalidate).toHaveBeenCalledWith('containers')
    expect(broadcast).not.toHaveBeenCalled()
    expect(vi.mocked(docker).mock.calls.at(-1)?.[0]).toEqual(['rm', own.id])
  })

  it('keeps explicit owner-wide Compose actions unchanged', async () => {
    await dockerBridge(ctx.core).composeAction('shared-project', 'down')
    expect(docker).toHaveBeenCalledWith(['compose', '-p', 'shared-project', 'down'], { timeout: 180_000 })
  })
})

describe('manual and archive cleanup entrypoints', () => {
  it('uses authoritative cleanup for the manual own-task route', async () => {
    setDockerBridge(dockerBridge(ctx.core))
    const app = new Hono<AppEnv>()
      .use('*', async (c, next) => { c.set('principal', { kind: 'internal', userId: 'synthetic', scope: 'task', taskId: task.id }); await next() })
      .route('/v1/p/docker', routes)
    expect((await app.fetch(new Request('http://synthetic/v1/p/docker/tasks/t1/teardown', { method: 'POST' }), ctx.env)).status).toBe(200)
    expect(vi.mocked(docker).mock.calls.slice(1).map(([args]) => args)).toEqual([['stop', own.id], ['rm', own.id], ['stop', loose.id]])
  })

  it('offers only associated resources, and registered automatic archive cleanup uses the same policy', async () => {
    const plugin = dockerPlugin()
    const registration = vi.spyOn(ctx.taskChecks, 'register')
    await plugin.init?.(ctx)
    expect(registration).toHaveBeenCalledOnce()
    const check = registration.mock.calls[0][0]
    expect(await check.check(task, new AbortController().signal)).toMatchObject({ details: [own.name, loose.name], message: "2 running containers are associated with this task's worktree" })
    await check.apply?.(task, new AbortController().signal)
    expect(vi.mocked(docker).mock.calls.slice(1).map(([args]) => args)).toEqual([['stop', own.id], ['rm', own.id], ['stop', loose.id]])
    await plugin.dispose?.()
  })

  it('offers no cleanup checkbox for heuristic-only or foreign resources', async () => {
    mocks.containers.mockResolvedValue([foreign, unverified])
    expect(await dockerArchiveConcern(dockerBridge(ctx.core), task)).toBeNull()
  })
})
