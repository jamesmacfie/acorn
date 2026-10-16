// Bitbucket's write verbs, through the broker. Each throws the route's error code, so a caller can
// branch on `reauth` and the rest.
import { postJson, writeJson } from '@acorn/plugin-api/client'
import type { ReviewEvent } from '@acorn/change-request-ui/views'
import { pullRequestRoute } from '../shared/api'

export const pullRequestWrites = (repository: string, number: string) => {
  const at = (child: string) => pullRequestRoute(repository, number, child)
  return {
    comment: (body: string) => postJson(at('comments'), { body }),
    review: (event: ReviewEvent, body: string) => postJson(at('review'), { event, body }),
    merge: (method: string) => postJson(at('merge'), { method }),
    close: () => postJson(at('close')),
    requestReviewer: (login: string) => postJson(at('reviewers'), { login }),
    removeReviewer: (login: string) =>
      writeJson(at('reviewers'), {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ login }),
      }),
    addLineComment: (body: string, file: string, oldLine: number | null, newLine: number | null) =>
      postJson(at('line-comments'), { body, path: file, oldLine, newLine }),
    reply: (commentId: number, body: string) => postJson(at(`comments/${commentId}/replies`), { body }),
    resolve: (threadId: string, resolved: boolean) => postJson(at(`threads/${threadId}/resolve`), { resolved }),
  }
}
