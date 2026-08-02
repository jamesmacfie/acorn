import { postJson } from '../../../core/client/apiClient'
import { type LinearCommentRequest, linearCommentsRoute } from '@acorn/protocol/api.ts'

// Add a comment / threaded reply to a Linear ticket; caller refetches the issue after.
export const postLinearComment = (identifier: string, body: string, parentId?: string, connectionId?: string) =>
  postJson<{ ok: true }>(linearCommentsRoute(identifier, connectionId), { body, parentId } satisfies LinearCommentRequest)
