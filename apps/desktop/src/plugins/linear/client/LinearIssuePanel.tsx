import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { formatRelativeTime } from '../../../core/client/lib/formatRelativeTime'
import { linearIssueKey, linearIssueOptions, type LinearComment } from '../../../core/client/queries'
import type { LinearRelatedIssue } from '../../../core/shared/api'
import { postLinearComment } from '../../github/client/mutations'
import { renderMarkdown } from '../../../core/client/integrations/markdown'
import { priorityMeta } from './model'
import { Tabs, type TabDef } from '../../../core/client/ui/Tabs'
import CopyButton from '../../../core/client/ui/CopyButton'

export type LinearIssueTarget = { identifier: string; connectionId?: string }
const targetKey = (target: LinearIssueTarget) => `${target.connectionId ?? 'unscoped'}:${target.identifier}`

// Glyph per activity kind (Linear-style compact feed). State changes are tinted by the new state.
const ACTIVITY_GLYPH: Record<string, string> = { created: '✦', state: '◐', assignee: '○', label: '▣', title: '✎' }

type PanelTab = 'overview' | 'activity' | 'comments'
const fmtDate = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleDateString() : '')
const isDone = (issue: LinearRelatedIssue) => issue.state?.type === 'completed' || issue.state?.type === 'canceled'

