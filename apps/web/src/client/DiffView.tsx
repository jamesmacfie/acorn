import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { useParams, useSearchParams } from '@solidjs/router'
import { createVirtualizer } from '@tanstack/solid-virtual'
import gitdiffParser from 'gitdiff-parser'
import { filesOptions, pullDetailOptions, type Thread } from './queries'
import { addReviewComment, replyReview, resolveThread } from './mutations'
import { getHighlighter, langFor } from './shiki'
import { synth } from './diff'

// Right (Diff) pane: parse the selected file's unified-diff patch, syntax-highlight (Shiki, dual
// theme via CSS vars), virtualize rows (docs/git-diff.md, docs/ui-style.md §6). Review threads are
// interleaved as variable-height rows anchored to their diff line; the virtualizer measures each
// rendered row (measureElement + data-index) so thread height needn't be known ahead of time.

type Tok = { content: string; light: string; dark: string }
type Row =
  | { kind: 'hunk'; text: string }
  | { kind: 'normal' | 'insert' | 'delete'; oldNo: number | null; newNo: number | null; toks: Tok[] }
  | { kind: 'thread'; thread: Thread }

export default function DiffView() {
  const params = useParams()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const owner = () => params.owner ?? ''
  const repo = () => params.repo ?? ''
  const number = () => params.number ?? ''

  const files = createQuery(() => filesOptions(owner(), repo(), number(), !!params.number))
  const detail = createQuery(() => pullDetailOptions(owner(), repo(), number(), !!params.number))
  const selected = createMemo(() => files.data?.find((f) => f.path === searchParams.file) ?? null)
  const headSha = () => detail.data?.pull?.headSha ?? null

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['pull', owner(), repo(), number()] })

  // Parse + highlight off the render path; re-runs when the selected file changes. Threads are
  // applied separately at render time so they refetch/rerender without re-tokenizing the patch.
  const [base] = createResource(
    () => selected(),
    async (file): Promise<Exclude<Row, { kind: 'thread' }>[]> => {
      if (!file?.patch) return []
      const parsed = gitdiffParser.parse(synth(file.path, file.patch))
      const hunks = parsed[0]?.hunks ?? []
      const hl = await getHighlighter()
      const lang = langFor(file.path)
      const tok = (content: string): Tok[] => {
        if (lang === 'text') return [{ content, light: '', dark: '' }] // no grammar → render plain
        const [line] = hl.codeToTokensWithThemes(content, { lang: lang as never, themes: { light: 'github-light', dark: 'github-dark' } })
        return (line ?? []).map((t) => ({ content: t.content, light: t.variants.light.color ?? '', dark: t.variants.dark.color ?? '' }))
      }
      const out: Exclude<Row, { kind: 'thread' }>[] = []
      for (const h of hunks) {
        out.push({ kind: 'hunk', text: h.content || `@@ -${h.oldStart} +${h.newStart} @@` })
        for (const ch of h.changes) {
          if (ch.type === 'normal') out.push({ kind: 'normal', oldNo: ch.oldLineNumber, newNo: ch.newLineNumber, toks: tok(ch.content) })
          else if (ch.type === 'insert') out.push({ kind: 'insert', oldNo: null, newNo: ch.lineNumber, toks: tok(ch.content) })
          else out.push({ kind: 'delete', oldNo: ch.lineNumber, newNo: null, toks: tok(ch.content) })
        }
      }
      return out
    },
  )

  // Interleave thread rows after their anchor diff row. A thread anchors to a line in the SELECTED
  // file: RIGHT/null → match new-line number; LEFT → match old-line number.
  const rows = createMemo<Row[]>(() => {
    const diff = base()
    if (!diff) return []
    const file = selected()
    const threads = (file ? detail.data?.threads ?? [] : []).filter((t) => t.path === file?.path)
    if (threads.length === 0) return diff
    const out: Row[] = []
    for (const r of diff) {
      out.push(r)
      if (r.kind === 'hunk') continue
      for (const t of threads) {
        const onRight = t.side === 'RIGHT' || t.side == null
        const anchor = onRight ? r.newNo : r.oldNo
        if (anchor != null && anchor === t.line) out.push({ kind: 'thread', thread: t })
      }
    }
    return out
  })

  let scrollEl: HTMLDivElement | undefined
  const virt = createVirtualizer({
    get count() {
      return rows().length
    },
    getScrollElement: () => scrollEl ?? null,
    estimateSize: () => 20,
    overscan: 20,
  })

  return (
    <Show when={searchParams.file} fallback={<p class="placeholder">Select a file.</p>}>
      <Show when={selected()?.patch} fallback={<p class="placeholder">{base.loading ? 'Loading…' : 'No diff (binary or too large).'}</p>}>
        <div class="diff" ref={scrollEl}>
          <div class="diff-rows" style={{ height: `${virt.getTotalSize()}px` }}>
            <For each={virt.getVirtualItems()}>
              {(vi) => {
                const row = () => rows()[vi.index]
                return (
                  <div
                    class="diff-row"
                    classList={{
                      'diff-hunk': row().kind === 'hunk',
                      'diff-add': row().kind === 'insert',
                      'diff-del': row().kind === 'delete',
                      'diff-thread-row': row().kind === 'thread',
                    }}
                    data-index={vi.index}
                    ref={(el) => queueMicrotask(() => virt.measureElement(el))}
                    style={{ transform: `translateY(${vi.start}px)` }}
                  >
                    <Show when={row().kind === 'thread'}>
                      <ThreadRow
                        thread={(row() as Extract<Row, { kind: 'thread' }>).thread}
                        onMutated={invalidate}
                        resolveThread={(threadId, resolved) => resolveThread(owner(), repo(), number(), threadId, resolved)}
                        reply={(databaseId, body) => replyReview(owner(), repo(), number(), databaseId, body)}
                      />
                    </Show>
                    <Show when={row().kind === 'hunk'}>
                      <span class="diff-hunk-text">{(row() as Extract<Row, { kind: 'hunk' }>).text}</span>
                    </Show>
                    <Show when={row().kind !== 'hunk' && row().kind !== 'thread'}>
                      {(() => {
                        const r = row() as Extract<Row, { kind: 'normal' | 'insert' | 'delete' }>
                        const side = r.oldNo != null && r.newNo == null ? 'LEFT' : 'RIGHT'
                        const lineNo = side === 'LEFT' ? r.oldNo : r.newNo
                        return <DiffLine r={r} canAdd={!!headSha() && lineNo != null} side={side} lineNo={lineNo ?? 0} addComment={(body) => addReviewComment(owner(), repo(), number(), body, selected()!.path, lineNo!, side)} onMutated={invalidate} />
                      })()}
                    </Show>
                  </div>
                )
              }}
            </For>
          </div>
        </div>
      </Show>
    </Show>
  )
}

