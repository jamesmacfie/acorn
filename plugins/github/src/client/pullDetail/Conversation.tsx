import { createMemo, For, Show, type JSX } from 'solid-js'
import { formatRelativeTime } from '@acorn/plugin-api/client'
import {
  Badge, Button, Card, CodeBlock, Composer, CopyButton, Inline, Kbd, Stack, Text, Timeline, UserAvatar,
} from '@acorn/plugin-api/ui'
import { ProviderHtml } from '@acorn/plugin-api/ui/host'
import type { PrModel } from './prModel'
import type { PullCommit, Thread, ThreadComment } from '../../contract/api'
import {
  hasRenderableBody, reviewAction, threadComments, threadSnippetFromIndex, type ConversationEntry,
  type SnippetLine, type ThreadSnippetIndex,
} from './model'

// One turn of a pull request's conversation, as a `Card` in a `Timeline`. Four kinds: a comment, a
// review summary, a commit, and a review thread pinned to a file.
//
// Accepted difference from the hand-drawn version this replaces: every turn is the kit's card rather
// than four bespoke boxes, so a commit and a comment now share their padding and their rule.

export function ConversationEntryItem(props: {
  entry: ConversationEntry
  snippetIndex: ThreadSnippetIndex
  onOpenFile: (path: string) => void
  onLinkClick: (event: MouseEvent) => void
}) {
  switch (props.entry.kind) {
    case 'comment':
      return (
        <ConversationItem
          author={props.entry.comment.author}
          action="commented"
          body={props.entry.comment.body}
          createdAt={props.entry.createdAt}
          onLinkClick={props.onLinkClick}
        />
      )
    case 'review':
      return (
        <ConversationItem
          author={props.entry.review.author}
          action={reviewAction(props.entry.review.state)}
          body={props.entry.review.body}
          state={props.entry.review.state}
          createdAt={props.entry.createdAt}
          onLinkClick={props.onLinkClick}
        />
      )
    case 'commit':
      return <CommitItem commit={props.entry.commit} />
    case 'thread':
      return (
        <FileThreadItem
          thread={props.entry.thread}
          snippetIndex={props.snippetIndex}
          onOpenFile={props.onOpenFile}
          onLinkClick={props.onLinkClick}
        />
      )
  }
}

/** Who did what, when. The header line every turn carries. */
function Byline(props: { author: string | null | undefined; action: string; state?: string | null; createdAt: number | null }) {
  const tone = (): 'ok' | 'danger' | 'muted' | undefined => {
    switch ((props.state ?? '').toUpperCase()) {
      case 'APPROVED': return 'ok'
      case 'CHANGES_REQUESTED': return 'danger'
      case '': return undefined
      default: return 'muted'
    }
  }
  return (
    <Inline>
      <UserAvatar login={props.author ?? null} />
      <Text emphasis="strong">{props.author ?? 'unknown'}</Text>
      <Text emphasis="muted" tone={tone()}>{props.action}</Text>
      <Show when={formatRelativeTime(props.createdAt)}>{(age) => <Text emphasis="muted">{age()}</Text>}</Show>
    </Inline>
  )
}

function CommitItem(props: { commit: PullCommit }) {
  const author = () => props.commit.author ?? props.commit.authorLogin ?? 'unknown'
  return (
    <Card pad="sm">
      <Stack gap="row">
        <Inline>
          <UserAvatar login={props.commit.authorLogin} />
          <Badge size="xs" tone="accent">{props.commit.sha.slice(0, 7)}</Badge>
          <Text>{props.commit.message || 'No commit message.'}</Text>
        </Inline>
        <Inline>
          <Text emphasis="muted">{author()}</Text>
          <Show when={formatRelativeTime(props.commit.committedAt)}>{(age) => <Text emphasis="muted">{age()}</Text>}</Show>
        </Inline>
      </Stack>
    </Card>
  )
}

function ConversationItem(props: {
  author: string | null
  action: string
  body: string | null
  state?: string | null
  createdAt?: number | null
  onLinkClick: (event: MouseEvent) => void
}) {
  const hasBody = () => hasRenderableBody(props.body)
  let text = ''
  return (
    <Card pad="sm" stripe="accent">
      <Stack gap="row">
        <Inline>
          <Byline author={props.author} action={props.action} state={props.state} createdAt={props.createdAt ?? null} />
          <Show when={hasBody()}>
            <CopyButton text={() => text || props.body || ''} title="Copy comment" />
          </Show>
        </Inline>
        <Show when={hasBody()} fallback={<Text emphasis="muted">No written summary.</Text>}>
          <ProviderHtml html={props.body!} onLinkClick={props.onLinkClick} onText={(value) => { text = value }} />
        </Show>
      </Stack>
    </Card>
  )
}

/** A snippet line as one row of monospace text. The gutters are padded rather than coloured: a
 *  `CodeBlock` is the kit's excerpt, and a two-colour diff band is the diff viewer's job, which is
 *  one press away on the file button above it. */
