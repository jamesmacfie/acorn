// Session-only sync bookkeeping for the Manifest (docs/next/context-ui.md). Two concerns:
//
// 1. Staleness — what *this pane* last sent to each agent session via Sync. No hashing: we keep the
//    raw per-section compact strings (a few KB, one entry per live session). It's a heuristic —
//    agent-pulled context (MCP task_context) and workflow pushes don't update it (tooltip says so).
//    Dead sessions fall out of the picker, so no exit hook is needed; task archive evicts explicitly.
//
// 2. Target session — which agent session Sync targets, per task (the activeByTask pattern), always
//    validated against the live list so a killed target falls back to the most-recent session.
import { createSignal } from 'solid-js'
import { agentSessionsFor } from '../../terminal/client/sessions'
import type { TerminalSession } from '../../../core/shared/terminal'

type SyncRecord = { taskId: string; at: number; sections: Record<string, string> }
const lastSync = new Map<string /* sessionId */, SyncRecord>()

// A monotonic tick so pane pills re-render when a sync lands; records are read imperatively.
const [tick, bump] = createSignal(0)

export function recordSync(sessionId: string, taskId: string, sections: Record<string, string>): void {
  lastSync.set(sessionId, { taskId, at: Date.now(), sections })
  bump(tick() + 1)
}

export type SyncStatus =
  | { kind: 'never' }
  | { kind: 'synced'; at: number }
  | { kind: 'stale'; at: number; changes: number }

export function syncStatus(sessionId: string, current: Record<string, string>): SyncStatus {
  tick() // subscribe so the pill updates after recordSync
  const record = lastSync.get(sessionId)
  if (!record) return { kind: 'never' }
  const keys = new Set([...Object.keys(record.sections), ...Object.keys(current)])
  let changes = 0
  for (const key of keys) if (record.sections[key] !== current[key]) changes++
  return changes ? { kind: 'stale', at: record.at, changes } : { kind: 'synced', at: record.at }
}

const targetByTask = new Map<string /* taskId */, string /* sessionId */>()
export const rememberTarget = (taskId: string, sessionId: string): void => {
  targetByTask.set(taskId, sessionId)
}
export function targetSessionFor(taskId: string): TerminalSession | undefined {
  const sessions = agentSessionsFor(taskId)
  return sessions.find((s) => s.id === targetByTask.get(taskId)) ?? sessions[0]
}

export function evictSyncState(taskId: string): void {
  targetByTask.delete(taskId)
  for (const [sessionId, record] of lastSync) if (record.taskId === taskId) lastSync.delete(sessionId)
}
