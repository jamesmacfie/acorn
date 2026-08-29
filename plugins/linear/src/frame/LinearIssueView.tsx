import { createSignal, For, Show } from 'solid-js'
import { Badge, Button, Chip, DescriptionList, Spinner, Tabs, Textarea } from '@acorn/plugin-api/ui'
import type { LinearComment, LinearIssueDetail, LinearRelatedIssue } from '../shared/api'
import { priorityMeta } from '../shared/triage'
import { formatDate, relativeTime } from './model'

// One Linear ticket, rendered inside the frame's own document. Three tabs, Overview, Activity, and
// Comments, all fed by one detail request and drawn with the shell's primitives so a loaded Linear
// looks first-party under every appearance pack.
//
// Three things live outside this file. The right-anchored drawer chrome belongs to whoever opened the
// panel, because a frame cannot Portal past its iframe (client-core/plugins/frames/register.ts). The
// ticket switcher for a task linking several tickets sits in app.tsx beside the task read. Where a
// link in rendered content goes has two answers, re-point this view or hand the URL to the host, so
// it arrives as `onContentClick` from app.tsx, which holds both.

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
  /**
   * A click anywhere in rendered markdown. Where a link goes is not this view's decision: a Linear
   * ticket re-points the view, anything else goes to the host, and both halves need the current target
   * and the bridge, which this file does not have.
   */
  onContentClick(event: MouseEvent): void
  /**
   * Markdown to sanitised HTML. A prop rather than a direct `renderMarkdown` call because a Linear
   * body can point at a private upload, resolving one needs the bridge, and the resolved set is app
   * state that has to tick this render.
   */
  renderBody(markdown: string): string
}

