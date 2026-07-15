import { createEffect, createSignal, For, Match, on, Show, Switch } from 'solid-js'
import CopyButton from '../../../../core/client/ui/CopyButton'
import { fileStatusMeta } from '../displayMeta'
import MentionTextarea from '../MentionTextarea'
import type { Thread } from '../../../../core/client/queries'
import { UserAvatar } from '../../../../core/client/ui/UserAvatar'
import { fileAnchor, type CodeRow, type FileRow, type GapRow, type HunkRow, type LoadDiffRow, type Row, type ThreadRowT } from './model'
import { markTokens, type FindHighlight } from './find'
import { persistDraft } from '../comments/draftState'

export type LineComposerController = {
  isOpen: () => boolean
  body: () => string
  setOpen: (open: boolean) => void
  setBody: (body: string) => void
}

export type ThreadCollapseController = {
  collapsed: () => boolean
  setCollapsed: (collapsed: boolean) => void
}

export function NonCodeRow(props: {
  row: Exclude<Row, CodeRow>
  onMutated: () => void
  resolveThread: (threadId: string, resolved: boolean) => Promise<unknown>
  reply: (commentDatabaseId: number, body: string) => Promise<unknown>
  expandGap?: (gap: GapRow) => Promise<unknown>
  retryDiff?: (file: LoadDiffRow['file']) => void
  mentions?: string[]
  threadCollapse?: (thread: Thread) => ThreadCollapseController
  fileCollapsed?: (path: string) => boolean
  onToggleFileCollapse?: (path: string) => void
  onLayoutChange?: () => void
}) {
  return (
    <Switch>
      <Match when={props.row.kind === 'file' ? (props.row as FileRow) : null}>
        {(f) => {
          const status = () => fileStatusMeta(f().file.status)
          return (
            <div class="diff-file-head copyable" id={fileAnchor(f().file.path)}>
              <Show when={props.onToggleFileCollapse}>
                <button
                  type="button"
                  class="diff-file-collapse"
                  aria-expanded={!props.fileCollapsed?.(f().file.path)}
                  title={props.fileCollapsed?.(f().file.path) ? 'Expand file' : 'Collapse file'}
                  onClick={() => props.onToggleFileCollapse?.(f().file.path)}
                >
                  {props.fileCollapsed?.(f().file.path) ? '▸' : '▾'}
                </button>
              </Show>
              <span class={`file-status file-status-${status().tone}`} title={status().label}>
                {status().letter}
              </span>
              <span class="diff-file-path">{f().file.path}</span>
              <CopyButton text={() => f().file.path} title="Copy path" />
              <span class="file-stat add">+{f().file.additions ?? 0}</span>
              <span class="file-stat del">&#8722;{f().file.deletions ?? 0}</span>
            </div>
          )
        }}
      </Match>
      <Match when={props.row.kind === 'hunk' ? (props.row as HunkRow) : null}>
        {(h) => <span class="diff-hunk-text">{h().text}</span>}
      </Match>
      <Match when={props.row.kind === 'gap' ? (props.row as GapRow) : null}>
        {(g) => <GapRowView gap={g()} expandGap={props.expandGap} />}
      </Match>
      <Match when={props.row.kind === 'nodiff'}>
        <span class="diff-nodiff muted">No diff (binary or too large).</span>
      </Match>
      <Match when={props.row.kind === 'load' ? (props.row as LoadDiffRow) : null}>
        {(row) => (
          <span class="diff-load" classList={{ 'diff-load-error': row().status === 'error' }}>
            <span>{row().status === 'error' ? 'Could not load diff.' : 'Loading diff…'}</span>
            <Show when={row().status === 'error'}>
              <button class="diff-load-retry" onClick={() => props.retryDiff?.(row().file)}>
                Retry
              </button>
            </Show>
          </span>
        )}
      </Match>
      <Match when={props.row.kind === 'thread' ? (props.row as ThreadRowT) : null}>
        {(t) => (
          <ThreadRow
            thread={t().thread}
            onMutated={props.onMutated}
            resolveThread={props.resolveThread}
            reply={props.reply}
            mentions={props.mentions ?? []}
            collapse={props.threadCollapse?.(t().thread)}
            onLayoutChange={props.onLayoutChange}
          />
        )}
      </Match>
    </Switch>
  )
}

function GapRowView(props: { gap: GapRow; expandGap?: (gap: GapRow) => Promise<unknown> }) {
  const [busy, setBusy] = createSignal(false)
  const label = () => (props.gap.side === 'bottom' ? 'Expand below' : `Expand ${props.gap.count ?? ''} lines`.replace('  ', ' '))
  const run = async () => {
    if (!props.expandGap || props.gap.sha == null) return
    setBusy(true)
    try {
      await props.expandGap(props.gap)
    } finally {
      setBusy(false)
    }
  }
  return (
    <button class="diff-gap" disabled={busy() || props.gap.sha == null || !props.expandGap} onClick={run}>
      {busy() ? 'Expanding…' : `⋯ ${label()} ⋯`}
    </button>
  )
}

