import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'
import { createMutation, createQuery, useQueryClient } from '@tanstack/solid-query'
import { useNavigate, useParams } from '@solidjs/router'
import { useChangedFiles } from './changedFiles'
import { checksState, FAILED_STATUSES, fileStatusMeta, integrationsOptions, openRefPanel, persistDraft, projectsOptions, summarizeFileStats, type Task } from '@acorn/plugin-api/client'
import { requestFileScroll, routeKey } from './fileNavigation'
import { CopyButton, MentionTextarea, Picker, UserAvatar } from '@acorn/plugin-api/ui'
import { mentionsOptions, pullConflictsOptions, pullDetailOptions, repoLabelsOptions } from './queries'
import { pullPrefixKey, pullsPrefixKey, type Label } from '../contract/api'
import { linearIssuesOptions } from '@acorn/plugin-linear/contract/issues.ts'
import { addComment, addLabel, closePr, disableAutoMerge, enableAutoMerge, mergePr, removeLabel, removeReviewer, reopenPr, rerunFailed, requestReviewer, setDraft, setViewed, submitReview } from './mutations'
import { ConversationEntryItem } from './pullDetail/Conversation'
import ChecksPanel from './checks/ChecksPanel'
import { scanLinearRefs } from '@acorn/plugin-linear/contract/scanRefs.ts'
import { linkifyLinearIds, makeContentLinkHandler } from './contentLinks'
import { PullSummary } from './PullSummary'
import { buildConversationEntries, buildThreadSnippetIndex } from './pullDetail/model'
import { createNavigatorScrollRestoration } from './reviewScrollRestoration'
import type { ReviewViewScope } from './reviewViewState'
import './styles/pull-detail.css'
import './styles/checks-panel.css'

const labelColor = (color: string | null | undefined) => (color ? `#${color}` : 'var(--text-faint)')

// Render plain text with bare Linear identifiers (CRA-404) turned into clickable links — used for
// the PR title, where the id is plain text. Prefixes gate which ids are real (see splitLinearIds).
const rememberOpen = (key: string) => (el: HTMLDetailsElement) => {
  const stored = localStorage.getItem(`section-open:${key}`)
  if (stored !== null) el.open = stored === '1'
  el.addEventListener('toggle', () => localStorage.setItem(`section-open:${key}`, el.open ? '1' : '0'))
}

