// How each session group in the Agent pane's sidebar is ordered, chosen per task and per group, and
// persisted as a task-scoped state slice (agents.session-order). Mirrors the context plugin's
// selectionStore.ts: a pure signal store, a no-clobber hydrate, and the slice descriptor.
//
// A group's subagents and delegated children follow the group's order rather than having one of their
// own, so there is one choice per group to make and to remember.
import { createSignal } from 'solid-js'
import { onScopeEvicted, parseJson, type PersistedStateSlice } from '@acorn/plugin-api/client'
import type { AgentSession, AgentSubagent } from '../../contract/wire.ts'
import { isActiveAgent } from './agentActivity'

export type SessionOrder = 'status' | 'name' | 'created' | 'activity'
export type SessionGroup = 'managed' | 'workflow' | 'inline'
type TaskOrders = Partial<Record<SessionGroup, SessionOrder>>

// Newest first, which is the order the sidebar always drew in before there was a choice.
export const DEFAULT_SESSION_ORDER: SessionOrder = 'created'

export const SESSION_ORDER_CHOICES: readonly { value: SessionOrder; label: string }[] = [
  { value: 'status', label: 'Running first' },
  { value: 'name', label: 'Name' },
  { value: 'created', label: 'Newest first' },
  { value: 'activity', label: 'Latest activity' },
]

const ORDERS = new Set<string>(SESSION_ORDER_CHOICES.map((choice) => choice.value))
const GROUPS = new Set<string>(['managed', 'workflow', 'inline'])

const [ordersByTask, setOrdersByTask] = createSignal<Record<string, TaskOrders>>({})

export const sessionOrderFor = (taskId: string, group: SessionGroup): SessionOrder =>
  ordersByTask()[taskId]?.[group] ?? DEFAULT_SESSION_ORDER

export function setSessionOrder(taskId: string, group: SessionGroup, order: SessionOrder): void {
  setOrdersByTask((current) => ({ ...current, [taskId]: { ...current[taskId], [group]: order } }))
}

const hydrate = (taskId: string, value: TaskOrders): void => {
  setOrdersByTask((current) => (taskId in current ? current : { ...current, [taskId]: value }))
}

// Keyed by node-minted task ids, so none of it survives a node switch (the context plugin's
// selectionStore.ts states the case).
onScopeEvicted((e) => {
  if (e.scope === 'node-switched') setOrdersByTask({})
  else if (e.scope === 'task') {
    setOrdersByTask((current) => {
      if (!(e.taskId in current)) return current
      const next = { ...current }
      delete next[e.taskId]
      return next
    })
  }
})

const byName = (left: string, right: string): number =>
  left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })

// Each order is a key and a direction, with creation order breaking ties so two sessions that
// compare equal never swap places between redraws.
export const compareSessions = (order: SessionOrder) => (left: AgentSession, right: AgentSession): number => {
  const created = right.createdAt - left.createdAt || left.id.localeCompare(right.id)
  if (order === 'status') return Number(isActiveAgent(right)) - Number(isActiveAgent(left)) || created
  if (order === 'name') return byName(left.title, right.title) || created
  if (order === 'activity') {
    const at = (session: AgentSession) => session.lastEventAt ?? session.updatedAt
    return at(right) - at(left) || created
  }
  return created
}

const subagentRunning = (subagent: AgentSubagent): boolean =>
  subagent.status === 'pending' || subagent.status === 'running'

export const compareSubagents = (order: SessionOrder) => (left: AgentSubagent, right: AgentSubagent): number => {
  const started = right.startedAt - left.startedAt || left.id.localeCompare(right.id)
  if (order === 'status') return Number(subagentRunning(right)) - Number(subagentRunning(left)) || started
  if (order === 'name') return byName(left.title, right.title) || started
  if (order === 'activity') return right.updatedAt - left.updatedAt || started
  return started
}

const parseTaskOrders = (raw: unknown): TaskOrders => {
  const value = parseJson(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([group, order]) => GROUPS.has(group) && typeof order === 'string' && ORDERS.has(order))) as TaskOrders
}

export const sessionOrderSlice: PersistedStateSlice<TaskOrders> = {
  id: 'agents.session-order',
  key: 'agents:session-order',
  scope: 'task',
  restore: 'panes',
  version: 1,
  codec: { parse: parseTaskOrders, serialize: (value) => value },
  empty: () => ({}),
  unknownIds: 'retain-inert',
  maxBytes: 1024,
  binding: { values: ordersByTask, hydrate },
}