const snippetLine = (line: SnippetLine): string => {
  const marker = line.kind === 'insert' ? '+' : line.kind === 'delete' ? '−' : ' '
  const gutter = `${line.oldNo ?? ''}`.padStart(5) + `${line.newNo ?? ''}`.padStart(6)
  return `${gutter} ${marker} ${line.text}`
}

function FileThreadItem(props: {
  thread: Thread
  snippetIndex: ThreadSnippetIndex
  onOpenFile: (path: string) => void
  onLinkClick: (event: MouseEvent) => void
}) {
  const comments = threadComments(props.thread)
  const first = () => comments[0]
  const snippet = createMemo(() => threadSnippetFromIndex(props.thread, props.snippetIndex))
  const path = () => props.thread.path ?? 'Unknown file'

  return (
    <Card pad="sm" stripe="accent">
      <Stack gap="row">
        <Inline>
          <Byline author={first()?.author} action="commented" createdAt={first()?.createdAt ?? null} />
          <Show when={props.thread.resolved}><Badge size="xs" tone="ok">resolved</Badge></Show>
        </Inline>
        <Button
          variant="ghost"
          size="sm"
          onPress={() => props.thread.path && props.onOpenFile(props.thread.path)}
        >
          {path()}{props.thread.line != null ? ` L${props.thread.line}` : ''} — view in diff
        </Button>
        <Show when={snippet().length}>
          <CodeBlock size="xs" maxHeight="block">
            {snippet().map(snippetLine).join('\n')}
          </CodeBlock>
        </Show>
        <For each={comments}>
          {(comment, index) => <FileThreadComment comment={comment} compact={index() === 0} onLinkClick={props.onLinkClick} />}
        </For>
      </Stack>
    </Card>
  )
}

function FileThreadComment(props: { comment: ThreadComment; compact: boolean; onLinkClick: (event: MouseEvent) => void }) {
  return (
    <Stack gap="row">
      <Show when={!props.compact}>
        <Byline author={props.comment.author} action="commented" createdAt={props.comment.createdAt} />
      </Show>
      <Show when={hasRenderableBody(props.comment.body)} fallback={<Text emphasis="muted">No content.</Text>}>
        <ProviderHtml html={props.comment.body!} onLinkClick={props.onLinkClick} />
      </Show>
    </Stack>
  )
}

/** The whole conversation: the comment box, the turns, and the review verbs. */
export function PrConversation(props: {
  model: PrModel
  onOpenFile: (path: string) => void
  onLinkClick: (event: MouseEvent) => void
}) {
  const model = () => props.model
  return (
    <Stack gap="section">
      <Show when={!model().readOnly}>
        <Stack>
          <ComposerBox
            placeholder="Leave a comment…"
            value={model().draftText()}
            onInput={model().setDraftText}
            mentions={model().mentions()}
            busy={model().comment.isPending}
            onSubmit={model().submitComment}
          />
          <ComposerBox
            placeholder="Leave a review comment…"
            value={model().reviewBody()}
            onInput={model().setReviewBody}
            mentions={model().mentions()}
            busy={model().review.isPending}
            submitLabel="Comment"
            onSubmit={() => model().submitReviewWith('COMMENT')}
            secondary={
              <>
                {/* Approve is the only verb that works on an empty body, so it cannot be the primary
                    submit — the composer disables that without text. */}
                <Button busy={model().review.isPending} onPress={() => model().submitReviewWith('APPROVE')}>Approve</Button>
                <Button
                  disabled={model().review.isPending || !model().reviewBody().trim()}
                  onPress={() => model().submitReviewWith('REQUEST_CHANGES')}
                >Request changes</Button>
              </>
            }
          />
        </Stack>
      </Show>
      <Timeline ariaLabel="Pull request conversation">
        <For
          each={model().conversationEntries()}
          fallback={<Text emphasis="muted">No comments or commits.</Text>}
        >
          {(entry) => (
            <Timeline.Turn>
              <ConversationEntryItem
                entry={entry}
                snippetIndex={model().threadSnippetIndex()}
                onOpenFile={props.onOpenFile}
                onLinkClick={props.onLinkClick}
              />
            </Timeline.Turn>
          )}
        </For>
      </Timeline>
    </Stack>
  )
}

// Both composers are the kit's, with different verbs, so the chord hint is spelled once.
function ComposerBox(props: {
  placeholder: string
  value: string
  onInput: (value: string) => void
  mentions: string[]
  busy: boolean
  submitLabel?: string
  onSubmit: () => void
  secondary?: JSX.Element
}) {
  return (
    <Composer
      placeholder={props.placeholder}
      value={props.value}
      onInput={props.onInput}
      mentions={props.mentions}
      busy={props.busy}
      submitLabel={props.submitLabel}
      onSubmit={() => props.onSubmit()}
      hint={<><Kbd size="xs">⌘↵</Kbd> to send</>}
      secondary={props.secondary}
    />
  )
}
