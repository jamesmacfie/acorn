// Where a task's pull request stands, in the corners of its Pull request button: CI top right, the
// review decision bottom right, conflicts bottom left, and draft, merged, or closed top left. A merged
// or closed pull request shows only that, because nothing else on it is left to act on.
//
// Held the way git's changes dot is held: one signal of answers per task, a read the first time a
// task is asked about, and the last answer kept when a read fails. The detail is read again when the
// Node refreshes its copy (`pr-synced`), when a commit lands on the task (`head:changed`), and once a
// minute while checks run or just after a push. That minute's read is what turns an amber dot green
// or red: a stale read starts the Node's refresh, which then announces `pr-synced`.
import { createSignal } from 'solid-js'
import {
  activeTaskId,
  clientEvents,
  onPluginFrame,
  onScopeEvicted,
  readJson,
  taskById,
  type RailMarker,
  type RailMarkerContribution,
} from '@acorn/plugin-api/client'
import { CHECK_TONE, checksState, checksSummary } from '../checks/checkStatus'
import { pullRoute, type PullDetail } from '../../shared/api'
import { formatPullRef, pullRefMatchesTask } from '../../shared/pullRef'
import { reviewDecision } from './model'

const POLL_MS = 60_000
// Long enough for GitHub to register a pushed commit's checks, which the read right after the push
// can miss.
const PUSH_WINDOW_MS = 5 * 60_000

/** The button's marks for one pull request. "Open" gets none, because it is the normal case. */
export function pullMarkers(detail: PullDetail): RailMarker[] {
  const pull = detail.pull
  if (!pull) return []
  if (pull.state === 'merged')
    return [{ id: 'state', label: 'Merged', icon: 'git-merge', tone: 'accent', placements: ['top-start'] }]
  if (pull.state === 'closed')
    return [{ id: 'state', label: 'Closed', icon: 'git-pull-request-closed', placements: ['top-start'] }]

  const markers: RailMarker[] = []
  if (pull.draft)
    markers.push({ id: 'state', label: 'Draft', icon: 'git-pull-request-draft', placements: ['top-start'] })
  if (detail.checks.length) {
    const state = checksState(detail.checks)
    markers.push({
      id: 'checks',
      label: checksSummary(detail.checks),
      dotTone: CHECK_TONE[state],
      busy: state === 'pending' || state === 'mixed',
      placements: ['top-end'],
    })
  }
  const review = reviewDecision(detail.reviews)
  if (review.state === 'approved')
    markers.push({
      id: 'review',
      label: `Approved by ${review.reviewers.join(', ')}`,
      icon: 'check',
      placements: ['bottom-end'],
    })
  else if (review.state === 'changes-requested')
    markers.push({
      id: 'review',
      label: `Changes requested by ${review.reviewers.join(', ')}`,
      icon: 'file-diff',
      tone: 'warn',
      placements: ['bottom-end'],
    })
  if (pull.mergeable === 'CONFLICTING')
    markers.push({
      id: 'conflicts',
      label: pull.baseRef ? `Merge conflicts with ${pull.baseRef}` : 'Merge conflicts',
      icon: 'triangle-alert',
      tone: 'danger',
      placements: ['bottom-start'],
    })
  return markers
}

type Asked = { owner: string; name: string; pullNumber: number; pushedAt: number; seq: number }

const asked = new Map<string, Asked>()
const [details, setDetails] = createSignal<Record<string, PullDetail>>({})

function read(taskId: string): void {
  const entry = asked.get(taskId)
  if (!entry) return
  const seq = ++entry.seq
  readJson<PullDetail>(pullRoute(entry.owner, entry.name, entry.pullNumber)).then(
    (detail) => {
      // Only the newest read for the pull this task still points at.
      if (asked.get(taskId) === entry && entry.seq === seq) setDetails((current) => ({ ...current, [taskId]: detail }))
    },
    () => {},
  )
}

const stillMoving = (taskId: string): boolean => {
  const entry = asked.get(taskId)
  const detail = details()[taskId]
  if (!entry || !detail?.pull || detail.pull.state !== 'open') return false
  if (Date.now() - entry.pushedAt < PUSH_WINDOW_MS) return true
  const state = checksState(detail.checks)
  return detail.checks.length > 0 && (state === 'pending' || state === 'mixed')
}

// Subscribed on the first ask rather than at import, so a window that never shows a pull request
// opens no socket listener and runs no clock. Module-level for the renderer's life, like the signal.
let listening = false
function listen(): void {
  if (listening) return
  listening = true
  onPluginFrame('github', 'plugin:github:pr-synced', (payload) => {
    const event = (payload ?? {}) as { repoOwner?: unknown; repoName?: unknown; pullNumber?: unknown }
    if (
      typeof event.repoOwner !== 'string' ||
      typeof event.repoName !== 'string' ||
      typeof event.pullNumber !== 'number'
    )
      return
    const ref = formatPullRef(event.repoOwner, event.repoName, event.pullNumber)
    for (const [taskId, entry] of asked) if (pullRefMatchesTask(ref, entry, entry.pullNumber)) read(taskId)
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
  // Only the task being viewed, because that is the only one whose button is drawn. Paused while the
  // window is hidden; the terminal client has no document and always counts as shown.
  setInterval(() => {
    const taskId = activeTaskId()
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    if (taskId && stillMoving(taskId)) read(taskId)
  }, POLL_MS)
}

function ask(taskId: string, owner: string, name: string, pullNumber: number): void {
  const held = asked.get(taskId)
  if (held && held.owner === owner && held.name === name && held.pullNumber === pullNumber) return
  listen()
  asked.set(taskId, { owner, name, pullNumber, pushedAt: 0, seq: 0 })
  read(taskId)
}

/** Test seam: the state is module-level, so a suite must not inherit the previous one's answers. */
export function _resetPullMarkers(): void {
  asked.clear()
  setDetails({})
}

// The PR pane's own button only. `statusAnnotations` stays off the pane, because this plugin owns it.
export const prRailMarkerContribution: RailMarkerContribution = {
  id: 'pr-status',
  order: 30,
  markers: (target) => {
    if (target.kind !== 'pane' || target.id !== 'pr') return []
    const task = taskById(target.taskId)
    if (!task?.github || task.pullNumber == null) return []
    ask(target.taskId, task.github.owner, task.github.name, task.pullNumber)
    const detail = details()[target.taskId]
    // A task whose pull changed keeps the old answer until the new read lands. Show nothing meanwhile.
    return detail?.pull?.number === task.pullNumber ? pullMarkers(detail) : []
  },
}
