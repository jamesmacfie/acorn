import { createEffect, createMemo, createRoot, createSignal, onCleanup } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { onPluginFrame, onScopeEvicted } from '@acorn/plugin-api/client'
import {
  createChangeRequestModel,
  type ChangeRequestModel,
  type ChangeRequestScope,
} from '@acorn/change-request-ui/views'
import { diffKey, filesKey, pullRequestKey, pullRequestPrefixKey, pullRequestsPrefixKey } from '../../shared/api'
import { sameRepository } from '../../shared/pullRequestRef'
import { diffOptions, fetchDiffSegments, filesOptions, membersOptions, pullRequestOptions } from '../queries'
import { pullRequestWrites } from '../mutations'
import { BITBUCKET_MERGE_METHODS, bitbucketHost, rememberAvatars } from '../changeRequest'

// Everything one pull request knows, held once per pull request and read by every view that draws it:
// Bitbucket's queries and writes under the shared review model (docs/plugins/change-request-ui.md).
// One reactive root at a time, keyed by the pull request and where it is seen from.

const scopeKey = (scope: ChangeRequestScope) =>
  `${scope.taskId ?? ''}|${scope.owner}/${scope.repo}#${scope.number}|${scope.readOnly ? 'ro' : 'rw'}`

const roots = new Map<string, { model: ChangeRequestModel; dispose: () => void }>()

export function prModel(scope: ChangeRequestScope): ChangeRequestModel {
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
  const repository = `${scope.owner}/${scope.repo}`
  const number = scope.number
  const queryClient = useQueryClient()

  // The Node announces `pr-synced` when it replaces the mirror, which is how a stale read the route
  // answered first turns fresh here.
  const offSynced = onPluginFrame('bitbucket', 'plugin:bitbucket:pr-synced', (payload) => {
    const event = (payload ?? {}) as { repository?: unknown; number?: unknown }
    if (
      typeof event.repository !== 'string' ||
      event.number !== Number(number) ||
      !sameRepository(event.repository, repository)
    )
      return
    void queryClient.invalidateQueries({ queryKey: pullRequestKey(repository, number) })
    void queryClient.invalidateQueries({ queryKey: filesKey(repository, number) })
  })
  onCleanup(offSynced)

  const detail = createQuery(() => pullRequestOptions(repository, number, true))
  const files = createQuery(() => filesOptions(repository, number, true))
  const members = createQuery(() => membersOptions(repository, true))
  const [diffWanted, setDiffWanted] = createSignal(false)
  const diff = createQuery(() => diffOptions(repository, number, diffWanted()))
  createEffect(() => {
    if (detail.data) rememberAvatars(detail.data.avatars)
    rememberAvatars(Object.fromEntries((members.data ?? []).map((member) => [member.login, member.avatarUrl])))
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: pullRequestPrefixKey(repository) })
    void queryClient.invalidateQueries({ queryKey: pullRequestsPrefixKey(repository) })
    void queryClient.invalidateQueries({ queryKey: diffKey(repository, number) })
  }
  const writes = pullRequestWrites(repository, number)

  // Bitbucket has no labels, no draft toggle, and no way to reopen a declined pull request, so those
  // verbs are left out and the views draw no control for them.
  return createChangeRequestModel({
    scope,
    host: bitbucketHost,
    draftKey: `bitbucket:${repository}/${number}`,
    detail: () => detail.data,
    detailFailed: () => detail.isError,
    files: () => files.data?.files ?? [],
    filesLoading: () => files.isLoading,
    filesWarning: () => files.data?.warning ?? null,
    mentions: createMemo(() => (members.data ?? []).map((member) => member.login)),
    mentionsLoading: () => members.isLoading,
    repoLabels: () => [],
    labelsLoading: () => false,
    diff: {
      data: () => diff.data,
      want: () => setDiffWanted(true),
      loadSegments: (requests, signal) => fetchDiffSegments(repository, requests, signal),
    },
    refresh,
    actions: {
      comment: writes.comment,
      review: { events: ['comment', 'approve', 'request-changes'], submit: writes.review },
      requestReviewer: writes.requestReviewer,
      removeReviewer: writes.removeReviewer,
      merge: { methods: BITBUCKET_MERGE_METHODS, run: writes.merge },
      close: writes.close,
    },
  })
}
