import { and, eq } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import { gh, ghError } from './githubApi'
import { pullsResource } from './resourceKeys'
import { repos, syncState } from '../node/schema'
import { repoMatches } from './repoMatch'
import { type GithubEmit, NO_EMIT } from './events'

export type CreatePullInput = {
  title: string
  body?: string
  base: string
  head: string
  draft?: boolean
}

export type CreatePullFailure = {
  status: 400 | 401 | 403 | 422 | 429 | 502
  error: string
  detail?: string[]
}

export type CreatePullResult =
  | { ok: true; number: number }
  | { ok: false; failure: CreatePullFailure }

// One GitHub write shared by the interactive route and the task-scoped agent tool. Keeping cache
// invalidation here matters: both writers must make the mirrored open list cold after GitHub accepts
// the PR, or one surface can create a pull the other does not see until the stale window expires.
export async function createPullRequest(
  token: string,
  db: PluginDatabase,
  userId: string,
  owner: string,
  repo: string,
  input: CreatePullInput,
  emit: GithubEmit = NO_EMIT,
): Promise<CreatePullResult> {
  if (!input.title.trim() || !input.base || !input.head)
    return { ok: false, failure: { status: 400, error: 'bad_request' } }

  const res = await gh(token, `/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: input.title.trim(),
      body: input.body ?? '',
      base: input.base,
      head: input.head,
      draft: !!input.draft,
    }),
  })
  if (res.status === 422) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; errors?: { message?: string }[] }
    const message = body.errors?.[0]?.message ?? body.message
    return {
      ok: false,
      failure: { status: 422, error: 'validation_failed', ...(message ? { detail: [message] } : {}) },
    }
  }
  const failure = ghError(res)
  if (failure) return { ok: false, failure }
  const created = (await res.json()) as { number: number }

  const [repoRow] = await db
    .select({ id: repos.id })
    .from(repos)
    .where(and(eq(repos.userId, userId), repoMatches(owner, repo)))
  if (repoRow) {
    await db
      .delete(syncState)
      .where(and(eq(syncState.userId, userId), eq(syncState.resource, pullsResource(repoRow.id, 'open'))))
  }
  emit('pulls-changed', { repoOwner: owner, repoName: repo })
  return { ok: true, number: created.number }
}
