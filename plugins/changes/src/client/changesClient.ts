// Local-changes review over loopback HTTP: was `window.acorn.terminal.local`. Pure-Node
// on the server, so it works in a plain browser (dev:node) too.
import {
  localActionRoute, localCommitMessageRoute, localDiffRoute, localHeadCommitRoute, localModelConnectionsRoute, localNewSideRoute,
  localStatusRoute, type CommitMessageRequest, type CommitOptions, type GeneratedCommitMessage, type HeadCommit, type PullOptions,
  type PushOptions,
} from '../shared/api'
import type { AvailableModelConnection } from '@acorn/protocol/modelProviders.ts'
import { readJson, writeJson } from '@acorn/plugin-api/client'
import type { LocalStatus } from '@acorn/protocol/terminal.ts'

type ActionResult = { ok: boolean; reason?: string }
const post = <T>(url: string, body?: unknown) =>
  writeJson<T>(url, { method: 'POST', headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

export const localGitApi = {
  status: (taskId: string) => readJson<LocalStatus>(localStatusRoute(taskId)),
  diff: (taskId: string, path: string, scope: 'unstaged' | 'staged') => readJson<{ patch: string } | { error: string }>(localDiffRoute(taskId, path, scope)),
  newSide: (taskId: string, path: string, scope: 'unstaged' | 'staged') => readJson<{ text: string } | { error: string }>(localNewSideRoute(taskId, path, scope)),
  stage: (taskId: string, paths: string[]) => post<ActionResult>(localActionRoute(taskId, 'stage'), { paths }),
  unstage: (taskId: string, paths: string[]) => post<ActionResult>(localActionRoute(taskId, 'unstage'), { paths }),
  discard: (taskId: string, path: string, untracked?: boolean) => post<ActionResult>(localActionRoute(taskId, 'discard'), { path, untracked }),
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
  modelConnections: (taskId: string) => readJson<AvailableModelConnection[]>(localModelConnectionsRoute(taskId)),
  commitMessage: (taskId: string, request: CommitMessageRequest) =>
    post<GeneratedCommitMessage>(localCommitMessageRoute(taskId), request),
}
