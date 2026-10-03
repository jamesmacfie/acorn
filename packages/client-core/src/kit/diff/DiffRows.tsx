// Row rendering for the shared diff viewer (see docs/diff-rendering.md for why it lives in
// client-core). The whole file came across, threads and composers included: a "generic rows here,
// review rows in github" split would be a redesign of the component, and the changes pane already
// renders NonCodeRow today. What each surface actually varies is passed in as props (composers,
// resolve/reply callbacks, gap expansion), so nothing here reaches back into a plugin.
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from 'solid-js'
import CopyButton from '../components/inputs/CopyButton'
import { fileStatusMeta } from '../lib/rendering/displayMeta'
import MentionTextarea from '../components/inputs/MentionTextarea'
import type { DiffFile, DiffThread } from './diffModel'
import { UserAvatar } from '../components/content/UserAvatar'
import { buildDiffRows, fileAnchor, isCodeRow, plainTokenize, type CodeRow, type FileRow, type GapRow, type HunkRow, type LoadDiffRow, type LoadDiffStatus, type Row, type ThreadRowT } from './diffModel'
import { markTokens, type FindHighlight } from './find'
import { persistDraft } from '../lib/state/draftState'
import { Button } from '../components/primitives'
import SanitizedHtml from '../components/content/SanitizedHtml'

