// Local-changes review over loopback HTTP: was `window.acorn.terminal.local`. Pure-Node
// on the server, so it works in a plain browser (dev:node) too.
import {
  localActionRoute, localCommitMessageRoute, localDocumentRoute, localHeadCommitRoute, localModelBackendsRoute, localNewSideRoute,
  localSearchRoute, localSegmentsRoute, localStatusRoute, type CommitMessageRequest, type CommitOptions, type GeneratedCommitMessage,
  type HeadCommit, type LocalDocumentRequest, type LocalDocumentResponse, type LocalSearchRequest, type LocalSegmentsRequest,
  type PullOptions, type PushOptions,
} from '../shared/api'
import type { DiffSearchPage, DiffSegmentPayload } from '@acorn/plugin-api/ui/diff'
import type { ModelBackend } from '@acorn/protocol/modelProviders.ts'
import { readJson, writeJson } from '@acorn/plugin-api/client'
import type { LocalStatus } from '@acorn/protocol/localGit.ts'

type ActionResult = { ok: boolean; reason?: string }
const post = <T>(url: string, body?: unknown, signal?: AbortSignal) =>
  writeJson<T>(url, { method: 'POST', headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal })

export const localGitApi = {
  status: (taskId: string) => readJson<LocalStatus>(localStatusRoute(taskId)),
  // The stacked diff as a document, its segments, and its search pages (docs/diff-rendering/document.md § The
  // document).
  document: (taskId: string, request: LocalDocumentRequest, signal?: AbortSignal) => post<LocalDocumentResponse>(localDocumentRoute(taskId), request, signal),
  segments: (taskId: string, request: LocalSegmentsRequest, signal?: AbortSignal) => post<DiffSegmentPayload[]>(localSegmentsRoute(taskId), request, signal),
  search: (taskId: string, request: LocalSearchRequest, signal?: AbortSignal) => post<DiffSearchPage>(localSearchRoute(taskId), request, signal),
  newSide: (taskId: string, path: string, scope: 'unstaged' | 'staged') => readJson<{ text: string } | { error: string }>(localNewSideRoute(taskId, path, scope)),
  stage: (taskId: string, paths: string[]) => post<ActionResult>(localActionRoute(taskId, 'stage'), { paths }),
  unstage: (taskId: string, paths: string[]) => post<ActionResult>(localActionRoute(taskId, 'unstage'), { paths }),
  discard: (taskId: string, path: string, untracked?: boolean, oldPath?: string) => post<ActionResult>(localActionRoute(taskId, 'discard'), { path, untracked, oldPath }),
  headCommit: (taskId: string) => readJson<HeadCommit | null>(localHeadCommitRoute(taskId)),
  commit: (taskId: string, message: string, options: CommitOptions = {}) =>
    post<ActionResult>(localActionRoute(taskId, 'commit'), { message, ...options }),
  stageAll: (taskId: string) => post<ActionResult>(localActionRoute(taskId, 'stage-all')),
  unstageAll: (taskId: string) => post<ActionResult>(localActionRoute(taskId, 'unstage-all')),
  discardAll: (taskId: string) => post<ActionResult>(localActionRoute(taskId, 'discard-all')),
  // The four remote verbs. Pull and push send their body even when every flag is off, so the node's
  // zod schema is the one shape it ever parses; the other two carry none.
  fetch: (taskId: string) => post<ActionResult>(localActionRoute(taskId, 'fetch')),
  pull: (taskId: string, options: PullOptions = {}) => post<ActionResult>(localActionRoute(taskId, 'pull'), options),
  push: (taskId: string, options: PushOptions = {}) => post<ActionResult>(localActionRoute(taskId, 'push'), options),
  abort: (taskId: string) => post<ActionResult>(localActionRoute(taskId, 'abort')),
  // The wand's two calls. Neither answers `{ ok, reason }`: a refusal comes back as an error envelope
  // with a code the footer turns into a next step (./model.ts § generateReason), because "the provider
  // key was rejected" and "nothing is staged" need different sentences.
  modelBackends: (taskId: string) => readJson<ModelBackend[]>(localModelBackendsRoute(taskId)),
  commitMessage: (taskId: string, request: CommitMessageRequest) =>
    post<GeneratedCommitMessage>(localCommitMessageRoute(taskId), request),
}
