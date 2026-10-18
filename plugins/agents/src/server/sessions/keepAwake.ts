import { managedState } from '../../contract/attention'
import type { AgentWsFrame } from '../../contract/wire'

// One keep-awake lease for each session that's working or waiting on its owner
// (docs/node-distribution/keep-awake.md). A waiting session counts, because the person who answers it
// is often on another machine. `hold` answers undefined when core offers no keep-awake service.
export function holdAwakeWhileBusy(
  subscribe: (listener: (frame: AgentWsFrame) => void) => () => void,
  hold: () => (() => void) | undefined,
): () => void {
  const leases = new Map<string, () => void>()
  const release = (sessionId: string) => {
    leases.get(sessionId)?.()
    leases.delete(sessionId)
  }
  const unsubscribe = subscribe((frame) => {
    if (frame.channel === 'agent:deleted') return release(frame.sessionId)
    if (frame.channel !== 'agent:session') return
    const { id } = frame.session
    const state = managedState(frame.session)
    if (state !== 'working' && state !== 'blocked') return release(id)
    if (leases.has(id)) return
    const lease = hold()
    if (lease) leases.set(id, lease)
  })
  return () => {
    unsubscribe()
    for (const id of [...leases.keys()]) release(id)
  }
}
