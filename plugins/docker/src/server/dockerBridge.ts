// Main-process backing for the /v1/p/docker routes (server/routes/docker.ts). Maps the CLI failure
// taxonomy onto BridgeError statuses: refs the daemon doesn't know → 404, state conflicts → 409,
// daemon down/CLI missing → 409 docker_unavailable (info() reports availability for UI gating),
// anything else → 422 with the stderr tail.
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
import { existsSync } from 'node:fs'
import { BridgeError, type CoreServices } from '@acorn/plugin-api/node'
import type { DockerBridge } from '../server/routes/docker'
import type { WsServerFrame } from '@acorn/protocol/ws.ts'
import type { DockerComposeAction, DockerContainerAction, DockerContainerSummary, DockerPruneKind, DockerTaskSummary } from '../shared/model'
import { docker, DockerCliError } from './cli'
import { loadDockerLayers, loadDockerOverrides } from './dockerConfig'
import { containerBelongsToTask, containerMatchesTask } from './matcher'
import { parseInspectOutput, parsePsOutput } from './parse'
import { getDockerService } from './dockerService'

function toBridgeError(err: unknown): never {
  if (err instanceof DockerCliError) {
    if (err.kind === 'not_installed' || err.kind === 'daemon_down') throw new BridgeError(409, 'docker_unavailable')
    if (/no such (container|image|volume|network|object)/i.test(err.stderr)) throw new BridgeError(404, 'docker_not_found')
    if (/(conflict|in use|is running|paused|not paused|already)/i.test(err.stderr)) throw new BridgeError(409, err.message || 'docker_conflict')
    throw new BridgeError(422, err.message || 'docker_failed')
  }
  throw err
}

const run = async <T>(fn: () => Promise<T>): Promise<T> => fn().catch(toBridgeError)

const isActive = (c: DockerContainerSummary): boolean => c.state === 'running' || c.state === 'paused' || c.state === 'restarting'

// `tasks` and `projects` are core tables and this plugin owns none, so its task reads, one id and the
// whole active set for the rail badge, and the one project read for its settings tab come through the
// core services rather than a db handle (docs/data-layer.md § Plugin databases).
export type DockerCoreServices = Pick<CoreServices, 'tasks' | 'projects'>

