import { isAbsolute, join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { type AppEnv, type CoreServices, ownerId, type PluginDatabase, respondError } from '@acorn/plugin-api/node'
import type { GithubImportItem, GithubImportResponse, GithubImportResult } from '../../contract/api'
import { repos } from '../../node/schema'

const actionSchema = z.discriminatedUnion('action', [
  z.object({ repoId: z.number().int().positive(), action: z.literal('map'), path: z.string().min(1) }),
  z.object({ repoId: z.number().int().positive(), action: z.literal('clone'), parentDir: z.string().min(1) }),
])

// Accept the named request shape used by the client and the bare-array shape used by early callers.
// Both normalize to one boundary contract before any repository work begins.
const requestSchema = z.union([
  z.object({ repositories: z.array(actionSchema).min(1).max(100) }),
  z.object({ items: z.array(actionSchema).min(1).max(100) }).transform(({ items }) => ({ repositories: items })),
  z.array(actionSchema).min(1).max(100).transform((repositories) => ({ repositories })),
])

type ImportCore = Pick<CoreServices, 'projects' | 'git'>

const MISSING_PROJECT = 'Project disappeared while importing.'

const failed = (item: GithubImportItem, owner: string, name: string, error: unknown): GithubImportResult => ({
  repoId: item.repoId,
  owner,
  name,
  action: item.action,
  ok: false,
  error: error instanceof Error ? error.message : String(error),
})

export const githubImport = (db: PluginDatabase, core: ImportCore) => new Hono<AppEnv>()
  .post('/import', async (c) => {
    const userId = ownerId(c)
    const parsed = requestSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request', parsed.error.issues.map((issue) => issue.message))

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
        let path: string
        if (item.action === 'map') {
          if (!isAbsolute(item.path)) throw new Error('Checkout path must be absolute.')
          path = item.path
        } else {
          if (!isAbsolute(item.parentDir)) throw new Error('Clone parent directory must be absolute.')
          await core.git.gitOrThrow(
            ['clone', `https://github.com/${repo.owner}/${repo.name}.git`, repo.name],
            { cwd: item.parentDir, env: { GIT_TERMINAL_PROMPT: '0' } },
          )
          path = join(item.parentDir, repo.name)
        }

        // A path-less project for this repository is a placeholder left by an older import, not a
        // second checkout — fill it in rather than adding a rival row. A project that already HAS a
        // path is a real checkout, and two clones of one repository are legal (schema.ts: the
        // projects_github_idx is deliberately non-unique), so that case still creates a new project.
        const placeholder = await core.projects.byGithub(repo.owner, repo.name)
        const existingId = placeholder && placeholder.path === null ? placeholder.id : null
        const projectId = existingId ?? (await core.projects.create({ name: repo.name, path })).id
        const stamped = await core.projects.update(projectId, { path, githubRepoId: repo.id })
        if (!stamped) throw new Error(MISSING_PROJECT)

        results.push({ repoId: repo.id, owner: repo.owner, name: repo.name, action: item.action, ok: true, projectId: stamped.id })
      } catch (error) {
        results.push(failed(item, repo.owner, repo.name, error))
      }
    }

    return c.json({ results } satisfies GithubImportResponse)
  })
