import { createQuery } from '@tanstack/solid-query'
import { createSignal } from 'solid-js'
import { useSearchParams } from '@solidjs/router'
import { fileSummariesOptions, type PullFile } from './queries'

// Single source for a PR's changed-file order and the `?file=` scroll target. `?file=` is written
// from three places — the `/` finder and `[`/`]` cycling (Shortcuts.tsx) and the file list
// (PullDetail) — all of which must agree on the file order, which is the summaries query's order.
// DiffView only reads `?file=` (as its scroll anchor), so it keeps its own full-payload query.
export function useChangedFiles(
  route: () => { owner: string; repo: string; number: string } | null,
  options: { router?: boolean } = {},
) {
  // Registry-rendered PR panes receive a task and deliberately have no router provider in their
  // conformance harness. Browse/detail routes keep URL-backed file selection; task panes keep the
  // same behavior locally and use the typed file-scroll event to drive the diff.
  const router = options.router !== false ? useSearchParams() : null
  const [localFile, setLocalFile] = createSignal<string>()
  const query = createQuery(() => {
    const r = route()
    return fileSummariesOptions(r?.owner ?? '', r?.repo ?? '', r?.number ?? '', !!r)
  })

  const files = (): PullFile[] => query.data ?? []
  const isLoading = () => query.isLoading
  const currentFile = () => {
    const value = router?.[0].file
    return typeof value === 'string' ? value : localFile()
  }
  const selectFile = (path: string) => {
    if (router) router[1]({ file: path })
    else setLocalFile(path)
  }

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
