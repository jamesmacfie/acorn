import { createMemo, createRoot, createSignal, onCleanup } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { onPluginFrame, onScopeEvicted } from '@acorn/plugin-api/client'
import {
  createChangeRequestModel,
  type ChangeRequestModel,
  type ChangeRequestScope,
} from '@acorn/change-request-ui/views'
import {
  fetchDiffSegments,
  fileSummariesOptions,
  mentionsOptions,
  pullConflictsOptions,
  pullDetailOptions,
  pullDiffOptions,
  repoLabelsOptions,
} from '../queries'
import { pullKey, pullDiffKey, fileSummariesKey, pullPrefixKey, pullsPrefixKey } from '../../shared/api'
import {
  addComment,
  addLabel,
  closePr,
  disableAutoMerge,
  enableAutoMerge,
  mergePr,
  removeLabel,
  removeReviewer,
  reopenPr,
  requestReviewer,
  rerunFailed,
  setDraft,
  setViewed,
  submitReview,
} from '../mutations'
import { GITHUB_MERGE_METHODS, githubHost, toChangeRequestDetail } from '../changeRequest'
import { incompleteFilesMessage } from '../completeness'

// Everything one pull request knows, held once per pull and read by every surface that draws it
// (docs/github-integration.md, docs/panes/layout.md § Layout model). The views and the model they read
// are the shared review package's; this is GitHub's half of it: the queries, the writes, and the
// `pr-synced` edge that re-reads them.
//
// Overview, the file list and the conversation share queries, mutations, persisted drafts and one
// error line, so the shared thing lives in its own reactive root keyed by the pull, the same pattern
// the changes pane follows.

/** Which pull request, seen from where. `taskId` separates a task's review from the browse surface
 *  showing the same pull, the same way the diff viewer's scope does. */
export type PrScope = ChangeRequestScope

export type PrModel = ChangeRequestModel

const scopeKey = (scope: PrScope): string =>
  `${scope.taskId ?? ''}|${scope.owner}/${scope.repo}#${scope.number}|${scope.readOnly ? 'ro' : 'rw'}`

const roots = new Map<string, { model: PrModel; dispose: () => void }>()

/** The model for one pull request, built on first ask and held until another one is asked for. One at
 *  a time: the reader is looking at one pull, and every query behind this is in the shared cache
 *  anyway, so a second root would buy nothing and keep a stale subscription alive. */
export function prModel(scope: PrScope): PrModel {
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
  for (const [key, entry] of roots) {
    if (!key.startsWith(`${event.taskId}|`)) continue
    entry.dispose()
    roots.delete(key)
  }
})

/** Test seam. The map is module-level, so a suite must not inherit the previous one's model. */
export function _resetPrModels(): void {
  for (const entry of roots.values()) entry.dispose()
  roots.clear()
}

const REVIEW_EVENTS = { comment: 'COMMENT', approve: 'APPROVE', 'request-changes': 'REQUEST_CHANGES' } as const

