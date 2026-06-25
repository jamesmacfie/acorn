import { createMemo, createSignal, For, Show } from 'solid-js'
import { createMutation, createQuery, useQueryClient } from '@tanstack/solid-query'
import { useParams, useSearchParams } from '@solidjs/router'
import { fileStatusMeta, formatRelativeTime, summarizeFileStats } from './displayMeta'
import { requestFileScroll, routeKey } from './fileNavigation'
import Picker from './Picker'
import { fileSummariesOptions, mentionsOptions, pullDetailOptions, pullPrefixKey, pullsPrefixKey, repoLabelsOptions, reposOptions, type Label } from './queries'
import MentionTextarea from './MentionTextarea'
import { addComment, addLabel, closePr, mergePr, removeLabel, reopenPr, rerunFailed, setDraft, setViewed, submitReview } from './mutations'
import { UserAvatar } from './UserAvatar'
import { ConversationEntryItem } from './features/pullDetail/Conversation'
import { buildConversationEntries, buildThreadSnippetIndex } from './features/pullDetail/model'

// Conclusions that count as a failed check → eligible for "Rerun failed jobs".
const FAILED_STATUSES = new Set(['failure', 'error', 'cancelled', 'timed_out'])
const labelColor = (color: string | null | undefined) => (color ? `#${color}` : 'var(--text-faint)')

