import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { formatRelativeTime } from '../../github/client/displayMeta'
import { linearIssueKey, linearIssueOptions, type LinearComment } from '../../../core/client/queries'
import { postLinearComment } from '../../github/client/mutations'
import { renderMarkdown } from '../../../core/client/integrations/markdown'

export type LinearIssueTarget = { identifier: string; connectionId?: string }
const targetKey = (target: LinearIssueTarget) => `${target.connectionId ?? 'unscoped'}:${target.identifier}`

// Glyph per activity kind (Linear-style compact feed). State changes are tinted by the new state.
const ACTIVITY_GLYPH: Record<string, string> = { created: '✦', state: '◐', assignee: '○', label: '▣', title: '✎' }

// One referenced Linear ticket. Two variants: the default right-anchored overlay (PullDetail's
// Integrations section — mirrors ChecksPanel) and `variant="pane"`, which renders the same content
// in a Task-view layout slot like the other provider panes (docs/panes.md). Fetches full detail on
// open via linearIssueOptions, which forces a fresh server read so the panel is always current.
// Bodies are raw markdown (renderMarkdown → sanitized HTML). Activity Log replays the issue
// history; comments are threaded with an inline reply box (GitHub-style), plus a bottom composer.
export default function LinearIssuePanel(props: {
  target: LinearIssueTarget
  onClose: () => void
  onContentClick: (e: MouseEvent) => void
  // When a task links several Linear tickets, the panel shows a chip strip to switch between
  // them (docs/workspaces-and-tasks.md). Omitted by the single-ticket PR-detail caller.
  targets?: LinearIssueTarget[]
  onSelectTarget?: (target: LinearIssueTarget) => void
  variant?: 'overlay' | 'pane'
}) {
  const qc = useQueryClient()
  const issue = createQuery(() => linearIssueOptions(props.target.identifier, true, props.target.connectionId))

  const [draft, setDraft] = createSignal('')
  const [replyingId, setReplyingId] = createSignal<string | null>(null)
  const [replyDraft, setReplyDraft] = createSignal('')
  const [posting, setPosting] = createSignal(false)
  const [postError, setPostError] = createSignal('')

  // Escape-close belongs to the overlay; the pane variant closes via the layout (slot ✕ / switcher).
  onMount(() => {
    if (props.variant === 'pane') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    onCleanup(() => window.removeEventListener('keydown', onKey))
  })

  const send = async (body: string, parentId?: string) => {
    const text = body.trim()
    if (!text) return
    setPosting(true)
    setPostError('')
    try {
      await postLinearComment(props.target.identifier, text, parentId, props.target.connectionId)
      setDraft('')
      setReplyDraft('')
      setReplyingId(null)
      await qc.invalidateQueries({ queryKey: linearIssueKey(props.target.identifier, props.target.connectionId) })
    } catch (e) {
      setPostError((e as Error).message || 'Failed to add comment.')
    } finally {
      setPosting(false)
    }
  }
  const toggleReply = (id: string) => {
    setReplyDraft('')
    setPostError('')
    setReplyingId(replyingId() === id ? null : id)
  }

  const state = () => issue.data?.state
  const topComments = () => (issue.data?.comments ?? []).filter((c) => !c.parentId)
  const repliesOf = (id: string) => (issue.data?.comments ?? []).filter((c) => c.parentId === id)

  const comment = (c: LinearComment, isReply: boolean) => (
    <li class="linear-comment" classList={{ 'linear-comment-reply': isReply }}>
      <div class="linear-comment-head">
        <span class="linear-comment-author">{c.author ?? 'Unknown'}</span>
        <Show when={formatRelativeTime(c.createdAt)}>{(age) => <span class="muted">{age()}</span>}</Show>
        <Show when={!isReply}>
          <button type="button" class="linear-reply-btn" onClick={() => toggleReply(c.id)}>
            Reply
          </button>
        </Show>
      </div>
      <div class="markdown" innerHTML={renderMarkdown(c.body)} />
      <Show when={repliesOf(c.id).length}>
        <ul class="linear-comment-children">
          <For each={repliesOf(c.id)}>{(child) => comment(child, true)}</For>
        </ul>
      </Show>
      <Show when={replyingId() === c.id}>
        <div class="composer linear-reply-box">
          <textarea
            ref={(el) => el.focus()}
            class="composer-input"
            placeholder="Write a reply…"
            value={replyDraft()}
            onInput={(e) => setReplyDraft(e.currentTarget.value)}
          />
          <Show when={postError()}>
            <div class="action-error">{postError()}</div>
          </Show>
          <div class="pr-actions">
            <button type="button" onClick={() => send(replyDraft(), c.id)} disabled={posting() || !replyDraft().trim()}>
              {posting() ? 'Sending…' : 'Reply'}
            </button>
            <button type="button" onClick={() => setReplyingId(null)}>
              Cancel
            </button>
          </div>
        </div>
      </Show>
    </li>
  )

  // Chip strip + scrolling detail body, shared verbatim by both variants (only one renders —
  // `variant` is fixed per call site).
  const tabs = () => (
    <Show when={(props.targets?.length ?? 0) > 1}>
      <div class="integrations-panel-tabs">
        <For each={props.targets}>
          {(target) => (
            <button
              type="button"
              class="integrations-panel-tab"
              classList={{ active: targetKey(target) === targetKey(props.target) }}
              onClick={() => props.onSelectTarget?.(target)}
            >
              {target.identifier}
            </button>
          )}
        </For>
      </div>
    </Show>
  )
  const body = () => (
    <div class="integrations-panel-body" onClick={props.onContentClick}>
          <Show when={!issue.isLoading} fallback={<p class="muted">Loading ticket…</p>}>
            <Show when={issue.data} fallback={<p class="muted">{issue.isError ? 'Failed to load ticket.' : 'Not found.'}</p>}>
              {(data) => (
                <>
                  <h2 class="linear-issue-title">{data().title}</h2>
                  <div class="linear-issue-meta">
                    <Show when={state()}>
                      {(s) => (
                        <span class="linear-state" style={{ '--state-color': s().color }}>
                          {s().name}
                        </span>
                      )}
                    </Show>
                    <Show when={data().assignee}>{(a) => <span class="muted">{a()}</span>}</Show>
                  </div>
                  <Show when={data().description} fallback={<p class="muted">No description.</p>}>
                    {(desc) => <div class="markdown" innerHTML={renderMarkdown(desc())} />}
                  </Show>

                  <Show when={(data().activity ?? []).length}>
                    <h3 class="linear-section-head">Activity Log</h3>
                    <ul class="linear-activity">
                      <For each={data().activity ?? []}>
                        {(a) => (
                          <li class="linear-activity-row">
                            <span class="linear-activity-icon" style={a.color ? { color: a.color } : undefined}>
                              {ACTIVITY_GLYPH[a.icon] ?? '•'}
                            </span>
                            <span class="linear-activity-text">
                              <Show when={a.actor}>{(name) => <span class="linear-activity-actor">{name()} </span>}</Show>
                              {a.text}
                            </span>
                            <Show when={formatRelativeTime(a.createdAt)}>{(age) => <span class="muted linear-activity-time">{age()}</span>}</Show>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>

                  <h3 class="linear-section-head">Comments ({topComments().length})</h3>
                  <ul class="linear-comments">
                    <For each={topComments()} fallback={<li class="muted">No comments yet.</li>}>{(c) => comment(c, false)}</For>
                  </ul>

                  <div class="composer linear-composer-sep">
                    <textarea
                      class="composer-input"
                      placeholder="Leave a comment…"
                      value={draft()}
                      onInput={(e) => setDraft(e.currentTarget.value)}
                    />
                    <Show when={postError() && !replyingId()}>
                      <div class="action-error">{postError()}</div>
                    </Show>
                    <button type="button" onClick={() => send(draft())} disabled={posting() || !draft().trim()}>
                      {posting() ? 'Sending…' : 'Comment'}
                    </button>
                  </div>
                </>
              )}
            </Show>
          </Show>
        </div>
  )

  return (
    <Show
      when={props.variant === 'pane'}
      fallback={
        <Portal>
          <div class="integrations-panel-backdrop" onClick={props.onClose} />
          <aside class="integrations-panel">
            <header class="integrations-panel-head">
              <span class="integrations-panel-title">{props.target.identifier}</span>
              <Show when={issue.data?.url}>
                {(url) => (
                  <a class="integrations-panel-link muted" href={url()} target="_blank" rel="noreferrer">
                    Open in Linear ↗
                  </a>
                )}
              </Show>
              <button type="button" class="integrations-panel-close" onClick={props.onClose} aria-label="Close">
                ✕
              </button>
            </header>
            {tabs()}
            {body()}
          </aside>
        </Portal>
      }
    >
      <section class="pane linear-pane">
        <div class="section-header">
          <span>Linear · {props.target.identifier}</span>
          <Show when={issue.data?.url}>
            {(url) => (
              <a class="integrations-panel-link muted" style={{ 'text-align': 'right' }} href={url()} target="_blank" rel="noreferrer">
                Open in Linear ↗
              </a>
            )}
          </Show>
        </div>
        {tabs()}
        {body()}
      </section>
    </Show>
  )
}
