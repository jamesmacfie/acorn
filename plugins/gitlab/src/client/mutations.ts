// GitLab's write verbs, through the broker. Each throws the route's error code, so a caller can branch
// on `reauth` and the rest.
import { postJson, writeJson } from '@acorn/plugin-api/client'
import { jobRetryRoute, mergeRequestRoute } from '../shared/api'

const remove = (route: string, body: unknown) =>
  writeJson(route, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export const mergeRequestWrites = (address: string, number: string) => {
  const at = (child: string) => mergeRequestRoute(address, number, child)
  return {
    comment: (body: string) => postJson(at('comments'), { body }),
    approve: () => postJson(at('approve')),
    merge: (method: string) => postJson(at('merge'), { method }),
    close: () => postJson(at('close')),
    reopen: () => postJson(at('reopen')),
    setDraft: (draft: boolean) => postJson(at('draft'), { draft }),
    addLabel: (name: string) => postJson(at('labels'), { name }),
    removeLabel: (name: string) => remove(at('labels'), { name }),
    requestReviewer: (login: string) => postJson(at('reviewers'), { login }),
    removeReviewer: (login: string) => remove(at('reviewers'), { login }),
    addNote: (body: string, file: string, oldLine: number | null, newLine: number | null) =>
      postJson(at('notes'), { body, path: file, oldLine, newLine }),
    reply: (noteId: number, body: string) => postJson(at(`notes/${noteId}/replies`), { body }),
    resolve: (discussionId: string, resolved: boolean) =>
      postJson(at(`discussions/${encodeURIComponent(discussionId)}/resolve`), { resolved }),
  }
}

export const retryJob = (address: string, jobId: number) => postJson(jobRetryRoute(address, jobId))