// Mid (Navigator) pane: PR header + description + changed-files + checks + conversation.
// Bodies are GitHub-sanitized bodyHTML, rendered via innerHTML (docs/ui-style.md §5).
export default function PullDetail() {
  const params = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const qc = useQueryClient()
  const repos = createQuery(() => reposOptions(true))
  const repoKnown = () => !!repos.data?.some((r) => r.owner === params.owner && r.name === params.repo)
  const o = () => params.owner ?? ''
  const r = () => params.repo ?? ''
  const n = () => params.number ?? ''
  const hasRepoParams = () => !!params.owner && !!params.repo
  const hasPullParams = () => hasRepoParams() && !!params.number
  const detail = createQuery(() => pullDetailOptions(o(), r(), n(), hasPullParams()))
  const files = createQuery(() => fileSummariesOptions(o(), r(), n(), hasPullParams()))
  const mentionsQuery = createQuery(() => mentionsOptions(o(), r(), hasRepoParams()))
  const repoLabels = createQuery(() => repoLabelsOptions(o(), r(), hasRepoParams()))
  const mentionsList = () => mentionsQuery.data ?? []
  const fileSummary = createMemo(() => summarizeFileStats(files.data))
  const conversationEntries = createMemo(() => buildConversationEntries(detail.data))
  const threadSnippetIndex = createMemo(() => buildThreadSnippetIndex(files.data))
  const assignedLabelNames = createMemo(() => new Set((detail.data?.labels ?? []).map((label) => label.name.toLowerCase())))
  const labelResults = (query: string): Label[] => {
    const q = query.trim().toLowerCase()
    return (repoLabels.data ?? []).filter((label) => !assignedLabelNames().has(label.name.toLowerCase()) && (!q || label.name.toLowerCase().includes(q)))
  }

  // Refetch detail (and the open-PR list, since state changes drop a PR from it) after a mutation.
  const refresh = () => {
    qc.invalidateQueries({ queryKey: pullPrefixKey(o(), r()) })
    qc.invalidateQueries({ queryKey: pullsPrefixKey(o(), r()) })
  }

  const [mergeMethod, setMergeMethod] = createSignal('squash')
  const [draftText, setDraftText] = createSignal('')
  const [reviewBody, setReviewBody] = createSignal('')
  const [actionError, setActionError] = createSignal('')
  const run = (p: Promise<unknown>) => p.then(refresh).catch((e) => setActionError(String(e.message ?? e)))

  const [rerunned, setRerunned] = createSignal(new Set<number>())
  const triggerRerun = (runId: number) => {
    setRerunned((s) => new Set([...s, runId]))
    rerunFailed(o(), r(), runId)
      .then(refresh)
      .catch((e) => {
        setRerunned((s) => { const n = new Set(s); n.delete(runId); return n })
        setActionError(String((e as Error).message ?? e))
      })
  }

  const merge = createMutation(() => ({ mutationFn: () => mergePr(o(), r(), n(), mergeMethod()) }))
  const close = createMutation(() => ({ mutationFn: () => closePr(o(), r(), n()) }))
  const reopen = createMutation(() => ({ mutationFn: () => reopenPr(o(), r(), n()) }))
  const draft = createMutation(() => ({ mutationFn: (d: boolean) => setDraft(o(), r(), n(), d) }))
  const comment = createMutation(() => ({ mutationFn: (body: string) => addComment(o(), r(), n(), body) }))
  const review = createMutation(() => ({
    mutationFn: ({ event, body }: { event: string; body: string }) => submitReview(o(), r(), n(), event, body),
  }))
  const submitReviewWith = (event: string) => {
    const body = reviewBody().trim()
    if ((event === 'REQUEST_CHANGES' || event === 'COMMENT') && !body) return
    run(review.mutateAsync({ event, body })).then(() => setReviewBody(''))
  }

  const submitComment = () => {
    const body = draftText().trim()
    if (!body) return
    run(comment.mutateAsync(body)).then(() => setDraftText(''))
  }
  const chooseLabel = (label: Label) => run(addLabel(o(), r(), n(), label.name))
  const selectFile = (path: string) => {
    setSearchParams({ file: path })
    requestFileScroll({ routeKey: routeKey(o(), r(), n()), path })
  }

  return (
    <Show when={params.number} fallback={<p class="placeholder">Select a PR.</p>}>
      <Show when={repoKnown() || !repos.data} fallback={<p class="placeholder">Not found.</p>}>
      <Show when={detail.data?.pull} fallback={<p class="placeholder">{detail.isError ? 'Not found.' : 'Loading…'}</p>}>
        {(pull) => (
          <>
            <div class="pr-detail-header">
              <div class="pr-detail-title">
                <span class="pr-num">#{pull().number}</span> {pull().title}
              </div>
              <div class="pr-detail-meta muted">
                <span class={`state-badge state-${pull().state}`}>{pull().draft ? 'draft' : pull().state}</span>
                <Show when={pull().author}>
                  {(a) => (
                    <span class="identity-chip">
                      <UserAvatar login={a()} />
                      <span>{a()}</span>
                    </span>
                  )}
                </Show>
                <span class="branch-flow">
                  <button class="branch-chip" title={pull().baseRef ?? 'base'} onClick={() => navigator.clipboard.writeText(pull().baseRef ?? '')}>
                    <span class="branch-chip-label">{pull().baseRef ?? 'base'}</span>
                    <svg class="branch-chip-copy" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  </button>
                  <span class="branch-arrow">←</span>
                  <button class="branch-chip" title={pull().headRef ?? 'head'} onClick={() => navigator.clipboard.writeText(pull().headRef ?? '')}>
                    <span class="branch-chip-label">{pull().headRef ?? 'head'}</span>
                    <svg class="branch-chip-copy" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  </button>
                </span>
                <span>
                  {fileSummary().count} files · <span class="file-stat add">+{fileSummary().additions}</span> /{' '}
                  <span class="file-stat del">−{fileSummary().deletions}</span>
                </span>
                <Show when={formatRelativeTime(pull().updatedAt)}>
                  {(age) => <span>{age()}</span>}
                </Show>
              </div>
              <Show when={pull().state === 'open'}>
                <div class="pr-actions">
                  <select class="repo-select" value={mergeMethod()} onChange={(e) => setMergeMethod(e.currentTarget.value)}>
                    <option value="squash">squash</option>
                    <option value="merge">merge</option>
                    <option value="rebase">rebase</option>
                  </select>
                  <button type="button" onClick={() => run(merge.mutateAsync())} disabled={merge.isPending}>
                    Merge
                  </button>
                  <button type="button" onClick={() => run(close.mutateAsync())} disabled={close.isPending}>
                    Close
                  </button>
                  <button type="button" onClick={() => run(draft.mutateAsync(!pull().draft))} disabled={draft.isPending}>
                    {pull().draft ? 'Ready for review' : 'Convert to draft'}
                  </button>
                </div>
              </Show>
              <Show when={pull().state === 'closed'}>
                <div class="pr-actions">
                  <button type="button" onClick={() => run(reopen.mutateAsync())} disabled={reopen.isPending}>
                    Reopen
                  </button>
                </div>
              </Show>
              <Show when={actionError()}>
                <div class="action-error">{actionError()}</div>
              </Show>
            </div>

            <Show when={pull().body}>
              <details class="nav-section" open>
                <summary>Description</summary>
                <div class="markdown" innerHTML={pull().body!} />
              </details>
            </Show>

            <details class="nav-section" open>
              <summary>Labels</summary>
              <ul class="label-list">
                <For each={detail.data?.labels} fallback={<li class="label-empty muted">None.</li>}>
                  {(l) => (
                    <li class="label-row" style={{ 'border-left-color': labelColor(l.color) }}>
                      <span class="label-row-name">{l.name}</span>
                      <button type="button" class="label-row-remove" title="Remove label" onClick={() => run(removeLabel(o(), r(), n(), l.name))}>
                        ×
                      </button>
                    </li>
                  )}
                </For>
              </ul>
              <div class="label-picker">
                <Picker<Label>
                  label="Add label…"
                  placeholder="Filter labels…"
                  emptyText={repoLabels.isLoading ? 'Loading labels…' : 'No labels available.'}
                  results={labelResults}
                  rowLabel={(label) => label.name}
                  isActive={() => false}
                  onSelect={chooseLabel}
                  buttonClass="label-picker-button"
                  leading={(label) => (
                    <span class="label-picker-swatch" style={{ background: labelColor(label.color) }} aria-hidden="true" />
                  )}
                />
              </div>
            </details>

            <details class="nav-section" open>
              <summary>
                Files <span class="muted">({files.data?.length ?? 0})</span>
              </summary>
              <ul class="file-list">
                <For each={files.data} fallback={<li class="placeholder">{files.isLoading ? 'Loading…' : 'No files.'}</li>}>
                  {(f) => {
                    const status = () => fileStatusMeta(f.status)
                    return (
                      <li class="file-row" classList={{ active: searchParams.file === f.path, viewed: f.viewed }}>
                        <input
                          type="checkbox"
                          class="file-viewed"
                          title="Mark viewed"
                          checked={f.viewed}
                          onChange={(e) => run(setViewed(o(), r(), n(), f.path, e.currentTarget.checked))}
                        />
                        <button type="button" class="file-open" onClick={() => selectFile(f.path)}>
                          <span class={`file-status file-status-${status().tone}`} title={status().label}>
                            {status().letter}
                          </span>
                          <span class="file-path">{f.path}</span>
                          <span class="file-stat add">+{f.additions ?? 0}</span>
                          <span class="file-stat del">−{f.deletions ?? 0}</span>
                        </button>
                      </li>
                    )
                  }}
                </For>
              </ul>
            </details>

            <Show when={detail.data?.checks.length}>
              <details class="nav-section">
                <summary>
                  Checks <span class="muted">({detail.data!.checks.length})</span>
                </summary>
                <ul class="check-list">
                  <For each={detail.data!.checks}>
                    {(ck) => (
                      <li class="check-row">
                        <span class={`check-dot check-${(ck.status ?? '').toLowerCase()}`} />
                        <span class="check-name">{ck.name}</span>
                        <Show when={ck.url}>
                          {(u) => (
                            <a class="muted" href={u()} target="_blank" rel="noreferrer">
                              {ck.status}
                            </a>
                          )}
                        </Show>
                        <Show when={FAILED_STATUSES.has((ck.status ?? '').toLowerCase()) && ck.runId != null}>
                          <button type="button" class="check-rerun" disabled={rerunned().has(ck.runId!)} onClick={() => triggerRerun(ck.runId!)}>
                            {rerunned().has(ck.runId!) ? 'Queued' : 'Rerun'}
                          </button>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              </details>
            </Show>

            <details class="nav-section" open>
              <summary>
                Comments/Commits{' '}
                <span class="muted">({conversationEntries().length})</span>
              </summary>
              <Show when={detail.data}>
                <div class="composer">
                  <MentionTextarea
                    class="composer-input"
                    placeholder="Leave a comment…"
                    value={draftText()}
                    onInput={setDraftText}
                    mentions={mentionsList()}
                  />
                  <button type="button" onClick={submitComment} disabled={comment.isPending || !draftText().trim()}>
                    Comment
                  </button>
                </div>
              </Show>
              <div class="conversation-items">
                <For each={conversationEntries()} fallback={<span class="muted conversation-empty">No comments or commits.</span>}>
                  {(entry) => (
                    <ConversationEntryItem entry={entry} snippetIndex={threadSnippetIndex()} onOpenFile={selectFile} />
                  )}
                </For>
              </div>
            </details>

            <details class="nav-section" open>
              <summary>Review</summary>
              <div class="composer">
                <MentionTextarea
                  class="composer-input"
                  placeholder="Leave a review comment…"
                  value={reviewBody()}
                  onInput={setReviewBody}
                  disabled={review.isPending}
                  mentions={mentionsList()}
                />
                <div class="pr-actions">
                  <button type="button" onClick={() => submitReviewWith('APPROVE')} disabled={review.isPending}>
                    {review.isPending ? 'Submitting…' : 'Approve'}
                  </button>
                  <button type="button" onClick={() => submitReviewWith('REQUEST_CHANGES')} disabled={review.isPending || !reviewBody().trim()}>
                    Request changes
                  </button>
                  <button type="button" onClick={() => submitReviewWith('COMMENT')} disabled={review.isPending || !reviewBody().trim()}>
                    Comment
                  </button>
                </div>
              </div>
            </details>
          </>
        )}
      </Show>
      </Show>
    </Show>
  )
}