export function DiffLine(props: {
  r: CodeRow
  canAdd: boolean
  addComment: (body: string) => Promise<unknown>
  onMutated: () => void
  composer?: LineComposerController
  mentions?: string[]
  highlight?: FindHighlight
}) {
  return (
    <>
      <span class="diff-gutter">{props.r.oldNo ?? ''}</span>
      <span class="diff-gutter">{props.r.newNo ?? ''}</span>
      <span class="diff-marker">{props.r.kind === 'insert' ? '+' : props.r.kind === 'delete' ? '\u2212' : ' '}</span>
      <LineComposer canAdd={props.canAdd} addComment={props.addComment} onMutated={props.onMutated} composer={props.composer} mentions={props.mentions ?? []}>
        <CodeContent r={props.r} highlight={props.highlight} />
      </LineComposer>
    </>
  )
}

export function SplitCell(props: {
  r: CodeRow | null
  gutter: number | null
  canAdd: boolean
  addComment: (body: string) => Promise<unknown>
  onMutated: () => void
  composer?: LineComposerController
  mentions?: string[]
  highlight?: FindHighlight
}) {
  return (
    <div
      class="diff-split-cell"
      classList={{
        'diff-add': props.r?.kind === 'insert',
        'diff-del': props.r?.kind === 'delete',
        'diff-split-empty': !props.r,
      }}
    >
      <Show when={props.r} fallback={<span class="diff-gutter" />}>
        {(r) => (
          <>
            <span class="diff-gutter">{props.gutter ?? ''}</span>
            <span class="diff-marker">{r().kind === 'insert' ? '+' : r().kind === 'delete' ? '\u2212' : ' '}</span>
            <LineComposer canAdd={props.canAdd} addComment={props.addComment} onMutated={props.onMutated} composer={props.composer} mentions={props.mentions ?? []}>
              <CodeContent r={r()} highlight={props.highlight} />
            </LineComposer>
          </>
        )}
      </Show>
    </div>
  )
}

function CodeContent(props: { r: CodeRow; highlight?: FindHighlight }) {
  const hl = () => (props.highlight && props.highlight.ranges.length ? props.highlight : null)
  return (
    <Show
      when={props.r.words}
      fallback={
        <span class="diff-code">
          <Show
            when={hl()}
            fallback={<For each={props.r.toks}>{(t) => <span style={{ '--l': t.light, '--r': t.dark }}>{t.content}</span>}</For>}
          >
            {(h) => (
              <For each={markTokens(props.r.toks, h().ranges, h().current)}>
                {(t) => (
                  <span style={{ '--l': t.light, '--r': t.dark }} classList={{ 'diff-find-hit': t.mark > 0, 'diff-find-current': t.mark === 2 }}>
                    {t.content}
                  </span>
                )}
              </For>
            )}
          </Show>
        </span>
      }
    >
      {(words) => (
        <span class="diff-code">
          <Show
            when={hl()}
            fallback={
              <For each={words()}>
                {(w) => <span classList={{ 'diff-word-add': w.kind === 'add', 'diff-word-del': w.kind === 'del' }}>{w.content}</span>}
              </For>
            }
          >
            {(h) => (
              <For each={markTokens(words(), h().ranges, h().current)}>
                {(w) => (
                  <span
                    classList={{ 'diff-word-add': w.kind === 'add', 'diff-word-del': w.kind === 'del', 'diff-find-hit': w.mark > 0, 'diff-find-current': w.mark === 2 }}
                  >
                    {w.content}
                  </span>
                )}
              </For>
            )}
          </Show>
        </span>
      )}
    </Show>
  )
}

