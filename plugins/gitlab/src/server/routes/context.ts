import type { Context } from 'hono'
import { type AppEnv, ownerId, type PluginDatabase, respondError, type RouteFailure } from '@acorn/plugin-api/node'
import type { PatchBlobStore } from '@acorn/diff-document/store'
import { gitlabSession, type GitlabSession } from '../gitlabApi'
import { resolveProject } from '../mirror/projects'
import type { MirrorKey } from '../mirror/detail'

// What every `/projects/:path` route starts from: the owner, their GitLab credential, and the project
// the path names. A route answers 401 `reauth` with no credential, so a disconnected GitLab serves
// nothing from the mirror either.

export type ProjectRequest = {
  session: GitlabSession
  userId: string
  project: { userId: string; id: number; path: string }
  blobs: PatchBlobStore
}

export const fail = (c: Context<AppEnv>, failure: RouteFailure) =>
  respondError(c, failure.status, failure.error, failure.detail)

export async function projectRequest(
  c: Context<AppEnv>,
  db: PluginDatabase,
): Promise<{ ok: true; value: ProjectRequest } | { ok: false; response: Response }> {
  const session = await gitlabSession(c)
  if (!session.token) return { ok: false, response: respondError(c, 401, 'reauth') }
  const userId = ownerId(c)
  const resolved = await resolveProject(session, db, userId, c.req.param('path') ?? '')
  if (!resolved.ok) return { ok: false, response: fail(c, resolved.failure) }
  return {
    ok: true,
    value: {
      session,
      userId,
      project: { userId, id: resolved.value.id, path: resolved.value.path },
      blobs: c.env.BLOBS,
    },
  }
}

/** The merge request `:number` names in the project, as the mirror keys it. */
export function mergeRequestKey(c: Context<AppEnv>, request: ProjectRequest): MirrorKey | null {
  const iid = Number(c.req.param('number'))
  if (!Number.isSafeInteger(iid) || iid <= 0) return null
  return { userId: request.userId, projectId: request.project.id, path: request.project.path, iid }
}
