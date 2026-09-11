import { describe, expect, it, vi } from 'vitest'
import type { CoreServices } from '@acorn/plugin-api/node'
import { createPreviewUrlRuntime } from './previewUrls'

const task = { id: 'task-1', title: 'Preview', projectId: 'project-1', branch: 'feat/preview', worktreePath: '/repo', pullNumber: null }
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
