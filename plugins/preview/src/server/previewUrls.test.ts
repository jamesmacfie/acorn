import { describe, expect, it, vi } from 'vitest'
import type { CoreServices } from '@acorn/plugin-api/node'
import { createPreviewUrlRuntime } from './previewUrls'

const task = { id: 'task-1', title: 'Preview', projectId: 'project-1', branch: 'feat/preview', worktreePath: '/repo', pullNumber: null, skipSetup: false }
const project = { id: 'project-1', name: 'Acorn', path: '/repo', workspaceId: 'workspace-1', github: { owner: 'acorn', name: 'app', repoId: 1 } }

const core = (previewMode: 'url' | 'port' | 'script' | null = 'url', previewValue: string | null = 'https://configured.example') => ({
  identity: { active: vi.fn(() => 'user-1') },
  tasks: {
    load: vi.fn(async (id: string) => id === task.id ? task : undefined),
    active: vi.fn(async () => [task, { ...task, id: 'task-2', projectId: 'project-2' }]),
    root: vi.fn(async () => '/repo'),
  },
  projects: {
    byId: vi.fn(async () => project),
    config: vi.fn(async () => ({ projectId: project.id, config: { previewMode, previewValue } })),
  },
  proc: {
    runProcess: vi.fn(async () => ({
      code: 0, signal: null, stdout: '\nhttps://script.example\n', stderr: '', timedOut: false,
      aborted: false, truncated: false, spawnError: null,
    })),
  },
}) as unknown as Pick<CoreServices, 'identity' | 'proc' | 'projects' | 'tasks'>

describe('preview URL runtime', () => {
  it('resolves recipe, run-target, and config sources in priority order and suppresses duplicates', async () => {
    const service = core()
    let runUrl: string | undefined
    const emit = vi.fn()
    const runtime = createPreviewUrlRuntime(service, () => ({ defaultUrl: async () => runUrl } as never), emit)

    await expect(runtime.forTask(task.id)).resolves.toEqual({ taskId: task.id, url: 'https://configured.example', source: 'config' })
    await runtime.refresh(task.id)
    expect(emit).not.toHaveBeenCalled()

    runUrl = 'http://localhost:4321'
    await runtime.refresh(task.id)
    expect(emit).toHaveBeenLastCalledWith({
      channel: 'plugin:preview:url-changed', taskId: task.id, url: runUrl, source: 'run-target',
    })
    await runtime.refresh(task.id)
    expect(emit).toHaveBeenCalledTimes(1)

    await runtime.selectRecipe(task.id, 'http://localhost:9000')
    expect(emit).toHaveBeenLastCalledWith({
      channel: 'plugin:preview:url-changed', taskId: task.id, url: 'http://localhost:9000', source: 'recipe',
    })
    await expect(runtime.forTask(task.id)).resolves.toMatchObject({ source: 'recipe' })
  })

  it('refreshes only active tasks in the changed project', async () => {
    const service = core('port', '4173')
    const emit = vi.fn()
    const runtime = createPreviewUrlRuntime(service, () => undefined, emit)
    await runtime.refreshProject(project.id)
    expect(emit).toHaveBeenCalledOnce()
    expect(emit).toHaveBeenCalledWith({
      channel: 'plugin:preview:url-changed', taskId: task.id, url: 'http://localhost:4173', source: 'config',
    })
  })

  it('announces when the resolved URL disappears so clients do not retain stale previews', async () => {
    const service = core(null, null)
    let runUrl: string | undefined = 'http://localhost:4321'
    const emit = vi.fn()
    const runtime = createPreviewUrlRuntime(service, () => ({ defaultUrl: async () => runUrl } as never), emit)
    await runtime.forTask(task.id)

    runUrl = undefined
    await runtime.refresh(task.id)

    expect(emit).toHaveBeenCalledWith({
      channel: 'plugin:preview:url-changed', taskId: task.id, url: null, source: null,
    })
  })

  it('reports which tasks have preview set up without resolving a URL', async () => {
    const service = core(null, null)
    let targets: { id: string; command: string; running: boolean; urlCommand?: string }[] = [{ id: 'web', command: 'pnpm dev', running: false }]
    const runtime = createPreviewUrlRuntime(service, () => ({ targets: async () => ({ targets, errors: [], layouts: [] }) } as never), vi.fn())
    await expect(runtime.configured()).resolves.toEqual({ 'task-1': false, 'task-2': false })

    // A URL the target discovers once it runs counts before it runs, so the pane is not tied to the
    // dev server being up.
    targets = [{ ...targets[0]!, urlCommand: 'echo http://localhost:3000' }]
    await expect(runtime.configured()).resolves.toEqual({ 'task-1': true, 'task-2': true })
    expect(service.proc.runProcess).not.toHaveBeenCalled()
  })

  it('counts project configuration and a picked recipe URL as set up', async () => {
    const runtime = createPreviewUrlRuntime(core('script', 'pnpm preview-url'), () => undefined, vi.fn())
    await expect(runtime.configured()).resolves.toEqual({ 'task-1': true, 'task-2': false })
    await runtime.selectRecipe('task-2', 'http://localhost:9000')
    await expect(runtime.configured()).resolves.toEqual({ 'task-1': true, 'task-2': true })
  })

  it('runs script configuration on the node with task identity and uses its last output line', async () => {
    const service = core('script', 'pnpm preview-url')
    const runtime = createPreviewUrlRuntime(service, () => undefined, vi.fn())
    await expect(runtime.forTask(task.id)).resolves.toEqual({
      taskId: task.id, url: 'https://script.example', source: 'script',
    })
    expect(service.proc.runProcess).toHaveBeenCalledWith(expect.objectContaining({
      file: '/bin/sh', args: ['-c', 'pnpm preview-url'], cwd: '/repo',
      env: expect.objectContaining({ ACORN_TASK_ID: task.id, ACORN_PROJECT_ID: project.id, ACORN_REPO: 'acorn/app' }),
      timeoutMs: 10_000,
    }))
  })
})

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