function build(scope: PrScope) {
  const { owner, repo, number } = scope
  const queryClient = useQueryClient()
  const has = () => !!owner && !!repo && !!number

  // A stale route response starts a background mirror refresh and returns before that refresh lands.
  // Its provider-rendered HTML can contain GitHub image URLs whose signatures have already expired,
  // so the `pr-synced` edge is part of the read contract: re-read the exact active detail after the
  // node replaces its mirror. Subscribe before createQuery starts the request so a fast refresh cannot
  // announce between the stale response and this listener being attached.
  const offPrSynced = onPluginFrame('github', 'plugin:github:pr-synced', (payload) => {
    if (!payload || typeof payload !== 'object') return
    const event = payload as { repoOwner?: unknown; repoName?: unknown; pullNumber?: unknown }
    if (
      typeof event.repoOwner !== 'string' ||
      typeof event.repoName !== 'string' ||
      typeof event.pullNumber !== 'number'
    )
      return
    if (event.pullNumber !== Number(number)) return
    if (event.repoOwner.toLowerCase() !== owner.toLowerCase() || event.repoName.toLowerCase() !== repo.toLowerCase())
      return
    void queryClient.invalidateQueries({ queryKey: pullKey(owner, repo, number) })
    void queryClient.invalidateQueries({ queryKey: fileSummariesKey(owner, repo, number) })
    void queryClient.invalidateQueries({ queryKey: pullDiffKey(owner, repo, number) })
  })
  onCleanup(offPrSynced)

  const detail = createQuery(() => pullDetailOptions(owner, repo, number, has()))
  const files = createQuery(() => fileSummariesOptions(owner, repo, number, has()))
  const mentions = createQuery(() => mentionsOptions(owner, repo, !!owner && !!repo))
  const repoLabels = createQuery(() => repoLabelsOptions(owner, repo, !!owner && !!repo))
  const [diffWanted, setDiffWanted] = createSignal(false)
  const diff = createQuery(() => pullDiffOptions(owner, repo, number, diffWanted()))
  const neutral = createMemo(() => (detail.data ? toChangeRequestDetail(detail.data) : undefined))

  // GitHub only tells us *that* a pull conflicts (`mergeable === 'CONFLICTING'`); the conflicting
  // files are computed locally (see the pullConflicts route). Only fetch when it does.
  const conflicting = () => detail.data?.pull?.mergeable === 'CONFLICTING'
  const conflicts = createQuery(() =>
    pullConflictsOptions(owner, repo, number, detail.data?.pull?.baseRef ?? '', has() && conflicting()),
  )

  // Refetch the detail, and the open-PR list too: a state change drops a pull out of it.
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: pullPrefixKey(owner, repo) })
    queryClient.invalidateQueries({ queryKey: pullsPrefixKey(owner, repo) })
  }

  return createChangeRequestModel({
    scope,
    host: githubHost,
    draftKey: `${owner}/${repo}/${number}`,
    detail: neutral,
    detailFailed: () => detail.isError,
    files: () => files.data?.files ?? [],
    filesLoading: () => files.isLoading,
    filesWarning: () => incompleteFilesMessage(files.data?.completeness),
    mentions: () => mentions.data ?? [],
    mentionsLoading: () => mentions.isLoading,
    repoLabels: () =>
      (repoLabels.data ?? []).map((label) => ({ name: label.name, color: label.color ? `#${label.color}` : null })),
    labelsLoading: () => repoLabels.isLoading,
    diff: {
      data: () => diff.data,
      want: () => setDiffWanted(true),
      loadSegments: (requests, signal) => fetchDiffSegments(owner, repo, requests, signal),
    },
    conflicts: { files: () => conflicts.data, loading: () => conflicts.isLoading },
    refresh,
    actions: {
      comment: (body) => addComment(owner, repo, number, body),
      review: {
        events: ['comment', 'approve', 'request-changes'],
        submit: (event, body) => submitReview(owner, repo, number, REVIEW_EVENTS[event], body),
      },
      addLabel: (name) => addLabel(owner, repo, number, name),
      removeLabel: (name) => removeLabel(owner, repo, number, name),
      requestReviewer: (login) => requestReviewer(owner, repo, number, login),
      removeReviewer: (login) => removeReviewer(owner, repo, number, login),
      setViewed: (path, viewed) => setViewed(owner, repo, number, path, viewed),
      merge: { methods: GITHUB_MERGE_METHODS, run: (method) => mergePr(owner, repo, number, method) },
      autoMerge: {
        enable: (method) => enableAutoMerge(owner, repo, number, method),
        disable: () => disableAutoMerge(owner, repo, number),
      },
      setDraft: (isDraft) => setDraft(owner, repo, number, isDraft),
      close: () => closePr(owner, repo, number),
      reopen: () => reopenPr(owner, repo, number),
      rerun: (runId) => rerunFailed(owner, repo, runId),
    },
  })
}
