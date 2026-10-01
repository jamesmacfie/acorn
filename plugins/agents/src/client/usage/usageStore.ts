import { createSignal, type Accessor } from 'solid-js'
import type { AgentUsageSnapshot } from '../../shared/usage'
import { agentUsageClient, type AgentUsageClient } from './usageClient'

const POLL_MS = 5 * 60_000

export type AgentUsageStore = {
  snapshot: Accessor<AgentUsageSnapshot | null>
  loading: Accessor<boolean>
  refreshing: Accessor<boolean>
  refreshingProviderId: Accessor<string | null>
  error: Accessor<string>
  init(): () => void
  ensure(): Promise<void>
  refresh(): Promise<void>
  refreshProvider(providerId: string): Promise<void>
}

export function createAgentUsageStore(
  client: AgentUsageClient,
  timers: Pick<typeof globalThis, 'setInterval' | 'clearInterval'> = globalThis,
): AgentUsageStore {
  const [snapshot, setSnapshot] = createSignal<AgentUsageSnapshot | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [refreshing, setRefreshing] = createSignal(false)
  const [refreshingProviderId, setRefreshingProviderId] = createSignal<string | null>(null)
  const [error, setError] = createSignal('')
  let consumers = 0
  let poll: ReturnType<typeof setInterval> | undefined
  let generation = 0

  const load = async (force: boolean, providerId?: string): Promise<void> => {
    if (force && refreshing()) return
    const mine = ++generation
    if (force) {
      setRefreshing(true)
      setRefreshingProviderId(providerId ?? null)
    }
    else if (!snapshot()) setLoading(true)
    setError('')
    try {
      const result = await (providerId ? client.refreshProvider(providerId) : force ? client.refresh() : client.read())
      if (mine === generation) setSnapshot(result)
    } catch (cause) {
      if (mine === generation) setError(cause instanceof Error ? cause.message : 'Agent usage could not be loaded.')
    } finally {
      if (force) {
        setRefreshing(false)
        setRefreshingProviderId(null)
      }
      if (mine === generation) {
        setLoading(false)
      }
    }
  }

  return {
    snapshot,
    loading,
    refreshing,
    refreshingProviderId,
    error,
    init() {
      consumers += 1
      if (consumers === 1) {
        void load(false)
        poll = timers.setInterval(() => void load(false), POLL_MS)
      }
      let active = true
      return () => {
        if (!active) return
        active = false
        consumers = Math.max(0, consumers - 1)
        if (consumers === 0 && poll) {
          timers.clearInterval(poll)
          poll = undefined
        }
      }
    },
    ensure: () => (snapshot() ? Promise.resolve() : load(false)),
    refresh: () => load(true),
    refreshProvider: (providerId) => load(true, providerId),
  }
}

export const agentUsageStore = createAgentUsageStore(agentUsageClient)
