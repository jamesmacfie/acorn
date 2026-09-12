import type { CoreServices } from '@acorn/plugin-api/node'
import type { TerminalRunTargets } from '@acorn/plugin-terminal/contract/runTargets.ts'
import type { PreviewUrlChangedEvent, PreviewUrlState } from '../contract/urls'

type PreviewCore = Pick<CoreServices, 'proc' | 'projects' | 'tasks'>
type Emit = (frame: { channel: 'plugin:preview:url-changed' } & PreviewUrlChangedEvent) => void

const validPortUrl = (value: string): string | null => {
  const port = Number(value)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? `http://localhost:${port}` : null
}

// Kept byte-identical with core's worktree slug. It is part of the task script environment, while
// importing the worktree helper would cross the plugin boundary this runtime exists to preserve.
const taskSlug = (branch: string): string => branch.replace(/[^A-Za-z0-9._-]/g, '-')

const scriptUrl = async (core: PreviewCore, taskId: string, script: string): Promise<string | null> => {
  const task = await core.tasks.load(taskId)
  if (!task) return null
  const project = await core.projects.byId(task.projectId)
  const cwd = await core.tasks.root(taskId)
  if (!project || !cwd) return null
  const result = await core.proc.runProcess({
    file: '/bin/sh',
    args: ['-c', script],
    cwd,
    env: {
      ACORN_TASK_ID: taskId,
      ACORN_WORKTREE_PATH: cwd,
      ACORN_PROJECT_ID: project.id,
      ACORN_PROJECT_NAME: project.name,
      ...(project.github ? { ACORN_REPO: `${project.github.owner}/${project.github.name}` } : {}),
      ...(task.branch ? { ACORN_BRANCH: task.branch, ACORN_TASK_SLUG: taskSlug(task.branch) } : {}),
      ACORN_TASK_TITLE: task.title,
    },
    timeoutMs: 10_000,
  })
  if (result.spawnError || result.timedOut || result.code !== 0) return null
  return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean).pop() ?? null
}

export type PreviewUrlRuntime = {
  forTask(taskId: string): Promise<PreviewUrlState | null>
  refresh(taskId: string): Promise<void>
  refreshProject(projectId: string): Promise<void>
  selectRecipe(taskId: string, url: string): Promise<void>
  dispose(): void
}

/**
 * Owns the preview resolution ladder on the node. Events are invalidations: callers always re-read
 * `forTask`, and the remembered value exists only to suppress duplicate announcements.
 */
export function createPreviewUrlRuntime(
  core: PreviewCore,
  runTargets: () => TerminalRunTargets | undefined,
  emit: Emit,
): PreviewUrlRuntime {
  const recipeUrls = new Map<string, string>()
  const observed = new Map<string, PreviewUrlState | null>()

  const resolve = async (taskId: string): Promise<PreviewUrlState | null> => {
    const recipe = recipeUrls.get(taskId)
    if (recipe) return { taskId, url: recipe, source: 'recipe' }

    const runUrl = (await runTargets()?.defaultUrl(taskId).catch(() => undefined))?.trim()
    if (runUrl) return { taskId, url: runUrl, source: 'run-target' }

    const task = await core.tasks.load(taskId)
    if (!task) return null
    const config = (await core.projects.config(task.projectId))?.config
    const value = config?.previewValue?.trim() ?? ''
    if (!value) return null
    if (config?.previewMode === 'url') return { taskId, url: value, source: 'config' }
    if (config?.previewMode === 'port') {
      const url = validPortUrl(value)
      return url ? { taskId, url, source: 'config' } : null
    }
    if (config?.previewMode === 'script') {
      const url = await scriptUrl(core, taskId, value)
      return url ? { taskId, url, source: 'script' } : null
    }
    return null
  }

  const forTask = async (taskId: string): Promise<PreviewUrlState | null> => {
    const state = await resolve(taskId)
    observed.set(taskId, state)
    return state
  }

  const refresh = async (taskId: string): Promise<void> => {
    const hadBefore = observed.has(taskId)
    const before = observed.get(taskId)
    const next = await resolve(taskId)
    observed.set(taskId, next)
    if (!hadBefore && !next) return
    if (before?.url === next?.url && before?.source === next?.source) return
    emit(next
      ? { channel: 'plugin:preview:url-changed', ...next }
      : { channel: 'plugin:preview:url-changed', taskId, url: null, source: null })
  }

  return {
    forTask,
    refresh,
    refreshProject: async (projectId) => {
      const tasks = await core.tasks.active()
      await Promise.all(tasks.filter((task) => task.projectId === projectId).map((task) => refresh(task.id)))
    },
    selectRecipe: async (taskId, url) => {
      const value = url.trim()
      if (!value || recipeUrls.get(taskId) === value) return
      recipeUrls.set(taskId, value)
      await refresh(taskId)
    },
    dispose: () => {
      recipeUrls.clear()
      observed.clear()
    },
  }
}
