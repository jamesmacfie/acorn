import { createComputed, createEffect, createMemo, createSignal, For, onCleanup, Show, untrack, type Accessor, type JSX, type Setter } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { formatChord, formatRelativeTime } from '@acorn/plugin-api/client'
import {
  Badge, Button, Card, CodeBlock, Composer, CopyButton, Inline, Kbd, Link, Stack, Text, Timeline, UserAvatar,
} from '@acorn/plugin-api/ui'
import { createDiffSnippets, type DiffSnippetAnchor, type DiffSnippetLine, type DiffSnippets } from '@acorn/plugin-api/ui/diff'
import { ProviderHtml } from '@acorn/plugin-api/ui/host'
import type { PrModel } from './prModel'
import type { PullCommit, Thread, ThreadComment } from '../../shared/api'
import { fetchDiffSegments, pullDiffOptions } from '../queries'
import { hasRenderableBody, reviewAction, threadComments, type ConversationEntry } from './model'

// One turn of a pull request's conversation, as a `Card` in a `Timeline`. Four kinds: a comment, a
// review summary, a commit, and a review thread pinned to a file.
//
// Accepted difference from the hand-drawn version this replaces: every turn is the kit's card rather
// than four bespoke boxes, so a commit and a comment now share their padding and their rule.
//
// A turn's byline is drawn at once and its body when the turn comes near the viewport (`near`, from
// the kit's Timeline.Turn). GitHub's rendered HTML, with its images, and a thread's quoted code are
// the expensive parts, and a pull request with hundreds of threads used to build every one on open.

/** Where a body goes until its turn comes near. Words rather than a blank, so a card is never empty. */
const NOT_DRAWN = 'Shown when you scroll to it.'

export function ConversationEntryItem(props: {
  entry: ConversationEntry
  near: Accessor<boolean>
  snippets: DiffSnippets
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
          near={props.near}
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
          near={props.near}
          onLinkClick={props.onLinkClick}
        />
      )
    case 'commit':
      return <CommitItem commit={props.entry.commit} />
    case 'thread':
      return (
        <FileThreadItem
          thread={props.entry.thread}
          near={props.near}
          snippets={props.snippets}
          onOpenFile={props.onOpenFile}
          onLinkClick={props.onLinkClick}
        />
      )
  }
}

/** Who did what, when. The header line every turn carries. The verb is words; a review's verdict is
 *  also the colour of its card's stripe. */
function Byline(props: { author: string | null | undefined; action: string; createdAt: number | null }) {
  return (
    <Inline>
      <UserAvatar login={props.author ?? null} />
      <Text emphasis="strong">{props.author ?? 'unknown'}</Text>
      <Text emphasis="muted">{props.action}</Text>
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
  near: Accessor<boolean>
  onLinkClick: (event: MouseEvent) => void
}) {
  const hasBody = () => hasRenderableBody(props.body)
  const stripe = (): 'accent' | 'ok' | 'danger' => {
    switch ((props.state ?? '').toUpperCase()) {
      case 'APPROVED': return 'ok'
      case 'CHANGES_REQUESTED': return 'danger'
      default: return 'accent'
    }
  }
  let text = ''
  return (
    <Card pad="sm" stripe={stripe()}>
      <Stack gap="row">
        <Inline>
          <Byline author={props.author} action={props.action} createdAt={props.createdAt ?? null} />
          <Show when={hasBody()}>
            <CopyButton text={() => text || props.body || ''} title="Copy comment" />
          </Show>
        </Inline>
        <Show when={hasBody()}>
          <Show when={props.near()} fallback={<Text emphasis="muted">{NOT_DRAWN}</Text>}>
            <ProviderHtml html={props.body!} onLinkClick={props.onLinkClick} onText={(value) => { text = value }} />
          </Show>
        </Show>
      </Stack>
    </Card>
  )
}

/** A snippet line as one row of monospace text. The gutters are padded rather than coloured: a
 *  `CodeBlock` is the kit's excerpt, and a two-colour diff band is the diff viewer's job, which is
 *  one press away on the file button above it. */
const snippetLine = (line: DiffSnippetLine): string => {
  const marker = line.kind === 'insert' ? '+' : line.kind === 'delete' ? '−' : ' '
  const gutter = `${line.oldNo ?? ''}`.padStart(5) + `${line.newNo ?? ''}`.padStart(6)
  return `${gutter} ${marker} ${line.text}`
}

