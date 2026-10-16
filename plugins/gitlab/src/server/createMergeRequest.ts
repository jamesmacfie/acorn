import type { RouteResult } from '@acorn/plugin-api/node'
import { glJson, projectRef, type GitlabSession } from './gitlabApi'

export type CreateInput = { title: string; body?: string; base?: string; head: string; draft?: boolean }

/**
 * Open a merge request from `head`. The target is `base`, or the project's default branch when the
 * caller names none. GitLab has no draft flag on create: a draft is a title that starts with `Draft:`.
 */
export async function createMergeRequest(
  session: GitlabSession,
  project: { path: string; defaultBranch: string | null },
  input: CreateInput,
): Promise<RouteResult<{ number: number }>> {
  const target = input.base ?? project.defaultBranch
  if (!target)
    return {
      ok: false,
      failure: {
        error: 'no_default_branch',
        status: 404,
        detail: ['The project has no default branch to merge into.'],
      },
    }
  const title = input.draft && !/^draft:/i.test(input.title) ? `Draft: ${input.title}` : input.title
  const created = await glJson<{ iid: number }>(session, `/projects/${projectRef(project.path)}/merge_requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source_branch: input.head,
      target_branch: target,
      title,
      description: input.body ?? '',
      remove_source_branch: false,
    }),
  })
  return created.ok ? { ok: true, value: { number: created.value.iid } } : created
}
