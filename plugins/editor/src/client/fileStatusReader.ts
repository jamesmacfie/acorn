import { createMemo, createSignal } from 'solid-js'
import { latestSignal } from '@acorn/plugin-api/client'
import type { EditorApi } from './editorClient'
import type { EditorFileStatusSnapshot } from '../contract/fileStatus'
import { projectFileStatus } from './fileStatusModel'

/** One task-owned read. Bursts join one run; a newer request follows it at most once. */
export function createFileStatusReader(api: Pick<EditorApi, 'fileStatus'>, taskId: string, isCurrent: () => boolean) {
  const [snapshot, setSnapshot] = createSignal<EditorFileStatusSnapshot | null>(null)
  const [stale, setStale] = createSignal(false)
  const projection = createMemo(() => projectFileStatus(snapshot()))
  // A newer request aborts the commit of the read in flight, which then runs once more.
  const latest = latestSignal()
  let running = false
  let pending = false
  let stopped = false
  const refresh = () => {
    if (stopped) return
    const signal = latest.next()
    if (running) { pending = true; return }
    running = true
    void api.fileStatus(taskId).then((next) => {
      if (!stopped && isCurrent() && !signal.aborted) {
        setSnapshot(next.kind === 'ready' ? next : null)
        setStale(false)
      }
    }).catch((cause: unknown) => {
      if (stopped || !isCurrent() || signal.aborted) return
      if (typeof cause === 'object' && cause !== null && 'status' in cause && cause.status === 404) {
        setSnapshot(null)
        setStale(false)
      } else setStale(true)
    }).finally(() => {
      running = false
      if (pending && !stopped) { pending = false; refresh() }
    })
  }
  return {
    projection,
    stale,
    refresh,
    providerChanged: () => {
      if (stopped) return
      latest.abort()
      setSnapshot(null)
      setStale(false)
      refresh()
    },
    stop: () => { stopped = true; latest.abort(); pending = false },
  }
}
