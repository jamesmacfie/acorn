import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'
import { createMutation, createQuery, useQueryClient } from '@tanstack/solid-query'
import { useNavigate, useParams } from '@solidjs/router'
import { useChangedFiles } from './changedFiles'
import { checksState, FAILED_STATUSES, fileStatusMeta, formatRelativeTime, summarizeFileStats } from './displayMeta'
import { requestFileScroll, routeKey } from './fileNavigation'
import Picker from './Picker'
import CopyButton from './CopyButton'
import { integrationsOptions, linearIssuesOptions, mentionsOptions, pullDetailOptions, pullPrefixKey, pullsPrefixKey, repoLabelsOptions, reposOptions, type Label } from './queries'
import MentionTextarea from './MentionTextarea'
import { addComment, addLabel, closePr, disableAutoMerge, enableAutoMerge, mergePr, removeLabel, removeReviewer, reopenPr, rerunFailed, requestReviewer, setDraft, setViewed, submitReview } from './mutations'
import { UserAvatar } from './UserAvatar'
import { ConversationEntryItem } from './features/pullDetail/Conversation'
import ChecksPanel from './features/checks/ChecksPanel'
import LinearIssuePanel from './features/integrations/LinearIssuePanel'
import { scanLinearRefs } from './features/integrations/scanLinearRefs'
import { linkifyLinearIds, makeContentLinkHandler, splitLinearIds } from './contentLinks'
import { buildConversationEntries, buildThreadSnippetIndex } from './features/pullDetail/model'
import { persistDraft } from './features/comments/draftState'

const labelColor = (color: string | null | undefined) => (color ? `#${color}` : 'var(--text-faint)')

// Render plain text with bare Linear identifiers (CRA-404) turned into clickable links — used for
// the PR title, where the id is plain text. Prefixes gate which ids are real (see splitLinearIds).
function LinearText(props: { text: string; prefixes: string[]; onOpen: (id: string) => void }) {
  const parts = createMemo(() => splitLinearIds(props.text, props.prefixes))
  return (
    <For each={parts()}>
      {(p) =>
        p.id ? (
          <a class="linear-inline-link" onClick={() => props.onOpen(p.id!)}>
            {p.text}
          </a>
        ) : (
          <>{p.text}</>
        )
      }
    </For>
  )
}

// Persist a <details> open/closed state in localStorage, keyed by section name, so it survives
// navigation and reloads. Seeds from storage on mount (falling back to the JSX `open` default),
// then writes back on every toggle. ponytail: localStorage, not server prefs — these are
// per-device UI preferences and avoid the async seed-flash the left pane has.
const rememberOpen = (key: string) => (el: HTMLDetailsElement) => {
  const stored = localStorage.getItem(`section-open:${key}`)
  if (stored !== null) el.open = stored === '1'
  el.addEventListener('toggle', () => localStorage.setItem(`section-open:${key}`, el.open ? '1' : '0'))
}

