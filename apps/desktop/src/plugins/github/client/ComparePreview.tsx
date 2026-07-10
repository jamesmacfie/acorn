import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { useParams, useSearchParams } from '@solidjs/router'
import { compareOptions, reposOptions } from '../../../core/client/queries'
import { getHighlighter } from './shiki'
import { DiffLine, NonCodeRow } from './diff/DiffRows'
import { createDiffHydrator } from './diff/hydration'
import {
  buildDiffRows,
  buildRenderableRows,
  highlighterTokenize,
  isCodeRow,
  plainTokenize,
  type CodeRow,
  type ParsedFile,
  type Row,
  type TokenizeLine,
} from './diff/model'

// Right (Diff) pane in create mode: read-only base..head preview. Reuses the diff engine
// (createDiffHydrator + buildRenderableRows + Shiki) and the row components, but with no review
// threads, line composers, or gap expansion — none of those exist before the PR does. Rows render
// in normal flow (no virtualizer); the hydrator parses in small idle batches so branch changes do
// not pin the main thread, and its generation counter cancels a stale run when the file set flips.
// Every patch body arrives inline on the compare payload, so `cachedFile` serves them all (binary /
// too-large files have a null patch and render the "No diff" row) and no fetchPatches is wired.
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
  const compareFiles = () => compare.data?.files ?? []

  const [parsedByPath, setParsedByPath] = createSignal<Map<string, ParsedFile>>(new Map())
  let tokenizerPromise: Promise<TokenizeLine> | null = null
  const loadTokenizer = async () => {
    return (tokenizerPromise ??= getHighlighter().then(highlighterTokenize).catch(() => plainTokenize))
  }

  const hydrator = createDiffHydrator({
    tokenizerForFile: () => loadTokenizer(),
    parseFile: (file, tokenize) => ({ file, diff: buildDiffRows(file, tokenize) }),
    onParsed: (parsedFile) => setParsedByPath((prev) => new Map(prev).set(parsedFile.file.path, parsedFile)),
    cachedFile: (path) => compareFiles().find((file) => file.path === path) ?? null,
  })
  onCleanup(hydrator.dispose)

  // Re-hydrate when the compared file set changes; reset() bumps the generation, cancelling any
  // in-flight parse of the previous branch pair.
  createEffect(on(compareFiles, (list) => {
    setParsedByPath(new Map())
    hydrator.reset(list)
  }))

  const parsed = createMemo<ParsedFile[]>(() => {
    const parsedFiles = parsedByPath()
    return compareFiles().map((file) => {
      const parsedFile = parsedFiles.get(file.path)
      if (parsedFile) return parsedFile
      return { file, diff: [{ kind: 'load', file, status: hydrator.status(file.path) === 'error' ? 'error' : 'loading' }] }
    })
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
                      'diff-thread-row': row.kind === 'nodiff' || row.kind === 'load',
                    }}
                  >
                    <Show
                      when={isCodeRow(row) ? row : null}
                      fallback={
                        <NonCodeRow
                          row={row as Exclude<Row, CodeRow>}
                          onMutated={noop}
                          resolveThread={noop}
                          reply={noop}
                          retryDiff={(file) => hydrator.retry(file.path)}
                        />
                      }
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
