import { createSignal, For, Show } from 'solid-js'
import { Badge, Button, renderMarkdown, Spinner, Tabs, Textarea } from '@acorn/plugin-api/ui'
import type { LinearComment, LinearIssueDetail, LinearRelatedIssue } from '../shared/api'
import { priorityMeta } from '../shared/triage'
import { formatDate, linearIdentifierFromHref, relativeTime } from './model'

// One Linear ticket, rendered inside the frame's own document. The same three tabs the compiled panel
// had — Overview / Activity / Comments, all fed by the one detail request — drawn with the shell's own
// primitives so a loaded Linear looks like a first-party one under every appearance pack.
//
// Two things the compiled panel owned are gone from here, and both moved OUT rather than being lost.
// The right-anchored drawer chrome belongs to whoever opened the panel, because a frame cannot Portal
// past its iframe (client-core/plugins/frames/register.tsx). And the ticket switcher for a task linking
// several tickets is the app shell's business, so it sits in app.tsx beside the task read.

// Glyph per activity kind (Linear-style compact feed). State changes are tinted by the new state.
const ACTIVITY_GLYPH: Record<string, string> = { created: '✦', state: '◐', assignee: '○', label: '▣', title: '✎' }

const isDone = (issue: LinearRelatedIssue) => issue.state?.type === 'completed' || issue.state?.type === 'canceled'

export type LinearIssueViewProps = {
  issue: LinearIssueDetail
  activeTab: string
  refreshing: boolean
  posting: boolean
  postError: string
  /** Present when a relation row re-targeted the view, so there is somewhere to go back to. */
  overridden: boolean
  onTab(id: string): void
  onRefresh(): void
  onBack(): void
  onOpenRelated(identifier: string): void
  onComment(body: string, parentId?: string): void
  onCopy(text: string): void
}

