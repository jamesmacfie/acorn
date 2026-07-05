import { createQuery } from '@tanstack/solid-query'
import { useSearchParams } from '@solidjs/router'
import { fileSummariesOptions, type PullFile } from './queries'

// Single source for a PR's changed-file order and the `?file=` scroll target. `?file=` is written
// from three places — the `/` finder and `[`/`]` cycling (Shortcuts.tsx) and the file list
// (PullDetail) — all of which must agree on the file order, which is the summaries query's order.
// DiffView only reads `?file=` (as its scroll anchor), so it keeps its own full-payload query.
export function useChangedFiles(route: () => { owner: string; repo: string; number: string } | null) {
  const [searchParams, setSearchParams] = useSearchParams()
  const query = createQuery(() => {
    const r = route()
    return fileSummariesOptions(r?.owner ?? '', r?.repo ?? '', r?.number ?? '', !!r)
  })

  const files = (): PullFile[] => query.data ?? []
  const isLoading = () => query.isLoading
  const currentFile = () => (typeof searchParams.file === 'string' ? searchParams.file : undefined)
  const selectFile = (path: string) => setSearchParams({ file: path })

  // Move ?file= to the next/prev changed file, wrapping. No-op when there are no files.
  const cycleFile = (dir: 1 | -1) => {
    const list = files()
    if (!list.length) return
    const i = list.findIndex((f) => f.path === currentFile())
    const base = i < 0 ? (dir === 1 ? -1 : 0) : i
    const next = (base + dir + list.length) % list.length
    selectFile(list[next].path)
  }

  return { files, isLoading, currentFile, selectFile, cycleFile }
}
