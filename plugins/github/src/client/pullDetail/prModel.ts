import { createMemo, createRoot, createSignal } from 'solid-js'
import { createMutation, createQuery, useQueryClient } from '@tanstack/solid-query'
import {
  integrationsOptions, learnRefPrefixes, onScopeEvicted, openRefPanel, persistDraft,
  refResolutionsOptions, scanContentRefs, summarizeFileStats,
} from '@acorn/plugin-api/client'
import {
  fileSummariesOptions, mentionsOptions, pullConflictsOptions, pullDetailOptions, repoLabelsOptions,
} from '../queries'
import { pullPrefixKey, pullsPrefixKey, type Label } from '../../contract/api'
import {
  addComment, addLabel, closePr, disableAutoMerge, enableAutoMerge, mergePr, removeLabel,
  removeReviewer, reopenPr, requestReviewer, rerunFailed, setDraft, setViewed, submitReview,
} from '../mutations'
import { buildConversationEntries, buildThreadSnippetIndex } from './model'

// Everything one pull request knows, held once per pull and read by every surface that draws it
// (docs/github-integration.md, docs/panes.md § Layout model).
//
// Overview, the file list and the conversation are three components rather than one long closure, and
// browse and the PR pane draw them in different arrangements. They share fifteen queries, six
// mutations, two persisted drafts and one error line, so the shared thing lives in its own reactive
// root keyed by the pull, the same pattern the changes pane follows.
//
// File selection is deliberately not here. In browse it is `?file=` and in a task pane it is the
// file-scroll event, so it belongs to whichever surface has a router rather than to the pull
// (../changedFiles.ts).

/** Which pull request, seen from where. `taskId` separates a task's review from the browse surface
 *  showing the same pull, the same way the diff viewer's scope does. */
export type PrScope = {
  owner: string
  repo: string
  number: string
  taskId?: string
  /** A related pull the reader is only looking at: no merge, no comment, no label. */
  readOnly?: boolean
}

export type PrModel = ReturnType<typeof build>

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
  for (const [id, entry] of roots) if (id !== key) { entry.dispose(); roots.delete(id) }
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

