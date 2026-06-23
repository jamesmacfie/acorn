import { createMemo, createSignal, For, Show } from 'solid-js'
import { createMutation, createQuery, useQueryClient } from '@tanstack/solid-query'
import { useParams, useSearchParams } from '@solidjs/router'
import gitdiffParser from 'gitdiff-parser'
import { fileStatusMeta, formatRelativeTime, summarizeFileStats } from './displayMeta'
import { synth } from './diff'
import { requestFileScroll, routeKey } from './fileNavigation'
import { filesOptions, pullDetailOptions, reposOptions, type Comment, type PullFile, type Review, type Thread, type ThreadComment } from './queries'
import { addComment, addLabel, closePr, mergePr, removeLabel, reopenPr, rerunFailed, setDraft, setViewed } from './mutations'
import { UserAvatar } from './UserAvatar'

// Conclusions that count as a failed check → eligible for "Rerun failed jobs".
const FAILED_STATUSES = new Set(['failure', 'error', 'cancelled', 'timed_out'])

function hasRenderableBody(body: string | null | undefined): boolean {
  if (!body) return false
  if (/<(img|pre|code|table|ul|ol|blockquote)\b/i.test(body)) return true
  return body.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length > 0
}

function reviewAction(state: string | null): string {
  switch ((state ?? '').toUpperCase()) {
    case 'APPROVED':
      return 'approved'
    case 'CHANGES_REQUESTED':
      return 'requested changes'
    case 'COMMENTED':
      return 'reviewed'
    case 'DISMISSED':
      return 'dismissed review'
    default:
      return state ? state.toLowerCase().replaceAll('_', ' ') : 'reviewed'
  }
}

function shouldShowReviewSummary(review: Review): boolean {
  return hasRenderableBody(review.body) || (review.state ?? '').toUpperCase() !== 'COMMENTED'
}

function byTime<T extends { createdAt: number | null }>(a: T, b: T): number {
  return (a.createdAt ?? Number.MAX_SAFE_INTEGER) - (b.createdAt ?? Number.MAX_SAFE_INTEGER)
}

const threadComments = (thread: Thread) => [...thread.comments].sort(byTime)
const threadCreatedAt = (thread: Thread) => threadComments(thread)[0]?.createdAt ?? null

type ConversationEntry =
  | { kind: 'review'; id: string; createdAt: number | null; review: Review }
  | { kind: 'comment'; id: string; createdAt: number | null; comment: Comment }
  | { kind: 'thread'; id: string; createdAt: number | null; thread: Thread }

type SnippetLine = {
  kind: 'normal' | 'insert' | 'delete'
  oldNo: number | null
  newNo: number | null
  text: string
}

function threadSnippet(thread: Thread, files: PullFile[] | undefined): SnippetLine[] {
  if (!thread.path || thread.line == null) return []
  const file = files?.find((f) => f.path === thread.path)
  if (!file?.patch) return []

  const targetSide = thread.side === 'LEFT' ? 'LEFT' : 'RIGHT'
  try {
    const [parsed] = gitdiffParser.parse(synth(file.path, file.patch))
    const rows: SnippetLine[] = []
    for (const hunk of parsed?.hunks ?? []) {
      for (const change of hunk.changes) {
        if (change.type === 'normal') {
          rows.push({ kind: 'normal', oldNo: change.oldLineNumber, newNo: change.newLineNumber, text: change.content })
        } else if (change.type === 'insert') {
          rows.push({ kind: 'insert', oldNo: null, newNo: change.lineNumber, text: change.content })
        } else {
          rows.push({ kind: 'delete', oldNo: change.lineNumber, newNo: null, text: change.content })
        }
      }
    }
    const index = rows.findIndex((row) => (targetSide === 'LEFT' ? row.oldNo : row.newNo) === thread.line)
    if (index < 0) return []
    return rows.slice(Math.max(index - 2, 0), index + 3)
  } catch {
    return []
  }
}

