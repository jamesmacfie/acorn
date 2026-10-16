import { createMemo, createSignal } from 'solid-js'
import { createMutation, createQuery } from '@tanstack/solid-query'
import {
  integrationsOptions,
  learnRefPrefixes,
  openRefPanel,
  persistDraft,
  refResolutionsOptions,
  scanContentRefs,
  summarizeFileStats,
} from '@acorn/plugin-api/client'
import type { DiffDocumentTopology, DiffSegmentPayload, DiffSegmentRequest } from '@acorn/plugin-api/ui/diff'
import { branchReferenceCandidates } from '../model/branchReferences'
import { buildConversationEntries, reviewDecision } from '../model/conversation'
import type { ChangedFile, ChangeRequestDetail, Check, Label } from '../model/types'

// Everything one change request knows, read by every view that draws it. A code host builds one per
// change request from its own queries and mutations, in a reactive root it owns, and the views read
// only this (docs/plugins/change-request-ui.md).
//
// File selection is deliberately not here. In browse it is `?file=` and in a task pane it is the
// file-scroll event, so it belongs to whichever surface has a router rather than to the change request
// (`useChangedFiles`).

/** The code host drawing the views, in its own words. */
export type ChangeRequestHost = {
  /** The plugin's id. The overview's slot is `<pluginId>:summary-badges`. */
  pluginId: string
  /** The host's name, such as `GitHub`, for "Open on GitHub" and "Reconnect GitHub". */
  label: string
  /** What one is called, in lower case: `pull request`, `merge request`. */
  noun: string
  /** What goes before its number: `#`, `!`. */
  prefix: string
  /** A person's picture, or undefined to draw their initials. */
  avatar: (login: string | null | undefined) => string | undefined
  /** A failed write as a sentence. `code: 'reauth'` offers to reconnect the host. */
  describeFailure: (cause: unknown) => { text: string; code?: string }
}

/** Which change request, seen from where. `taskId` separates a task's review from the browse surface
 *  showing the same one. `owner` is the repository's namespace: a GitHub owner or a GitLab group path. */
export type ChangeRequestScope = {
  owner: string
  repo: string
  number: string
  taskId?: string
  /** A related change request the reader is only looking at: no merge, no comment, no label. */
  readOnly?: boolean
}

export type ReviewEvent = 'comment' | 'approve' | 'request-changes'

/** What the host can do to a change request. An absent verb hides its control. */
type ChangeRequestActions = {
  comment: (body: string) => Promise<unknown>
  review?: { events: readonly ReviewEvent[]; submit: (event: ReviewEvent, body: string) => Promise<unknown> }
  addLabel: (name: string) => Promise<unknown>
  removeLabel: (name: string) => Promise<unknown>
  requestReviewer: (login: string) => Promise<unknown>
  removeReviewer: (login: string) => Promise<unknown>
  setViewed?: (path: string, viewed: boolean) => Promise<unknown>
  /** `word` names a method in a sentence, such as "Enable auto-merge (squash)". */
  merge?: {
    methods: readonly { value: string; label: string; word: string }[]
    run: (method: string) => Promise<unknown>
  }
  autoMerge?: { enable: (method: string) => Promise<unknown>; disable: () => Promise<unknown> }
  setDraft?: (draft: boolean) => Promise<unknown>
  close: () => Promise<unknown>
  reopen: () => Promise<unknown>
  /** Re-run a failed check, addressed by its `runId`. */
  rerun?: (runId: number) => Promise<unknown>
}

export type ChangeRequestModelInput = {
  scope: ChangeRequestScope
  host: ChangeRequestHost
  /** Names the persisted comment drafts, unique across hosts, such as `owner/repo/7`. */
  draftKey: string
  detail: () => ChangeRequestDetail | undefined
  detailFailed: () => boolean
  files: () => ChangedFile[]
  filesLoading: () => boolean
  /** What to say when the host sent fewer files than the change request has. */
  filesWarning: () => string | null
  mentions: () => string[]
  mentionsLoading: () => boolean
  repoLabels: () => Label[]
  labelsLoading: () => boolean
  /** The diff document, for the conversation's code snippets. The host reads it once `want` is
   *  called, which happens when some thread has a line to quote. */
  diff: {
    data: () => { revision?: string | null; document: DiffDocumentTopology } | undefined
    want: () => void
    loadSegments: (requests: DiffSegmentRequest[], signal: AbortSignal) => Promise<DiffSegmentPayload[]>
  }
  /** The conflicting files, when the host can list them. */
  conflicts?: { files: () => { available: boolean; files: string[] } | undefined; loading: () => boolean }
  /** Re-read after a write lands. */
  refresh: () => void
  actions: ChangeRequestActions
}

