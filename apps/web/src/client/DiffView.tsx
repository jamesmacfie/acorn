import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { useParams, useSearchParams } from '@solidjs/router'
import { createVirtualizer } from '@tanstack/solid-virtual'
import gitdiffParser from 'gitdiff-parser'
import { diffWordsWithSpace } from 'diff'
import { filesOptions, prefsOptions, pullDetailOptions, type Thread } from './queries'
import { addReviewComment, replyReview, resolveThread, setPref } from './mutations'
import { getHighlighter, langFor } from './shiki'
import { synth } from './diff'

// Right (Diff) pane: parse the selected file's unified-diff patch, syntax-highlight (Shiki, dual
// theme via CSS vars), virtualize rows (docs/git-diff.md, docs/ui-style.md §6). Review threads are
// interleaved as variable-height rows anchored to their diff line; the virtualizer measures each
// rendered row (measureElement + data-index) so thread height needn't be known ahead of time.
//
// Two view modes (persisted via the `diff_view` pref): UNIFIED (default, virtualized — unchanged
// from before) and SPLIT (side-by-side). Paired delete/insert lines additionally carry a word-level
// intra-line diff (jsdiff) so the exact changed spans are highlighted in both modes.

type Tok = { content: string; light: string; dark: string }
// A word-diff span layered over a paired changed line: `kind` marks whether this span was added on
// the new side or removed from the old side; an `eq` span is unchanged context within the line.
type WordTok = { content: string; kind: 'eq' | 'add' | 'del' }
type CodeRow = {
  kind: 'normal' | 'insert' | 'delete'
  oldNo: number | null
  newNo: number | null
  toks: Tok[]
  raw: string // raw line text, used for word-diff pairing
  words?: WordTok[] // present only on paired changed lines
}
type HunkRow = { kind: 'hunk'; text: string }
type Row = HunkRow | CodeRow | { kind: 'thread'; thread: Thread }
type DiffRow = HunkRow | CodeRow // a parsed diff row (no interleaved threads)

type ViewMode = 'unified' | 'split'

// A split-mode band: either a full-width row (hunk header or thread) or a paired left/right line.
// `left`/`right` may be null when one side has no counterpart (pure delete or pure insert).
type SplitBand =
  | { kind: 'full'; row: Extract<Row, { kind: 'hunk' | 'thread' }> }
  | { kind: 'pair'; left: CodeRow | null; right: CodeRow | null }

// Compute a word-level intra-line diff between the old and new text of a paired changed line.
// Returns the span list for each side; only changed spans get add/del kinds. Whitespace is kept
// (diffWordsWithSpace) so the rendered text stays byte-faithful to the original line.
function wordDiff(oldText: string, newText: string): { del: WordTok[]; add: WordTok[] } {
  const parts = diffWordsWithSpace(oldText, newText)
  const del: WordTok[] = []
  const add: WordTok[] = []
  for (const p of parts) {
    if (p.added) add.push({ content: p.value, kind: 'add' })
    else if (p.removed) del.push({ content: p.value, kind: 'del' })
    else {
      del.push({ content: p.value, kind: 'eq' })
      add.push({ content: p.value, kind: 'eq' })
    }
  }
  return { del, add }
}

