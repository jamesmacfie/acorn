import { createSignal } from 'solid-js'
import { useSearchParams } from '@solidjs/router'
import type { ChangedFile } from '../model/types'

// Single source for a change request's changed-file order and the `?file=` scroll target. `?file=` is
// written from three places (the `/` palette search, `[` and `]` cycling, and the file list), all of
// which must agree on the file order, which is the host's file list order. The diff only reads
// `?file=` as its scroll anchor.
export function useChangedFiles<T extends ChangedFile>(files: () => T[], options: { router?: boolean } = {}) {
  // Registry-rendered panes receive a task and deliberately have no router provider in their
  // conformance harness. Browse and detail routes keep URL-backed file selection; task panes keep the
  // same behaviour locally and use the typed file-scroll event to drive the diff.
  const router = options.router !== false ? useSearchParams() : null
  const [localFile, setLocalFile] = createSignal<string>()

  const currentFile = () => {
    const value = router?.[0].file
    return typeof value === 'string' ? value : localFile()
  }
  const selectFile = (path: string) => {
    if (router) router[1]({ file: path })
    else setLocalFile(path)
  }

  // Move ?file= to the next or previous changed file, wrapping. A no-op when there are no files.
  const cycleFile = (dir: 1 | -1) => {
    const list = files()
    if (!list.length) return
    const i = list.findIndex((f) => f.path === currentFile())
    const base = i < 0 ? (dir === 1 ? -1 : 0) : i
    const next = (base + dir + list.length) % list.length
    selectFile(list[next].path)
  }

  return { files, currentFile, selectFile, cycleFile }
}
