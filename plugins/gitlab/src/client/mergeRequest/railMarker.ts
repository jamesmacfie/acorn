// Where a task's merge request stands, in the corners of its `mr` pane button, as GitHub's pull
// request button does (plugins/github/src/client/pullDetail/railMarker.ts): the pipeline top right,
// approval bottom right, conflicts bottom left, and draft, merged, or closed top left. Read once when
// the button is first drawn, again when the Node refreshes its mirror or a commit lands on the task,
// and once a minute while jobs run.
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
import {
  CHECK_TONE,
  checksState,
  checksSummary,
  reviewDecision,
  type ChangeRequestDetail,
} from '@acorn/change-request-ui/model'
import { mergeRequestRoute } from '../../shared/api'
import { samePath } from '../../shared/mergeRequestRef'
import { taskMergeRequest } from '../clientRoutes'

const POLL_MS = 60_000
const PUSH_WINDOW_MS = 5 * 60_000

/** The button's marks for one merge request. Open gets none, because it is the normal case. */
export function mergeRequestMarkers(detail: ChangeRequestDetail): RailMarker[] {
  const request = detail.request
  if (!request) return []
  if (request.state === 'merged')
    return [{ id: 'state', label: 'Merged', icon: 'git-merge', tone: 'accent', placements: ['top-start'] }]
  if (request.state === 'closed')
    return [{ id: 'state', label: 'Closed', icon: 'git-pull-request-closed', placements: ['top-start'] }]
  const markers: RailMarker[] = []
  if (request.draft)
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
  if (request.conflicting)
    markers.push({
      id: 'conflicts',
      label: request.baseRef ? `Merge conflicts with ${request.baseRef}` : 'Merge conflicts',
      icon: 'triangle-alert',
      tone: 'danger',
      placements: ['bottom-start'],
    })
  return markers
}

type Asked = { address: string; number: number; pushedAt: number; seq: number }
const asked = new Map<string, Asked>()
const [details, setDetails] = createSignal<Record<string, ChangeRequestDetail>>({})

function read(taskId: string): void {
  const entry = asked.get(taskId)
  if (!entry) return
  const seq = ++entry.seq
  readJson<ChangeRequestDetail>(mergeRequestRoute(entry.address, entry.number)).then(
    (detail) => {
      if (asked.get(taskId) === entry && entry.seq === seq) setDetails((current) => ({ ...current, [taskId]: detail }))
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

// Subscribed on the first ask, so a window that never shows a merge request runs no clock.
let listening = false
function listen(): void {
  if (listening) return
  listening = true
  onPluginFrame('gitlab', 'plugin:gitlab:pr-synced', (payload) => {
    const event = (payload ?? {}) as { projectAddress?: unknown; number?: unknown }
    if (typeof event.projectAddress !== 'string') return
    for (const [taskId, entry] of asked)
      if (entry.number === event.number && samePath(entry.address, event.projectAddress)) read(taskId)
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

export const mrRailMarkerContribution: RailMarkerContribution = {
  id: 'mr-status',
  order: 30,
  markers: (target) => {
    if (target.kind !== 'pane' || target.id !== 'mr') return []
    const task = taskById(target.taskId)
    const at = task && taskMergeRequest(task)
    if (!at) return []
    const held = asked.get(target.taskId)
    if (!held || held.address !== at.address || held.number !== at.number) {
      listen()
      asked.set(target.taskId, { ...at, pushedAt: 0, seq: 0 })
      read(target.taskId)
    }
    const detail = details()[target.taskId]
    return detail?.request?.number === at.number ? mergeRequestMarkers(detail) : []
  },
}
