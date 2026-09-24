import { createSignal } from 'solid-js'
import { activeNodeId } from '../../../infra/node/activeNode'
import type { Disposable } from '../../../kit/lib/registry'

export type SessionSubmit = 'now' | 'after-ready' | 'draft'
export type SessionSummary = {
  sourceId: string
  nodeId: string
  sessionId: string
  taskId: string
  title: string
  running: boolean
  createdAt: number
  agent?: boolean
  idle?: boolean
  settingUp?: boolean
  /** Host registration epoch. A row chosen before plugin reload cannot call its replacement. */
  sourceVersion?: number
}

export type SessionSource = {
  // The source owns its fetch, invalidation and full records. A signal read here makes consumers
  // reactive without giving the host the source's row type.
  summaries(): readonly Omit<SessionSummary, 'sourceId'>[]
  refresh?(): Promise<void>
  send?(sessionId: string, text: string, submit: SessionSubmit): Promise<{ ok: boolean; queued?: boolean; reason?: string }>
  focus?(sessionId: string, taskId: string): void
  dispose?(): void
}

const sources = new Map<string, { source: SessionSource; version: number }>()
const [revision, setRevision] = createSignal(0)
let nextVersion = 0
const currentNode = (): string => activeNodeId() ?? ''

export function registerSessionSource(sourceId: string, source: SessionSource): Disposable {
  if (sources.has(sourceId)) throw new Error(`session source already registered: ${sourceId}`)
  const registered = { source, version: ++nextVersion }
  sources.set(sourceId, registered)
  setRevision((value) => value + 1)
  return { dispose: () => {
    if (sources.get(sourceId) !== registered) return
    sources.delete(sourceId)
    source.dispose?.()
    setRevision((value) => value + 1)
  } }
}

export function sessionSummaries(): SessionSummary[] {
  revision()
  const nodeId = currentNode()
  return [...sources].flatMap(([sourceId, { source, version }]) => source.summaries()
    .filter((summary) => summary.nodeId === nodeId)
    .map((summary) => ({ ...summary, sourceId, sourceVersion: version })))
}

export function agentSessionsFor(taskId: string | null): SessionSummary[] {
  if (!taskId) return []
  return sessionSummaries().filter((row) => row.taskId === taskId && row.agent && row.running)
    .sort((a, b) => b.createdAt - a.createdAt)
}

export function isSettingUp(taskId: string): boolean {
  return sessionSummaries().some((row) => row.taskId === taskId && row.settingUp && row.running)
}

export async function sendToSession(row: SessionSummary, text: string, submit: SessionSubmit): Promise<{ ok: boolean; queued?: boolean; reason?: string }> {
  const registered = sources.get(row.sourceId)
  const source = registered?.source
  if (!source?.send || row.sourceVersion !== registered?.version || row.nodeId !== currentNode() || !source.summaries().some((current) =>
    current.nodeId === row.nodeId && current.sessionId === row.sessionId && current.taskId === row.taskId && current.running))
    return { ok: false, reason: 'Session is no longer available.' }
  return source.send(row.sessionId, text, submit)
}

export function focusSession(row: SessionSummary): boolean {
  const registered = sources.get(row.sourceId)
  const source = registered?.source
  if (!source?.focus || row.sourceVersion !== registered?.version || row.nodeId !== currentNode() || !source.summaries().some((current) =>
    current.nodeId === row.nodeId && current.sessionId === row.sessionId && current.taskId === row.taskId)) return false
  source.focus(row.sessionId, row.taskId)
  return true
}

export async function refreshSessionSources(): Promise<void> {
  await Promise.all([...sources.values()].map(({ source }) => source.refresh?.()))
}
