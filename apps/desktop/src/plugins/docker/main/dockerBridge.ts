// Main-process backing for the /api/docker routes (server/routes/docker.ts). Maps the CLI failure
// taxonomy onto BridgeError statuses: refs the daemon doesn't know → 404, state conflicts → 409,
// daemon down/CLI missing → 409 docker_unavailable (info() reports availability for UI gating),
// anything else → 422 with the stderr tail.
import { existsSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { BridgeError } from '../../../core/server/bridge'
import { schema, type AppDatabase } from '../../../core/server/db'
import type { DockerBridge } from '../server/routes/docker'
import type { DockerComposeAction, DockerContainerAction, DockerContainerSummary, DockerPruneKind, DockerTaskSummary } from '../shared/model'
import { docker, DockerCliError } from './cli'
import { loadDockerOverrides } from './dockerConfig'
import { containerMatchesTask } from './matcher'
import { parseInspectOutput } from './parse'
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

export function dockerBridge(db: AppDatabase): DockerBridge {
  const service = getDockerService()

  const activeTasks = () =>
    db.select({ id: schema.tasks.id, worktreePath: schema.tasks.worktreePath, branch: schema.tasks.branch })
      .from(schema.tasks)
      .where(eq(schema.tasks.status, 'active'))

  async function linkedContainers(taskId: string): Promise<DockerContainerSummary[]> {
    const [task] = await db.select({ worktreePath: schema.tasks.worktreePath, branch: schema.tasks.branch })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, taskId))
    if (!task) throw new BridgeError(404, 'task_not_found')
    const overrides = await loadDockerOverrides(task.worktreePath)
    return (await service.containers()).filter((c) => containerMatchesTask(c, task, overrides))
  }

  // Decorate summaries with the stale signal: the compose working_dir no longer exists on disk.
  // One existsSync per distinct dir per call — a handful of stats, not worth caching.
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
      const [tasks, cs] = await Promise.all([activeTasks(), service.containers()])
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
      // Compose projects get `compose -p <project> down` (compose reconstructs the project from
      // labels — no compose file needed, works even after the worktree is gone). Loose linked
      // containers are just stopped. Volumes are kept (no -v): stop reclaiming RAM, not data.
      const matched = await linkedContainers(taskId)
      const projects = [...new Set(matched.flatMap((c) => (c.composeProject ? [c.composeProject] : [])))]
      const loose = matched.filter((c) => !c.composeProject && isActive(c))
      for (const project of projects) await docker(['compose', '-p', project, 'down'], { timeout: 180_000 })
      for (const c of loose) await docker(['stop', c.id], { timeout: 60_000 })
      service.invalidate('containers')
      return { ok: true as const }
    }),
  }
}
