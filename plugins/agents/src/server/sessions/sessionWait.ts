import type { AgentSessionSnapshot, AgentWsFrame } from '../../contract/wire.ts'
import type { WaitCondition } from './runtimeEngine'
import type { AgentStore } from './store'

type WaitDependencies = {
  store: Pick<AgentStore, 'waitFacts' | 'waitSnapshot'>
  subscribe(listener: (frame: AgentWsFrame) => void): () => void
  shutdown: AbortSignal
}

/** One check owns each waiter. Frames during a read request one follow-up check. */
export function waitForSessionSnapshot(
  deps: WaitDependencies,
  sessionId: string,
  afterSeq: number,
  until: WaitCondition,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<AgentSessionSnapshot> {
  return new Promise((resolve, reject) => {
    let settled = false
    let expired = timeoutMs === 0
    let active = false
    let dirty = false
    let initial = true
    let off = () => {}
    let timer: ReturnType<typeof setTimeout> | undefined
    const signals = [deps.shutdown, ...(signal ? [signal] : [])]
    const cleanup = () => {
      clearTimeout(timer)
      off()
      for (const item of signals) item.removeEventListener('abort', abort)
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const abort = () => fail(signals.find((item) => item.aborted)?.reason)
    const finish = (snapshot: AgentSessionSnapshot) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(snapshot)
    }
    const check = async () => {
      if (active || settled || expired) return
      active = true
      try {
        do {
          dirty = false
          const facts = await deps.store.waitFacts(sessionId, afterSeq, until)
          if (settled || expired) return
          // Retain the setup recheck even when the initial reader yields after its transaction.
          if (initial) { initial = false; dirty = true }
          if (dirty) continue
          if (facts.matched) {
            const snapshot = await deps.store.waitSnapshot(sessionId, afterSeq, until)
            if (settled || expired) return
            if (!dirty && snapshot.wait?.matched) { finish(snapshot); return }
            dirty = true
          }
        } while (dirty && !settled && !expired)
      } catch (error) { if (!expired) fail(error) }
      finally { active = false }
    }
    const timeout = () => {
      if (settled) return
      expired = true
      off()
      // A held check cannot extend the deadline or overwrite this final read.
      void deps.store.waitSnapshot(sessionId, afterSeq, until).then(finish, fail)
    }
    for (const item of signals) item.addEventListener('abort', abort, { once: true })
    if (signals.some((item) => item.aborted)) { abort(); return }
    // Subscribe before the first read, closing the initial read/listener gap as well.
    off = deps.subscribe((frame) => {
      const target = frame.channel === 'agent:event' ? frame.event.sessionId
        : frame.channel === 'agent:session' ? frame.session.id
        : frame.channel === 'agent:turn' ? frame.turn.sessionId
        : frame.channel === 'agent:request' ? frame.request.sessionId : frame.sessionId
      if (target !== sessionId || settled || expired) return
      if (frame.channel === 'agent:deleted') { fail(new Error(`Managed agent session not found: ${sessionId}`)); return }
      dirty = true
      void check()
    })
    if (expired) timeout()
    else {
      timer = setTimeout(timeout, timeoutMs)
      void check()
    }
  })
}
