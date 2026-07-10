// Local-changes review over loopback HTTP (Phase 3): was `window.acorn.terminal.local`. Pure-Node
// on the server, so it works in a plain browser (dev:node) too.
import { localActionRoute, localBlobRoute, localChangesRoute, localDiffRoute } from '../../../core/shared/api'
import { readJson, writeJson } from '../../../core/client/apiClient'
import type { LocalChange } from '../../../core/shared/terminal'

type ActionResult = { ok: boolean; reason?: string }
const post = <T>(url: string, body?: unknown) =>
  writeJson<T>(url, { method: 'POST', headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

export const localGitApi = {
  changes: (taskId: string) => readJson<LocalChange[]>(localChangesRoute(taskId)),
  diff: (taskId: string, path: string, scope: 'unstaged' | 'staged') => readJson<{ patch: string } | { error: string }>(localDiffRoute(taskId, path, scope)),
  blob: (taskId: string, path: string, ref?: string) => readJson<{ text: string } | { error: string }>(localBlobRoute(taskId, path, ref)),
  stage: (taskId: string, path: string) => post<ActionResult>(localActionRoute(taskId, 'stage'), { path }),
  unstage: (taskId: string, path: string) => post<ActionResult>(localActionRoute(taskId, 'unstage'), { path }),
  discard: (taskId: string, path: string, untracked?: boolean) => post<ActionResult>(localActionRoute(taskId, 'discard'), { path, untracked }),
  commit: (taskId: string, message: string) => post<ActionResult>(localActionRoute(taskId, 'commit'), { message }),
  stageAll: (taskId: string) => post<ActionResult>(localActionRoute(taskId, 'stage-all')),
  unstageAll: (taskId: string) => post<ActionResult>(localActionRoute(taskId, 'unstage-all')),
  discardAll: (taskId: string) => post<ActionResult>(localActionRoute(taskId, 'discard-all')),
  push: (taskId: string) => post<ActionResult>(localActionRoute(taskId, 'push')),
}
