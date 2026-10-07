import { createMemo, createSignal } from 'solid-js'
import type { EditorApi } from './editorClient'
import type { EditorFileStatusSnapshot } from '../contract/fileStatus'
import { projectFileStatus } from './fileStatusModel'

/** One task-owned read. Bursts join one run; a newer request follows it at most once. */
export function createFileStatusReader(api: Pick<EditorApi, 'fileStatus'>, taskId: string, isCurrent: () => boolean) {
  const [snapshot, setSnapshot] = createSignal<EditorFileStatusSnapshot | null>(null)
  const [stale, setStale] = createSignal(false)
  const projection = createMemo(() => projectFileStatus(snapshot()))
  let revision = 0
  let running = false
  let pending = false
  let stopped = false
  const refresh = () => {
    if (stopped) return
    const requested = ++revision
    if (running) { pending = true; return }
    running = true
    const current = requested
    void api.fileStatus(taskId).then((next) => {
      if (!stopped && isCurrent() && current === revision) {
        setSnapshot(next.kind === 'ready' ? next : null)
        setStale(false)
      }
    }).catch((cause: unknown) => {
      if (stopped || !isCurrent() || current !== revision) return
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
      revision++
      setSnapshot(null)
      setStale(false)
      refresh()
    },
    stop: () => { stopped = true; revision++; pending = false },
  }
}
