import type { Context } from 'hono'
import { type AppEnv, type PluginDatabase, respondError, type RouteFailure } from '@acorn/plugin-api/node'
import type { PatchBlobStore } from '@acorn/diff-document/store'
import { gitlabSession, type GitlabSession } from '../gitlabApi'
import { resolveProject } from '../mirror/projects'
import type { MirrorKey } from '../mirror/detail'
import type { GitlabServer, GitlabServers } from '../servers'

// What every `/projects/:host/:path` route starts from: the server `:host` names, the owner's
// credential on it, and the project `:path` names there. A route answers 401 `reauth` with no
// credential, so a disconnected server serves nothing from the mirror either.

export type ProjectRequest = {
  session: GitlabSession
  server: GitlabServer
  project: { connectionId: string; id: number; path: string }
  blobs: PatchBlobStore
}

export const fail = (c: Context<AppEnv>, failure: RouteFailure) =>
  respondError(c, failure.status, failure.error, failure.detail)

export async function projectRequest(
  c: Context<AppEnv>,
  db: PluginDatabase,
  servers: GitlabServers,
): Promise<{ ok: true; value: ProjectRequest } | { ok: false; response: Response }> {
  const server = servers.byHost(c.req.param('host') ?? '')
  const session = server && (await gitlabSession(c, server))
  if (!server || !session?.token) return { ok: false, response: respondError(c, 401, 'reauth') }
  const resolved = await resolveProject(session, db, server.connectionId, c.req.param('path') ?? '')
  if (!resolved.ok) return { ok: false, response: fail(c, resolved.failure) }
  return {
    ok: true,
    value: {
      session,
      server,
      project: { connectionId: server.connectionId, id: resolved.value.id, path: resolved.value.path },
      blobs: c.env.BLOBS,
    },
  }
}

/** The merge request `:number` names in the project, as the mirror keys it. */
export function mergeRequestKey(c: Context<AppEnv>, request: ProjectRequest): MirrorKey | null {
  const iid = Number(c.req.param('number'))
  if (!Number.isSafeInteger(iid) || iid <= 0) return null
  return { connectionId: request.server.connectionId, projectId: request.project.id, path: request.project.path, iid }
}