export type ChangeRequestModel = ReturnType<typeof createChangeRequestModel>

export function createChangeRequestModel(input: ChangeRequestModelInput) {
  const { scope, host, actions } = input
  const readOnly = scope.readOnly === true
  const detail = () => input.detail()
  const request = () => detail()?.request ?? undefined

  const fileSummary = createMemo(() => summarizeFileStats(input.files()))
  const conversationEntries = createMemo(() => buildConversationEntries(detail()))

  // Linear tickets linked from the body, comments, reviews and threads. The host reads every
  // registered recogniser, so this finds any provider's URLs; it is narrowed to Linear because the
  // enrichment route and the chip downstream of it are Linear-only.
  const linearTextRefs = createMemo(() => {
    const data = detail()
    if (!data) return []
    const texts: (string | null | undefined)[] = [data.request?.body]
    for (const comment of data.comments) texts.push(comment.body)
    for (const review of data.reviews) texts.push(review.body)
    for (const thread of data.threads) for (const comment of thread.comments) texts.push(comment.body)
    return scanContentRefs(texts)
      .filter((ref) => ref.providerId === 'linear')
      .map((ref) => ({ ...ref, item: ref.item.toUpperCase() }))
  })
  const branchCandidates = createMemo(() => branchReferenceCandidates(request()?.headRef))
  const linearIdentifiers = createMemo(() => [
    ...new Set([...linearTextRefs().map((ref) => ref.item), ...branchCandidates()]),
  ])
  const integrations = createQuery(() => integrationsOptions(linearIdentifiers().length > 0))
  const linearConnected = () =>
    (integrations.data?.integrations ?? []).some(
      (entry) => entry.providerId === 'linear' && entry.status === 'connected',
    )
  // Enrichment through the host, addressed by provider
  // (docs/first-party-plugins.md § First-party for one specific reason). The connection check stays
  // because a 403 with no connection wastes a round trip when the "connect Linear" fallback is what
  // should render.
  const linearIssues = createQuery(() => refResolutionsOptions('linear', linearIdentifiers(), linearConnected()))
  const linearSummary = createMemo(() => new Map((linearIssues.data ?? []).map((issue) => [issue.identifier, issue])))
  const linearRefs = createMemo(() => {
    const refs = new Map(linearTextRefs().map((ref) => [ref.item, ref]))
    // Branch fragments have no provider or URL until Linear confirms them. Keep the query's inputs
    // independent of this result so a branch-only issue can trigger its own lookup.
    if (linearConnected()) {
      for (const identifier of branchCandidates()) {
        const issue = linearSummary().get(identifier)
        if (!issue?.url || refs.has(identifier)) continue
        refs.set(identifier, { providerId: 'linear', kind: 'linear.issue', item: identifier, url: issue.url })
      }
    }
    return [...refs.values()]
  })
  // `openRefPanel` refuses when Linear is not installed on this device, which is why nothing here
  // checks first.
  const showLinearIssue = (identifier: string): void =>
    void openRefPanel({ providerId: 'linear', displayId: identifier })

  // Which bare `CRA-404`-shaped tokens are safe to linkify here, and for whom. Learned from the refs
  // already confirmed in this change request by their full URLs, so the prefix is witnessed rather
  // than guessed.
  const refPrefixes = createMemo(() => learnRefPrefixes(linearTextRefs()))

  const assignedLabels = createMemo(() => new Set((detail()?.labels ?? []).map((label) => label.name.toLowerCase())))
  const requestedReviewers = createMemo(() => new Set(detail()?.reviewers ?? []))

  const labelResults = (query: string): Label[] => {
    const wanted = query.trim().toLowerCase()
    return input
      .repoLabels()
      .filter(
        (label) =>
          !assignedLabels().has(label.name.toLowerCase()) && (!wanted || label.name.toLowerCase().includes(wanted)),
      )
  }
  const reviewerResults = (query: string): string[] => {
    const wanted = query.trim().toLowerCase()
    return input
      .mentions()
      .filter((login) => !requestedReviewers().has(login) && (!wanted || login.toLowerCase().includes(wanted)))
  }

  const [actionFailed, setActionFailed] = createSignal<{ text: string; code?: string } | null>(null)
  const setActionError = (cause: unknown) => setActionFailed(host.describeFailure(cause))
  // Reports the failure and resolves, so a caller chaining `.then` is not left hanging. That is fine
  // for a fire-and-forget action and wrong for anything that clears the reader's text; see
  // `runThenClear`.
  const run = (work: Promise<unknown>) => work.then(input.refresh).catch(setActionError)
  const runThenClear = (work: Promise<unknown>, clear: () => void) =>
    work
      .then(() => {
        clear()
        return input.refresh()
      })
      .catch(setActionError)

  const [mergeMethod, setMergeMethod] = createSignal(actions.merge?.methods[0]?.value ?? '')
  const [draftText, setDraftText] = createSignal('')
  const [reviewBody, setReviewBody] = createSignal('')
  // In-progress comment and review text, per change request, so it survives navigation and a reload.
  const has = () => !!scope.owner && !!scope.repo && !!scope.number
  persistDraft(() => (has() ? `pr-comment:${input.draftKey}` : null), draftText, setDraftText)
  persistDraft(() => (has() ? `review-body:${input.draftKey}` : null), reviewBody, setReviewBody)

  // The description as plain text, handed up by the body that renders it, for the copy button in the
  // section's header.
  const [descriptionText, setDescriptionText] = createSignal('')

  const [openCheck, setOpenCheck] = createSignal<Check | null>(null)
  const [rerunned, setRerunned] = createSignal(new Set<number>())
  const triggerRerun = (runId: number) => {
    if (!actions.rerun) return
    setRerunned((current) => new Set([...current, runId]))
    actions
      .rerun(runId)
      .then(input.refresh)
      .catch((cause) => {
        setRerunned((current) => {
          const next = new Set(current)
          next.delete(runId)
          return next
        })
        setActionError(cause)
      })
  }

  const unsupported = () => Promise.reject(new Error(`${host.label} can't do that.`))
  const merge = createMutation(() => ({ mutationFn: () => actions.merge?.run(mergeMethod()) ?? unsupported() }))
  const autoMergeEnable = createMutation(() => ({
    mutationFn: () => actions.autoMerge?.enable(mergeMethod()) ?? unsupported(),
  }))
  const autoMergeDisable = createMutation(() => ({
    mutationFn: () => actions.autoMerge?.disable() ?? unsupported(),
  }))
  const close = createMutation(() => ({ mutationFn: actions.close }))
  const reopen = createMutation(() => ({ mutationFn: actions.reopen }))
  const draft = createMutation(() => ({
    mutationFn: (isDraft: boolean) => actions.setDraft?.(isDraft) ?? unsupported(),
  }))
  const comment = createMutation(() => ({ mutationFn: actions.comment }))
  const review = createMutation(() => ({
    mutationFn: ({ event, body }: { event: ReviewEvent; body: string }) =>
      actions.review?.submit(event, body) ?? unsupported(),
  }))

  const submitComment = () => {
    const body = draftText().trim()
    if (!body) return
    void runThenClear(comment.mutateAsync(body), () => setDraftText(''))
  }
  const submitReviewWith = (event: ReviewEvent) => {
    const body = reviewBody().trim()
    if ((event === 'request-changes' || event === 'comment') && !body) return
    void runThenClear(review.mutateAsync({ event, body }), () => setReviewBody(''))
  }

  return {
    scope,
    host,
    readOnly,
    actions,
    request,
    detailFailed: input.detailFailed,
    detail,
    diff: input.diff,
    labels: () => detail()?.labels ?? [],
    checks: () => detail()?.checks ?? [],
    reviewers: () => detail()?.reviewers ?? [],
    reviewDecision: createMemo(() => reviewDecision(detail()?.reviews ?? [])),
    files: input.files,
    filesWarning: input.filesWarning,
    filesLoading: input.filesLoading,
    fileSummary,
    conversationEntries,
    conflicting: () => request()?.conflicting === true,
    conflicts: () => input.conflicts?.files(),
    conflictsLoading: () => input.conflicts?.loading() ?? false,
    linearRefs,
    linearConnected,
    linearIssues,
    linearSummary,
    showLinearIssue,
    refPrefixes,
    mentions: input.mentions,
    mentionsLoading: input.mentionsLoading,
    labelsLoading: input.labelsLoading,
    labelResults,
    reviewerResults,
    actionError: () => actionFailed()?.text ?? '',
    /** The last failure was the host refusing the stored sign-in, so the way out is to reconnect. */
    actionNeedsReconnect: () => actionFailed()?.code === 'reauth',
    mergeMethod,
    setMergeMethod,
    draftText,
    setDraftText,
    reviewBody,
    setReviewBody,
    descriptionText,
    setDescriptionText,
    openCheck,
    setOpenCheck,
    rerunned,
    triggerRerun,
    run,
    refresh: input.refresh,
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
    addLabel: (name: string) => run(actions.addLabel(name)),
    removeLabel: (name: string) => run(actions.removeLabel(name)),
    requestReviewer: (login: string) => run(actions.requestReviewer(login)),
    removeReviewer: (login: string) => run(actions.removeReviewer(login)),
    setViewed: (path: string, viewed: boolean) =>
      actions.setViewed ? run(actions.setViewed(path, viewed)) : undefined,
  }
}
