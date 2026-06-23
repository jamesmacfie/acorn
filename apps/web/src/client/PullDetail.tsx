import { createSignal, For, Show } from 'solid-js'
import { createMutation, createQuery, useQueryClient } from '@tanstack/solid-query'
import { useParams, useSearchParams } from '@solidjs/router'
import { filesOptions, pullDetailOptions, reposOptions } from './queries'
import { addComment, addLabel, closePr, mergePr, removeLabel, reopenPr, rerunFailed, setDraft, setViewed } from './mutations'

// Conclusions that count as a failed check → eligible for "Rerun failed jobs".
const FAILED_STATUSES = new Set(['failure', 'error', 'cancelled', 'timed_out'])

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
                <Show when={pull().author}>{(a) => <span>{a()}</span>}</Show>
                <span>
                  {pull().baseRef} ← {pull().headRef}
                </span>
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
                  {(f) => (
                    <li class="file-row" classList={{ active: searchParams.file === f.path, viewed: f.viewed }}>
                      <input
                        type="checkbox"
                        class="file-viewed"
                        title="Mark viewed"
                        checked={f.viewed}
                        onChange={(e) => run(setViewed(o(), r(), n(), f.path, e.currentTarget.checked))}
                      />
                      <button type="button" class="file-open" onClick={() => setSearchParams({ file: f.path })}>
                        <span class="file-path">{f.path}</span>
                        <span class="file-stat add">+{f.additions ?? 0}</span>
                        <span class="file-stat del">−{f.deletions ?? 0}</span>
                      </button>
                    </li>
                  )}
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
                <span class="muted">({(detail.data?.comments.length ?? 0) + (detail.data?.reviews.length ?? 0)})</span>
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
                <For each={detail.data?.reviews}>
                  {(rv) => (
                    <Show when={rv.body || rv.state}>
                      <div class="comment">
                        <div class="comment-meta muted">
                          {rv.author} <span class={`review-state review-${(rv.state ?? '').toLowerCase()}`}>{rv.state}</span>
                        </div>
                        <Show when={rv.body}>
                          <div class="markdown" innerHTML={rv.body!} />
                        </Show>
                      </div>
                    </Show>
                  )}
                </For>
                <For each={detail.data?.comments}>
                  {(m) => (
                    <div class="comment">
                      <div class="comment-meta muted">{m.author}</div>
                      <div class="markdown" innerHTML={m.body ?? ''} />
                    </div>
                  )}
                </For>
              </details>
          </>
        )}
      </Show>
    </Show>
  )
}