export function LinearIssueView(props: LinearIssueViewProps) {
  const [draft, setDraft] = createSignal('')
  const [replyingId, setReplyingId] = createSignal<string | null>(null)
  const [replyDraft, setReplyDraft] = createSignal('')
  const issue = () => props.issue
  const topComments = () => issue().comments.filter((entry) => !entry.parentId)
  const repliesOf = (id: string) => issue().comments.filter((entry) => entry.parentId === id)

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
      <span class="truncate">{related.title}</span>
      <Show when={related.state}>
        {(state) => <Chip color={state().color}>{state().name}</Chip>}
      </Show>
    </button>
  )

  const comment = (entry: LinearComment, isReply: boolean) => (
    <li class="ln-comment" classList={{ 'ln-comment-reply': isReply }}>
      <div class="ln-comment-head">
        <span class="ln-comment-author">{entry.author ?? 'Unknown'}</span>
        <Show when={relativeTime(entry.createdAt)}>{(age) => <span class="ln-muted">{age()}</span>}</Show>
        <Show when={!isReply}>
          <Button size="sm" variant="bare" onPress={() => {
            setReplyDraft('')
            setReplyingId(replyingId() === entry.id ? null : entry.id)
          }}>Reply</Button>
        </Show>
      </div>
      {/* innerHTML over host-sanitised markup. `renderMarkdown` behind `renderBody` escapes the
          source, allows only http(s) and mailto hrefs and `data:image/` sources, and drops every
          attribute it did not write. */}
      <div class="ui-markdown" innerHTML={props.renderBody(entry.body)} onClick={props.onContentClick} />
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
            onInput={(value) => setReplyDraft(value)}
          />
          <Show when={props.postError}><div class="ln-error" role="alert">{props.postError}</div></Show>
          <div class="ln-composer-actions">
            <Button size="sm" busy={props.posting} disabled={!replyDraft().trim()} onPress={() => send(replyDraft(), entry.id)}>Reply</Button>
            <Button size="sm" variant="bare" onPress={() => setReplyingId(null)}>Cancel</Button>
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
            <Button size="sm" variant="bare" onPress={props.onBack}>← back</Button>
          </Show>
          <Button size="sm" busy={props.refreshing} onPress={props.onRefresh}>Refresh</Button>
          {/* The clipboard, not `ui.openUrl`. The host resolves a URL through its content-link
              ladder, linear's recogniser claims `linear.app/…/issue/…`, and it resolves to the ticket
              already on screen, so the button would re-open where the reader is. A frame cannot ask
              for the browser specifically. See docs/integrations.md § Linear. */}
          <Button size="sm" onPress={() => props.onCopy(issue().url)}>Copy link</Button>
        </div>
      </header>

      <div class="ln-chips">
        <Show when={issue().state}>
          {(state) => <Chip color={state().color}>{state().name}</Chip>}
        </Show>
        <Show when={priorityMeta(issue().priority, issue().priorityLabel).level !== 'none'}>
          <Badge tone="warn" size="xs">{priorityMeta(issue().priority, issue().priorityLabel).label}</Badge>
        </Show>
        <For each={issue().labels ?? []}>
          {(label) => <Chip color={label.color}>{label.name}</Chip>}
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
        {/* DescriptionList's `facts` layout started as this grid. */}
        <DescriptionList layout="facts">
          <Show when={issue().assignee}>{(name) => <DescriptionList.Item label="Assignee">{name()}</DescriptionList.Item>}</Show>
          <Show when={issue().creator}>{(name) => <DescriptionList.Item label="Opened by">{name()} {relativeTime(issue().createdAt)}</DescriptionList.Item>}</Show>
          <Show when={issue().estimate != null}><DescriptionList.Item label="Estimate">{issue().estimate} pts</DescriptionList.Item></Show>
          <Show when={issue().cycle}>{(cycle) => <DescriptionList.Item label="Cycle">C{cycle().number}{cycle().endsAt ? ` → ${formatDate(cycle().endsAt)}` : ''}</DescriptionList.Item>}</Show>
          <Show when={issue().dueDate}>{(due) => <DescriptionList.Item label="Due">{formatDate(due())}</DescriptionList.Item>}</Show>
          <Show when={issue().team}>{(team) => <DescriptionList.Item label="Team">{team().name}</DescriptionList.Item>}</Show>
          <Show when={issue().project}>{(project) => <DescriptionList.Item label="Project">{project().name}</DescriptionList.Item>}</Show>
          <Show when={issue().branchName}>
            {(branch) => (
              <DescriptionList.Item label="Branch">
                <span class="ln-branch">
                  <code>{branch()}</code>
                  <Button size="sm" variant="bare" onPress={() => props.onCopy(branch())}>Copy</Button>
                </span>
              </DescriptionList.Item>
            )}
          </Show>
        </DescriptionList>

        <Show when={issue().description} fallback={<p class="ln-muted">No description.</p>}>
          {(description) => <div class="ui-markdown" innerHTML={props.renderBody(description())} onClick={props.onContentClick} />}
        </Show>

        <Show when={(issue().attachments ?? []).length}>
          <h2 class="ln-section-head">Links</h2>
          {/* Real anchors, on the same delegated handler the markdown uses. Attachments are the one
              section that is nothing but links: a PR, a Figma file, a Sentry issue. `Copy link` stays
              alongside, because an attachment is what a reader most often pastes somewhere, and
              unlike the header URL it does not point back to this view. */}
          <ul class="ln-links" onClick={props.onContentClick}>
            <For each={issue().attachments}>
              {(attachment) => (
                <li>
                  <Show when={attachment.sourceType}>{(kind) => <span class="ln-attachment-kind">{kind()}</span>}</Show>
                  <a class="ln-attachment-title" href={attachment.url}>{attachment.title}</a>
                  <Button size="sm" variant="bare" onPress={() => props.onCopy(attachment.url)}>Copy link</Button>
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
            onInput={(value) => setDraft(value)}
          />
          <Show when={props.postError && !replyingId()}><div class="ln-error" role="alert">{props.postError}</div></Show>
          <div class="ln-composer-actions">
            <Button size="sm" busy={props.posting} disabled={!draft().trim()} onPress={() => send(draft())}>Comment</Button>
            <Show when={props.posting}><Spinner size="sm" label="Sending" /></Show>
          </div>
        </div>
      </section>
    </>
  )
}