export type LineComposerController = {
  isOpen: () => boolean
  body: () => string
  setOpen: (open: boolean) => void
  setBody: (body: string) => void
  /** Clear only the draft whose exact body the mutation acknowledged. */
  acknowledge?: (originalBody: string) => void
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
  /** The file's hydration state now, rather than when the row model was built. A row model over 200
   *  files is rebuilt per parse, so baking a per-file status into it made every file's error rebuild
   *  every other file's rows (docs/diff-rendering/loading.md § Parsing and highlighting). */
  loadStatus?: (path: string) => LoadDiffStatus
  mentions?: string[]
  threadCollapse?: (thread: DiffThread) => ThreadCollapseController
  fileCollapsed?: (path: string) => boolean
  onToggleFileCollapse?: (path: string) => void
  onLayoutChange?: () => void
}) {
  return (
    <Switch>
      <Match when={props.row.kind === 'file' ? (props.row as FileRow) : null}>
        {(f) => (
          <FileHead
            file={f().file}
            anchorId={fileAnchor(f().file.path)}
            collapsed={props.fileCollapsed?.(f().file.path)}
            onToggleCollapse={props.onToggleFileCollapse}
          />
        )}
      </Match>
      <Match when={props.row.kind === 'hunk' ? (props.row as HunkRow) : null}>
        {(h) => <span class="diff-hunk-text">{h().text}</span>}
      </Match>
      <Match when={props.row.kind === 'gap' ? (props.row as GapRow) : null}>
        {(g) => <GapRowView gap={g()} expandGap={props.expandGap} />}
      </Match>
      <Match when={props.row.kind === 'nodiff'}>
        <span class="diff-nodiff muted">Can't show this file. It's binary or too large.</span>
      </Match>
      <Match when={props.row.kind === 'load' ? (props.row as LoadDiffRow) : null}>
        {(row) => {
          const failed = () => (props.loadStatus?.(row().file.path) ?? row().status) === 'error'
          return (
          <span class="diff-load" classList={{ 'diff-load-error': failed() }}>
            <span>{failed() ? "Couldn't load this part." : 'Loading…'}</span>
            <Show when={failed()}>
              <Button variant="ghost" size="xs" onPress={() => props.retryDiff?.(row().file)}>
                Try again
              </Button>
            </Show>
          </span>
          )
        }}
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

// Per-file header bar: opens each file's section in the stacked diff, and doubles as the sticky
// current-file header DiffView pins to the top of the scroller (no anchor id there).
export function FileHead(props: {
  /** Only what the header draws, so a document's file and a whole-patch file both fit. */
  file: Pick<DiffFile, 'path' | 'status' | 'additions' | 'deletions'>
  anchorId?: string
  collapsed?: boolean
  onToggleCollapse?: (path: string) => void
  /** Indexes into the path that a file filter matched, drawn as find marks. */
  marks?: readonly number[]
}) {
  const status = () => fileStatusMeta(props.file.status)
  // The path as runs of marked and unmarked characters, so each run of hits is one mark.
  const pathRuns = createMemo(() => {
    const path = props.file.path
    const marks = new Set(props.marks)
    const runs: { text: string; mark: boolean }[] = []
    for (let i = 0; i < path.length; i++) {
      const mark = marks.has(i)
      const last = runs[runs.length - 1]
      if (last?.mark === mark) last.text += path[i]
      else runs.push({ text: path[i]!, mark })
    }
    return runs
  })
  return (
    <div class="diff-file-head copyable" id={props.anchorId}>
      <Show when={props.onToggleCollapse}>
        <button
          type="button"
          class="diff-file-collapse"
          aria-expanded={!props.collapsed}
          aria-label={props.collapsed ? 'Expand file' : 'Collapse file'}
          data-tip={props.collapsed ? 'Expand file' : 'Collapse file'}
          onClick={() => props.onToggleCollapse?.(props.file.path)}
        >
          {props.collapsed ? '▸' : '▾'}
        </button>
      </Show>
      <span class={`file-status file-status-${status().tone}`} data-tip={status().label}>
        {status().letter}
      </span>
      <span class="diff-file-path">
        <For each={pathRuns()}>{(run) => (run.mark ? <mark class="ui-find-mark">{run.text}</mark> : run.text)}</For>
      </span>
      <CopyButton text={() => props.file.path} title="Copy path" />
      <span class="file-stat add">+{props.file.additions ?? 0}</span>
      <span class="file-stat del">&#8722;{props.file.deletions ?? 0}</span>
    </div>
  )
}

function GapRowView(props: { gap: GapRow; expandGap?: (gap: GapRow) => Promise<unknown> }) {
  const [busy, setBusy] = createSignal(false)
  const label = () => (props.gap.side === 'bottom'
    ? 'Show the rest of the file'
    : props.gap.count == null ? 'Show hidden lines' : `Show ${props.gap.count} hidden lines`)
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
      {busy() ? 'Loading…' : label()}
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
  openLine?: (row: CodeRow) => void
  askAgent?: (row: CodeRow) => void
  /** The second line of the ask button's tip: what a click on the line itself does. */
  askHint?: string
}) {
  return (
    <>
      <span class="diff-line-chrome">
        <span class="diff-gutter">
          {props.r.oldNo ?? ''}
          <OpenLineButton row={props.r} onOpen={props.openLine} />
          <AskAgentButton row={props.r} onOpen={props.askAgent} hint={props.askHint} />
        </span>
        <span class="diff-gutter">{props.r.newNo ?? ''}</span>
        <span class="diff-marker">{props.r.kind === 'insert' ? '+' : props.r.kind === 'delete' ? '\u2212' : ' '}</span>
      </span>
      <Show when={props.canAdd && props.composer}>
        <button class="diff-add-btn" title="Comment on this line" onClick={() => props.composer?.setOpen(!props.composer.isOpen())}>
          +
        </button>
      </Show>
      <CodeContent r={props.r} highlight={props.highlight} />
      <Show when={props.composer?.isOpen()}>
        <LineComposer addComment={props.addComment} onMutated={props.onMutated} composer={props.composer!} mentions={props.mentions ?? []} />
      </Show>
    </>
  )
}

/**
 * One file's patch as a read-only stacked diff in normal document flow: the file header, then its
 * hunks. No comments, no gap expansion, no split view and no virtual list, for a surface that shows a
 * small patch inside something else, such as an agent's step in its thread. Rows are built when this
 * mounts, so put it inside a closed Fold and a long thread of them costs nothing until one is opened.
 * Plain text, since the highlighter is asynchronous and these are short.
 *
 * `lineNumbers={false}` blanks both number columns, for hunks whose numbers count from the top of an
 * excerpt rather than the file.
 */
export function StackedDiff(props: { path: string; patch: string; lineNumbers?: boolean }) {
  const rows = createMemo(() => {
    const file = { path: props.path, status: null, additions: null, deletions: null, sha: null, viewed: false, patch: props.patch }
    return buildDiffRows(file, plainTokenize).flatMap<HunkRow | CodeRow>((row) => {
      if (row.kind === 'hunk') return [row]
      if (!isCodeRow(row)) return []
      return [props.lineNumbers === false ? { ...row, oldNo: null, newNo: null } : row]
    })
  })
  const head = createMemo(() => ({
    path: props.path,
    status: /^@@ -0,0 /.test(props.patch) ? 'added' : / \+0,0 @@/.test(props.patch) ? 'removed' : null,
    additions: rows().filter((row) => row.kind === 'insert').length,
    deletions: rows().filter((row) => row.kind === 'delete').length,
  }))
  return (
    <div class="diff diff-stacked">
      <div class="diff-rows">
        <div class="diff-row diff-file-row"><FileHead file={head()} /></div>
        <For each={rows()}>
          {(row) => (
            <Show when={isCodeRow(row) ? row : null} fallback={
              <div class="diff-row diff-hunk"><span class="diff-hunk-text">{(row as HunkRow).text}</span></div>
            }>
              {(code) => (
                <div class="diff-row" classList={{ 'diff-add': code().kind === 'insert', 'diff-del': code().kind === 'delete' }}>
                  <DiffLine r={code()} canAdd={false} addComment={async () => {}} onMutated={() => {}} />
                </div>
              )}
            </Show>
          )}
        </For>
      </div>
    </div>
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
  openLine?: (row: CodeRow) => void
  askAgent?: (row: CodeRow) => void
  askHint?: string
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
            <span class="diff-gutter">
              {props.gutter ?? ''}
              <OpenLineButton row={r()} onOpen={props.openLine} />
              <AskAgentButton row={r()} onOpen={props.askAgent} hint={props.askHint} />
            </span>
            <span class="diff-marker">{r().kind === 'insert' ? '+' : r().kind === 'delete' ? '\u2212' : ' '}</span>
            <Show when={props.canAdd && props.composer}>
              <button class="diff-add-btn" title="Comment on this line" onClick={() => props.composer?.setOpen(!props.composer.isOpen())}>
                +
              </button>
            </Show>
            <CodeContent r={r()} highlight={props.highlight} />
            <Show when={props.composer?.isOpen()}>
              <LineComposer addComment={props.addComment} onMutated={props.onMutated} composer={props.composer!} mentions={props.mentions ?? []} />
            </Show>
          </>
        )}
      </Show>
    </div>
  )
}

