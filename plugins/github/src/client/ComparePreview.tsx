import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { useParams, useSearchParams } from '@solidjs/router'
import { compareOptions } from './queries'
import { projectsOptions } from '@acorn/plugin-api/client'
import { DiffLine, EmptyState, NonCodeRow } from '@acorn/plugin-api/ui'
import { buildDiffRowsAsync, buildRenderableRows, type CodeRow, createDiffHydrator, isCodeRow, type ParsedFile, type Row, tokenizeDocument } from '@acorn/plugin-api/ui/diff'

// Right (Diff) pane in create mode: a read-only base..head preview. Reuses the diff engine
// (createDiffHydrator, buildRenderableRows, Shiki) and the row components, but with no review threads,
// line composers or gap expansion, none of which exist before the PR does.
//
// Rows render in normal flow with no virtualizer. The hydrator parses in small idle batches so branch
// changes don't pin the main thread, and its generation counter cancels a stale run when the file set
// flips. Every patch body arrives inline on the compare payload, so `cachedFile` serves them all and no
// fetchPatches is wired. Binary and too-large files have a null patch and render the "No diff" row.
const noop = async () => {}

export default function ComparePreview() {
  const params = useParams()
  const [searchParams] = useSearchParams()
  const projects = createQuery(() => projectsOptions(true))
  const project = () => projects.data?.find((x) => x.id === params.projectId)
  const github = () => project()?.github
  const o = () => github()?.owner ?? ''
  const r = () => github()?.name ?? ''
  const repo = () => github()
  const base = () => (typeof searchParams.base === 'string' && searchParams.base) || project()?.defaultBranch || ''
  const head = () => (typeof searchParams.head === 'string' ? searchParams.head : '')
  const comparable = () => !!head() && head() !== base()
  const compare = createQuery(() => compareOptions(o(), r(), base(), head(), !!repo() && comparable()))
  const compareFiles = () => compare.data?.files ?? []

  const [parsedByPath, setParsedByPath] = createSignal<Map<string, ParsedFile>>(new Map())

  const hydrator = createDiffHydrator({
    parseFile: async (file) => ({ file, diff: await buildDiffRowsAsync(file, tokenizeDocument) }),
    onParsed: (parsedFile) => setParsedByPath((prev) => new Map(prev).set(parsedFile.file.path, parsedFile)),
    cachedFile: (path) => compareFiles().find((file) => file.path === path) ?? null,
  })
  onCleanup(hydrator.dispose)

  // Re-hydrate when the compared file set changes. reset() bumps the generation, cancelling any
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
    <Show when={comparable()} fallback={<EmptyState align="start">Pick a branch to compare.</EmptyState>}>
      <Show when={!compare.isLoading} fallback={<EmptyState align="start" busy>Loading…</EmptyState>}>
        <Show
          when={(compare.data?.aheadBy ?? 0) > 0}
          fallback={<EmptyState align="start">Nothing to compare — branches are identical.</EmptyState>}
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