it('joins overlapping script readers but reruns after completion and keeps tasks independent', async () => {
  const service = core('script', 'synthetic')
  vi.mocked(service.tasks.load).mockImplementation(async (id) => ({ ...task, id }))
  const held = deferred<Awaited<ReturnType<typeof service.proc.runProcess>>>()
  vi.mocked(service.proc.runProcess).mockImplementation(() => held.promise)
  const runtime = createPreviewUrlRuntime(service, () => undefined, vi.fn())
  const readers = Array.from({ length: 8 }, () => runtime.forTask(task.id))
  const other = runtime.forTask('independent')
  await vi.waitFor(() => expect(service.proc.runProcess).toHaveBeenCalledTimes(2))
  held.resolve({ code: 0, stdout: 'http://localhost:3000' } as never)
  expect((await Promise.all(readers)).every((value) => value?.source === 'script')).toBe(true)
  expect(await other).toMatchObject({ taskId: 'independent' })
  await runtime.forTask(task.id)
  expect(service.proc.runProcess).toHaveBeenCalledTimes(3)
  runtime.dispose()
})

it.each(['recipe', 'project', 'run-target'] as const)('retires a held script on %s change and keeps replacement authority', async (change) => {
  const service = core('script', 'synthetic')
  const held = deferred<Awaited<ReturnType<typeof service.proc.runProcess>>>()
  vi.mocked(service.proc.runProcess).mockImplementationOnce(() => held.promise)
  const emit = vi.fn()
  let runUrl: string | undefined
  const runtime = createPreviewUrlRuntime(service, () => ({ defaultUrl: async () => runUrl } as never), emit)
  const stale = runtime.forTask(task.id)
  await vi.waitFor(() => expect(service.proc.runProcess).toHaveBeenCalledOnce())
  if (change === 'recipe') await runtime.selectRecipe(task.id, 'http://localhost:4000')
  if (change === 'project') {
    vi.mocked(service.projects.config).mockResolvedValue({ config: { previewMode: 'url', previewValue: 'http://localhost:4000' } } as never)
    await runtime.refreshProject(project.id)
  }
  if (change === 'run-target') {
    runUrl = 'http://localhost:4000'
    await runtime.refresh(task.id)
  }
  held.resolve({ code: 0, stdout: 'http://localhost:3000' } as never)
  expect(await stale).toBeNull()
  expect(emit).toHaveBeenCalledOnce()
  expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'http://localhost:4000' }))
  await runtime.refresh(task.id)
  expect(emit).toHaveBeenCalledOnce()
  runtime.dispose()
})

it('old completion cannot release a held replacement wave', async () => {
  const service = core('script', 'synthetic')
  const first = deferred<Awaited<ReturnType<typeof service.proc.runProcess>>>()
  const second = deferred<Awaited<ReturnType<typeof service.proc.runProcess>>>()
  vi.mocked(service.proc.runProcess).mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
  const runtime = createPreviewUrlRuntime(service, () => undefined, vi.fn())
  const stale = runtime.forTask(task.id)
  await vi.waitFor(() => expect(service.proc.runProcess).toHaveBeenCalledTimes(1))
  const replacement = runtime.refresh(task.id)
  await vi.waitFor(() => expect(service.proc.runProcess).toHaveBeenCalledTimes(2))
  first.resolve({ code: 0, stdout: 'http://localhost:3000' } as never)
  expect(await stale).toBeNull()
  const joined = runtime.forTask(task.id)
  second.resolve({ code: 0, stdout: 'http://localhost:4000' } as never)
  await replacement
  expect(await joined).toMatchObject({ url: 'http://localhost:4000' })
  expect(service.proc.runProcess).toHaveBeenCalledTimes(2)
  runtime.dispose()
})