// Mid (Navigator) pane: PR header + description + changed-files + checks + conversation.
// Bodies are GitHub-sanitized bodyHTML, rendered via innerHTML (docs/ui-design.md).
export default function PullDetail() {
  const params = useParams()
  const qc = useQueryClient()
  const repos = createQuery(() => reposOptions(true))
  const repoKnown = () => !!repos.data?.some((r) => r.owner === params.owner && r.name === params.repo)
  const o = () => params.owner ?? ''
  const r = () => params.repo ?? ''
  const n = () => params.number ?? ''
  const hasRepoParams = () => !!params.owner && !!params.repo
  const hasPullParams = () => hasRepoParams() && !!params.number
  const detail = createQuery(() => pullDetailOptions(o(), r(), n(), hasPullParams()))
  // Changed files + `?file=` selection via the shared hook, so the finder, [ / ] cycling, and
  // this file list all agree on one file order/source.
  const changedFiles = useChangedFiles(() => (hasPullParams() ? { owner: o(), repo: r(), number: n() } : null))
  const mentionsQuery = createQuery(() => mentionsOptions(o(), r(), hasRepoParams()))
  const repoLabels = createQuery(() => repoLabelsOptions(o(), r(), hasRepoParams()))
  const mentionsList = () => mentionsQuery.data ?? []
  const fileSummary = createMemo(() => summarizeFileStats(changedFiles.files()))
  const conversationEntries = createMemo(() => buildConversationEntries(detail.data))
  const threadSnippetIndex = createMemo(() => buildThreadSnippetIndex(changedFiles.files()))

  // Integrations: Linear tickets linked from the PR body / comments / reviews / threads.
  const linearRefs = createMemo(() => {
    const d = detail.data
    if (!d) return []
    const texts: (string | null | undefined)[] = [d.pull?.body]
    for (const cm of d.comments) texts.push(cm.body)
    for (const rv of d.reviews) texts.push(rv.body)
    for (const th of d.threads) for (const cm of th.comments) texts.push(cm.body)
    return scanLinearRefs(texts)
  })
  const integrations = createQuery(() => integrationsOptions(linearRefs().length > 0))
  const linearConnected = () => (integrations.data?.integrations ?? []).some((i) => i.provider === 'linear' && i.connected)
  const linearIssues = createQuery(() => linearIssuesOptions(linearRefs().map((rf) => rf.identifier), linearRefs().length > 0 && linearConnected()))
  const linearSummary = createMemo(() => new Map((linearIssues.data?.issues ?? []).map((i) => [i.identifier, i])))
  const [openIssue, setOpenIssue] = createSignal<string | null>(null)
  // Open in-app links found inside rendered bodies (Linear issues → panel; GitHub PRs/repos → SPA).
  const navigate = useNavigate()
  const onContentClick = makeContentLinkHandler(navigate, setOpenIssue)
  // Team prefixes seen via linear.app URLs in this PR — used to safely linkify bare ids (CRA-404)
  // in GitHub text/title without false-positives on things like UTF-8.
  const linearPrefixes = createMemo(() => [...new Set(linearRefs().map((rf) => rf.identifier.split('-')[0]))])

  // After GitHub bodies render (innerHTML, opaque to Solid), wrap bare Linear ids in clickable
  // anchors. Only touch .markdown nodes (never Solid-managed text). Re-runs when data/prefixes change.
  let descRef: HTMLDivElement | undefined
  let convRef: HTMLDivElement | undefined
  createEffect(() => {
    detail.data
    const prefixes = linearPrefixes()
    queueMicrotask(() => {
      if (descRef) linkifyLinearIds(descRef, prefixes)
      convRef?.querySelectorAll<HTMLElement>('.markdown').forEach((el) => linkifyLinearIds(el, prefixes))
    })
  })
  const assignedLabelNames = createMemo(() => new Set((detail.data?.labels ?? []).map((label) => label.name.toLowerCase())))
  const labelResults = (query: string): Label[] => {
    const q = query.trim().toLowerCase()
    return (repoLabels.data ?? []).filter((label) => !assignedLabelNames().has(label.name.toLowerCase()) && (!q || label.name.toLowerCase().includes(q)))
  }
  const requestedReviewers = createMemo(() => new Set(detail.data?.requestedReviewers ?? []))
  const reviewerResults = (query: string): string[] => {
    const q = query.trim().toLowerCase()
    return mentionsList().filter((login) => !requestedReviewers().has(login) && (!q || login.toLowerCase().includes(q)))
  }

  // Refetch detail (and the open-PR list, since state changes drop a PR from it) after a mutation.
  const refresh = () => {
    qc.invalidateQueries({ queryKey: pullPrefixKey(o(), r()) })
    qc.invalidateQueries({ queryKey: pullsPrefixKey(o(), r()) })
  }

  const [mergeMethod, setMergeMethod] = createSignal('squash')
  const [draftText, setDraftText] = createSignal('')
  const [reviewBody, setReviewBody] = createSignal('')
  // Persist in-progress comment/review text per PR so it survives navigation and reloads.
  persistDraft(() => (hasPullParams() ? `pr-comment:${o()}/${r()}/${n()}` : null), draftText, setDraftText)
  persistDraft(() => (hasPullParams() ? `review-body:${o()}/${r()}/${n()}` : null), reviewBody, setReviewBody)
  const [actionError, setActionError] = createSignal('')
  const run = (p: Promise<unknown>) => p.then(refresh).catch((e) => setActionError(String(e.message ?? e)))

  const [openCheck, setOpenCheck] = createSignal<{ runId: number; name: string } | null>(null)
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
  const autoMergeEnable = createMutation(() => ({ mutationFn: () => enableAutoMerge(o(), r(), n(), mergeMethod()) }))
  const autoMergeDisable = createMutation(() => ({ mutationFn: () => disableAutoMerge(o(), r(), n()) }))
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
    changedFiles.selectFile(path)
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
                <span class="pr-num copyable">#{pull().number}<CopyButton text={() => String(pull().number)} title="Copy PR number" /></span> <LinearText text={pull().title} prefixes={linearPrefixes()} onOpen={setOpenIssue} />
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
                  <Show when={!pull().autoMergeEnabled}>
                    <select class="repo-select" value={mergeMethod()} onChange={(e) => setMergeMethod(e.currentTarget.value)}>
                      <option value="squash">squash</option>
                      <option value="merge">merge</option>
                      <option value="rebase">rebase</option>
                    </select>
                  </Show>
                  <Show when={pull().autoMergeEnabled}>
                    <button type="button" onClick={() => run(autoMergeDisable.mutateAsync())} disabled={autoMergeDisable.isPending}>
                      Disable auto-merge
                    </button>
                  </Show>
                  <Show when={!pull().autoMergeEnabled && pull().mergeStateStatus === 'BLOCKED'}>
                    <button type="button" onClick={() => run(autoMergeEnable.mutateAsync())} disabled={autoMergeEnable.isPending}>
                      Enable auto-merge ({mergeMethod()})
                    </button>
                  </Show>
                  <Show when={!pull().autoMergeEnabled && pull().mergeStateStatus !== 'BLOCKED'}>
                    <button
                      type="button"
                      onClick={() => run(merge.mutateAsync())}
                      disabled={merge.isPending || pull().mergeable === 'CONFLICTING'}
                      title={pull().mergeable === 'CONFLICTING' ? 'Resolve merge conflicts before merging' : undefined}
                    >
                      Merge
                    </button>
                  </Show>
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
              <details class="nav-section" open ref={rememberOpen('description')}>
                <summary class="copyable">Description<CopyButton class="copy-right" text={() => descRef?.textContent ?? ''} title="Copy description" /></summary>
                <div class="markdown" ref={descRef} onClick={onContentClick} innerHTML={pull().body!} />
              </details>
            </Show>

            <Show when={linearRefs().length > 0}>
              <details class="nav-section" open ref={rememberOpen('integrations')}>
                <summary>
                  Integrations <span class="muted">({linearRefs().length})</span>
                </summary>
                <Show
                  when={linearConnected()}
                  fallback={
                    <>
                      <ul class="check-list">
                        <For each={linearRefs()}>
                          {(rf) => (
                            <li class="check-row">
                              <a class="integration-row" href={rf.url} target="_blank" rel="noreferrer">
                                <span class="integration-row-id">{rf.identifier}</span>
                              </a>
                            </li>
                          )}
                        </For>
                      </ul>
                      <p class="muted" style={{ padding: '4px 0' }}>
                        Connect Linear in your account menu to see titles and details.
                      </p>
                    </>
                  }
                >
                  <ul class="check-list">
                    <For each={linearRefs()}>
                      {(rf) => {
                        const summary = () => linearSummary().get(rf.identifier)
                        return (
                          <li class="check-row">
                            <button type="button" class="integration-row" onClick={() => setOpenIssue(rf.identifier)}>
                              <span class="integration-row-id">{rf.identifier}</span>
                              <Show when={summary()} fallback={<span class="integration-row-title muted">{linearIssues.isLoading ? 'Loading…' : ''}</span>}>
                                {(s) => (
                                  <>
                                    <span class="integration-row-title">{s().title}</span>
                                    <Show when={s().state}>
                                      {(st) => (
                                        <span class="integration-row-state" style={{ '--state-color': st().color }}>
                                          {st().name}
                                        </span>
                                      )}
                                    </Show>
                                  </>
                                )}
                              </Show>
                            </button>
                          </li>
                        )
                      }}
                    </For>
                  </ul>
                </Show>
              </details>
            </Show>

            <details class="nav-section" open ref={rememberOpen('labels')}>
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

            <details class="nav-section" open ref={rememberOpen('files')}>
              <summary>
                Files <span class="muted">({changedFiles.files().length})</span>
              </summary>
              <ul class="file-list">
                <For each={changedFiles.files()} fallback={<li class="placeholder">{changedFiles.isLoading() ? 'Loading…' : 'No files.'}</li>}>
                  {(f) => {
                    const status = () => fileStatusMeta(f.status)
                    return (
                      <li class="file-row" classList={{ active: changedFiles.currentFile() === f.path, viewed: f.viewed }}>
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
              <details class="nav-section" ref={rememberOpen('checks')}>
                <summary>
                  Checks <span class="muted">({detail.data!.checks.length})</span>
                  <span class={`checks-dot checks-dot-${checksState(detail.data!.checks)}`} />
                </summary>
                <ul class="check-list">
                  <For each={detail.data!.checks}>
                    {(ck) => (
                      <li class="check-row">
                        <span class={`check-dot check-${(ck.status ?? '').toLowerCase()}`} />
                        <Show when={ck.runId != null} fallback={<span class="check-name">{ck.name}</span>}>
                          <button type="button" class="check-name check-name-link" onClick={() => setOpenCheck({ runId: ck.runId!, name: ck.name })}>
                            {ck.name}
                          </button>
                        </Show>
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

            <details class="nav-section" open ref={rememberOpen('conversation')}>
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
              <div class="conversation-items" ref={convRef} onClick={onContentClick}>
                <For each={conversationEntries()} fallback={<span class="muted conversation-empty">No comments or commits.</span>}>
                  {(entry) => (
                    <ConversationEntryItem entry={entry} snippetIndex={threadSnippetIndex()} onOpenFile={selectFile} />
                  )}
                </For>
              </div>
            </details>

            <details class="nav-section" open ref={rememberOpen('review')}>
              <summary>Review</summary>
              <ul class="label-list">
                <For each={detail.data?.requestedReviewers} fallback={<li class="label-empty muted">No reviewers requested.</li>}>
                  {(login) => (
                    <li class="label-row">
                      <span class="identity-chip">
                        <UserAvatar login={login} />
                        <span class="label-row-name">{login}</span>
                      </span>
                      <button type="button" class="label-row-remove" title="Remove review request" onClick={() => run(removeReviewer(o(), r(), n(), login))}>
                        ×
                      </button>
                    </li>
                  )}
                </For>
              </ul>
              <div class="label-picker">
                <Picker<string>
                  label="Request review…"
                  placeholder="Filter people…"
                  emptyText={mentionsQuery.isLoading ? 'Loading people…' : 'No one to request.'}
                  results={reviewerResults}
                  rowLabel={(login) => login}
                  isActive={() => false}
                  onSelect={(login) => run(requestReviewer(o(), r(), n(), login))}
                  buttonClass="label-picker-button"
                  leading={(login) => <UserAvatar login={login} />}
                />
              </div>
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
            <Show when={openCheck()}>
              {(c) => <ChecksPanel owner={o()} repo={r()} runId={c().runId} jobName={c().name} onClose={() => setOpenCheck(null)} />}
            </Show>
            <Show when={openIssue()}>
              {(id) => <LinearIssuePanel identifier={id()} onClose={() => setOpenIssue(null)} onContentClick={onContentClick} />}
            </Show>
          </>
        )}
      </Show>
      </Show>
    </Show>
  )
}