// Mid (Navigator) pane: PR header + description + changed-files + checks + conversation.
// Bodies are GitHub-sanitized bodyHTML, rendered via innerHTML (docs/ui-style.md §5).
export default function PullDetail() {
  const params = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const qc = useQueryClient()
  const repos = createQuery(() => reposOptions(true))
  const repoKnown = () => !!repos.data?.some((r) => r.owner === params.owner && r.name === params.repo)
  const enabled = () => !!params.number && repoKnown()
  const detail = createQuery(() => pullDetailOptions(params.owner ?? '', params.repo ?? '', params.number ?? '', enabled()))
  const files = createQuery(() => filesOptions(params.owner ?? '', params.repo ?? '', params.number ?? '', enabled()))
  const fileSummary = createMemo(() => summarizeFileStats(files.data))
  const conversationEntries = createMemo<ConversationEntry[]>(() => {
    const data = detail.data
    if (!data) return []
    return [
      ...data.reviews.filter(shouldShowReviewSummary).map((review) => ({ kind: 'review' as const, id: review.id, createdAt: review.submittedAt, review })),
      ...data.comments.map((comment) => ({ kind: 'comment' as const, id: comment.id, createdAt: comment.createdAt, comment })),
      ...data.threads.filter((thread) => thread.comments.length > 0).map((thread) => ({ kind: 'thread' as const, id: thread.threadId, createdAt: threadCreatedAt(thread), thread })),
    ].sort((a, b) => (a.createdAt ?? Number.MAX_SAFE_INTEGER) - (b.createdAt ?? Number.MAX_SAFE_INTEGER))
  })

  const o = () => params.owner ?? ''
  const r = () => params.repo ?? ''
  const n = () => params.number ?? ''
  // Refetch detail (and the open-PR list, since state changes drop a PR from it) after a mutation.
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['pull', o(), r()] })
    qc.invalidateQueries({ queryKey: ['pulls', o(), r()] })
  }

  const [mergeMethod, setMergeMethod] = createSignal('squash')
  const [draftText, setDraftText] = createSignal('')
  const [labelText, setLabelText] = createSignal('')
  const [actionError, setActionError] = createSignal('')
  const run = (p: Promise<unknown>) => p.then(refresh).catch((e) => setActionError(String(e.message ?? e)))

  const merge = createMutation(() => ({ mutationFn: () => mergePr(o(), r(), n(), mergeMethod()) }))
  const close = createMutation(() => ({ mutationFn: () => closePr(o(), r(), n()) }))
  const reopen = createMutation(() => ({ mutationFn: () => reopenPr(o(), r(), n()) }))
  const draft = createMutation(() => ({ mutationFn: (d: boolean) => setDraft(o(), r(), n(), d) }))
  const comment = createMutation(() => ({ mutationFn: (body: string) => addComment(o(), r(), n(), body) }))

  const submitComment = () => {
    const body = draftText().trim()
    if (!body) return
    run(comment.mutateAsync(body)).then(() => setDraftText(''))
  }
  const submitLabel = () => {
    const name = labelText().trim()
    if (!name) return
    run(addLabel(o(), r(), n(), name)).then(() => setLabelText(''))
  }
  const selectFile = (path: string) => {
    setSearchParams({ file: path })
    requestFileScroll({ routeKey: routeKey(o(), r(), n()), path })
  }

  return (
    <Show when={params.number} fallback={<p class="placeholder">Select a PR.</p>}>
      <Show when={detail.data?.pull} fallback={<p class="placeholder">{detail.isError ? 'Failed to load PR.' : 'Loading…'}</p>}>
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
                  <span class="branch-chip">{pull().baseRef ?? 'base'}</span>
                  <span class="branch-arrow">←</span>
                  <span class="branch-chip">{pull().headRef ?? 'head'}</span>
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
              <div class="labels">
                <For each={detail.data?.labels} fallback={<span class="muted">None.</span>}>
                  {(l) => (
                    <button
                      type="button"
                      class="label-chip"
                      title="Remove label"
                      style={l.color ? { 'border-color': `#${l.color}` } : undefined}
                      onClick={() => run(removeLabel(o(), r(), n(), l.name))}
                    >
                      {l.name} ✕
                    </button>
                  )}
                </For>
              </div>
              <div class="composer">
                <input
                  class="pr-filter"
                  placeholder="Add label…"
                  value={labelText()}
                  onInput={(e) => setLabelText(e.currentTarget.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submitLabel()}
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
                          <button type="button" class="check-rerun" onClick={() => run(rerunFailed(o(), r(), ck.runId!))}>
                            Rerun
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
                Conversation{' '}
                <span class="muted">({conversationEntries().length})</span>
              </summary>
              <Show when={detail.data}>
                <div class="composer">
                  <textarea
                    class="composer-input"
                    placeholder="Leave a comment…"
                    value={draftText()}
                    onInput={(e) => setDraftText(e.currentTarget.value)}
                  />
                  <button type="button" onClick={submitComment} disabled={comment.isPending || !draftText().trim()}>
                    Comment
                  </button>
                </div>
              </Show>
              <div class="conversation-items">
                <For each={conversationEntries()} fallback={<span class="muted conversation-empty">No comments.</span>}>
                  {(entry) => (
                    <ConversationEntryItem entry={entry} files={files.data} onOpenFile={selectFile} />
                  )}
                </For>
              </div>
            </details>
          </>
        )}
      </Show>
    </Show>
  )
}

