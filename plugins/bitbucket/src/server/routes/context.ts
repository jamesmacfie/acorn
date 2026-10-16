import type { Context } from 'hono'
import { type AppEnv, type PluginDatabase, respondError, type RouteFailure } from '@acorn/plugin-api/node'
import type { PatchBlobStore } from '@acorn/diff-document/store'
import { bitbucketSession, type BitbucketSession } from '../bitbucketApi'
import { resolveRepository } from '../mirror/repositories'
import type { MirrorKey } from '../mirror/detail'
import type { BitbucketAccount } from '../account'

// What every `/repositories/:workspace/:repo` route starts from: the owner's credential and the
// repository the two segments name. A route answers 401 `reauth` with no credential, so a disconnected
// account serves nothing from the mirror either.

export type RepositoryRequest = {
  session: BitbucketSession
  connectionId: string
  repository: { repo: string; path: string; defaultBranch: string | null }
  blobs: PatchBlobStore
}

export const fail = (c: Context<AppEnv>, failure: RouteFailure) =>
  respondError(c, failure.status, failure.error, failure.detail)

export async function repositoryRequest(
  c: Context<AppEnv>,
  db: PluginDatabase,
  account: BitbucketAccount,
): Promise<{ ok: true; value: RepositoryRequest } | { ok: false; response: Response }> {
  const connectionId = account.connectionId()
  const session = connectionId ? await bitbucketSession(c, connectionId) : null
  if (!connectionId || !session?.auth) return { ok: false, response: respondError(c, 401, 'reauth') }
  const resolved = await resolveRepository(
    session,
    db,
    connectionId,
    `${c.req.param('workspace')}/${c.req.param('repo')}`,
  )
  if (!resolved.ok) return { ok: false, response: fail(c, resolved.failure) }
  return { ok: true, value: { session, connectionId, repository: resolved.value, blobs: c.env.BLOBS } }
}

/** The pull request `:number` names in the repository, as the mirror keys it. */
export function pullRequestKey(c: Context<AppEnv>, request: RepositoryRequest): MirrorKey | null {
  const number = Number(c.req.param('number'))
  if (!Number.isSafeInteger(number) || number <= 0) return null
  return { connectionId: request.connectionId, repository: request.repository.repo, number }
}
