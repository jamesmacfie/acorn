import { createSignal } from 'solid-js'
import {
  activeTaskId,
  clientEvents,
  onPluginFrame,
  onScopeEvicted,
  readJson,
  taskById,
  type RailMarkerContribution,
  type Task,
} from '@acorn/plugin-api/client'
import { checksState } from '../model/checkStatus'
import { changeRequestMarkers } from '../model/railMarkers'
import type { ChangeRequestDetail } from '../model/types'

const POLL_MS = 60_000
// Long enough for the host to register a pushed commit's checks, which the read right after the push
// can miss.
const PUSH_WINDOW_MS = 5 * 60_000

/** A change request as a host names it: its repository, in the host's own spelling, and its number. */
type Watched = { repository: string; number: number }

const sameRequest = (a: Watched, b: Watched) =>
  a.number === b.number && a.repository.toLowerCase() === b.repository.toLowerCase()

/**
 * The marks on a code host's change request pane button (`changeRequestMarkers`), held the way git's
 * changes dot is held: one signal of answers per task, a read the first time a task is asked about, and
 * the last answer kept when a read fails. The detail is read again when the Node refreshes its copy
 * (`plugin:<pluginId>:pr-synced`), when a commit lands on the task, and once a minute while checks run
 * or just after a push. That minute's read is what turns an amber dot green or red: a stale read starts
 * the Node's refresh, which then announces `pr-synced`.
 */
export function changeRequestRailMarker(options: {
  id: string
  /** The pane whose button carries the marks. */
  pane: string
  pluginId: string
  /** The task's change request on this host, or null. */
  target: (task: Task) => Watched | null
  /** Where its detail is read, answering the neutral model. */
  route: (watched: Watched) => string
  /** The change request a `pr-synced` frame names, or null. */
  synced: (payload: unknown) => Watched | null
}): RailMarkerContribution {
  type Asked = Watched & { pushedAt: number; seq: number }
  const asked = new Map<string, Asked>()
  const [details, setDetails] = createSignal<Record<string, ChangeRequestDetail>>({})

  function read(taskId: string): void {
    const entry = asked.get(taskId)
    if (!entry) return
    const seq = ++entry.seq
    readJson<ChangeRequestDetail>(options.route(entry)).then(
      (detail) => {
        if (asked.get(taskId) === entry && entry.seq === seq)
          setDetails((current) => ({ ...current, [taskId]: detail }))
      },
      () => {},
    )
  }

  const stillMoving = (taskId: string): boolean => {
    const entry = asked.get(taskId)
    const detail = details()[taskId]
    if (!entry || detail?.request?.state !== 'open') return false
    if (Date.now() - entry.pushedAt < PUSH_WINDOW_MS) return true
    const state = checksState(detail.checks)
    return detail.checks.length > 0 && (state === 'pending' || state === 'mixed')
  }

  // Subscribed on the first ask, so a window that never shows a change request runs no clock.
  let listening = false
  function listen(): void {
    if (listening) return
    listening = true
    onPluginFrame(options.pluginId, `plugin:${options.pluginId}:pr-synced`, (payload) => {
      const named = options.synced(payload)
      if (!named) return
      for (const [taskId, entry] of asked) if (sameRequest(entry, named)) read(taskId)
    })
    clientEvents.on('head:changed', (event) => {
      const entry = asked.get(event.taskId)
      if (!entry) return
      entry.pushedAt = Date.now()
      read(event.taskId)
    })
    onScopeEvicted((event) => {
      if (event.scope === 'workspace') return
      const drop = event.scope === 'task' ? [event.taskId] : [...asked.keys()]
      for (const taskId of drop) asked.delete(taskId)
      setDetails((current) => Object.fromEntries(Object.entries(current).filter(([taskId]) => asked.has(taskId))))
    })
    setInterval(() => {
      const taskId = activeTaskId()
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      if (taskId && stillMoving(taskId)) read(taskId)
    }, POLL_MS)
  }

  return {
    id: options.id,
    order: 30,
    markers: (target) => {
      if (target.kind !== 'pane' || target.id !== options.pane) return []
      const task = taskById(target.taskId)
      const at = task && options.target(task)
      if (!at) return []
      const held = asked.get(target.taskId)
      if (!held || held.repository !== at.repository || held.number !== at.number) {
        listen()
        asked.set(target.taskId, { ...at, pushedAt: 0, seq: 0 })
        read(target.taskId)
      }
      const detail = details()[target.taskId]
      return detail?.request?.number === at.number ? changeRequestMarkers(detail) : []
    },
  }
}
