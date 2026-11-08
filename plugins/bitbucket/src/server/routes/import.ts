import { isAbsolute } from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  type AppEnv,
  type CoreServices,
  type PluginDatabase,
  requireDevice,
  respondError,
} from '@acorn/plugin-api/node'
import { isValidRepositoryPath } from '@acorn/protocol/branch.ts'
import type { BitbucketImportItem, BitbucketImportResult } from '../../shared/api'
import { BITBUCKET_HOST } from '../../shared/pullRequestRef'
import { BITBUCKET_PROVIDER } from '../bitbucketApi'
import { mirroredRepository } from '../mirror/repositories'
import type { BitbucketAccount } from '../account'

// Import mirrored repositories as acorn projects: link a folder that already holds a clone, or clone
// into a parent folder. The shape of GitHub's importer (plugins/github/src/server/routes/repos/import.ts).

const repository = z.string().min(3).max(255)
const item = z.discriminatedUnion('action', [
  z.object({ repository, action: z.literal('map'), path: z.string().min(1) }),
  z.object({ repository, action: z.literal('clone'), parentDir: z.string().min(1) }),
])
const body = z.object({ repositories: z.array(item).min(1).max(100) })

const failed = (entry: BitbucketImportItem, error: unknown): BitbucketImportResult => ({
  repository: entry.repository,
  action: entry.action,
  ok: false,
  error: error instanceof Error ? error.message : String(error),
})

export const bitbucketImport = (db: PluginDatabase, core: Pick<CoreServices, 'projects'>, account: BitbucketAccount) =>
  new Hono<AppEnv>().post('/', requireDevice, async (c) => {
    const parsed = body.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success)
      return respondError(
        c,
        400,
        'bad_request',
        parsed.error.issues.map((issue) => issue.message),
      )

    const connectionId = account.connectionId()
    const results: BitbucketImportResult[] = []
    for (const entry of parsed.data.repositories) {
      const found = connectionId ? await mirroredRepository(db, connectionId, entry.repository) : null
      if (!found) {
        results.push(failed(entry, 'Repository is not available in the Bitbucket mirror.'))
        continue
      }
      try {
        // Fills a project that names this repository and has no folder yet, rather than adding a rival.
        const placeholder = await core.projects.byRepository(BITBUCKET_PROVIDER, found.repo)
        const fillProjectId = placeholder && placeholder.path === null ? placeholder.id : undefined

        if (entry.action === 'clone') {
          // The full name names a folder and reaches git's arguments, so it's held to the repository
          // path grammar first.
          if (!isValidRepositoryPath(found.repo))
            throw new Error(`Bitbucket sent a repository name acorn won't clone into a folder: ${found.path}`)
          // Core clones in the background and links the row when it has its folder
          // (docs/workspaces-and-tasks/clone-runs.md). The folder is the repository's slug, as
          // `git clone` would name it.
          const { cloneId } = await core.projects.clone({
            url: `https://${BITBUCKET_HOST}/${found.repo}.git`,
            parentDir: entry.parentDir,
            name: found.repo.split('/').pop()!,
            fillProjectId,
          })
          results.push({ repository: found.repo, action: entry.action, ok: true, cloneId })
          continue
        }

        if (!isAbsolute(entry.path)) throw new Error('Checkout path must be absolute.')
        const projectId = fillProjectId ?? (await core.projects.create({ name: found.name, path: entry.path })).id
        const stamped = await core.projects.update(projectId, { path: entry.path })
        if (!stamped) throw new Error('Project disappeared while importing.')
        results.push({ repository: found.repo, action: entry.action, ok: true, acornProjectId: stamped.id })
      } catch (error) {
        results.push(failed(entry, error))
      }
    }
    return c.json({ results })
  })