// One referenced Linear ticket. Two variants: the default right-anchored overlay (PullDetail's
// Integrations section — mirrors ChecksPanel) and `variant="pane"`, which renders the same content
// in a Task-view layout slot like the other provider panes (docs/panes.md). Fetches full detail on
// open via linearIssueOptions, which forces a fresh server read so the panel is always current.
// Content is split across Overview / Activity / Comments tabs (mirrors RollbarItemPanel); the one
// detail request feeds all three. Parent/sub-issue/relation rows re-target the panel in place.
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
  // Related-issue navigation: an override identifier (same connection) re-points the detail query
  // without disturbing the caller's selection. Cleared whenever the caller's target changes.
  const [override, setOverride] = createSignal<string | null>(null)
  const activeIdentifier = () => override() ?? props.target.identifier
  const issue = createQuery(() => linearIssueOptions(activeIdentifier(), true, props.target.connectionId))

  const [tab, setTab] = createSignal<PanelTab>('overview')
  const [draft, setDraft] = createSignal('')
  const [replyingId, setReplyingId] = createSignal<string | null>(null)
  const [replyDraft, setReplyDraft] = createSignal('')
  const [posting, setPosting] = createSignal(false)
  const [postError, setPostError] = createSignal('')
  const [refreshing, setRefreshing] = createSignal(false)

  createEffect(on(() => targetKey(props.target), () => {
    setOverride(null)
    setTab('overview')
  }, { defer: true }))

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
      await postLinearComment(activeIdentifier(), text, parentId, props.target.connectionId)
      setDraft('')
      setReplyDraft('')
      setReplyingId(null)
      await qc.invalidateQueries({ queryKey: linearIssueKey(activeIdentifier(), props.target.connectionId) })
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

  const refresh = async () => {
    if (refreshing()) return
    setRefreshing(true)
    try {
      await qc.invalidateQueries({ queryKey: linearIssueKey(activeIdentifier(), props.target.connectionId) })
    } finally {
      setRefreshing(false)
    }
  }

  const openRelated = (identifier: string) => {
    setOverride(identifier)
    setTab('overview')
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

  // A clickable reference to another issue (parent, sub-issue, relation target). Re-targets the panel.
  const relatedRow = (related: LinearRelatedIssue, opts?: { done?: boolean }) => (
    <button type="button" class="linear-related-row" classList={{ done: opts?.done }} onClick={() => openRelated(related.identifier)}>
      <Show when={opts?.done !== undefined}>
        <span class="linear-related-check">{opts?.done ? '✓' : '○'}</span>
      </Show>
      <span class="linear-related-id">{related.identifier}</span>
      <span class="linear-related-title">{related.title}</span>
      <Show when={related.state}>{(s) => <span class="linear-related-state" style={{ '--state-color': s().color }}>{s().name}</span>}</Show>
    </button>
  )

  // Multi-ticket chip strip (a task linking several Linear tickets); only one renders per call site.
  const ticketChips = () => (
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

  const panelTabs = (): TabDef[] => [
    { id: 'overview', label: 'Overview' },
    { id: 'activity', label: 'Activity', count: issue.data?.activity?.length },
    { id: 'comments', label: 'Comments', count: issue.data?.comments?.length },
  ]

  const overview = () => {
    const data = issue.data
    if (!data) return null
    const prio = priorityMeta(data.priority, data.priorityLabel)
    const children = data.children ?? []
    const doneCount = children.filter(isDone).length
    return (
      <>
        <h2 class="linear-issue-title">{data.title}</h2>
        <div class="linear-issue-meta">
          <Show when={state()}>
            {(s) => <span class="linear-state" style={{ '--state-color': s().color }}>{s().name}</span>}
          </Show>
          <Show when={prio.level !== 'none'}>
            <span class="linear-priority" data-p={prio.level} title={prio.label} aria-label={prio.label}><i /><i /><i /></span>
          </Show>
          <Show when={data.creator}>
            {(name) => (
              <span class="muted">
                opened by {name()}
                <Show when={formatRelativeTime(data.createdAt)}>{(age) => <> · {age()}</>}</Show>
              </span>
            )}
          </Show>
        </div>

        <Show when={(data.labels ?? []).length}>
          <div class="linear-labels">
            <For each={data.labels}>{(l) => <span class="linear-label-chip" style={{ '--label-color': l.color }}>{l.name}</span>}</For>
          </div>
        </Show>

        <dl class="linear-meta-grid">
          <Show when={data.assignee}><div><dt>Assignee</dt><dd>{data.assignee}</dd></div></Show>
          <Show when={data.estimate != null}><div><dt>Estimate</dt><dd>{data.estimate} pts</dd></div></Show>
          <Show when={data.cycle}>{(c) => <div><dt>Cycle</dt><dd>C{c().number}{c().endsAt ? ` → ${fmtDate(c().endsAt)}` : ''}</dd></div>}</Show>
          <Show when={data.dueDate}>{(d) => <div><dt>Due</dt><dd>{fmtDate(d())}</dd></div>}</Show>
          <Show when={data.team}>{(t) => <div><dt>Team</dt><dd>{t().name}</dd></div>}</Show>
          <Show when={data.project}>{(p) => <div><dt>Project</dt><dd>{p().name}</dd></div>}</Show>
          <Show when={data.branchName}>
            {(branch) => (
              <div>
                <dt>Branch</dt>
                <dd class="linear-branch copyable">
                  <code>{branch()}</code>
                  <CopyButton text={branch} title="Copy branch name" />
                </dd>
              </div>
            )}
          </Show>
        </dl>

        <Show when={data.description} fallback={<p class="muted">No description.</p>}>
          {(desc) => <div class="markdown" innerHTML={renderMarkdown(desc())} />}
        </Show>

        <Show when={(data.attachments ?? []).length}>
          <h3 class="linear-section-head">Links</h3>
          <ul class="linear-links">
            <For each={data.attachments}>
              {(a) => (
                <li class="linear-attachment">
                  <Show when={a.sourceType}>{(kind) => <span class="linear-attachment-kind">{kind()}</span>}</Show>
                  <a href={a.url} target="_blank" rel="noreferrer">{a.title}</a>
                  <Show when={a.subtitle}>{(sub) => <span class="muted"> {sub()}</span>}</Show>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <Show when={data.parent || children.length}>
          <h3 class="linear-section-head">
            {children.length ? 'Sub-issues' : 'Parent'}
            <Show when={children.length}><span class="muted"> · {doneCount}/{children.length}</span></Show>
          </h3>
          <Show when={children.length}>
            <div class="linear-subissue-bar"><i style={{ width: `${Math.round((doneCount / children.length) * 100)}%` }} /></div>
          </Show>
          <div class="linear-related">
            <Show when={data.parent}>{(p) => (<><span class="linear-related-label">Parent</span>{relatedRow(p())}</>)}</Show>
            <For each={children}>{(child) => relatedRow(child, { done: isDone(child) })}</For>
          </div>
        </Show>

        <Show when={(data.relations ?? []).length}>
          <h3 class="linear-section-head">Relations</h3>
          <div class="linear-related">
            <For each={data.relations}>
              {(rel) => (<><span class="linear-related-label">{rel.label}</span>{relatedRow(rel.issue)}</>)}
            </For>
          </div>
        </Show>
      </>
    )
  }

  const body = () => (
    <div class="integrations-panel-body linear-tab-panel" role="tabpanel" onClick={props.onContentClick}>
      <Show when={!issue.isLoading} fallback={<p class="muted">Loading ticket…</p>}>
        <Show when={issue.data} fallback={<p class="muted">{issue.isError ? 'Failed to load ticket.' : 'Not found.'}</p>}>
          <Show when={tab() === 'overview'}>{overview()}</Show>

          <Show when={tab() === 'activity'}>
            <Show when={(issue.data?.activity ?? []).length} fallback={<p class="muted">No activity yet.</p>}>
              <ul class="linear-activity">
                <For each={issue.data?.activity ?? []}>
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
          </Show>

          <Show when={tab() === 'comments'}>
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
          </Show>
        </Show>
      </Show>
    </div>
  )

  const backAndRefresh = () => (
    <>
      <Show when={override()}>
        <button type="button" class="linear-panel-back" title="Back to the linked ticket" onClick={() => setOverride(null)}>← back</button>
      </Show>
      <button type="button" class="new-pr-btn" disabled={refreshing()} onClick={() => void refresh()}>
        {refreshing() ? 'Refreshing…' : 'Refresh'}
      </button>
    </>
  )

  const tabStrip = () => (
    <Tabs tabs={panelTabs()} active={tab()} onChange={(id) => setTab(id as PanelTab)} idPrefix="linear-panel" ariaLabel="Linear ticket sections" />
  )

  return (
    <Show
      when={props.variant === 'pane'}
      fallback={
        <Portal>
          <div class="integrations-panel-backdrop" onClick={props.onClose} />
          <aside class="integrations-panel">
            <header class="integrations-panel-head">
              <span class="integrations-panel-title">{activeIdentifier()}</span>
              {backAndRefresh()}
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
            {ticketChips()}
            {tabStrip()}
            {body()}
          </aside>
        </Portal>
      }
    >
      <section class="pane linear-pane">
        <div class="section-header">
          <span>Linear · {activeIdentifier()}</span>
          {backAndRefresh()}
          <Show when={issue.data?.url}>
            {(url) => (
              <a class="integrations-panel-link muted" style={{ 'text-align': 'right' }} href={url()} target="_blank" rel="noreferrer">
                Open in Linear ↗
              </a>
            )}
          </Show>
        </div>
        {ticketChips()}
        {tabStrip()}
        {body()}
      </section>
    </Show>
  )
}
