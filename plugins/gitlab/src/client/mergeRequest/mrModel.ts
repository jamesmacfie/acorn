import { createEffect, createMemo, createRoot, createSignal, onCleanup } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { onPluginFrame, onScopeEvicted } from '@acorn/plugin-api/client'
import {
  createChangeRequestModel,
  type ChangeRequestModel,
  type ChangeRequestScope,
} from '@acorn/change-request-ui/views'
import { diffKey, filesKey, mergeRequestKey, mergeRequestPrefixKey, mergeRequestsPrefixKey } from '../../shared/api'
import { samePath } from '../../shared/mergeRequestRef'
import {
  diffOptions,
  fetchDiffSegments,
  filesOptions,
  labelsOptions,
  mergeRequestOptions,
  membersOptions,
} from '../queries'
import { mergeRequestWrites, retryJob } from '../mutations'
import { GITLAB_MERGE_METHODS, gitlabHost, rememberAvatars } from '../changeRequest'

// Everything one merge request knows, held once per merge request and read by every view that draws
// it: GitLab's queries and writes under the shared review model (docs/plugins/change-request-ui.md).
// One reactive root at a time, keyed by the merge request and where it is seen from.

const scopeKey = (scope: ChangeRequestScope) =>
  `${scope.taskId ?? ''}|${scope.owner}/${scope.repo}!${scope.number}|${scope.readOnly ? 'ro' : 'rw'}`

const roots = new Map<string, { model: ChangeRequestModel; dispose: () => void }>()

export function mrModel(scope: ChangeRequestScope): ChangeRequestModel {
  const key = scopeKey(scope)
  const held = roots.get(key)
  if (held) return held.model
  for (const [id, entry] of roots)
    if (id !== key) {
      entry.dispose()
      roots.delete(id)
    }
  const entry = createRoot((dispose) => ({ model: build(scope), dispose }))
  roots.set(key, entry)
  return entry.model
}

onScopeEvicted((event) => {
  if (event.scope !== 'task') return
  for (const [key, entry] of roots)
    if (key.startsWith(`${event.taskId}|`)) {
      entry.dispose()
      roots.delete(key)
    }
})

function build(scope: ChangeRequestScope) {
  const path = `${scope.owner}/${scope.repo}`
  const number = scope.number
  const queryClient = useQueryClient()

  // The Node announces `pr-synced` when it replaces the mirror, which is how a stale read the route
  // answered first turns fresh here.
  const offSynced = onPluginFrame('gitlab', 'plugin:gitlab:pr-synced', (payload) => {
    const event = (payload ?? {}) as { projectPath?: unknown; number?: unknown }
    if (typeof event.projectPath !== 'string' || event.number !== Number(number) || !samePath(event.projectPath, path))
      return
    void queryClient.invalidateQueries({ queryKey: mergeRequestKey(path, number) })
    void queryClient.invalidateQueries({ queryKey: filesKey(path, number) })
  })
  onCleanup(offSynced)

  const detail = createQuery(() => mergeRequestOptions(path, number, true))
  const files = createQuery(() => filesOptions(path, number, true))
  const members = createQuery(() => membersOptions(path, true))
  const labels = createQuery(() => labelsOptions(path, true))
  const [diffWanted, setDiffWanted] = createSignal(false)
  const diff = createQuery(() => diffOptions(path, number, diffWanted()))
  createEffect(() => {
    if (detail.data) rememberAvatars(detail.data.avatars)
    rememberAvatars(Object.fromEntries((members.data ?? []).map((member) => [member.login, member.avatarUrl])))
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: mergeRequestPrefixKey(path) })
    void queryClient.invalidateQueries({ queryKey: mergeRequestsPrefixKey(path) })
    void queryClient.invalidateQueries({ queryKey: diffKey(path, number) })
  }
  const writes = mergeRequestWrites(path, number)

  return createChangeRequestModel({
    scope,
    host: gitlabHost,
    draftKey: `gitlab:${path}/${number}`,
    detail: () => detail.data,
    detailFailed: () => detail.isError,
    files: () => files.data?.files ?? [],
    filesLoading: () => files.isLoading,
    filesWarning: () => files.data?.warning ?? null,
    mentions: createMemo(() => (members.data ?? []).map((member) => member.login)),
    mentionsLoading: () => members.isLoading,
    repoLabels: () => labels.data ?? [],
    labelsLoading: () => labels.isLoading,
    diff: {
      data: () => diff.data,
      want: () => setDiffWanted(true),
      loadSegments: (requests, signal) => fetchDiffSegments(path, requests, signal),
    },
    refresh,
    actions: {
      comment: writes.comment,
      // GitLab has approvals and no review summary, so Approve stands alone.
      review: { events: ['approve'], submit: () => writes.approve() },
      addLabel: writes.addLabel,
      removeLabel: writes.removeLabel,
      requestReviewer: writes.requestReviewer,
      removeReviewer: writes.removeReviewer,
      merge: { methods: GITLAB_MERGE_METHODS, run: writes.merge },
      setDraft: writes.setDraft,
      close: writes.close,
      reopen: writes.reopen,
      rerun: (jobId) => retryJob(path, jobId),
    },
  })
}