function FileThreadItem(props: {
  thread: Thread
  near: Accessor<boolean>
  snippets: DiffSnippets
  onOpenFile: (path: string) => void
  onLinkClick: (event: MouseEvent) => void
}) {
  // Reactive, because the turn outlives a refetch: a reply arriving is a new thread object under the
  // same turn key, not a new turn.
  const comments = createMemo(() => threadComments(props.thread))
  const first = () => comments()[0]
  const path = () => props.thread.path ?? 'Unknown file'
  const fileName = () => path().split('/').pop() || path()
  // Where the thread sits in the diff, by the rule the diff viewer places it with: the new side unless
  // GitHub said LEFT. An outdated thread has no line, and so no snippet.
  const anchor = createMemo((): DiffSnippetAnchor | null =>
    props.thread.path && props.thread.line != null
      ? { path: props.thread.path, side: props.thread.side === 'LEFT' ? 'old' : 'new', line: props.thread.line }
      : null)
  // Its segment is read once the turn comes near, and let go when the turn leaves the DOM.
  createEffect(() => {
    const at = anchor()
    if (at && props.near()) onCleanup(props.snippets.want(at))
  })
  const snippet = () => {
    const at = anchor()
    return at && props.near() ? props.snippets.snippet(at) : undefined
  }
  const lines = () => {
    const shown = snippet()
    return shown?.state === 'ready' && shown.lines.length ? shown.lines : undefined
  }

  return (
    <Card pad="sm" stripe="accent">
      <Stack gap="row">
        <Inline>
          <Byline author={first()?.author} action="commented" createdAt={first()?.createdAt ?? null} />
          <Show when={props.thread.resolved}><Badge size="xs" tone="ok">Resolved</Badge></Show>
        </Inline>
        {/* The file's name and line, which fit the column; the path is in the tip. */}
        <Link tip={path()} onPress={() => props.thread.path && props.onOpenFile(props.thread.path)}>
          {fileName()}{props.thread.line != null ? `, line ${props.thread.line}` : ''}
        </Link>
        <Show
          when={lines()}
          fallback={<Show when={snippet()?.state === 'unavailable'}><Text emphasis="muted">Snippet unavailable.</Text></Show>}
        >
          {(shown) => (
            <CodeBlock size="xs" maxHeight="block">
              {shown().map(snippetLine).join('\n')}
            </CodeBlock>
          )}
        </Show>
        <For each={comments()}>
          {(comment, index) => (
            <FileThreadComment comment={comment} compact={index() === 0} near={props.near} onLinkClick={props.onLinkClick} />
          )}
        </For>
      </Stack>
    </Card>
  )
}

function FileThreadComment(props: { comment: ThreadComment; compact: boolean; near: Accessor<boolean>; onLinkClick: (event: MouseEvent) => void }) {
  return (
    <Stack gap="row">
      <Show when={!props.compact}>
        <Byline author={props.comment.author} action="commented" createdAt={props.comment.createdAt} />
      </Show>
      <Show when={hasRenderableBody(props.comment.body)} fallback={<Text emphasis="muted">No content.</Text>}>
        <Show when={props.near()} fallback={<Text emphasis="muted">{NOT_DRAWN}</Text>}>
          <ProviderHtml html={props.comment.body!} onLinkClick={props.onLinkClick} />
        </Show>
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
  const { owner, repo, number } = props.model.scope
  // Turns by key, the way the agent transcript draws its rows: `For` over the keys, and each turn reads
  // its entry from a signal of its own. Every refetch rebuilds the entries, and `For` over the objects
  // would rebuild every turn with them, dropping a selection, a scroll place and every drawn body.
  const entries = createMemo(() => model().conversationEntries())
  const keys = createMemo(() => entries().map((entry) => entry.key))
  const byKey = createMemo(() => new Map(entries().map((entry) => [entry.key, entry])))
  const turns = new Map<string, Setter<ConversationEntry>>()
  createComputed(() => {
    const current = byKey()
    for (const [key, set] of turns) {
      const entry = current.get(key)
      if (entry) set(entry)
    }
  })
  // The diff's document says which segment holds each thread's line, so a thread's snippet reads one
  // segment rather than a parsed patch (docs/github-integration/surfaces.md § Conversation). Only asked for
  // when some thread has a line to quote.
  const anchored = createMemo(() => entries().some((entry) => entry.kind === 'thread' && entry.thread.line != null))
  const diff = createQuery(() => pullDiffOptions(owner, repo, number, anchored()))
  const snippets = createDiffSnippets({
    files: () => diff.data?.document.files,
    load: (requests, signal) => fetchDiffSegments(owner, repo, requests, signal),
  })
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
        <For each={keys()} fallback={<Text emphasis="muted">No comments or commits.</Text>}>
          {(key) => {
            const [entry, set] = createSignal(untrack(byKey).get(key)!)
            turns.set(key, set)
            onCleanup(() => turns.delete(key))
            return (
              <Timeline.Turn key={key}>
                {(near) => (
                  <ConversationEntryItem
                    entry={entry()}
                    near={near}
                    snippets={snippets}
                    onOpenFile={props.onOpenFile}
                    onLinkClick={props.onLinkClick}
                  />
                )}
              </Timeline.Turn>
            )
          }}
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
      hint={<><Kbd size="xs">{formatChord('meta+enter')}</Kbd> to send</>}
      secondary={props.secondary}
    />
  )
}
