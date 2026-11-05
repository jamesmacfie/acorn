import { isAbsolute } from 'node:path'
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
import type { GithubImportItem, GithubImportResponse, GithubImportResult } from '../../../shared/api'
import { repos } from '../../../node/schema'

const actionSchema = z.discriminatedUnion('action', [
  z.object({ repoId: z.number().int().positive(), action: z.literal('map'), path: z.string().min(1) }),
  z.object({ repoId: z.number().int().positive(), action: z.literal('clone'), parentDir: z.string().min(1) }),
])

// Accept the named request shape used by the client and the bare-array shape used by early callers.
// Both normalize to one boundary contract before any repository work begins.
const requestSchema = z.union([
  z.object({ repositories: z.array(actionSchema).min(1).max(100) }),
  z.object({ items: z.array(actionSchema).min(1).max(100) }).transform(({ items }) => ({ repositories: items })),
  z
    .array(actionSchema)
    .min(1)
    .max(100)
    .transform((repositories) => ({ repositories })),
])

type ImportCore = Pick<CoreServices, 'projects'>

const MISSING_PROJECT = 'Project disappeared while importing.'

const failed = (item: GithubImportItem, owner: string, name: string, error: unknown): GithubImportResult => ({
  repoId: item.repoId,
  owner,
  name,
  action: item.action,
  ok: false,
  error: error instanceof Error ? error.message : String(error),
})

export const githubImport = (db: PluginDatabase, core: ImportCore) =>
  new Hono<AppEnv>().post('/import', requireDevice, async (c) => {
    const userId = ownerId(c)
    const parsed = requestSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success)
      return respondError(
        c,
        400,
        'bad_request',
        parsed.error.issues.map((issue) => issue.message),
      )

    const results: GithubImportResult[] = []
    for (const item of parsed.data.repositories) {
      const [repo] = await db
        .select({ id: repos.id, owner: repos.owner, name: repos.name })
        .from(repos)
        .where(and(eq(repos.userId, userId), eq(repos.id, item.repoId)))
      if (!repo) {
        results.push(failed(item, '', '', 'Repository is not available in the GitHub mirror.'))
        continue
      }

      try {
        // Fills a deferred project, which has a GitHub facet and no path yet, rather than adding a
        // rival row (docs/github-integration.md § Importing projects).
        const placeholder = await core.projects.byGithub(repo.owner, repo.name)
        const fillProjectId = placeholder && placeholder.path === null ? placeholder.id : undefined
        const imported = { repoId: repo.id, owner: repo.owner, name: repo.name, action: item.action, ok: true }

        if (item.action === 'clone') {
          // Core clones in the background and links the row when it has its folder
          // (docs/workspaces-and-tasks/clone-runs.md).
          const { cloneId } = await core.projects.clone({
            url: `https://github.com/${repo.owner}/${repo.name}.git`,
            parentDir: item.parentDir,
            name: repo.name,
            fillProjectId,
            fields: { githubRepoId: repo.id },
          })
          results.push({ ...imported, cloneId })
          continue
        }

        if (!isAbsolute(item.path)) throw new Error('Checkout path must be absolute.')
        const projectId = fillProjectId ?? (await core.projects.create({ name: repo.name, path: item.path })).id
        const stamped = await core.projects.update(projectId, { path: item.path, githubRepoId: repo.id })
        if (!stamped) throw new Error(MISSING_PROJECT)
        results.push({ ...imported, projectId: stamped.id })
      } catch (error) {
        results.push(failed(item, repo.owner, repo.name, error))
      }
    }

    return c.json({ results } satisfies GithubImportResponse)
  })