it('disposal prevents late refresh events and refuses later script work', async () => {
  const service = core('script', 'synthetic')
  const held = deferred<Awaited<ReturnType<typeof service.proc.runProcess>>>()
  vi.mocked(service.proc.runProcess).mockImplementation(() => held.promise)
  const emit = vi.fn()
  const runtime = createPreviewUrlRuntime(service, () => undefined, emit)
  const pending = runtime.refresh(task.id)
  await vi.waitFor(() => expect(service.proc.runProcess).toHaveBeenCalledOnce())
  runtime.dispose()
  held.resolve({ code: 0, stdout: 'http://localhost:3000' } as never)
  await pending
  expect(await runtime.forTask(task.id)).toBeNull()
  await runtime.selectRecipe(task.id, 'http://localhost:4000')
  await runtime.refreshProject(project.id)
  expect(emit).not.toHaveBeenCalled()
  expect(service.proc.runProcess).toHaveBeenCalledOnce()
})

it('retires removed or archived tasks and forgets their recipe on restoration', async () => {
  const service = core()
  const runtime = createPreviewUrlRuntime(service, () => undefined, vi.fn())
  await runtime.selectRecipe(task.id, 'http://localhost:4000')
  vi.mocked(service.tasks.active).mockResolvedValue([])
  await runtime.refreshTasks(task.id)
  vi.mocked(service.tasks.active).mockResolvedValue([task] as never)
  await expect(runtime.forTask(task.id)).resolves.toMatchObject({ source: 'config' })
  runtime.dispose()
})

it.each([
  { code: 1 }, { code: 0, spawnError: 'failed' }, { code: 0, timedOut: true },
])('does not reuse failed or timed-out script results: %j', async (failure) => {
  const service = core('script', 'synthetic')
  vi.mocked(service.proc.runProcess).mockResolvedValueOnce({ stdout: 'http://localhost:3000', ...failure } as never)
  const runtime = createPreviewUrlRuntime(service, () => undefined, vi.fn())
  expect(await runtime.forTask(task.id)).toBeNull()
  expect(await runtime.forTask(task.id)).toMatchObject({ source: 'script' })
  runtime.dispose()
})

it('invalidates before a held project lookup and joins fresh readers without disturbing another project', async () => {
  const service = core('script', 'synthetic')
  vi.mocked(service.tasks.load).mockImplementation(async (id) => ({ ...task, id, projectId: id === 'other' ? 'other-project' : project.id }))
  const held = deferred<Awaited<ReturnType<typeof service.proc.runProcess>>>()
  vi.mocked(service.proc.runProcess).mockImplementation(() => held.promise)
  const runtime = createPreviewUrlRuntime(service, () => undefined, vi.fn())
  const first = runtime.forTask(task.id)
  const independent = runtime.forTask('other')
  await vi.waitFor(() => expect(service.proc.runProcess).toHaveBeenCalledTimes(2))
  const listing = deferred<Awaited<ReturnType<typeof service.tasks.active>>>()
  vi.mocked(service.tasks.active).mockImplementationOnce(() => listing.promise)
  const update = runtime.refreshProject(project.id)
  const fresh = runtime.forTask(task.id)
  await vi.waitFor(() => expect(service.proc.runProcess).toHaveBeenCalledTimes(3))
  listing.resolve([task] as never)
  await Promise.resolve()
  held.resolve({ code: 0, stdout: 'http://localhost:4000' } as never)
  expect(await first).toBeNull()
  expect(await independent).toMatchObject({ taskId: 'other', url: 'http://localhost:4000' })
  expect(await fresh).toMatchObject({ taskId: task.id, url: 'http://localhost:4000' })
  await update
  expect(service.proc.runProcess).toHaveBeenCalledTimes(3)
  runtime.dispose()
})

it('preserves run-target priority even when task metadata cannot be read', async () => {
  const service = core()
  vi.mocked(service.tasks.load).mockRejectedValue(new Error('task lookup unavailable'))
  const runtime = createPreviewUrlRuntime(service, () => ({ defaultUrl: async () => 'http://localhost:3000' } as never), vi.fn())
  expect(await runtime.forTask(task.id)).toMatchObject({ source: 'run-target', url: 'http://localhost:3000' })
  runtime.dispose()
})