export function dockerBridge(core: DockerCoreServices, broadcast?: (frame: WsServerFrame) => void): DockerBridge {
  const service = getDockerService(broadcast)

  async function linkedContainers(taskId: string): Promise<DockerContainerSummary[]> {
    const task = await core.tasks.load(taskId)
    if (!task) throw new BridgeError(404, 'task_not_found')
    return (await service.containers()).filter((c) => containerBelongsToTask(c, task))
  }

  // Decorate summaries with the stale signal: the compose working_dir no longer exists on disk. One
  // existsSync per distinct dir per call, a handful of stats, not worth caching.
  function withStale(cs: DockerContainerSummary[]): DockerContainerSummary[] {
    const missing = new Map<string, boolean>()
    return cs.map((c) => {
      if (!c.composeWorkingDir) return c
      let gone = missing.get(c.composeWorkingDir)
      if (gone === undefined) {
        gone = !existsSync(c.composeWorkingDir)
        missing.set(c.composeWorkingDir, gone)
      }
      return { ...c, workingDirMissing: gone }
    })
  }

  return {
    info: () => service.info(),
    containers: () => run(async () => withStale(await service.containers())),
    inspectContainer: (ref) => run(async () => {
      const detail = parseInspectOutput(await docker(['inspect', ref]))
      if (!detail) throw new BridgeError(404, 'docker_not_found')
      return detail
    }),
    containerAction: (ref, action: DockerContainerAction) => run(async () => {
      await docker([action, ref], { timeout: 60_000 })
      service.invalidate('containers')
      return { ok: true as const }
    }),
    removeContainer: (ref, force) => run(async () => {
      await docker(force ? ['rm', '-f', ref] : ['rm', ref], { timeout: 60_000 })
      service.invalidate('containers')
      return { ok: true as const }
    }),
    images: () => run(() => service.images()),
    removeImage: (ref, force) => run(async () => {
      await docker(force ? ['rmi', '-f', ref] : ['rmi', ref], { timeout: 60_000 })
      service.invalidate('images')
      return { ok: true as const }
    }),
    volumes: () => run(() => service.volumes()),
    removeVolume: (name, force) => run(async () => {
      await docker(force ? ['volume', 'rm', '-f', name] : ['volume', 'rm', name], { timeout: 60_000 })
      service.invalidate('volumes')
      return { ok: true as const }
    }),
    networks: () => run(() => service.networks()),
    removeNetwork: (ref) => run(async () => {
      await docker(['network', 'rm', ref], { timeout: 60_000 })
      service.invalidate('networks')
      return { ok: true as const }
    }),
    prune: (kind: DockerPruneKind) => run(async () => {
      const args = kind === 'builder' ? ['builder', 'prune', '-f'] : [kind.replace(/s$/, ''), 'prune', '-f']
      const out = await docker(args, { timeout: 300_000 })
      service.invalidate(kind === 'builder' ? 'images' : kind)
      const reclaimed = /total reclaimed space:\s*(.+)/i.exec(out)?.[1]?.trim() ?? '0B'
      return { reclaimed }
    }),
    composeAction: (project, action: DockerComposeAction) => run(async () => {
      await docker(['compose', '-p', project, action], { timeout: 180_000 })
      service.invalidate('containers')
      return { ok: true as const }
    }),
    taskSummary: () => run(async () => {
      const [tasks, cs] = await Promise.all([core.tasks.active(), service.containers()])
      const out: DockerTaskSummary[] = []
      for (const task of tasks) {
        const overrides = await loadDockerOverrides(task.worktreePath) // 30s-cached per path
        const matched = cs.filter((c) => containerMatchesTask(c, task, overrides))
        if (!matched.length) continue
        out.push({
          taskId: task.id,
          running: matched.filter(isActive).length,
          total: matched.length,
          projects: [...new Set(matched.flatMap((c) => (c.composeProject ? [c.composeProject] : [])))],
        })
      }
      return out
    }),
    taskContainers: (taskId) => run(() => linkedContainers(taskId)),
    taskTeardown: (taskId) => run(async () => {
      const task = await core.tasks.load(taskId)
      if (!task) throw new BridgeError(404, 'task_not_found')
      // Refresh full immutable IDs for mutations; cached display IDs and project names are not
      // action scope. A shared Compose project name cannot widen this task's cleanup to other roots.
      const matched = parsePsOutput(await docker(['ps', '-a', '--no-trunc', '--format', '{{json .}}']))
        .filter((c) => containerBelongsToTask(c, task))
      if (matched.some((c) => !/^[a-f0-9]{64}$/.test(c.id))) throw new BridgeError(422, 'docker_invalid_container_id')
      try {
        for (const c of matched) {
          if (c.state === 'paused') await docker(['unpause', c.id], { timeout: 60_000 })
          if (isActive(c)) await docker(['stop', c.id], { timeout: 60_000 })
          // Retain old Compose removal / loose-container stop semantics without deleting shared
          // networks or volumes (-v). Never force-remove a container restarted during cleanup.
          if (c.composeProject) await docker(['rm', c.id], { timeout: 60_000 })
        }
      } finally {
        service.invalidate('containers')
      }
      // Anyone holding state keyed to these containers (a port manager, a preview) wants this.
      broadcast?.({ channel: pluginChannel('docker', 'task-teardown'), taskId })
      return { ok: true as const }
    }),
    // The project's own checkout, not a task's worktree: the settings page describes the project, and
    // a worktree's copy of the file is the branch's business.
    projectMatcher: async (projectId) => {
      const project = await core.projects.byId(projectId)
      if (!project) throw new BridgeError(404, 'project_not_found')
      return loadDockerLayers(project.path)
    },
  }
}