// Mid (Navigator) pane: PR header + description + changed-files + checks + conversation.
// Bodies are GitHub-sanitized bodyHTML, rendered via innerHTML (docs/ui-design.md).
export default function PullDetail(props: { task?: Task } = {}) {
  // A contributed pane is task-scoped and must render without a Router. The route-owned browse
  // surface still uses params, so only acquire router context for that variant.
  const params = props.task ? null : useParams()
  const qc = useQueryClient()
  const projects = createQuery(() => projectsOptions(true))
  const routedProject = () => projects.data?.find((project) => project.id === params?.projectId)
  const o = () => props.task?.github?.owner ?? routedProject()?.github?.owner ?? ''
  const r = () => props.task?.github?.name ?? routedProject()?.github?.name ?? ''
  const n = () => (props.task?.pullNumber != null ? String(props.task.pullNumber) : params?.number ?? '')
  const repoKnown = () => !!o() && !!r()
  const hasRepoParams = () => !!o() && !!r()
  const hasPullParams = () => hasRepoParams() && !!n()
  const detail = createQuery(() => pullDetailOptions(o(), r(), n(), hasPullParams()))
  // Changed files + `?file=` selection via the shared hook, so the finder, [ / ] cycling, and
  // this file list all agree on one file order/source.
  const changedFiles = useChangedFiles(() => (hasPullParams() ? { owner: o(), repo: r(), number: n() } : null), { router: !props.task })
  const mentionsQuery = createQuery(() => mentionsOptions(o(), r(), hasRepoParams()))
  const repoLabels = createQuery(() => repoLabelsOptions(o(), r(), hasRepoParams()))
  const mentionsList = () => mentionsQuery.data ?? []
  const fileSummary = createMemo(() => summarizeFileStats(changedFiles.files()))
  // Merge conflicts: GitHub only tells us *that* a PR conflicts (mergeable === 'CONFLICTING'); the
  // conflicting files are computed locally (see pullConflicts route). Only fetch when conflicting.
  const conflicting = () => detail.data?.pull?.mergeable === 'CONFLICTING'
  const conflictBase = () => detail.data?.pull?.baseRef ?? ''
  const conflicts = createQuery(() => pullConflictsOptions(o(), r(), n(), conflictBase(), hasPullParams() && conflicting()))
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
  const linearConnected = () => (integrations.data?.integrations ?? []).some((i) => i.providerId === 'linear' && i.status === 'connected')
  const linearIssues = createQuery(() => linearIssuesOptions(linearRefs().map((rf) => rf.identifier), linearRefs().length > 0 && linearConnected()))
  const linearSummary = createMemo(() => new Map((linearIssues.data?.issues ?? []).map((i) => [i.identifier, i])))
  // Show a linked ticket without leaving the PR: the linked-ticket list below, and the bare `CRA-404` ids
  // in the title. `openRefPanel` refuses when Linear is not installed on this device, which is the right
  // degradation for a detail overlay and is why nothing here checks first.
  const showLinearIssue = (identifier: string): void => void openRefPanel({ providerId: 'linear', displayId: identifier })

  // The Navigator pane itself is the scroll container, outside this fragment-owned component.
  // Keep its session position per task/PR (or classic-browse PR) so disposing the review surface
  // to show another pane/source does not make returning start over at the header.
  const reviewScope = createMemo<ReviewViewScope | null>(() =>
    hasPullParams()
      ? { taskId: props.task?.id, routeKey: routeKey(o(), r(), n()) }
      : null,
  )
  const bindNavigatorScroll = createNavigatorScrollRestoration({
    scope: reviewScope,
    trackContent: () => {
      detail.data
      changedFiles.files().length
      conflicts.data
      linearIssues.data
    },
  })

  // Open in-app links found inside rendered bodies. The host resolves which provider claims the URL and
  // shows its reference panel (any provider's, not just Linear's — see contentLinks.ts); GitHub PRs/repos
  // resolve through the current project's GitHub facet before entering the project-keyed SPA route.
  const navigate = useNavigate()
  const onContentClick = makeContentLinkHandler(
    navigate,
    (owner, repo) => projects.data?.find((project) => project.github?.owner === owner && project.github?.name === repo)?.id,
  )
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
  // Reports the failure and RESOLVES, so a caller chaining `.then` is not left hanging. That is fine for a
  // fire-and-forget action and wrong for anything that clears the user's text — see `runThenClear`.
  const run = (p: Promise<unknown>) => p.then(refresh).catch((e) => setActionError(String(e.message ?? e)))
  const runThenClear = (p: Promise<unknown>, clear: () => void) =>
    p.then(() => {
      clear()
      return refresh()
    }).catch((e: unknown) => setActionError(String((e as Error).message ?? e)))

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
    void runThenClear(review.mutateAsync({ event, body }), () => setReviewBody(''))
  }

  const submitComment = () => {
    const body = draftText().trim()
    if (!body) return
    void runThenClear(comment.mutateAsync(body), () => setDraftText(''))
  }
  const chooseLabel = (label: Label) => run(addLabel(o(), r(), n(), label.name))
  const selectFile = (path: string) => {
    changedFiles.selectFile(path)
    requestFileScroll({ routeKey: routeKey(o(), r(), n()), path })
  }

  return (
    <Show when={n()} fallback={<p class="placeholder">Select a PR.</p>}>
      <Show when={repoKnown() || !projects.data} fallback={<p class="placeholder">Not found.</p>}>
      <Show when={detail.data?.pull} fallback={<p class="placeholder">{detail.isError ? 'Not found.' : 'Loading…'}</p>}>
        {(pull) => (
          <>
            <PullSummary
              pull={pull}
              bindNavigatorScroll={bindNavigatorScroll}
              fileSummary={fileSummary}
              linearPrefixes={linearPrefixes}
              onOpenIssue={showLinearIssue}
              mergeMethod={mergeMethod}
              setMergeMethod={setMergeMethod}
              run={run}
              disableAutoMerge={{ run: () => autoMergeDisable.mutateAsync(), pending: autoMergeDisable.isPending }}
              enableAutoMerge={{ run: () => autoMergeEnable.mutateAsync(), pending: autoMergeEnable.isPending }}
              merge={{ run: () => merge.mutateAsync(), pending: merge.isPending }}
              close={{ run: () => close.mutateAsync(), pending: close.isPending }}
              draft={{ run: (isDraft) => draft.mutateAsync(isDraft), pending: draft.isPending }}
              reopen={{ run: () => reopen.mutateAsync(), pending: reopen.isPending }}
              actionError={actionError}
              conflicting={conflicting()}
              conflicts={() => conflicts.data}
              conflictsLoading={() => conflicts.isLoading}
              conflictsRef={rememberOpen('conflicts')}
              selectFile={selectFile}
            />

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
                            <button type="button" class="integration-row" onClick={() => showLinearIssue(rf.identifier)}>
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
            {/* No reference panel here any more, and the deletion is the point. This was
                `<Show when={openIssue() ? refPanelFor('linear') : undefined}>` — a local signal plus one
                provider named in the markup, which made this the ONLY surface in the app that could show a
                referenced item, and Linear the only provider it could show. The registry was always
                general; the invocation was not. Both now belong to the shell
                (client-core/registries/refPanels.ts + refPanelHost.tsx), and this pane just asks. */}
          </>
        )}
      </Show>
      </Show>
    </Show>
  )
}