export default function DiffView() {
  const params = useParams()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const owner = () => params.owner ?? ''
  const repo = () => params.repo ?? ''
  const number = () => params.number ?? ''

  const files = createQuery(() => filesOptions(owner(), repo(), number(), !!params.number))
  const detail = createQuery(() => pullDetailOptions(owner(), repo(), number(), !!params.number))
  const prefs = createQuery(() => prefsOptions(true))
  const selected = createMemo(() => files.data?.find((f) => f.path === searchParams.file) ?? null)
  const headSha = () => detail.data?.pull?.headSha ?? null

  const viewMode = (): ViewMode => (prefs.data?.diff_view === 'split' ? 'split' : 'unified')
  const setViewMode = async (mode: ViewMode) => {
    await setPref('diff_view', mode)
    queryClient.invalidateQueries({ queryKey: ['prefs'] })
  }

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['pull', owner(), repo(), number()] })

  // Parse + highlight off the render path; re-runs when the selected file changes. Threads are
  // applied separately at render time so they refetch/rerender without re-tokenizing the patch.
  // Per-hunk we also pair adjacent delete/insert runs (zip by order) and compute a word-level diff
  // for each pair — this is positional and thread-independent, so it lives here, not at render time.
  const [base] = createResource(
    () => selected(),
    async (file): Promise<DiffRow[]> => {
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
      const out: DiffRow[] = []
      for (const h of hunks) {
        out.push({ kind: 'hunk', text: h.content || `@@ -${h.oldStart} +${h.newStart} @@` })
        for (const ch of h.changes) {
          if (ch.type === 'normal') out.push({ kind: 'normal', oldNo: ch.oldLineNumber, newNo: ch.newLineNumber, toks: tok(ch.content), raw: ch.content })
          else if (ch.type === 'insert') out.push({ kind: 'insert', oldNo: null, newNo: ch.lineNumber, toks: tok(ch.content), raw: ch.content })
          else out.push({ kind: 'delete', oldNo: ch.lineNumber, newNo: null, toks: tok(ch.content), raw: ch.content })
        }
      }
      // Word-diff: pair each maximal delete-run with the following insert-run, zipping by order.
      // The i-th delete pairs with the i-th insert; the shorter run leaves the rest unpaired.
      attachWordDiffs(out)
      return out
    },
  )

  // Interleave thread rows after their anchor diff row. A thread anchors to a line in the SELECTED
  // file: RIGHT/null → match new-line number; LEFT → match old-line number. Shared by both modes.
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

  // Split bands: hunk headers and threads stay full-width; consecutive paired delete/insert lines
  // share a band (same `words` pairing as the word-diff). Built from the same interleaved `rows()`.
  const bands = createMemo<SplitBand[]>(() => toBands(rows()))

  let scrollEl: HTMLDivElement | undefined
  const virt = createVirtualizer({
    get count() {
      return rows().length
    },
    getScrollElement: () => scrollEl ?? null,
    estimateSize: () => 20,
    overscan: 20,
  })

  const lineComment = (r: CodeRow) => {
    const side = r.oldNo != null && r.newNo == null ? 'LEFT' : 'RIGHT'
    const lineNo = side === 'LEFT' ? r.oldNo : r.newNo
    return { side: side as 'LEFT' | 'RIGHT', lineNo: lineNo ?? 0, canAdd: !!headSha() && lineNo != null }
  }

  return (
    <Show when={searchParams.file} fallback={<p class="placeholder">Select a file.</p>}>
      <Show when={selected()?.patch} fallback={<p class="placeholder">{base.loading ? 'Loading…' : 'No diff (binary or too large).'}</p>}>
        <div class="diff-toolbar">
          <div class="diff-viewmode" role="group" aria-label="Diff view mode">
            <button
              type="button"
              class="diff-viewmode-btn"
              classList={{ active: viewMode() === 'unified' }}
              aria-pressed={viewMode() === 'unified'}
              onClick={() => setViewMode('unified')}
            >
              Unified
            </button>
            <button
              type="button"
              class="diff-viewmode-btn"
              classList={{ active: viewMode() === 'split' }}
              aria-pressed={viewMode() === 'split'}
              onClick={() => setViewMode('split')}
            >
              Split
            </button>
          </div>
        </div>
        <Show
          when={viewMode() === 'split'}
          fallback={
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
                            const r = row() as CodeRow
                            const lc = lineComment(r)
                            return <DiffLine r={r} canAdd={lc.canAdd} side={lc.side} lineNo={lc.lineNo} addComment={(body) => addReviewComment(owner(), repo(), number(), body, selected()!.path, lc.lineNo, lc.side)} onMutated={invalidate} />
                          })()}
                        </Show>
                      </div>
                    )
                  }}
                </For>
              </div>
            </div>
          }
        >
          {/* ponytail: split mode renders non-virtualized. Pairing two columns into bands plus the
              full-width thread/composer interleave makes a measureElement virtualizer materially more
              complex; diffs shown here are a single file and small enough that plain rendering is
              fine. Unified mode stays virtualized and byte-identical to before. */}
          <div class="diff diff-split">
            <div class="diff-split-rows">
              <For each={bands()}>
                {(band) => (
                  <Show
                    when={band.kind === 'pair' ? (band as Extract<SplitBand, { kind: 'pair' }>) : null}
                    fallback={
                      <Show
                        when={(band as Extract<SplitBand, { kind: 'full' }>).row.kind === 'hunk'}
                        fallback={
                          <div class="diff-split-full diff-thread-row">
                            <ThreadRow
                              thread={((band as Extract<SplitBand, { kind: 'full' }>).row as Extract<Row, { kind: 'thread' }>).thread}
                              onMutated={invalidate}
                              resolveThread={(threadId, resolved) => resolveThread(owner(), repo(), number(), threadId, resolved)}
                              reply={(databaseId, body) => replyReview(owner(), repo(), number(), databaseId, body)}
                            />
                          </div>
                        }
                      >
                        <div class="diff-split-full diff-hunk">
                          <span class="diff-hunk-text">{((band as Extract<SplitBand, { kind: 'full' }>).row as Extract<Row, { kind: 'hunk' }>).text}</span>
                        </div>
                      </Show>
                    }
                  >
                    {(pair) => (
                      <div class="diff-split-pair">
                        <SplitCell
                          r={pair().left}
                          gutter={pair().left?.oldNo ?? null}
                          side="LEFT"
                          canAdd={!!headSha() && pair().left?.oldNo != null}
                          addComment={(body) => addReviewComment(owner(), repo(), number(), body, selected()!.path, pair().left!.oldNo!, 'LEFT')}
                          onMutated={invalidate}
                        />
                        <SplitCell
                          r={pair().right}
                          gutter={pair().right?.newNo ?? null}
                          side="RIGHT"
                          canAdd={!!headSha() && pair().right?.newNo != null}
                          addComment={(body) => addReviewComment(owner(), repo(), number(), body, selected()!.path, pair().right!.newNo!, 'RIGHT')}
                          onMutated={invalidate}
                        />
                      </div>
                    )}
                  </Show>
                )}
              </For>
            </div>
          </div>
        </Show>
      </Show>
    </Show>
  )
}