function LineComposer(props: {
  canAdd: boolean
  addComment: (body: string) => Promise<unknown>
  onMutated: () => void
  composer?: LineComposerController
  mentions: string[]
  children: unknown
}) {
  const [busy, setBusy] = createSignal(false)
  const [err, setErr] = createSignal<string | null>(null)

  const submit = async () => {
    const text = props.composer?.body().trim() ?? ''
    if (!text) return
    setBusy(true)
    setErr(null)
    try {
      await props.addComment(text)
      props.composer?.setBody('')
      props.composer?.setOpen(false)
      props.onMutated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Show when={props.canAdd && props.composer}>
        <button class="diff-add-btn" title="Comment on this line" onClick={() => props.composer?.setOpen(!props.composer.isOpen())}>
          +
        </button>
      </Show>
      {props.children as never}
      <Show when={props.composer?.isOpen()}>
        <div class="diff-composer" onClick={(e) => e.stopPropagation()}>
          <MentionTextarea
            class="diff-reply-input"
            placeholder={'Comment on this line\u2026'}
            value={props.composer?.body() ?? ''}
            onInput={(v) => props.composer?.setBody(v)}
            mentions={props.mentions}
          />
          <div class="diff-composer-actions">
            <button disabled={busy() || !(props.composer?.body().trim() ?? '')} onClick={submit}>
              {busy() ? 'Adding\u2026' : 'Comment'}
            </button>
            <button onClick={() => props.composer?.setOpen(false)}>Cancel</button>
          </div>
          <Show when={err()}>
            <span class="diff-thread-err">{err()}</span>
          </Show>
        </div>
      </Show>
    </>
  )
}

function ThreadRow(props: {
  thread: Thread
  onMutated: () => void
  resolveThread: (threadId: string, resolved: boolean) => Promise<unknown>
  reply: (commentDatabaseId: number, body: string) => Promise<unknown>
  mentions: string[]
  collapse?: ThreadCollapseController
  onLayoutChange?: () => void
}) {
  const [optimisticResolved, setOptimisticResolved] = createSignal<boolean | null>(null)
  const [localCollapsed, setLocalCollapsed] = createSignal(props.thread.resolved)
  const [body, setBody] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [err, setErr] = createSignal<string | null>(null)
  const replyId = () => props.thread.comments[0]?.databaseId ?? null
  // Persist an in-progress reply per thread so it survives navigation and reloads.
  persistDraft(() => `thread-reply:${props.thread.threadId}`, body, setBody)
  const resolved = () => optimisticResolved() ?? props.thread.resolved
  const collapsed = () => resolved() && (props.collapse?.collapsed() ?? localCollapsed())
  const setCollapsed = (value: boolean) => {
    if (props.collapse) props.collapse.setCollapsed(value)
    else setLocalCollapsed(value)
  }

  const publishLayoutChange = () => props.onLayoutChange?.()

  createEffect(on(
    () => [props.thread.threadId, props.thread.resolved] as const,
    ([threadId, serverResolved], previous) => {
      if (!previous) {
        publishLayoutChange()
        return
      }
      if (previous && previous[0] === threadId && previous[1] === serverResolved) return
      setOptimisticResolved(null)
      setCollapsed(serverResolved)
      publishLayoutChange()
    },
  ))

  const toggleResolve = async () => {
    const nextResolved = !resolved()
    setBusy(true)
    setErr(null)
    try {
      await props.resolveThread(props.thread.threadId, nextResolved)
      setOptimisticResolved(nextResolved)
      setCollapsed(nextResolved)
      publishLayoutChange()
      props.onMutated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  const toggleCollapsed = () => {
    setCollapsed(!collapsed())
    publishLayoutChange()
  }

  const submitReply = async () => {
    const text = body().trim()
    const id = replyId()
    if (!text || id == null) return
    setBusy(true)
    setErr(null)
    try {
      await props.reply(id, text)
      setBody('')
      props.onMutated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      class="diff-thread"
      classList={{
        'diff-thread-resolved': resolved(),
        'diff-thread-collapsed': collapsed(),
      }}
    >
      <div class="diff-thread-head">
        <span class="diff-thread-status">{resolved() ? 'Resolved' : 'Conversation'}</span>
        <Show when={resolved()}>
          <button class="diff-thread-link" onClick={toggleCollapsed}>
            {collapsed() ? 'Show' : 'Hide'}
          </button>
        </Show>
        <button class="diff-thread-link" disabled={busy()} onClick={toggleResolve}>
          {resolved() ? 'Unresolve' : 'Resolve'}
        </button>
      </div>
      <Show when={!collapsed()}>
        <For each={props.thread.comments}>
          {(c) => (
            <div class="comment diff-thread-comment">
              <div class="comment-meta comment-meta-with-avatar">
                <UserAvatar login={c.author} />
                <strong>{c.author ?? 'unknown'}</strong>
              </div>
              <div class="markdown" innerHTML={c.body ?? ''} />
            </div>
          )}
        </For>
        <div class="diff-reply">
          <MentionTextarea
            class="diff-reply-input"
            placeholder={replyId() == null ? 'Reply unavailable' : 'Reply\u2026'}
            disabled={replyId() == null}
            value={body()}
            onInput={setBody}
            mentions={props.mentions}
          />
          <div class="diff-composer-actions">
            <button disabled={busy() || replyId() == null || !body().trim()} onClick={submitReply}>
              {busy() ? 'Replying\u2026' : 'Reply'}
            </button>
          </div>
          <Show when={err()}>
            <span class="diff-thread-err">{err()}</span>
          </Show>
        </div>
      </Show>
    </div>
  )
}
