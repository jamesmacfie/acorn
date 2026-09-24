import { createSignal } from 'solid-js'
import type { TerminalSession } from '../contract/wire'
import { terminalApi } from './terminalClient'
import { onTerminalSessionCreated } from '../contract/sessionsClient'
import { activeNodeId, forgetAttentionSource, hasHostCapability, onScopeEvicted, registerWsChannel, replaceAttentionSource, requestTerminalFocusIntent, wsOnReconnect } from '@acorn/plugin-api/client'
import { fromTerminalSession } from './attention'

const node = (): string => activeNodeId() ?? ''
const [sessions, setSessions] = createSignal<TerminalSession[]>([])
export { sessions }
const [sessionNode, setSessionNode] = createSignal<string | null>(null)
export { sessionNode }
let generation = 0

export async function refreshSessions(): Promise<void> {
  const requestedNode = node()
  const request = ++generation
  try {
    const rows = hasHostCapability({ plugin: 'terminal' }) ? await terminalApi().list() : []
    if (request !== generation || requestedNode !== node()) return
    setSessionNode(requestedNode)
    setSessions(rows)
    replaceAttentionSource('terminal', requestedNode, rows.flatMap((session) => fromTerminalSession(session, requestedNode) ?? []))
  } catch (error) {
    if (request === generation && requestedNode === node()) { setSessions([]); forgetAttentionSource('terminal', requestedNode) }
    throw error
  }
}

export function addSession(session: TerminalSession, createdNode = node()): void {
  if (createdNode !== node()) return
  if (sessionNode() !== node()) { setSessionNode(node()); setSessions([]) }
  setSessions((rows) => rows.some((row) => row.id === session.id) ? rows : [...rows, session])
}

export function clearSessions(): void {
  const previousNode = sessionNode()
  generation++
  setSessionNode(null)
  setSessions([])
  activeByTask.clear()
  if (previousNode !== null) forgetAttentionSource('terminal', previousNode)
}

const activeByTask = new Map<string, string>()
export const activeTerminal = (taskId: string): string | undefined => activeByTask.get(taskId)
export const rememberActiveTerminal = (taskId: string, sessionId: string): void => { activeByTask.set(taskId, sessionId) }
export const requestTerminalFocus = (taskId: string, sessionId: string): void => requestTerminalFocusIntent(taskId, sessionId)

export function initSessions(): () => void {
  const created = onTerminalSessionCreated(addSession)
  const pull = (): void => { void refreshSessions().catch(() => {}) }
  pull()
  const channel = registerWsChannel('terminal', (frame) => {
    if (frame.channel === 'terminal:sessions-changed') pull()
  })
  const reconnect = wsOnReconnect(pull)
  const scope = onScopeEvicted((event) => {
    if (event.scope === 'task') activeByTask.delete(event.taskId)
    if (event.scope === 'node-switched') {
      clearSessions()
      pull()
    }
  })
  return () => { created(); scope(); channel.dispose(); reconnect(); clearSessions() }
}
