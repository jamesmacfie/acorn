import { createMemo, For, Show } from 'solid-js'
import { formatRelativeTime } from '../../displayMeta'
import type { PullCommit, Thread, ThreadComment } from '../../queries'
import { UserAvatar } from '../../UserAvatar'
import { hasRenderableBody, reviewAction, threadComments, threadSnippetFromIndex, type ConversationEntry, type ThreadSnippetIndex } from './model'

export function ConversationEntryItem(props: {
  entry: ConversationEntry
  snippetIndex: ThreadSnippetIndex
  onOpenFile: (path: string) => void
}) {
  switch (props.entry.kind) {
    case 'comment':
      return <ConversationItem author={props.entry.comment.author} action="commented" body={props.entry.comment.body} createdAt={props.entry.createdAt} />
    case 'review':
      return <ConversationItem author={props.entry.review.author} action={reviewAction(props.entry.review.state)} body={props.entry.review.body} state={props.entry.review.state} createdAt={props.entry.createdAt} />
    case 'commit':
      return <CommitItem commit={props.entry.commit} />
    case 'thread':
      return <FileThreadItem thread={props.entry.thread} snippetIndex={props.snippetIndex} onOpenFile={props.onOpenFile} />
  }
}

function CommitItem(props: { commit: PullCommit }) {
  const shortSha = () => props.commit.sha.slice(0, 7)
  const author = () => props.commit.author ?? props.commit.authorLogin ?? 'unknown'

  return (
    <div class="commit-row">
      <UserAvatar login={props.commit.authorLogin} />
      <div class="commit-main">
        <div class="commit-primary">
          <span class="commit-sha">{shortSha()}</span>
          <span class="commit-message">{props.commit.message || 'No commit message.'}</span>
        </div>
        <div class="commit-secondary">
          <span class="commit-author">{author()}</span>
          <Show when={formatRelativeTime(props.commit.committedAt)}>
            {(age) => <span class="comment-time">{age()}</span>}
          </Show>
        </div>
      </div>
    </div>
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

function FileThreadItem(props: { thread: Thread; snippetIndex: ThreadSnippetIndex; onOpenFile: (path: string) => void }) {
  const comments = threadComments(props.thread)
  const first = () => comments[0]
  const snippet = createMemo(() => threadSnippetFromIndex(props.thread, props.snippetIndex))
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
                <span class="diff-marker">{line.kind === 'insert' ? '+' : line.kind === 'delete' ? '\u2212' : ' '}</span>
                <code>{line.text}</code>
              </div>
            )}
          </For>
        </div>
      </Show>
      <div class="file-thread-comments">
        <For each={comments}>
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