export function LinearIssueView(props: LinearIssueViewProps) {
  const [draft, setDraft] = createSignal('')
  const [replyingId, setReplyingId] = createSignal<string | null>(null)
  const [replyDraft, setReplyDraft] = createSignal('')
  const issue = () => props.issue
  const topComments = () => issue().comments.filter((entry) => !entry.parentId)
  const repliesOf = (id: string) => issue().comments.filter((entry) => entry.parentId === id)

  // A linear.app link inside rendered markdown re-points this view instead of dying against the frame's
  // sandbox, which has no `allow-popups` and so cannot open a tab at all. Any other href stays inert;
  // that is a real limitation of the tier and is written down in docs/third-party/linear.md.
  const onMarkdownClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const href = (event.target as HTMLElement | null)?.closest('a')?.getAttribute('href')
    const identifier = linearIdentifierFromHref(href)
    if (!identifier) return
    event.preventDefault()
    props.onOpenRelated(identifier)
  }

  const send = (body: string, parentId?: string) => {
    if (!body.trim()) return
    props.onComment(body.trim(), parentId)
    if (parentId) {
      setReplyDraft('')
      setReplyingId(null)
    } else setDraft('')
  }

  const relatedRow = (related: LinearRelatedIssue, done?: boolean) => (
    <button type="button" class="ln-related-row" classList={{ 'ln-done': done }} onClick={() => props.onOpenRelated(related.identifier)}>
      <Show when={done !== undefined}><span class="ln-related-check">{done ? '✓' : '○'}</span></Show>
      <span class="ln-related-id">{related.identifier}</span>
      <span class="ln-related-title">{related.title}</span>
      <Show when={related.state}>
        {(state) => <span class="ln-state" style={{ '--state-color': state().color }}>{state().name}</span>}
      </Show>
    </button>
  )

  const comment = (entry: LinearComment, isReply: boolean) => (
    <li class="ln-comment" classList={{ 'ln-comment-reply': isReply }}>
      <div class="ln-comment-head">
        <span class="ln-comment-author">{entry.author ?? 'Unknown'}</span>
        <Show when={relativeTime(entry.createdAt)}>{(age) => <span class="ln-muted">{age()}</span>}</Show>
        <Show when={!isReply}>
          <Button size="sm" variant="bare" onClick={() => {
            setReplyDraft('')
            setReplyingId(replyingId() === entry.id ? null : entry.id)
          }}>Reply</Button>
        </Show>
      </div>
      {/* innerHTML over host-sanitised markup. `renderMarkdown` escapes the source, allows only
          http(s)/mailto hrefs and drops every attribute it did not write — which is exactly why it was
          moved onto the frame-safe barrel rather than reimplemented here. */}
      <div class="markdown" innerHTML={renderMarkdown(entry.body)} onClick={onMarkdownClick} />
      <Show when={repliesOf(entry.id).length}>
        <ul class="ln-comment-children"><For each={repliesOf(entry.id)}>{(child) => comment(child, true)}</For></ul>
      </Show>
      <Show when={replyingId() === entry.id}>
        <div class="ln-composer">
          <Textarea
            ref={(el: HTMLTextAreaElement) => queueMicrotask(() => el.focus())}
            rows={3}
            placeholder="Write a reply…"
            value={replyDraft()}
            onInput={(event) => setReplyDraft(event.currentTarget.value)}
          />
          <Show when={props.postError}><div class="ln-error" role="alert">{props.postError}</div></Show>
          <div class="ln-composer-actions">
            <Button size="sm" busy={props.posting} disabled={!replyDraft().trim()} onClick={() => send(replyDraft(), entry.id)}>Reply</Button>
            <Button size="sm" variant="bare" onClick={() => setReplyingId(null)}>Cancel</Button>
          </div>
        </div>
      </Show>
    </li>
  )

  return (
    <>
      <header class="ln-head">
        <div class="ln-heading">
          <div class="ln-eyebrow">{issue().identifier}</div>
          <h1>{issue().title}</h1>
        </div>
        <div class="ln-head-actions">
          <Show when={props.overridden}>
            <Button size="sm" variant="bare" onClick={props.onBack}>← back</Button>
          </Show>
          <Button size="sm" busy={props.refreshing} onClick={props.onRefresh}>Refresh</Button>
          {/* A frame cannot open a browser tab, so the honest affordance is the URL on the clipboard. */}
          <Button size="sm" onClick={() => props.onCopy(issue().url)}>Copy link</Button>
        </div>
      </header>

      <div class="ln-chips">
        <Show when={issue().state}>
          {(state) => <span class="ln-state" style={{ '--state-color': state().color }}>{state().name}</span>}
        </Show>
        <Show when={priorityMeta(issue().priority, issue().priorityLabel).level !== 'none'}>
          <Badge tone="warn" size="xs">{priorityMeta(issue().priority, issue().priorityLabel).label}</Badge>
        </Show>
        <For each={issue().labels ?? []}>
          {(label) => <span class="ln-label-chip" style={{ '--label-color': label.color }}>{label.name}</span>}
        </For>
      </div>

      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'activity', label: 'Activity', count: issue().activity.length },
          { id: 'comments', label: 'Comments', count: issue().comments.length },
        ]}
        active={props.activeTab}
        onChange={props.onTab}
        idPrefix="linear"
        ariaLabel="Linear ticket sections"
      />

      <section id="linear-panel-overview" class="ln-panel" role="tabpanel" aria-labelledby="linear-tab-overview" hidden={props.activeTab !== 'overview'}>
        <dl class="ln-facts">
          <Show when={issue().assignee}>{(name) => <div><dt>Assignee</dt><dd>{name()}</dd></div>}</Show>
          <Show when={issue().creator}>{(name) => <div><dt>Opened by</dt><dd>{name()} {relativeTime(issue().createdAt)}</dd></div>}</Show>
          <Show when={issue().estimate != null}><div><dt>Estimate</dt><dd>{issue().estimate} pts</dd></div></Show>
          <Show when={issue().cycle}>{(cycle) => <div><dt>Cycle</dt><dd>C{cycle().number}{cycle().endsAt ? ` → ${formatDate(cycle().endsAt)}` : ''}</dd></div>}</Show>
          <Show when={issue().dueDate}>{(due) => <div><dt>Due</dt><dd>{formatDate(due())}</dd></div>}</Show>
          <Show when={issue().team}>{(team) => <div><dt>Team</dt><dd>{team().name}</dd></div>}</Show>
          <Show when={issue().project}>{(project) => <div><dt>Project</dt><dd>{project().name}</dd></div>}</Show>
          <Show when={issue().branchName}>
            {(branch) => (
              <div>
                <dt>Branch</dt>
                <dd class="ln-branch">
                  <code>{branch()}</code>
                  <Button size="sm" variant="bare" onClick={() => props.onCopy(branch())}>Copy</Button>
                </dd>
              </div>
            )}
          </Show>
        </dl>

        <Show when={issue().description} fallback={<p class="ln-muted">No description.</p>}>
          {(description) => <div class="markdown" innerHTML={renderMarkdown(description())} onClick={onMarkdownClick} />}
        </Show>

        <Show when={(issue().attachments ?? []).length}>
          <h2 class="ln-section-head">Links</h2>
          <ul class="ln-links">
            <For each={issue().attachments}>
              {(attachment) => (
                <li>
                  <Show when={attachment.sourceType}>{(kind) => <span class="ln-attachment-kind">{kind()}</span>}</Show>
                  <span class="ln-attachment-title">{attachment.title}</span>
                  <Button size="sm" variant="bare" onClick={() => props.onCopy(attachment.url)}>Copy link</Button>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <Show when={issue().parent || (issue().children ?? []).length}>
          {(() => {
            const children = () => issue().children ?? []
            const doneCount = () => children().filter(isDone).length
            return (
              <>
                <h2 class="ln-section-head">
                  {children().length ? 'Sub-issues' : 'Parent'}
                  <Show when={children().length}><span class="ln-muted"> · {doneCount()}/{children().length}</span></Show>
                </h2>
                <Show when={children().length}>
                  <div class="ln-subissue-bar"><i style={{ width: `${Math.round((doneCount() / children().length) * 100)}%` }} /></div>
                </Show>
                <div class="ln-related">
                  <Show when={issue().parent}>{(parent) => <><span class="ln-related-label">Parent</span>{relatedRow(parent())}</>}</Show>
                  <For each={children()}>{(child) => relatedRow(child, isDone(child))}</For>
                </div>
              </>
            )
          })()}
        </Show>

        <Show when={(issue().relations ?? []).length}>
          <h2 class="ln-section-head">Relations</h2>
          <div class="ln-related">
            <For each={issue().relations}>
              {(relation) => <><span class="ln-related-label">{relation.label}</span>{relatedRow(relation.issue)}</>}
            </For>
          </div>
        </Show>
      </section>

      <section id="linear-panel-activity" class="ln-panel" role="tabpanel" aria-labelledby="linear-tab-activity" hidden={props.activeTab !== 'activity'}>
        <Show when={issue().activity.length} fallback={<p class="ln-muted">No activity yet.</p>}>
          <ul class="ln-activity">
            <For each={issue().activity}>
              {(entry) => (
                <li class="ln-activity-row">
                  <span class="ln-activity-icon" style={entry.color ? { color: entry.color } : undefined}>
                    {ACTIVITY_GLYPH[entry.icon] ?? '•'}
                  </span>
                  <span class="ln-activity-text">
                    <Show when={entry.actor}>{(name) => <span class="ln-activity-actor">{name()} </span>}</Show>
                    {entry.text}
                  </span>
                  <Show when={relativeTime(entry.createdAt)}>{(age) => <span class="ln-muted">{age()}</span>}</Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>

      <section id="linear-panel-comments" class="ln-panel" role="tabpanel" aria-labelledby="linear-tab-comments" hidden={props.activeTab !== 'comments'}>
        <ul class="ln-comments">
          <For each={topComments()} fallback={<li class="ln-muted">No comments yet.</li>}>{(entry) => comment(entry, false)}</For>
        </ul>
        <div class="ln-composer">
          <Textarea
            rows={3}
            placeholder="Leave a comment…"
            value={draft()}
            onInput={(event) => setDraft(event.currentTarget.value)}
          />
          <Show when={props.postError && !replyingId()}><div class="ln-error" role="alert">{props.postError}</div></Show>
          <div class="ln-composer-actions">
            <Button size="sm" busy={props.posting} disabled={!draft().trim()} onClick={() => send(draft())}>Comment</Button>
            <Show when={props.posting}><Spinner size="sm" label="Sending" /></Show>
          </div>
        </div>
      </section>
    </>
  )
}
