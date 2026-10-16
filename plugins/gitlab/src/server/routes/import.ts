import { isAbsolute, join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  type AppEnv,
  type CoreServices,
  ownerId,
  type PluginDatabase,
  requireDevice,
  respondError,
} from '@acorn/plugin-api/node'
import type { GitlabImportItem, GitlabImportResult } from '../../shared/api'
import { projects } from '../../node/schema'
import { GITLAB_ORIGIN } from '../config'
import { GITLAB_PROVIDER } from '../gitlabApi'

// Import mirrored projects as acorn projects: link a folder that already holds a clone, or clone into
// a parent folder. The shape of GitHub's importer (plugins/github/src/server/routes/repos/import.ts).

const item = z.discriminatedUnion('action', [
  z.object({ projectId: z.number().int().positive(), action: z.literal('map'), path: z.string().min(1) }),
  z.object({ projectId: z.number().int().positive(), action: z.literal('clone'), parentDir: z.string().min(1) }),
])
const body = z.object({ projects: z.array(item).min(1).max(100) })

const failed = (entry: GitlabImportItem, path: string, error: unknown): GitlabImportResult => ({
  projectId: entry.projectId,
  path,
  action: entry.action,
  ok: false,
  error: error instanceof Error ? error.message : String(error),
})

export const gitlabImport = (db: PluginDatabase, core: Pick<CoreServices, 'projects' | 'git'>) =>
  new Hono<AppEnv>().post('/', requireDevice, async (c) => {
    const userId = ownerId(c)
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
      const [project] = await db
        .select()
        .from(projects)
        .where(and(eq(projects.userId, userId), eq(projects.id, entry.projectId)))
      if (!project) {
        results.push(failed(entry, '', 'Project is not available in the GitLab mirror.'))
        continue
      }
      try {
        let path: string
        if (entry.action === 'map') {
          if (!isAbsolute(entry.path)) throw new Error('Checkout path must be absolute.')
          path = entry.path
        } else {
          if (!isAbsolute(entry.parentDir)) throw new Error('Clone parent directory must be absolute.')
          // The folder is the project's last path segment, as `git clone` would name it.
          const folder = project.path.split('/').pop()!
          await core.git.gitOrThrow(['clone', `${GITLAB_ORIGIN}/${project.path}.git`, folder], {
            cwd: entry.parentDir,
            env: { GIT_TERMINAL_PROMPT: '0' },
          })
          path = join(entry.parentDir, folder)
        }
        // Fills a project that names this repository and has no folder yet, rather than adding a rival.
        const placeholder = await core.projects.byRepository(GITLAB_PROVIDER, project.path.toLowerCase())
        const existingId = placeholder && placeholder.path === null ? placeholder.id : null
        const projectId = existingId ?? (await core.projects.create({ name: project.name, path })).id
        const stamped = await core.projects.update(projectId, { path, repositoryExternalId: String(project.id) })
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