function OpenLineButton(props: { row: CodeRow; onOpen?: (row: CodeRow) => void }) {
  const label = () => `Open ${props.row.path}:${props.row.newNo} in editor`
  return (
    <Show when={props.row.kind === 'insert' && props.row.newNo != null && props.onOpen}>
      <button
        type="button"
        class="diff-open-btn"
        title={label()}
        aria-label={label()}
        onClick={(event) => {
          event.stopPropagation()
          props.onOpen?.(props.row)
        }}
      >
        ↗
      </button>
    </Show>
  )
}

// The styled tip rather than `title`: the host's one delegated listener reads `data-tip`, so a tip per
// row costs no handler per row (kit/components/overlays/tips.tsx).
function AskAgentButton(props: { row: CodeRow; onOpen?: (row: CodeRow) => void; hint?: string }) {
  return <Show when={props.onOpen && (props.row.newNo != null || props.row.oldNo != null)}>
    <button
      type="button"
      class="diff-ask-btn"
      data-tip="Ask agent about this line"
      data-tip-sub={props.hint}
      aria-label={`Ask agent about ${props.row.path}:${props.row.newNo ?? props.row.oldNo}`}
      onClick={(event) => { event.stopPropagation(); props.onOpen?.(props.row) }}
    >✦</button>
  </Show>
}