function ConversationEntryItem(props: { entry: ConversationEntry; files: PullFile[] | undefined; onOpenFile: (path: string) => void }) {
  return (
    <Show
      when={props.entry.kind === 'thread' ? props.entry : null}
      fallback={
        <Show
          when={props.entry.kind === 'review' ? props.entry : null}
          fallback={
            <Show when={props.entry.kind === 'comment' ? props.entry : null}>
              {(entry) => <ConversationItem author={entry().comment.author} action="commented" body={entry().comment.body} createdAt={entry().createdAt} />}
            </Show>
          }
        >
          {(entry) => <ConversationItem author={entry().review.author} action={reviewAction(entry().review.state)} body={entry().review.body} state={entry().review.state} createdAt={entry().createdAt} />}
        </Show>
      }
    >
      {(entry) => <FileThreadItem thread={entry().thread} files={props.files} onOpenFile={props.onOpenFile} />}
    </Show>
  )
}

function ConversationItem(props: { author: string | null; action: string; body: string | null; state?: string | null; createdAt?: number | null }) {
  const hasBody = () => hasRenderableBody(props.body)
  const stateClass = () => (props.state ? `review-state review-${props.state.toLowerCase()}` : '')

  return (
    <div class="comment comment-card" classList={{ 'comment-card-empty': !hasBody() }}>
      <div class="comment-meta comment-meta-with-avatar">
        <UserAvatar login={props.author} />
        <span class="comment-author">{props.author ?? 'unknown'}</span>
        <span class={`comment-action ${stateClass()}`}>{props.action}</span>
        <Show when={formatRelativeTime(props.createdAt ?? null)}>
          {(age) => <span class="comment-time">{age()}</span>}
        </Show>
      </div>
      <Show when={hasBody()} fallback={<div class="comment-empty muted">No written summary.</div>}>
        <div class="markdown" innerHTML={props.body!} />
      </Show>
    </div>
  )
}

function FileThreadItem(props: { thread: Thread; files: PullFile[] | undefined; onOpenFile: (path: string) => void }) {
  const comments = () => threadComments(props.thread)
  const first = () => comments()[0]
  const snippet = () => threadSnippet(props.thread, props.files)
  const path = () => props.thread.path ?? 'Unknown file'

  return (
    <div class="file-thread-card">
      <div class="file-thread-head">
        <div class="file-thread-meta comment-meta-with-avatar">
          <UserAvatar login={first()?.author} />
          <span class="comment-author">{first()?.author ?? 'unknown'}</span>
          <span class="comment-action">commented</span>
          <Show when={formatRelativeTime(first()?.createdAt ?? null)}>
            {(age) => <span class="comment-time">{age()}</span>}
          </Show>
        </div>
        <button type="button" class="file-thread-open" onClick={() => props.thread.path && props.onOpenFile(props.thread.path)}>
          View in diff
        </button>
      </div>
      <button type="button" class="file-thread-file" onClick={() => props.thread.path && props.onOpenFile(props.thread.path)}>
        <span class="file-thread-path">{path()}</span>
        <Show when={props.thread.line != null}>
          <span class="file-thread-line">L{props.thread.line}</span>
        </Show>
      </button>
      <Show when={snippet().length}>
        <div class="file-thread-code" aria-label={`Diff context for ${path()}`}>
          <For each={snippet()}>
            {(line) => (
              <div class="file-thread-code-line" classList={{ 'diff-add': line.kind === 'insert', 'diff-del': line.kind === 'delete' }}>
                <span class="file-thread-gutter">{line.oldNo ?? ''}</span>
                <span class="file-thread-gutter">{line.newNo ?? ''}</span>
                <span class="diff-marker">{line.kind === 'insert' ? '+' : line.kind === 'delete' ? '−' : ' '}</span>
                <code>{line.text}</code>
              </div>
            )}
          </For>
        </div>
      </Show>
      <div class="file-thread-comments">
        <For each={comments()}>
          {(comment, index) => <FileThreadComment comment={comment} compact={index() === 0} />}
        </For>
      </div>
      <Show when={props.thread.resolved}>
        <div class="file-thread-resolved">Resolved</div>
      </Show>
    </div>
  )
}

function FileThreadComment(props: { comment: ThreadComment; compact: boolean }) {
  return (
    <div class="file-thread-comment">
      <Show when={!props.compact}>
        <div class="comment-meta comment-meta-with-avatar">
          <UserAvatar login={props.comment.author} />
          <span class="comment-author">{props.comment.author ?? 'unknown'}</span>
          <Show when={formatRelativeTime(props.comment.createdAt)}>
            {(age) => <span class="comment-time">{age()}</span>}
          </Show>
        </div>
      </Show>
      <Show when={hasRenderableBody(props.comment.body)} fallback={<div class="comment-empty muted">No content.</div>}>
        <div class="markdown" innerHTML={props.comment.body!} />
      </Show>
    </div>
  )
}
