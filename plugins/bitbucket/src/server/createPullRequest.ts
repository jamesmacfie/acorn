import type { RouteResult } from '@acorn/plugin-api/node'
import { bbJson, repositoryPath, send, type BitbucketSession } from './bitbucketApi'

export type CreateInput = { title: string; body?: string; base?: string; head: string; draft?: boolean }

/**
 * Open a pull request from `head`, a branch in the repository itself. The destination is `base`, or the
 * repository's main branch when the caller names none.
 */
export async function createPullRequest(
  session: BitbucketSession,
  repository: { repo: string; defaultBranch: string | null },
  input: CreateInput,
): Promise<RouteResult<{ number: number }>> {
  const destination = input.base ?? repository.defaultBranch
  if (!destination)
    return {
      ok: false,
      failure: {
        error: 'no_default_branch',
        status: 404,
        detail: ['The repository has no main branch to merge into.'],
      },
    }
  const created = await bbJson<{ id: number }>(
    session,
    `${repositoryPath(repository.repo)}/pullrequests`,
    send('POST', {
      title: input.title,
      description: input.body ?? '',
      source: { branch: { name: input.head } },
      destination: { branch: { name: destination } },
      draft: input.draft === true,
      close_source_branch: false,
    }),
  )
  return created.ok ? { ok: true, value: { number: created.value.id } } : created
}
