import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { useParams, useSearchParams } from '@solidjs/router'
import { compareOptions, reposOptions } from './queries'
import { getHighlighter } from './shiki'
import { DiffLine, NonCodeRow } from './features/diff/DiffRows'
import { parseFilesInChunks } from './features/diff/chunkedParse'
import {
  buildRenderableRows,
  highlighterTokenize,
  isCodeRow,
  plainTokenize,
  type CodeRow,
  type ParsedFile,
  type Row,
  type TokenizeLine,
} from './features/diff/model'

// Right (Diff) pane in create mode: read-only base..head preview. Reuses the diff engine
// (chunked parsing / buildRenderableRows + Shiki) and the row components, but with no review
// threads, line composers, or gap expansion — none of those exist before the PR does. Rows still
// render in normal flow; parsing is chunked so branch changes do not pin the main thread.
const noop = async () => {}

export default function ComparePreview() {
  const params = useParams()
  const [searchParams] = useSearchParams()
  const o = () => params.owner ?? ''
  const r = () => params.repo ?? ''
  const repos = createQuery(() => reposOptions(true))
  const repo = () => repos.data?.find((x) => x.owner === o() && x.name === r())
  const base = () => (typeof searchParams.base === 'string' && searchParams.base) || repo()?.defaultBranch || ''
  const head = () => (typeof searchParams.head === 'string' ? searchParams.head : '')
  const comparable = () => !!head() && head() !== base()
  const compare = createQuery(() => compareOptions(o(), r(), base(), head(), !!repo() && comparable()))

  // Parse + highlight all files once the tokenizer loads. Cancels if the file set changes mid-flight.
  const [parsed, setParsed] = createSignal<ParsedFile[]>([])
  let parseRun = 0
  createEffect(() => {
    const list = compare.data?.files ?? []
    const run = ++parseRun
    let cancelled = false
    onCleanup(() => {
      cancelled = true
    })
    setParsed([])
    if (!list.length) return
    void (async () => {
      const tokenize: TokenizeLine = await getHighlighter()
        .then(highlighterTokenize)
        .catch(() => plainTokenize)
      if (cancelled || run !== parseRun) return
      await parseFilesInChunks(list, tokenize, {
        isCancelled: () => cancelled || run !== parseRun,
        onChunk: setParsed,
      })
    })()
  })
  const rows = createMemo<Row[]>(() => buildRenderableRows(parsed(), undefined))

  return (
    <Show when={comparable()} fallback={<p class="placeholder">Pick a branch to compare.</p>}>
      <Show when={!compare.isLoading} fallback={<p class="placeholder">Loading…</p>}>
        <Show
          when={(compare.data?.aheadBy ?? 0) > 0}
          fallback={<p class="placeholder">Nothing to compare — branches are identical.</p>}
        >
          <div class="diff compare-diff">
            <div class="diff-rows">
              <For each={rows()}>
                {(row) => (
                  <div
                    class="diff-row"
                    classList={{
                      'diff-hunk': row.kind === 'hunk',
                      'diff-add': row.kind === 'insert',
                      'diff-del': row.kind === 'delete',
                      'diff-file-row': row.kind === 'file',
                      'diff-thread-row': row.kind === 'nodiff',
                    }}
                  >
                    <Show
                      when={isCodeRow(row) ? row : null}
                      fallback={<NonCodeRow row={row as Exclude<Row, CodeRow>} onMutated={noop} resolveThread={noop} reply={noop} />}
                    >
                      {(cr) => <DiffLine r={cr()} canAdd={false} addComment={noop} onMutated={noop} />}
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>
      </Show>
    </Show>
  )
}
