import { createEffect, createRoot, createSignal } from 'solid-js'
import type { TerminalSession } from '../contract/wire'
import { terminalApi } from './terminalClient'
import { onTerminalSessionCreated } from '../contract/sessionsClient'
import { activeNodeId, forgetAttentionSource, hasHostCapability, nodeState, onScopeEvicted, registerWsChannel, replaceAttentionSource, requestTerminalFocusIntent, wsOnReconnect } from '@acorn/plugin-api/client'
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
  // Once per node, when that node can answer, rather than at activation. Activation runs once, before
  // the window has heard from any node, so a read fired then can meet a node that is still starting,
  // and nothing would ask again until a session changed. The agent roster primes the same way
  // (plugins/agents/src/client/sessions/managedStore.ts § activateManagedAgentNotifications). No node id
  // at all is a renderer served by the node itself, which has no status to wait for, so it reads at once.
  let primed: string | null | undefined
  const stopPrime = createRoot((dispose) => {
    createEffect(() => {
      const nodeId = activeNodeId()
      if (nodeId === primed || (nodeId !== null && nodeState(nodeId) === 'offline')) return
      primed = nodeId
      pull()
    })
    return dispose
  })
  const channel = registerWsChannel('terminal', (frame) => {
    if (frame.channel === 'terminal:sessions-changed') pull()
  })
  const reconnect = wsOnReconnect(pull)
  const scope = onScopeEvicted((event) => {
    if (event.scope === 'task') activeByTask.delete(event.taskId)
    // No read here. The prime effect above reads the new node once it can answer. A read at the
    // switch itself went out before that: at launch, when the remembered node had gone, it asked the
    // local node before the broker had adopted it.
    if (event.scope === 'node-switched') clearSessions()
  })
  return () => { stopPrime(); created(); scope(); channel.dispose(); reconnect(); clearSessions() }
}
