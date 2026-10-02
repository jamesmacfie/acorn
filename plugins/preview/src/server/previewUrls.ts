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

const scriptUrl = async (core: PreviewCore, taskId: string, script: string, current: () => boolean): Promise<string | null> => {
  const task = await core.tasks.load(taskId)
  if (!task) return null
  const project = await core.projects.byId(task.projectId)
  const cwd = await core.tasks.root(taskId)
  if (!project || !cwd || !current()) return null
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
  configured(): Promise<Record<string, boolean>>
  refresh(taskId: string): Promise<void>
  refreshProject(projectId: string): Promise<void>
  refreshTasks(taskId: string | null): Promise<void>
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
  type Wave = { retired: boolean; projectId?: string; pending: Promise<PreviewUrlState | null> }
  const waves = new Map<string, Wave>()
  const authorities = new Map<string, Wave>()
  const taskProjects = new Map<string, string>()
  let disposed = false
  const taskSweeps = new Map<string | null, object>()

  const retire = (taskId: string): void => {
    const wave = authorities.get(taskId)
    if (wave) wave.retired = true
    waves.delete(taskId)
    authorities.delete(taskId)
  }

  const resolve = async (taskId: string, wave: Wave): Promise<PreviewUrlState | null> => {
    const recipe = recipeUrls.get(taskId)
    if (recipe) return { taskId, url: recipe, source: 'recipe' }

    const loaded = await core.tasks.load(taskId).then((task) => ({ task, error: undefined }), (error: unknown) => ({ task: undefined, error }))
    const task = loaded.task
    if (disposed || wave.retired) return null
    if (task) {
      wave.projectId = task.projectId
      taskProjects.set(taskId, task.projectId)
    }
    const runUrl = (await runTargets()?.defaultUrl(taskId).catch(() => undefined))?.trim()
    if (disposed || wave.retired) return null
    if (runUrl) return { taskId, url: runUrl, source: 'run-target' }

    if (loaded.error !== undefined) throw loaded.error
    if (!task) return null
    const config = (await core.projects.config(task.projectId))?.config
    if (disposed || wave.retired) return null
    const value = config?.previewValue?.trim() ?? ''
    if (!value) return null
    if (config?.previewMode === 'url') return { taskId, url: value, source: 'config' }
    if (config?.previewMode === 'port') {
      const url = validPortUrl(value)
      return url ? { taskId, url, source: 'config' } : null
    }
    if (config?.previewMode === 'script') {
      const url = await scriptUrl(core, taskId, value, () => !disposed && !wave.retired)
      return url ? { taskId, url, source: 'script' } : null
    }
    return null
  }

  // The same ladder as `resolve`, asking only whether each rung is filled in. It runs no script and
  // needs no dev server, because it decides whether the pane is offered at all: an answer that went
  // false while a dev server restarted would close the pane the reader was looking at.
  const configuredFor = async (taskId: string): Promise<boolean> => {
    if (recipeUrls.has(taskId)) return true
    const listed = await runTargets()?.targets(taskId).catch(() => undefined)
    if (listed && 'targets' in listed) {
      const target = listed.targets.find((t) => t.default) ?? listed.targets[0]
      if (target?.url || target?.urlCommand) return true
    }
    const task = await core.tasks.load(taskId)
    const config = task ? (await core.projects.config(task.projectId))?.config : undefined
    return !!config?.previewMode && !!config.previewValue?.trim()
  }

  const read = (taskId: string): Wave => {
    const joined = waves.get(taskId)
    if (joined) return joined
    const wave: Wave = { retired: disposed, projectId: taskProjects.get(taskId), pending: Promise.resolve(null) }
    const previous = authorities.get(taskId)
    if (previous) previous.retired = true
    authorities.set(taskId, wave)
    waves.set(taskId, wave)
    wave.pending = (disposed ? Promise.resolve(null) : resolve(taskId, wave)).then((state) => {
      // A retired caller receives null; it cannot treat its candidate as current authority.
      if (disposed || wave.retired) return null
      observed.set(taskId, state)
      return state
    }).finally(() => {
      if (waves.get(taskId) === wave) waves.delete(taskId)
    })
    return wave
  }

  const forTask = (taskId: string): Promise<PreviewUrlState | null> => disposed ? Promise.resolve(null) : read(taskId).pending

  const announce = async (taskId: string): Promise<void> => {
    if (disposed) return
    const hadBefore = observed.has(taskId)
    const before = observed.get(taskId)
    const wave = read(taskId)
    const next = await wave.pending
    if (disposed || wave.retired) return
    if (!hadBefore && !next) return
    if (before?.url === next?.url && before?.source === next?.source) return
    emit(next
      ? { channel: 'plugin:preview:url-changed', ...next }
      : { channel: 'plugin:preview:url-changed', taskId, url: null, source: null })
  }

  const refresh = (taskId: string): Promise<void> => {
    retire(taskId)
    return announce(taskId)
  }

  return {
    forTask,
    configured: async () => {
      if (disposed) return {}
      const tasks = await core.tasks.active()
      return Object.fromEntries(await Promise.all(tasks.map(async (task) => [task.id, await configuredFor(task.id)] as const)))
    },
    refresh,
    refreshProject: async (projectId) => {
      if (disposed) return
      // Retire before the active-task lookup yields. A wave without a project has not read
      // project configuration or run targets, so it still resolves through their fresh values.
      for (const [taskId, wave] of authorities) {
        if (wave.projectId === projectId) retire(taskId)
      }
      const tasks = await core.tasks.active()
      if (disposed) return
      await Promise.all(tasks.filter((task) => task.projectId === projectId).map((task) => announce(task.id)))
    },
    refreshTasks: async (taskId) => {
      if (disposed) return
      const sweep = {}
      taskSweeps.set(taskId, sweep)
      if (taskId !== null) retire(taskId)
      else for (const id of authorities.keys()) retire(id)
      const tasks = await core.tasks.active()
      if (disposed || taskSweeps.get(taskId) !== sweep) return
      taskSweeps.delete(taskId)
      const active = new Set(tasks.map((task) => task.id))
      for (const id of new Set([...recipeUrls.keys(), ...observed.keys(), ...taskProjects.keys(), ...authorities.keys()])) {
        if ((taskId !== null && id !== taskId) || active.has(id)) continue
        retire(id)
        recipeUrls.delete(id)
        observed.delete(id)
        taskProjects.delete(id)
      }
      await Promise.all(tasks.filter((task) => taskId === null || task.id === taskId).map((task) => announce(task.id)))
    },
    selectRecipe: async (taskId, url) => {
      const value = url.trim()
      if (disposed || !value || recipeUrls.get(taskId) === value) return
      recipeUrls.set(taskId, value)
      await refresh(taskId)
    },
    dispose: () => {
      disposed = true
      for (const id of authorities.keys()) retire(id)
      taskSweeps.clear()
      taskProjects.clear()
      recipeUrls.clear()
      observed.clear()
    },
  }
}