function build(scope: PrScope) {
  const { owner, repo, number } = scope
  const readOnly = scope.readOnly === true
  const queryClient = useQueryClient()
  const has = () => !!owner && !!repo && !!number

  const detail = createQuery(() => pullDetailOptions(owner, repo, number, has()))
  const files = createQuery(() => fileSummariesOptions(owner, repo, number, has()))
  const mentionsQuery = createQuery(() => mentionsOptions(owner, repo, !!owner && !!repo))
  const repoLabels = createQuery(() => repoLabelsOptions(owner, repo, !!owner && !!repo))

  // GitHub only tells us *that* a pull conflicts (`mergeable === 'CONFLICTING'`); the conflicting
  // files are computed locally (see the pullConflicts route). Only fetch when it does.
  const conflicting = () => detail.data?.pull?.mergeable === 'CONFLICTING'
  const conflicts = createQuery(() =>
    pullConflictsOptions(owner, repo, number, detail.data?.pull?.baseRef ?? '', has() && conflicting()))

  const fileList = () => files.data ?? []
  const fileSummary = createMemo(() => summarizeFileStats(fileList()))
  const conversationEntries = createMemo(() => buildConversationEntries(detail.data))
  const threadSnippetIndex = createMemo(() => buildThreadSnippetIndex(fileList()))

  // Linear tickets linked from the pull's body, comments, reviews and threads. The host reads every
  // registered recogniser, so this finds any provider's URLs; it is narrowed to Linear because what
  // is downstream of it, the enrichment route and the chip, still is.
  const linearRefs = createMemo(() => {
    const data = detail.data
    if (!data) return []
    const texts: (string | null | undefined)[] = [data.pull?.body]
    for (const comment of data.comments) texts.push(comment.body)
    for (const review of data.reviews) texts.push(review.body)
    for (const thread of data.threads) for (const comment of thread.comments) texts.push(comment.body)
    return scanContentRefs(texts).filter((ref) => ref.providerId === 'linear')
  })
  const integrations = createQuery(() => integrationsOptions(linearRefs().length > 0))
  const linearConnected = () =>
    (integrations.data?.integrations ?? []).some((entry) => entry.providerId === 'linear' && entry.status === 'connected')
  // Enrichment through the host, addressed by provider (docs/first-party-plugins.md § github). The
  // connection check stays because a 403 with no connection wastes a round trip when the "connect
  // Linear" fallback is what should render.
  const linearIssues = createQuery(() =>
    refResolutionsOptions('linear', linearRefs().map((ref) => ref.item), linearConnected()))
  const linearSummary = createMemo(() => new Map((linearIssues.data ?? []).map((issue) => [issue.identifier, issue])))
  // `openRefPanel` refuses when Linear is not installed on this device, which is why nothing here
  // checks first.
  const showLinearIssue = (identifier: string): void => void openRefPanel({ providerId: 'linear', displayId: identifier })

  // Which bare `CRA-404`-shaped tokens are safe to linkify here, and for whom. Learned from the refs
  // already confirmed in this pull by their full URLs, so the prefix is witnessed rather than guessed.
  const refPrefixes = createMemo(() => learnRefPrefixes(linearRefs()))

  const assignedLabels = createMemo(() => new Set((detail.data?.labels ?? []).map((label) => label.name.toLowerCase())))
  const requestedReviewers = createMemo(() => new Set(detail.data?.requestedReviewers ?? []))
  const mentions = () => mentionsQuery.data ?? []

  const labelResults = (query: string): Label[] => {
    const wanted = query.trim().toLowerCase()
    return (repoLabels.data ?? []).filter((label) =>
      !assignedLabels().has(label.name.toLowerCase()) && (!wanted || label.name.toLowerCase().includes(wanted)))
  }
  const reviewerResults = (query: string): string[] => {
    const wanted = query.trim().toLowerCase()
    return mentions().filter((login) =>
      !requestedReviewers().has(login) && (!wanted || login.toLowerCase().includes(wanted)))
  }

  // Refetch the detail, and the open-PR list too: a state change drops a pull out of it.
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: pullPrefixKey(owner, repo) })
    queryClient.invalidateQueries({ queryKey: pullsPrefixKey(owner, repo) })
  }

  const [actionError, setActionError] = createSignal('')
  // Reports the failure and resolves, so a caller chaining `.then` is not left hanging. That is fine
  // for a fire-and-forget action and wrong for anything that clears the reader's text; see
  // `runThenClear`.
  const run = (work: Promise<unknown>) => work.then(refresh).catch((cause) => setActionError(message(cause)))
  const runThenClear = (work: Promise<unknown>, clear: () => void) =>
    work.then(() => {
      clear()
      return refresh()
    }).catch((cause: unknown) => setActionError(message(cause)))

  const [mergeMethod, setMergeMethod] = createSignal('squash')
  const [draftText, setDraftText] = createSignal('')
  const [reviewBody, setReviewBody] = createSignal('')
  // In-progress comment and review text, per pull, so it survives navigation and a reload.
  persistDraft(() => (has() ? `pr-comment:${owner}/${repo}/${number}` : null), draftText, setDraftText)
  persistDraft(() => (has() ? `review-body:${owner}/${repo}/${number}` : null), reviewBody, setReviewBody)

  const [openCheck, setOpenCheck] = createSignal<{ runId: number; name: string } | null>(null)
  const [rerunned, setRerunned] = createSignal(new Set<number>())
  const triggerRerun = (runId: number) => {
    setRerunned((current) => new Set([...current, runId]))
    rerunFailed(owner, repo, runId)
      .then(refresh)
      .catch((cause) => {
        setRerunned((current) => {
          const next = new Set(current)
          next.delete(runId)
          return next
        })
        setActionError(message(cause))
      })
  }

  const merge = createMutation(() => ({ mutationFn: () => mergePr(owner, repo, number, mergeMethod()) }))
  const autoMergeEnable = createMutation(() => ({ mutationFn: () => enableAutoMerge(owner, repo, number, mergeMethod()) }))
  const autoMergeDisable = createMutation(() => ({ mutationFn: () => disableAutoMerge(owner, repo, number) }))
  const close = createMutation(() => ({ mutationFn: () => closePr(owner, repo, number) }))
  const reopen = createMutation(() => ({ mutationFn: () => reopenPr(owner, repo, number) }))
  const draft = createMutation(() => ({ mutationFn: (isDraft: boolean) => setDraft(owner, repo, number, isDraft) }))
  const comment = createMutation(() => ({ mutationFn: (body: string) => addComment(owner, repo, number, body) }))
  const review = createMutation(() => ({
    mutationFn: ({ event, body }: { event: string; body: string }) => submitReview(owner, repo, number, event, body),
  }))

  const submitComment = () => {
    const body = draftText().trim()
    if (!body) return
    void runThenClear(comment.mutateAsync(body), () => setDraftText(''))
  }
  const submitReviewWith = (event: string) => {
    const body = reviewBody().trim()
    if ((event === 'REQUEST_CHANGES' || event === 'COMMENT') && !body) return
    void runThenClear(review.mutateAsync({ event, body }), () => setReviewBody(''))
  }

  return {
    scope,
    readOnly,
    has,
    detail,
    pull: () => detail.data?.pull,
    labels: () => detail.data?.labels ?? [],
    checks: () => detail.data?.checks ?? [],
    reviewers: () => detail.data?.requestedReviewers ?? [],
    files: fileList,
    filesLoading: () => files.isLoading,
    fileSummary,
    conversationEntries,
    threadSnippetIndex,
    conflicting,
    conflicts: () => conflicts.data,
    conflictsLoading: () => conflicts.isLoading,
    linearRefs,
    linearConnected,
    linearIssues,
    linearSummary,
    showLinearIssue,
    refPrefixes,
    mentions,
    mentionsLoading: () => mentionsQuery.isLoading,
    labelsLoading: () => repoLabels.isLoading,
    labelResults,
    reviewerResults,
    actionError,
    mergeMethod,
    setMergeMethod,
    draftText,
    setDraftText,
    reviewBody,
    setReviewBody,
    openCheck,
    setOpenCheck,
    rerunned,
    triggerRerun,
    run,
    refresh,
    merge,
    autoMergeEnable,
    autoMergeDisable,
    close,
    reopen,
    draft,
    comment,
    review,
    submitComment,
    submitReviewWith,
    addLabel: (name: string) => run(addLabel(owner, repo, number, name)),
    removeLabel: (name: string) => run(removeLabel(owner, repo, number, name)),
    requestReviewer: (login: string) => run(requestReviewer(owner, repo, number, login)),
    removeReviewer: (login: string) => run(removeReviewer(owner, repo, number, login)),
    setViewed: (path: string, viewed: boolean) => run(setViewed(owner, repo, number, path, viewed)),
  }
}

const message = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String((cause as { message?: unknown })?.message ?? cause)
