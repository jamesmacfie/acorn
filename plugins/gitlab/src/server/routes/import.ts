import { isAbsolute } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  type AppEnv,
  type CoreServices,
  type PluginDatabase,
  requireDevice,
  respondError,
} from '@acorn/plugin-api/node'
import type { GitlabImportItem, GitlabImportResult } from '../../shared/api'
import { projects } from '../../node/schema'
import { GITLAB_PROVIDER } from '../gitlabApi'
import type { GitlabServers } from '../servers'

// Import mirrored projects as acorn projects: link a folder that already holds a clone, or clone into
// a parent folder. The shape of GitHub's importer (plugins/github/src/server/routes/repos/import.ts).

// A namespace or project segment, which GitLab starts with a letter, digit, or underscore.
const GITLAB_PATH_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/

const host = z.string().min(1).max(253)
const item = z.discriminatedUnion('action', [
  z.object({ host, projectId: z.number().int().positive(), action: z.literal('map'), path: z.string().min(1) }),
  z.object({ host, projectId: z.number().int().positive(), action: z.literal('clone'), parentDir: z.string().min(1) }),
])
const body = z.object({ projects: z.array(item).min(1).max(100) })

const failed = (entry: GitlabImportItem, path: string, error: unknown): GitlabImportResult => ({
  projectId: entry.projectId,
  path,
  action: entry.action,
  ok: false,
  error: error instanceof Error ? error.message : String(error),
})

export const gitlabImport = (db: PluginDatabase, core: Pick<CoreServices, 'projects'>, servers: GitlabServers) =>
  new Hono<AppEnv>().post('/', requireDevice, async (c) => {
    const parsed = body.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success)
      return respondError(
        c,
        400,
        'bad_request',
        parsed.error.issues.map((issue) => issue.message),
      )

    const results: GitlabImportResult[] = []
    for (const entry of parsed.data.projects) {
      const server = servers.byHost(entry.host)
      const [project] = server
        ? await db
            .select()
            .from(projects)
            .where(and(eq(projects.connectionId, server.connectionId), eq(projects.id, entry.projectId)))
        : []
      if (!server || !project) {
        results.push(failed(entry, '', 'Project is not available in the GitLab mirror.'))
        continue
      }
      try {
        // Fills a project that names this repository and has no folder yet, rather than adding a rival.
        const placeholder = await core.projects.byRepository(GITLAB_PROVIDER, project.path.toLowerCase())
        const fillProjectId = placeholder && placeholder.path === null ? placeholder.id : undefined
        const repositoryExternalId = String(project.id)

        if (entry.action === 'clone') {
          // The path comes from the server, which may be any host a person typed, so it's held to
          // GitLab's own path grammar before it names a folder or reaches git's arguments.
          if (!project.path.split('/').every((segment) => GITLAB_PATH_SEGMENT.test(segment)))
            throw new Error(`GitLab sent a project path acorn won't clone into a folder: ${project.path}`)
          // Core clones in the background and links the row when it has its folder
          // (docs/workspaces-and-tasks/clone-runs.md). The folder is the project's last path segment,
          // as `git clone` would name it.
          const { cloneId } = await core.projects.clone({
            url: `${server.origin}/${project.path}.git`,
            parentDir: entry.parentDir,
            name: project.path.split('/').pop()!,
            fillProjectId,
            fields: { repositoryExternalId },
          })
          results.push({ projectId: project.id, path: project.path, action: entry.action, ok: true, cloneId })
          continue
        }

        if (!isAbsolute(entry.path)) throw new Error('Checkout path must be absolute.')
        const projectId = fillProjectId ?? (await core.projects.create({ name: project.name, path: entry.path })).id
        const stamped = await core.projects.update(projectId, { path: entry.path, repositoryExternalId })
        if (!stamped) throw new Error('Project disappeared while importing.')
        results.push({
          projectId: project.id,
          path: project.path,
          action: entry.action,
          ok: true,
          acornProjectId: stamped.id,
        })
      } catch (error) {
        results.push(failed(entry, project.path, error))
      }
    }
    return c.json({ results })
  })
