import { createSignal, For, Match, Show, Switch } from 'solid-js'
import { fileStatusMeta } from '../../displayMeta'
import type { Thread } from '../../queries'
import { UserAvatar } from '../../UserAvatar'
import { fileAnchor, type CodeRow, type FileRow, type HunkRow, type Row, type ThreadRowT } from './model'

export function NonCodeRow(props: {
  row: Exclude<Row, CodeRow>
  onMutated: () => void
  resolveThread: (threadId: string, resolved: boolean) => Promise<unknown>
  reply: (commentDatabaseId: number, body: string) => Promise<unknown>
}) {
  return (
    <Switch>
      <Match when={props.row.kind === 'file' ? (props.row as FileRow) : null}>
        {(f) => {
          const status = () => fileStatusMeta(f().file.status)
          return (
            <div class="diff-file-head" id={fileAnchor(f().file.path)}>
              <span class={`file-status file-status-${status().tone}`} title={status().label}>
                {status().letter}
              </span>
              <span class="diff-file-path">{f().file.path}</span>
              <span class="file-stat add">+{f().file.additions ?? 0}</span>
              <span class="file-stat del">&#8722;{f().file.deletions ?? 0}</span>
            </div>
          )
        }}
      </Match>
      <Match when={props.row.kind === 'hunk' ? (props.row as HunkRow) : null}>
        {(h) => <span class="diff-hunk-text">{h().text}</span>}
      </Match>
      <Match when={props.row.kind === 'nodiff'}>
        <span class="diff-nodiff muted">No diff (binary or too large).</span>
      </Match>
      <Match when={props.row.kind === 'thread' ? (props.row as ThreadRowT) : null}>
        {(t) => <ThreadRow thread={t().thread} onMutated={props.onMutated} resolveThread={props.resolveThread} reply={props.reply} />}
      </Match>
    </Switch>
  )
}

export function DiffLine(props: {
  r: CodeRow
  canAdd: boolean
  addComment: (body: string) => Promise<unknown>
  onMutated: () => void
}) {
  return (
    <>
      <span class="diff-gutter">{props.r.oldNo ?? ''}</span>
      <span class="diff-gutter">{props.r.newNo ?? ''}</span>
      <span class="diff-marker">{props.r.kind === 'insert' ? '+' : props.r.kind === 'delete' ? '\u2212' : ' '}</span>
      <LineComposer canAdd={props.canAdd} addComment={props.addComment} onMutated={props.onMutated}>
        <CodeContent r={props.r} />
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
            <LineComposer canAdd={props.canAdd} addComment={props.addComment} onMutated={props.onMutated}>
              <CodeContent r={r()} />
            </LineComposer>
          </>
        )}
      </Show>
    </div>
  )
}

function CodeContent(props: { r: CodeRow }) {
  return (
    <Show
      when={props.r.words}
      fallback={
        <span class="diff-code">
          <For each={props.r.toks}>{(t) => <span style={{ '--l': t.light, '--r': t.dark }}>{t.content}</span>}</For>
        </span>
      }
    >
      {(words) => (
        <span class="diff-code">
          <For each={words()}>
            {(w) => (
              <span classList={{ 'diff-word-add': w.kind === 'add', 'diff-word-del': w.kind === 'del' }}>{w.content}</span>
            )}
          </For>
        </span>
      )}
    </Show>
  )
}

function LineComposer(props: {
  canAdd: boolean
  addComment: (body: string) => Promise<unknown>
  onMutated: () => void
  children: unknown
}) {
  const [open, setOpen] = createSignal(false)
  const [body, setBody] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [err, setErr] = createSignal<string | null>(null)

  const submit = async () => {
    const text = body().trim()
    if (!text) return
    setBusy(true)
    setErr(null)
    try {
      await props.addComment(text)
      setBody('')
      setOpen(false)
      props.onMutated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Show when={props.canAdd}>
        <button class="diff-add-btn" title="Comment on this line" onClick={() => setOpen((v) => !v)}>
          +
        </button>
      </Show>
      {props.children as never}
      <Show when={open()}>
        <div class="diff-composer" onClick={(e) => e.stopPropagation()}>
          <textarea
            class="diff-reply-input"
            placeholder={'Comment on this line\u2026'}
            value={body()}
            onInput={(e) => setBody(e.currentTarget.value)}
          />
          <div class="diff-composer-actions">
            <button disabled={busy() || !body().trim()} onClick={submit}>
              {busy() ? 'Adding\u2026' : 'Comment'}
            </button>
            <button onClick={() => setOpen(false)}>Cancel</button>
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
}) {
  const [collapsed, setCollapsed] = createSignal(props.thread.resolved)
  const [body, setBody] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [err, setErr] = createSignal<string | null>(null)
  const replyId = () => props.thread.comments[0]?.databaseId ?? null

  const toggleResolve = async () => {
    setBusy(true)
    setErr(null)
    try {
      await props.resolveThread(props.thread.threadId, !props.thread.resolved)
      props.onMutated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed')
    } finally {
      setBusy(false)
    }
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
    <div class="diff-thread" classList={{ 'diff-thread-resolved': props.thread.resolved }}>
      <div class="diff-thread-head">
        <span class="diff-thread-status">{props.thread.resolved ? 'Resolved' : 'Conversation'}</span>
        <Show when={props.thread.resolved}>
          <button class="diff-thread-link" onClick={() => setCollapsed((v) => !v)}>
            {collapsed() ? 'Show' : 'Hide'}
          </button>
        </Show>
        <button class="diff-thread-link" disabled={busy()} onClick={toggleResolve}>
          {props.thread.resolved ? 'Unresolve' : 'Resolve'}
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
          <textarea
            class="diff-reply-input"
            placeholder={replyId() == null ? 'Reply unavailable' : 'Reply\u2026'}
            disabled={replyId() == null}
            value={body()}
            onInput={(e) => setBody(e.currentTarget.value)}
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