// A single diff code line, with a hover "+" to open an inline new-line-comment composer.
function DiffLine(props: {
  r: Extract<Row, { kind: 'normal' | 'insert' | 'delete' }>
  canAdd: boolean
  side: 'LEFT' | 'RIGHT'
  lineNo: number
  addComment: (body: string) => Promise<unknown>
  onMutated: () => void
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
      <span class="diff-gutter">{props.r.oldNo ?? ''}</span>
      <span class="diff-gutter">{props.r.newNo ?? ''}</span>
      <span class="diff-marker">{props.r.kind === 'insert' ? '+' : props.r.kind === 'delete' ? '−' : ' '}</span>
      <Show when={props.canAdd}>
        <button class="diff-add-btn" title="Comment on this line" onClick={() => setOpen((v) => !v)}>
          +
        </button>
      </Show>
      <span class="diff-code">
        <For each={props.r.toks}>{(t) => <span style={{ '--l': t.light, '--r': t.dark }}>{t.content}</span>}</For>
      </span>
      <Show when={open()}>
        <div class="diff-composer" onClick={(e) => e.stopPropagation()}>
          <textarea
            class="diff-reply-input"
            placeholder="Comment on this line…"
            value={body()}
            onInput={(e) => setBody(e.currentTarget.value)}
          />
          <div class="diff-composer-actions">
            <button disabled={busy() || !body().trim()} onClick={submit}>
              {busy() ? 'Adding…' : 'Comment'}
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

// An inline review-comment thread: comments, resolve toggle, and a reply box.
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
              <div class="comment-meta">
                <strong>{c.author ?? 'unknown'}</strong>
              </div>
              <div class="markdown" innerHTML={c.body ?? ''} />
            </div>
          )}
        </For>
        <div class="diff-reply">
          <textarea
            class="diff-reply-input"
            placeholder={replyId() == null ? 'Reply unavailable' : 'Reply…'}
            disabled={replyId() == null}
            value={body()}
            onInput={(e) => setBody(e.currentTarget.value)}
          />
          <div class="diff-composer-actions">
            <button disabled={busy() || replyId() == null || !body().trim()} onClick={submitReply}>
              {busy() ? 'Replying…' : 'Reply'}
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
