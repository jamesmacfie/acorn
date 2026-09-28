import type { AgentSessionSnapshot, AgentWsFrame } from '../../contract/wire.ts'
import type { WaitCondition } from './runtimeEngine'
import type { AgentStore } from './store'

type WaitDependencies = {
  store: Pick<AgentStore, 'snapshot'>
  conditionMet(snapshot: AgentSessionSnapshot, until: WaitCondition): boolean
  subscribe(listener: (frame: AgentWsFrame) => void): () => void
}

/** Waits on live frames while using the durable snapshot as the return authority. */
export async function waitForSessionSnapshot(
  deps: WaitDependencies,
  sessionId: string,
  afterSeq: number,
  until: WaitCondition,
  timeoutMs: number,
): Promise<AgentSessionSnapshot> {
  const initial = await deps.store.snapshot(sessionId, afterSeq)
  if (deps.conditionMet(initial, until) || timeoutMs === 0) return initial
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (snapshot: AgentSessionSnapshot) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      off()
      resolve(snapshot)
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      off()
      reject(error)
    }
    const check = () => {
      void deps.store.snapshot(sessionId, afterSeq).then((snapshot) => {
        if (deps.conditionMet(snapshot, until)) finish(snapshot)
      }, fail)
    }
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      off()
      void deps.store.snapshot(sessionId, afterSeq).then(resolve, reject)
    }, timeoutMs)
    const off = deps.subscribe((frame) => {
      if (
        (frame.channel === 'agent:event' && frame.event.sessionId !== sessionId)
        || (frame.channel === 'agent:session' && frame.session.id !== sessionId)
        || (frame.channel === 'agent:turn' && frame.turn.sessionId !== sessionId)
        || (frame.channel === 'agent:request' && frame.request.sessionId !== sessionId)
        || frame.channel === 'agent:deleted'
      ) return
      check()
    })
    // Recheck after subscribing to cover events committed between the first read and registration.
    check()
  })
}
