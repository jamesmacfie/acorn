import { createEffect, createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { useParams, useSearchParams } from '@solidjs/router'
import { createVirtualizer } from '@tanstack/solid-virtual'
import gitdiffParser from 'gitdiff-parser'
import { diffWordsWithSpace } from 'diff'
import { fileStatusMeta } from './displayMeta'
import { filesOptions, prefsOptions, pullDetailOptions, type PullFile, type Thread } from './queries'
import { addReviewComment, replyReview, resolveThread, setPref } from './mutations'
import { getHighlighter, langFor } from './shiki'
import { synth } from './diff'
import { FILE_SCROLL_EVENT, routeKey as makeRouteKey, type FileScrollDetail } from './fileNavigation'
import { UserAvatar } from './UserAvatar'

// Right (Diff) pane: render EVERY changed file's diff stacked one after another in a single
// virtualized list (docs/git-diff.md, docs/ui-style.md §6). Each file opens with a header row;
// `?file=` no longer picks which file is shown — it's the scroll target (the file list, finder,
// and [ / ] all set it), so selecting a file scrolls the combined diff to it.
//
// Parsing + Shiki highlighting all files up front would block on large PRs, so files are parsed in
// chunks of 10 and appended as each chunk lands — the list grows progressively and stays scrollable
// while later files are still tokenizing. Review threads are interleaved at render time (matched by
// path) so thread mutations rerender without re-tokenizing patches.
//
// Two view modes (persisted via the `diff_view` pref): UNIFIED (default, virtualized) and SPLIT
// (side-by-side). Paired delete/insert lines additionally carry a word-level intra-line diff.

type Tok = { content: string; light: string; dark: string }
// A word-diff span layered over a paired changed line: `kind` marks whether this span was added on
// the new side or removed from the old side; an `eq` span is unchanged context within the line.
type WordTok = { content: string; kind: 'eq' | 'add' | 'del' }
type CodeRow = {
  kind: 'normal' | 'insert' | 'delete'
  path: string // owning file — used to anchor a new line-comment to the right file
  oldNo: number | null
  newNo: number | null
  toks: Tok[]
  raw: string // raw line text, used for word-diff pairing
  words?: WordTok[] // present only on paired changed lines
}
type HunkRow = { kind: 'hunk'; text: string }
// Full-width boundary/placeholder rows. `file` opens each file's section (scroll anchor); `nodiff`
// stands in for a file we got no patch for (binary / too large).
type FileRow = { kind: 'file'; file: PullFile }
type NoDiffRow = { kind: 'nodiff' }
type ThreadRowT = { kind: 'thread'; thread: Thread }
type Row = HunkRow | CodeRow | FileRow | NoDiffRow | ThreadRowT
type DiffRow = HunkRow | CodeRow // a parsed diff row (no interleaved threads / file chrome)

type ViewMode = 'unified' | 'split'

// A split-mode band: either a full-width row (hunk header, file header, no-diff, or thread) or a
// paired left/right line. `left`/`right` may be null when one side has no counterpart.
type SplitBand =
  | { kind: 'full'; row: HunkRow | FileRow | NoDiffRow | ThreadRowT }
  | { kind: 'pair'; left: CodeRow | null; right: CodeRow | null }

const isCodeRow = (r: Row): r is CodeRow => r.kind === 'normal' || r.kind === 'insert' || r.kind === 'delete'
// DOM id for a file's header, so split mode (non-virtualized) can scrollIntoView by path.
const fileAnchor = (path: string) => `diff-file:${path}`
const DIFF_LINE_HEIGHT = 20
const DIFF_FILE_HEADER_HEIGHT = 36
const estimateRowSize = (row: Row | undefined) => {
  if (!row) return DIFF_LINE_HEIGHT
  if (row.kind === 'file') return DIFF_FILE_HEADER_HEIGHT
  if (row.kind === 'thread') return 140
  if (row.kind === 'nodiff') return 28
  return DIFF_LINE_HEIGHT
}

type PullRoute = {
  owner: string
  repo: string
  number: string
  key: string
}
type TokenizeLine = (path: string, content: string) => Tok[]

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

// Parse + highlight a single file's patch into diff rows. Carries the file path onto each code row
// so a line-comment knows which file it belongs to. No-patch files return [] (rendered as `nodiff`).
const plainTokenize: TokenizeLine = (_path, content) => [{ content, light: '', dark: '' }]

function highlighterTokenize(hl: Awaited<ReturnType<typeof getHighlighter>>): TokenizeLine {
  return (path, content) => {
    const lang = langFor(path)
    if (lang === 'text') return plainTokenize(path, content)
    const [line] = hl.codeToTokensWithThemes(content, { lang: lang as never, themes: { light: 'github-light', dark: 'github-dark' } })
    return (line ?? []).map((t) => ({ content: t.content, light: t.variants.light.color ?? '', dark: t.variants.dark.color ?? '' }))
  }
}

function rawPatchRows(file: PullFile, tokenize: TokenizeLine): DiffRow[] {
  const rows: DiffRow[] = []
  for (const line of (file.patch ?? '').split('\n')) {
    if (line.startsWith('@@')) {
      rows.push({ kind: 'hunk', text: line })
    } else if (line.startsWith('+')) {
      const raw = line.slice(1)
      rows.push({ kind: 'insert', path: file.path, oldNo: null, newNo: null, toks: tokenize(file.path, raw), raw })
    } else if (line.startsWith('-')) {
      const raw = line.slice(1)
      rows.push({ kind: 'delete', path: file.path, oldNo: null, newNo: null, toks: tokenize(file.path, raw), raw })
    } else {
      const raw = line.startsWith(' ') ? line.slice(1) : line
      rows.push({ kind: 'normal', path: file.path, oldNo: null, newNo: null, toks: tokenize(file.path, raw), raw })
    }
  }
  return rows
}

function buildDiffRows(file: PullFile, tokenize: TokenizeLine): DiffRow[] {
  if (!file.patch) return []
  let parsed: ReturnType<typeof gitdiffParser.parse>
  try {
    parsed = gitdiffParser.parse(synth(file.path, file.patch))
  } catch {
    return rawPatchRows(file, tokenize)
  }
  const hunks = parsed[0]?.hunks ?? []
  const out: DiffRow[] = []
  for (const h of hunks) {
    out.push({ kind: 'hunk', text: h.content || `@@ -${h.oldStart} +${h.newStart} @@` })
    for (const ch of h.changes) {
      if (ch.type === 'normal') out.push({ kind: 'normal', path: file.path, oldNo: ch.oldLineNumber, newNo: ch.newLineNumber, toks: tokenize(file.path, ch.content), raw: ch.content })
      else if (ch.type === 'insert') out.push({ kind: 'insert', path: file.path, oldNo: null, newNo: ch.lineNumber, toks: tokenize(file.path, ch.content), raw: ch.content })
      else out.push({ kind: 'delete', path: file.path, oldNo: ch.lineNumber, newNo: null, toks: tokenize(file.path, ch.content), raw: ch.content })
    }
  }
  if (out.length === 0) return rawPatchRows(file, tokenize)
  // Word-diff: pair each maximal delete-run with the following insert-run, zipping by order.
  attachWordDiffs(out)
  return out
}

export default function DiffView() {
  const params = useParams()
  const route = createMemo<PullRoute | null>(() => {
    if (!params.owner || !params.repo || !params.number) return null
    return {
      owner: params.owner,
      repo: params.repo,
      number: params.number,
      key: makeRouteKey(params.owner, params.repo, params.number),
    }
  })

  return (
    <Show when={route()} keyed fallback={<p class="placeholder">Select a PR.</p>}>
      {(r) => <DiffForPull route={r} />}
    </Show>
  )
}

function DiffForPull(props: { route: PullRoute }) {
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const owner = props.route.owner
  const repo = props.route.repo
  const number = props.route.number

  const files = createQuery(() => filesOptions(owner, repo, number, true))
  const detail = createQuery(() => pullDetailOptions(owner, repo, number, true))
  const prefs = createQuery(() => prefsOptions(true))
  const headSha = () => detail.data?.pull?.headSha ?? null
  let lastTarget = ''

  const viewMode = (): ViewMode => (prefs.data?.diff_view === 'split' ? 'split' : 'unified')
  const setViewMode = async (mode: ViewMode) => {
    await setPref('diff_view', mode)
    queryClient.invalidateQueries({ queryKey: ['prefs'] })
  }

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['pull', owner, repo, number] })

  // Parse + highlight every file off the render path, in chunks of 10, appending as each chunk
  // lands so a large PR paints progressively instead of blocking on the full set. Re-runs only when
  // the file set itself changes (thread edits don't touch files.data → no re-tokenize).
  const [parsed, setParsed] = createSignal<{ file: PullFile; diff: DiffRow[] }[]>([])
  let parseRun = 0
  createEffect(() => {
    const list = files.data ?? []
    const run = ++parseRun
    let cancelled = false
    onCleanup(() => {
      cancelled = true
    })
    lastTarget = ''
    setParsed([])
    resetScrollPosition()
    if (!list.length) return
    void (async () => {
      const tokenize = await getHighlighter().then(highlighterTokenize).catch(() => plainTokenize)
      if (cancelled || run !== parseRun) return
      const acc: { file: PullFile; diff: DiffRow[] }[] = []
      for (let i = 0; i < list.length; i += 10) {
        if (cancelled || run !== parseRun) return
        for (const file of list.slice(i, i + 10)) acc.push({ file, diff: buildDiffRows(file, tokenize) })
        if (cancelled || run !== parseRun) return
        setParsed([...acc])
        await new Promise((r) => setTimeout(r, 0)) // yield so this chunk paints before the next 10
      }
    })()
  })

  // Flatten parsed files into one row list: a `file` header per file, then its diff rows with review
  // threads interleaved after their anchor line (RIGHT/null → new line, LEFT → old line), then a
  // `nodiff` placeholder if the file had no patch. Recomputes when parsing advances or threads change.
  const rows = createMemo<Row[]>(() => {
    const all = detail.data?.threads ?? []
    const out: Row[] = []
    for (const { file, diff } of parsed()) {
      out.push({ kind: 'file', file })
      const threads = all.filter((t) => t.path === file.path)
      for (const r of diff) {
        out.push(r)
        if (r.kind === 'hunk') continue
        for (const t of threads) {
          const onRight = t.side === 'RIGHT' || t.side == null
          const anchor = onRight ? r.newNo : r.oldNo
          if (anchor != null && anchor === t.line) out.push({ kind: 'thread', thread: t })
        }
      }
      if (diff.length === 0) out.push({ kind: 'nodiff' })
    }
    return out
  })

  // Split bands from the same interleaved rows (see toBands).
  const bands = createMemo<SplitBand[]>(() => toBands(rows()))

  // Scroll element as a signal so the virtualizer re-attaches when it (re)mounts (it lives behind a
  // `<Show>` — no PR / split mode — so it's absent at this component's onMount). The virtualizer
  // reads the element's size only when getScrollElement first returns it; publishing the ref inside
  // requestAnimationFrame guarantees that read happens AFTER layout (offsetHeight is real), not in
  // the same tick a cached query fills rows() — otherwise it freezes a 0-height viewport and the
  // range stays empty. measure() then drives that post-layout re-read.
  const [scrollEl, setScrollEl] = createSignal<HTMLDivElement>()
  const virt = createVirtualizer({
    get count() {
      return rows().length
    },
    getScrollElement: () => scrollEl() ?? null,
    estimateSize: (index) => estimateRowSize(rows()[index]),
    overscan: 20,
  })
  createEffect(() => {
    if (scrollEl()) virt.measure()
  })
  createEffect(() => {
    rows().length
    if (scrollEl()) queueMicrotask(() => virt.measure())
  })
  let scrollFrame = 0
  onCleanup(() => cancelAnimationFrame(scrollFrame))
  const resetScrollPosition = () => {
    const el = scrollEl()
    if (!el) return
    el.scrollTop = 0
    el.scrollLeft = 0
  }
  const publishScrollEl = (el: HTMLDivElement) => {
    cancelAnimationFrame(scrollFrame)
    scrollFrame = requestAnimationFrame(() => {
      setScrollEl(el)
      resetScrollPosition()
      virt.measure()
    })
  }
  const publishSplitScrollEl = (el: HTMLDivElement) => {
    cancelAnimationFrame(scrollFrame)
    scrollFrame = requestAnimationFrame(() => {
      setScrollEl(el)
      resetScrollPosition()
    })
  }

  const scrollToFile = (path: string, force = false) => {
    const all = rows()
    const idx = all.findIndex((r) => r.kind === 'file' && r.file.path === path)
    if (idx < 0) return false
    if (!force && path === lastTarget) return true
    lastTarget = path
    if (viewMode() === 'split') {
      queueMicrotask(() => document.getElementById(fileAnchor(path))?.scrollIntoView({ block: 'start' }))
    } else {
      virt.scrollToIndex(idx, { align: 'start' })
    }
    return true
  }

  onMount(() => {
    const onFileScroll = (event: Event) => {
      const detail = (event as CustomEvent<FileScrollDetail>).detail
      if (!detail || detail.routeKey !== props.route.key) return
      lastTarget = ''
      scrollToFile(detail.path, true)
    }
    window.addEventListener(FILE_SCROLL_EVENT, onFileScroll)
    onCleanup(() => window.removeEventListener(FILE_SCROLL_EVENT, onFileScroll))
  })

  // Scroll to the file named in `?file=` once it has been parsed. Tracks rows() so a file still in a
  // not-yet-parsed chunk scrolls as soon as its chunk lands; `lastTarget` keeps later chunk appends
  // (or thread edits) from yanking the scroll back after the initial jump.
  createEffect(() => {
    const path = typeof searchParams.file === 'string' ? searchParams.file : ''
    if (!path) {
      lastTarget = ''
      return
    }
    scrollToFile(path)
  })

  const lineComment = (r: CodeRow) => {
    const side = r.oldNo != null && r.newNo == null ? 'LEFT' : 'RIGHT'
    const lineNo = side === 'LEFT' ? r.oldNo : r.newNo
    return { side: side as 'LEFT' | 'RIGHT', lineNo: lineNo ?? 0, canAdd: !!headSha() && lineNo != null }
  }

  return (
    <Show
      when={files.data?.length}
      fallback={<p class="placeholder">{files.isLoading ? 'Loading…' : 'No files.'}</p>}
    >
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
          <div class="diff" ref={publishScrollEl}>
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
                        'diff-file-row': row().kind === 'file',
                        'diff-thread-row': row().kind === 'thread' || row().kind === 'nodiff',
                      }}
                      data-index={vi.index}
                      ref={(el) => queueMicrotask(() => virt.measureElement(el))}
                      style={{ transform: `translateY(${vi.start}px)` }}
                    >
                      <Show
                        when={isCodeRow(row()) ? (row() as CodeRow) : null}
                        fallback={
                          <NonCodeRow
                            row={row() as Exclude<Row, CodeRow>}
                            onMutated={invalidate}
                            resolveThread={(threadId, resolved) => resolveThread(owner, repo, number, threadId, resolved)}
                            reply={(databaseId, body) => replyReview(owner, repo, number, databaseId, body)}
                          />
                        }
                      >
                        {(r) => {
                          const lc = lineComment(r())
                          return <DiffLine r={r()} canAdd={lc.canAdd} side={lc.side} lineNo={lc.lineNo} addComment={(body) => addReviewComment(owner, repo, number, body, r().path, lc.lineNo, lc.side)} onMutated={invalidate} />
                        }}
                      </Show>
                    </div>
                  )
                }}
              </For>
            </div>
          </div>
        }
      >
        {/* Split mode renders non-virtualized — pairing two columns into bands plus the
            full-width thread/composer interleave makes a measureElement virtualizer materially more
            complex. Now that it spans every file, a very large PR in split mode mounts every row;
            upgrade path is the same band-aware virtualizer if that bites. Unified stays virtualized. */}
        <div class="diff diff-split" ref={publishSplitScrollEl}>
          <div class="diff-split-rows">
            <For each={bands()}>
              {(band) => (
                <Show
                  when={band.kind === 'pair' ? (band as Extract<SplitBand, { kind: 'pair' }>) : null}
                  fallback={
                    <div
                      class="diff-split-full"
                      classList={{
                        'diff-hunk': (band as Extract<SplitBand, { kind: 'full' }>).row.kind === 'hunk',
                        'diff-file-row': (band as Extract<SplitBand, { kind: 'full' }>).row.kind === 'file',
                        'diff-thread-row':
                          (band as Extract<SplitBand, { kind: 'full' }>).row.kind === 'thread' ||
                          (band as Extract<SplitBand, { kind: 'full' }>).row.kind === 'nodiff',
                      }}
                    >
                      <NonCodeRow
                        row={(band as Extract<SplitBand, { kind: 'full' }>).row}
                        onMutated={invalidate}
                        resolveThread={(threadId, resolved) => resolveThread(owner, repo, number, threadId, resolved)}
                        reply={(databaseId, body) => replyReview(owner, repo, number, databaseId, body)}
                      />
                    </div>
                  }
                >
                  {(pair) => (
                    <div class="diff-split-pair">
                      <SplitCell
                        r={pair().left}
                        gutter={pair().left?.oldNo ?? null}
                        side="LEFT"
                        canAdd={!!headSha() && pair().left?.oldNo != null}
                        addComment={(body) => addReviewComment(owner, repo, number, body, pair().left!.path, pair().left!.oldNo!, 'LEFT')}
                        onMutated={invalidate}
                      />
                      <SplitCell
                        r={pair().right}
                        gutter={pair().right?.newNo ?? null}
                        side="RIGHT"
                        canAdd={!!headSha() && pair().right?.newNo != null}
                        addComment={(body) => addReviewComment(owner, repo, number, body, pair().right!.path, pair().right!.newNo!, 'RIGHT')}
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

// Build the split-mode band list from the interleaved rows. Hunk/file/no-diff/thread rows become
// full-width bands; delete/insert runs are zipped into paired left/right bands (mirroring the
// word-diff pairing); leftover unpaired lines occupy one side only; context lines pair with
// themselves (same line on both sides).
function toBands(rows: Row[]): SplitBand[] {
  const out: SplitBand[] = []
  let i = 0
  while (i < rows.length) {
    const r = rows[i]!
    if (r.kind === 'hunk' || r.kind === 'thread' || r.kind === 'file' || r.kind === 'nodiff') {
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

// Render a full-width non-code row: file header (scroll anchor), hunk header, no-diff placeholder,
// or an inline review thread. Shared by unified and split rendering.
function NonCodeRow(props: {
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
              <span class="file-stat del">−{f().file.deletions ?? 0}</span>
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