function CodeContent(props: { r: CodeRow; highlight?: FindHighlight }) {
  const hl = () => (props.highlight && props.highlight.ranges.length ? props.highlight : null)
  // One `.diff-code` for both branches. In split mode it is the element that scrolls sideways, and a
  // row's word spans arrive after its plain text: a span per branch would be replaced when they land,
  // back at column 0.
  return (
    <span class="diff-code">
      <Show
        when={props.r.words}
        fallback={
          <Show
            when={hl()}
            fallback={<For each={props.r.toks}>{(t) => <span style={{ '--l': t.light, '--r': t.dark }}>{t.content}</span>}</For>}
          >
            {(h) => (
              <For each={markTokens(props.r.toks, h().ranges, h().current)}>
                {(t) => (
                  <span style={{ '--l': t.light, '--r': t.dark }} classList={{ 'ui-find-mark': t.mark > 0 }}
                  {...(t.mark === 2 ? { 'data-current': '' } : {})}>
                    {t.content}
                  </span>
                )}
              </For>
            )}
          </Show>
        }
      >
        {(words) => (
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
                    classList={{ 'diff-word-add': w.kind === 'add', 'diff-word-del': w.kind === 'del', 'ui-find-mark': w.mark > 0 }}
                    {...(w.mark === 2 ? { 'data-current': '' } : {})}
                  >
                    {w.content}
                  </span>
                )}
              </For>
            )}
          </Show>
        )}
      </Show>
    </span>
  )
}

function LineComposer(props: {
  addComment: (body: string) => Promise<unknown>
  onMutated: () => void
  composer: LineComposerController
  mentions: string[]
}) {
  const [busy, setBusy] = createSignal(false)
  const [err, setErr] = createSignal<string | null>(null)

  const submit = async () => {
    const submitting = props.composer
    const onMutated = props.onMutated
    const originalBody = submitting.body()
    const text = originalBody.trim()
    if (!text) return
    setBusy(true)
    setErr(null)
    try {
      await props.addComment(text)
      if (submitting.acknowledge) submitting.acknowledge(originalBody)
      else if (submitting.body() === originalBody) {
        submitting.setBody('')
        submitting.setOpen(false)
      }
      onMutated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="diff-composer" onClick={(e) => e.stopPropagation()}>
      <MentionTextarea
        placeholder={'Comment on this line\u2026'}
        value={props.composer.body()}
        onInput={props.composer.setBody}
        mentions={props.mentions}
      />
      <div class="diff-composer-actions">
        <Button variant="ghost" onPress={() => props.composer.setOpen(false)}>Cancel</Button>
        <Button variant="solid" disabled={busy() || !props.composer.body().trim()} onPress={submit}>
          {busy() ? 'Adding\u2026' : 'Comment'}
        </Button>
      </div>
      <Show when={err()}>
        <span class="diff-thread-err">{err()}</span>
      </Show>
    </div>
  )
}

function ThreadRow(props: {
  thread: DiffThread
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
  const collapsed = () => props.collapse?.collapsed() ?? localCollapsed()
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
      setErr(e instanceof Error ? e.message : "Couldn't save. Try again.")
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
      setErr(e instanceof Error ? e.message : "Couldn't save. Try again.")
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
        <span class="diff-thread-status">{resolved() ? 'Resolved' : 'Unresolved'}</span>
        <Button variant="bare" disabled={busy()} onPress={toggleResolve}>
          {resolved() ? 'Unresolve' : 'Resolve'}
        </Button>
        <Button variant="bare" onPress={toggleCollapsed}>
          {collapsed() ? 'Show' : 'Hide'}
        </Button>
      </div>
      <Show when={!collapsed()}>
        <For each={props.thread.comments}>
          {(c) => (
            <div class="comment diff-thread-comment">
              <div class="comment-meta comment-meta-with-avatar">
                <UserAvatar login={c.author} />
                <strong>{c.author ?? 'unknown'}</strong>
              </div>
              <SanitizedHtml html={c.body ?? ''} />
            </div>
          )}
        </For>
        <div class="diff-reply">
          <MentionTextarea
            placeholder={replyId() == null ? "Can't reply to this thread" : 'Reply\u2026'}
            disabled={replyId() == null}
            value={body()}
            onInput={setBody}
            mentions={props.mentions}
          />
          <div class="diff-composer-actions">
            <Button disabled={busy() || replyId() == null || !body().trim()} onPress={submitReply}>
              {busy() ? 'Replying\u2026' : 'Reply'}
            </Button>
          </div>
          <Show when={err()}>
            <span class="diff-thread-err">{err()}</span>
          </Show>
        </div>
      </Show>
    </div>
  )
}