// Pair each maximal run of deletes with the immediately-following run of inserts (zip by order):
// the i-th delete of the run pairs with the i-th insert. Both get a `words` span list from the
// word-diff. Unpaired leftovers (longer run) keep plain Shiki rendering. Mutates rows in place.
function attachWordDiffs(rows: DiffRow[]) {
  let i = 0
  while (i < rows.length) {
    if (rows[i]!.kind !== 'delete') {
      i++
      continue
    }
    let d = i
    while (d < rows.length && rows[d]!.kind === 'delete') d++
    let n = d
    while (n < rows.length && rows[n]!.kind === 'insert') n++
    const dels = rows.slice(i, d) as CodeRow[]
    const inss = rows.slice(d, n) as CodeRow[]
    const pairs = Math.min(dels.length, inss.length)
    for (let k = 0; k < pairs; k++) {
      const { del, add } = wordDiff(dels[k]!.raw, inss[k]!.raw)
      dels[k]!.words = del
      inss[k]!.words = add
    }
    i = n > i ? n : i + 1
  }
}

// Build the split-mode band list from the interleaved rows. Hunk headers and threads become
// full-width bands; delete/insert runs are zipped into paired left/right bands (mirroring the
// word-diff pairing); leftover unpaired lines occupy one side only; context lines pair with
// themselves (same line on both sides).
function toBands(rows: Row[]): SplitBand[] {
  const out: SplitBand[] = []
  let i = 0
  while (i < rows.length) {
    const r = rows[i]!
    if (r.kind === 'hunk' || r.kind === 'thread') {
      out.push({ kind: 'full', row: r })
      i++
      continue
    }
    if (r.kind === 'normal') {
      out.push({ kind: 'pair', left: r, right: r })
      i++
      continue
    }
    if (r.kind === 'delete') {
      let d = i
      while (d < rows.length && rows[d]!.kind === 'delete') d++
      let n = d
      while (n < rows.length && rows[n]!.kind === 'insert') n++
      const dels = rows.slice(i, d) as CodeRow[]
      const inss = rows.slice(d, n) as CodeRow[]
      const max = Math.max(dels.length, inss.length)
      for (let k = 0; k < max; k++) out.push({ kind: 'pair', left: dels[k] ?? null, right: inss[k] ?? null })
      i = n
      continue
    }
    // a stray insert run with no preceding delete → right side only
    let n = i
    while (n < rows.length && rows[n]!.kind === 'insert') n++
    for (const ins of rows.slice(i, n) as CodeRow[]) out.push({ kind: 'pair', left: null, right: ins })
    i = n
  }
  return out
}

// Render a line's code: word-diff spans when paired (intra-line highlight, plain text + glyph/bg —
// never colour alone), else the Shiki token spans. Shared by unified and split rendering.
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

// A single diff code line, with a hover "+" to open an inline new-line-comment composer.
function DiffLine(props: {
  r: CodeRow
  canAdd: boolean
  side: 'LEFT' | 'RIGHT'
  lineNo: number
  addComment: (body: string) => Promise<unknown>
  onMutated: () => void
}) {
  return (
    <>
      <span class="diff-gutter">{props.r.oldNo ?? ''}</span>
      <span class="diff-gutter">{props.r.newNo ?? ''}</span>
      <span class="diff-marker">{props.r.kind === 'insert' ? '+' : props.r.kind === 'delete' ? '−' : ' '}</span>
      <LineComposer canAdd={props.canAdd} addComment={props.addComment} onMutated={props.onMutated}>
        <CodeContent r={props.r} />
      </LineComposer>
    </>
  )
}

// One side of a split band. An empty cell (no counterpart) renders a filler so the grid stays
// aligned. The marker glyph + add/del background mark the change kind (never colour alone).
function SplitCell(props: {
  r: CodeRow | null
  gutter: number | null
  side: 'LEFT' | 'RIGHT'
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
            <span class="diff-marker">{r().kind === 'insert' ? '+' : r().kind === 'delete' ? '−' : ' '}</span>
            <LineComposer canAdd={props.canAdd} addComment={props.addComment} onMutated={props.onMutated}>
              <CodeContent r={r()} />
            </LineComposer>
          </>
        )}
      </Show>
    </div>
  )
}

// The hover "+" line-comment composer, wrapping a line's code content. Extracted so unified and
// split share the same new-line-comment behaviour.
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
