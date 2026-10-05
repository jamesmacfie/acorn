import type { AgentSession, AgentTurn } from '../../contract/wire'
import type { AgentConcurrencyLimits } from '../../shared/concurrency'
import { decideAgentCommand } from './stateMachine'

type QueueHead = { session: AgentSession; turn: AgentTurn }

export type QueueGeneration = {
  activeTurnId: string | null
  admissionTurnId: string | null
  workspaceId: string
  providerId: string
  stopping: boolean
  handle: { ready: boolean } | null
}

export type QueueCoordinatorPorts<Generation extends QueueGeneration> = {
  queuedHeads(): Promise<QueueHead[]>
  getSession(sessionId: string): Promise<AgentSession | null>
  requireSession(sessionId: string): Promise<AgentSession>
  nextQueuedTurn(sessionId: string): Promise<AgentTurn | null>
  limits(): Promise<AgentConcurrencyLimits>
  occupancy(): Iterable<Generation>
  live(sessionId: string): Generation | undefined
  workspaceId(taskId: string): Promise<string>
  stopLive(sessionId: string): Promise<void>
  ensureSession(session: AgentSession, turnId: string, workspaceId: string): Promise<Generation>
  ownsSession(sessionId: string, generation: Generation): boolean
  dispatch(session: AgentSession, turn: AgentTurn, generation: Generation): Promise<boolean>
  shuttingDown(): boolean
}

/** Serializes durable queue scans. Provider generations and turn outcomes belong to the engine. */
export class QueueCoordinator<Generation extends QueueGeneration> {
  private pumping = false
  private requested = false
  private interactiveStreak = 0
  private wakeTimer: ReturnType<typeof setTimeout> | null = null
  private wakeAt: number | null = null
  private readonly drainWaiters = new Set<() => void>()
  private closed = false

  constructor(private readonly ports: QueueCoordinatorPorts<Generation>) {}

  pump(): Promise<void> {
    if (this.closed || this.ports.shuttingDown()) return Promise.resolve()
    if (this.pumping) {
      this.requested = true
      return Promise.resolve()
    }
    return this.scan()
  }

  wakeAtTime(at: number): void {
    if (this.closed || this.ports.shuttingDown()) return
    if (this.wakeAt != null && this.wakeAt <= at) return
    if (this.wakeTimer) clearTimeout(this.wakeTimer)
    this.wakeAt = at
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null
      this.wakeAt = null
      void this.pump()
    }, Math.max(0, at - Date.now()))
    this.wakeTimer.unref?.()
  }

  async stop(): Promise<void> {
    this.closed = true
    if (this.wakeTimer) clearTimeout(this.wakeTimer)
    this.wakeTimer = null
    this.wakeAt = null
    if (this.pumping) await new Promise<void>((resolve) => this.drainWaiters.add(resolve))
  }

  private async scan(): Promise<void> {
    this.pumping = true
    const failedStarts = new Set<string>()
    try {
      for (;;) {
        this.requested = false
        const heads = await this.ports.queuedHeads()
        if (this.closed || this.ports.shuttingDown()) return
        const limits = await this.ports.limits()
        if (this.closed || this.ports.shuttingDown()) return
        const workspaceActive = new Map<string, number>()
        const providerActive = new Map<string, number>()
        for (const live of this.ports.occupancy()) {
          if (!live.activeTurnId && !live.admissionTurnId) continue
          workspaceActive.set(live.workspaceId, (workspaceActive.get(live.workspaceId) ?? 0) + 1)
          providerActive.set(live.providerId, (providerActive.get(live.providerId) ?? 0) + 1)
        }
        const sorted = heads.sort((a, b) => {
          const aInteractive = a.turn.source === 'interactive' || a.turn.source === 'automation'
          const bInteractive = b.turn.source === 'interactive' || b.turn.source === 'automation'
          if (this.interactiveStreak >= 5 && aInteractive !== bInteractive) return aInteractive ? 1 : -1
          if (aInteractive !== bInteractive) return aInteractive ? -1 : 1
          return a.turn.createdAt - b.turn.createdAt
        })
        let started = false
        for (const item of sorted) {
          if (this.closed || this.ports.shuttingDown()) return
          if (item.turn.notBefore != null && item.turn.notBefore > Date.now()) {
            this.wakeAtTime(item.turn.notBefore)
            continue
          }
          const existing = this.ports.live(item.session.id)
          if (failedStarts.has(item.session.id) || existing?.activeTurnId || existing?.admissionTurnId || existing?.stopping) continue
          const workspaceId = existing?.workspaceId || await this.ports.workspaceId(item.session.taskId)
          if (this.closed || this.ports.shuttingDown()) return
          if ((workspaceActive.get(workspaceId) ?? 0) >= limits.workspace) continue
          if ((providerActive.get(item.session.providerId) ?? 0) >= limits.provider) continue
          const current = await this.ports.getSession(item.session.id)
          const head = await this.ports.nextQueuedTurn(item.session.id)
          if (!current || current.controller !== 'acorn' || current.archivedAt || head?.id !== item.turn.id) continue
          if (head.notBefore != null && head.notBefore > Date.now()) {
            this.wakeAtTime(head.notBefore)
            continue
          }
          item.session = current
          if (item.session.runtimeState === 'failed' || item.session.runtimeState === 'stopped') {
            await this.ports.stopLive(item.session.id)
            if (this.closed || this.ports.shuttingDown()) return
          }
          const starting = this.ports.ensureSession(item.session, item.turn.id, workspaceId)
          const owner = this.ports.live(item.session.id)
          try {
            const live = await starting.catch(() => {
              if (!owner?.stopping && !this.closed && !this.ports.shuttingDown()) failedStarts.add(item.session.id)
              return null
            })
            if (!live?.handle?.ready || live.activeTurnId || live.stopping || this.closed || this.ports.shuttingDown()) continue
            const currentSession = await this.ports.requireSession(item.session.id)
            const currentHead = await this.ports.nextQueuedTurn(item.session.id)
            if (!this.ports.ownsSession(item.session.id, live) || currentHead?.id !== item.turn.id
              || currentSession.controller !== 'acorn' || currentSession.archivedAt) continue
            if (currentHead.notBefore != null && currentHead.notBefore > Date.now()) {
              this.wakeAtTime(currentHead.notBefore)
              continue
            }
            item.turn = currentHead
            const decision = decideAgentCommand({
              runtimeState: currentSession.runtimeState,
              attention: currentSession.attention,
              activeTurnId: live.activeTurnId,
              pendingRequestIds: [],
            }, { type: 'dispatch_turn', turnId: item.turn.id })
            if (!decision.ok) continue
            live.activeTurnId = item.turn.id
            workspaceActive.set(live.workspaceId, (workspaceActive.get(live.workspaceId) ?? 0) + 1)
            providerActive.set(live.providerId, (providerActive.get(live.providerId) ?? 0) + 1)
            this.interactiveStreak = item.turn.source === 'workflow' ? 0 : this.interactiveStreak + 1
            started = await this.ports.dispatch(item.session, item.turn, live)
          } finally {
            if (owner?.admissionTurnId === item.turn.id) owner.admissionTurnId = null
          }
        }
        if (!started && !this.requested) return
      }
    } catch (error) {
      if (!this.closed && !this.ports.shuttingDown()) throw error
    } finally {
      this.pumping = false
      for (const resolve of this.drainWaiters) resolve()
      this.drainWaiters.clear()
    }
  }
}
