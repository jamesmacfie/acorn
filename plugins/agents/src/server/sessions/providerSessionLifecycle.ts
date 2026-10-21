import { ProcessRetirementError } from '../processes/ownedProcess'
import { awaitWithSignal } from '../processes/startCancellation'
import type { AgentSession } from '../../contract/wire'
import type {
  AgentDriver,
  AgentDriverEvent,
  AgentDriverLoopHooks,
  AgentDriverMcpServer,
  AgentDriverReadBlock,
  AgentDriverSession,
} from '../drivers/types'
import type { AgentDriverRegistry } from '../drivers/registry'
import type { PluginTelemetry } from '@acorn/plugin-api/node'
import type { AgentStartupPhase, MeasureAgentStartup } from '../drivers/startupTelemetry'
import type { SkillReport, SkillStart } from '../drivers/skillIndex'
import { sessionAttendance } from './attendance'

export type ProviderGeneration = Readonly<{ sessionId: string; number: number }>

export type ProviderFacts = Readonly<{
  generation: ProviderGeneration
  taskId: string
  workspaceId: string
  providerId: string
  activeTurnId: string | null
  admissionTurnId: string | null
  stopping: boolean
  ready: boolean
  starting: boolean
  closing: boolean
  lastActivityAt: number
  pid: number | null
}>

type LiveSession = {
  generation: ProviderGeneration
  handle: AgentDriverSession | null
  startPromise: Promise<AgentDriverSession> | null
  controller: AbortController
  stopPromise: Promise<void> | null
  retirementFailure: ProcessRetirementError | null
  callbacks: Set<Promise<void>>
  activeTurnId: string | null
  admissionTurnId: string | null
  taskId: string
  workspaceId: string
  providerId: string
  stopping: boolean
  closing: boolean
  lastActivityAt: number
  reconnectAttempt: number
  acceptedResponse: boolean
  driver: AgentDriver
  // This start's skills, whether the first turn still owes their part, and every command or skill name
  // the harness has advertised, which is how a native load is confirmed.
  skills: SkillStart | null
  skillsOwed: boolean
  advertised: Set<string>
  retireMcp: (() => Promise<void>) | null
}

export type ProviderLifecyclePorts = {
  registry: AgentDriverRegistry
  taskRoot(taskId: string): Promise<string>
  workspaceId(taskId: string): Promise<string>
  hasProviderExecutionHistory(sessionId: string): Promise<boolean>
  /** The session's environment and task token. A `sandboxed` start's token can't reach execute tools. */
  scopedEnvironment(session: AgentSession, sandboxed: boolean): Record<string, string>
  mcpServers(
    session: AgentSession,
    env: Record<string, string>,
    signal: AbortSignal,
  ): Promise<{
    servers: AgentDriverMcpServer[]
    unavailable: string[]
    retire?: () => Promise<void>
  }>
  mcpUnavailable(sessionId: string, names: string[]): Promise<void>
  /** The skills a start of this session receives, with a native folder when the driver loads one, and
   *  the report once a turn carried them. */
  skills(session: AgentSession, generation: ProviderGeneration, native: boolean): Promise<SkillStart>
  skillsDelivered(sessionId: string, report: SkillReport): Promise<void>
  /** The bridge for a start of a driver with `loopHooks`, or null when no loop point has a handler. */
  loopHooks(session: AgentSession): Promise<AgentDriverLoopHooks | null>
  /** The config folder of the account the session is pinned to, or null for the harness's default
   *  login. Throws when that account was removed. */
  accountHome(session: AgentSession): Promise<string | null>
  /** Whether the person switched the read block on, read at every start. */
  readBlockOn(): Promise<boolean>
  /** The read block for a start of a driver with `readBlock`, once `readBlockOn` said yes. */
  readBlock(input: {
    sessionId: string
    worktree: string
    env: Record<string, string>
    skillPaths: readonly string[]
  }): Promise<AgentDriverReadBlock>
  event(sessionId: string, generation: ProviderGeneration, event: AgentDriverEvent): Promise<void>
  closed(sessionId: string, generation: ProviderGeneration, attempt: number, error?: Error): Promise<void>
  closeMessage(error?: Error): string
  startFailed(sessionId: string, admissionTurnId: string | null, error: unknown): Promise<void>
  retirementFlush(sessionId: string): Promise<void>
  session(sessionId: string): Promise<AgentSession>
  idleSweep(): Promise<void>
  quietSweep(sessionId: string): Promise<void>
  footprintSample(): Promise<void>
  callbackError(kind: 'idle' | 'quiet' | 'footprint', error: unknown): void
  telemetry?: Pick<PluginTelemetry, 'enabled' | 'startSpan'>
  pump(): void
  shuttingDown(): boolean
}

// Runs steps together and waits for every one to settle, then throws the first failure in the order
// given, or returns the values.
async function settleAll<T extends readonly unknown[]>(steps: { [K in keyof T]: Promise<T[K]> }): Promise<T> {
  const results = await Promise.allSettled(steps)
  const failed = results.find((result) => result.status === 'rejected')
  if (failed) throw failed.reason
  return results.map((result) => (result as PromiseFulfilledResult<unknown>).value) as unknown as T
}

const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000]

/** Owns provider generations, their children, callbacks, and process-specific timers. */
export class ProviderSessionLifecycle {
  private readonly live = new Map<string, LiveSession>()
  private readonly readinessHolds = new Set<string>()
  private readonly reconnectTimers = new Set<ReturnType<typeof setTimeout>>()
  private readonly quietTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly callbacks = new Set<Promise<void>>()
  private idleSweepTimer: ReturnType<typeof setInterval> | null = null
  private idleSweepRunning = false
  private footprintTimer: ReturnType<typeof setInterval> | null = null
  private nextGeneration = 0

  constructor(
    private readonly ports: ProviderLifecyclePorts,
    private readonly idleSweepMs: number,
    private readonly quietMs: number,
  ) {}

  private facts(live: LiveSession): ProviderFacts {
    return {
      generation: live.generation,
      taskId: live.taskId,
      workspaceId: live.workspaceId,
      providerId: live.providerId,
      activeTurnId: live.activeTurnId,
      admissionTurnId: live.admissionTurnId,
      stopping: live.stopping,
      ready: live.handle?.ready ?? false,
      starting: live.startPromise != null,
      closing: live.closing,
      lastActivityAt: live.lastActivityAt,
      pid: live.handle?.pid ?? null,
    }
  }

  current(sessionId: string): ProviderFacts | null {
    const live = this.live.get(sessionId)
    return live ? this.facts(live) : null
  }

  occupancy(): ProviderFacts[] {
    return [...this.live.values()].map((live) => this.facts(live))
  }
  ids(): string[] {
    return [...this.live.keys()]
  }
  has(sessionId: string): boolean {
    return this.live.has(sessionId)
  }
  owns(generation: ProviderGeneration): boolean {
    const live = this.live.get(generation.sessionId)
    return (
      !!live &&
      live.generation === generation &&
      !live.stopping &&
      !live.controller.signal.aborted &&
      !this.ports.shuttingDown()
    )
  }
  signal(generation: ProviderGeneration): AbortSignal {
    const live = this.require(generation)
    return live.controller.signal
  }
  holdReadiness(sessionId: string): void {
    this.readinessHolds.add(sessionId)
  }
  releaseReadiness(sessionId: string): void {
    this.readinessHolds.delete(sessionId)
  }
  isReadinessHeld(sessionId: string): boolean {
    return this.readinessHolds.has(sessionId)
  }
  idleCandidate(sessionId: string, generation: ProviderGeneration, before: number): boolean {
    const live = this.live.get(sessionId)
    return (
      !!live &&
      live.generation === generation &&
      live.handle != null &&
      !live.startPromise &&
      !live.stopping &&
      !live.activeTurnId &&
      !live.admissionTurnId &&
      !this.readinessHolds.has(sessionId) &&
      live.lastActivityAt <= before
    )
  }
  markStopping(generation: ProviderGeneration): boolean {
    const live = this.live.get(generation.sessionId)
    if (!live || live.generation !== generation) return false
    live.stopping = true
    return true
  }
  release(generation: ProviderGeneration, turnId: string): void {
    const live = this.live.get(generation.sessionId)
    if (live?.generation === generation && live.admissionTurnId === turnId) live.admissionTurnId = null
  }
  activate(generation: ProviderGeneration, turnId: string): boolean {
    const live = this.live.get(generation.sessionId)
    if (!live || !this.owns(generation) || live.activeTurnId || !live.handle?.ready) return false
    live.activeTurnId = turnId
    return true
  }
  clearActive(generation: ProviderGeneration, turnId?: string): void {
    const live = this.live.get(generation.sessionId)
    if (live?.generation === generation && (!turnId || live.activeTurnId === turnId)) {
      live.activeTurnId = null
      live.lastActivityAt = Date.now()
    }
  }
  takeActive(generation: ProviderGeneration): string | null {
    const live = this.live.get(generation.sessionId)
    if (live?.generation !== generation) return null
    const turnId = live?.activeTurnId ?? null
    if (live) live.activeTurnId = null
    return turnId
  }
  beginDispatch(generation: ProviderGeneration): void {
    const live = this.require(generation)
    live.acceptedResponse = false
    live.lastActivityAt = Date.now()
  }
  accepted(generation: ProviderGeneration): boolean {
    return this.require(generation).acceptedResponse
  }
  heard(generation: ProviderGeneration, substantive: boolean): void {
    const live = this.live.get(generation.sessionId)
    if (!live || live.generation !== generation) return
    live.lastActivityAt = Date.now()
    if (substantive) live.acceptedResponse = true
  }
  driverFailure(generation: ProviderGeneration, error: unknown): 'safe_transient' | 'uncertain' | 'permanent' {
    return this.require(generation).driver.classifyTurnFailure?.(error) ?? 'uncertain'
  }
  private require(generation: ProviderGeneration): LiveSession {
    const live = this.live.get(generation.sessionId)
    if (!live || live.generation !== generation) throw new Error('The managed agent session is stopping.')
    return live
  }

  async ensure(
    session: AgentSession,
    admission?: { turnId: string; workspaceId: string },
  ): Promise<ProviderGeneration> {
    if (this.ports.shuttingDown()) throw new Error('The managed agent runtime is shutting down.')
    const existing = this.live.get(session.id)
    if (existing?.retirementFailure) throw existing.retirementFailure
    if (existing?.stopping) throw new Error('The managed agent session is stopping.')
    if (admission && existing) existing.admissionTurnId = admission.turnId
    if (existing?.handle) return existing.generation
    if (existing?.startPromise) {
      await existing.startPromise
      if (!this.owns(existing.generation)) throw new Error('The managed agent session is stopping.')
      return existing.generation
    }
    if (session.controller !== 'acorn') throw new Error(`Session input is controlled by ${session.controller}.`)
    const driver = this.ports.registry.create(session.providerId)
    if (!driver) throw new Error(`Managed provider is not registered: ${session.providerId}`)
    const live: LiveSession = {
      generation: { sessionId: session.id, number: ++this.nextGeneration },
      handle: null,
      startPromise: null,
      controller: new AbortController(),
      stopPromise: null,
      retirementFailure: null,
      callbacks: new Set(),
      activeTurnId: null,
      admissionTurnId: admission?.turnId ?? null,
      taskId: session.taskId,
      workspaceId: admission?.workspaceId ?? '',
      providerId: session.providerId,
      stopping: false,
      closing: false,
      lastActivityAt: Date.now(),
      reconnectAttempt: existing?.reconnectAttempt ?? 0,
      acceptedResponse: false,
      driver,
      skills: null,
      skillsOwed: false,
      advertised: new Set(),
      retireMcp: null,
    }
    // Install before any task, ledger, environment, or driver await.
    this.live.set(session.id, live)
    this.armIdleSweep()
    live.startPromise = Promise.resolve().then(() => this.start(session, live))
    await live.startPromise
    if (!this.owns(live.generation)) throw new Error('The managed agent session is stopping.')
    // A start is when the total memory climbs, so the sweep doesn't wait for its timer.
    this.sweepIdle()
    return live.generation
  }

  private async start(session: AgentSession, live: LiveSession): Promise<AgentDriverSession> {
    const signal = live.controller.signal
    let startup: ReturnType<(typeof import('./startupTelemetry'))['sessionStartupTelemetry']>
    try {
      if (this.ports.telemetry?.enabled()) {
        const { sessionStartupTelemetry } = await import('./startupTelemetry')
        signal.throwIfAborted()
        startup = sessionStartupTelemetry(this.ports.telemetry, session, live.reconnectAttempt > 0, signal)
      }
      const prepare = <T>(phase: AgentStartupPhase, run: () => Promise<T>): Promise<T> =>
        startup ? startup.phase(phase, run) : run()
      // Async, so an aborted start rejects the step instead of throwing while the others are being set up.
      const read = async <T>(query: () => Promise<T>): Promise<T> => {
        signal.throwIfAborted()
        return awaitWithSignal(query(), signal)
      }
      // Nothing here waits on another step until `env`, so each group runs at once. `settleAll` fails only
      // after every step has settled, and a step puts what it builds on `live` as it lands, so the cleanup
      // below finds the skill folder and the MCP relays however the start ends.
      // Read at every start, like the hooks, so switching it applies from the next start. Decided before
      // the token is minted, because every execute tool runs outside the harness's sandbox, so a
      // sandboxed session's token stops at write tools (docs/managed-agents/read-block.md).
      const [cwd, workspaceId, hasHistory, sandboxed, accountHome, skills, loopHooks] = await settleAll([
        prepare('task.root', () => read(() => this.ports.taskRoot(session.taskId))),
        live.workspaceId
          ? Promise.resolve(live.workspaceId)
          : prepare('workspace.read', () => read(() => this.ports.workspaceId(session.taskId))),
        prepare('history.read', () => read(() => this.ports.hasProviderExecutionHistory(session.id))),
        live.driver.readBlock === true ? read(() => this.ports.readBlockOn()) : Promise.resolve(false),
        // Every start and resume, because the CLI finds the session it resumes only in this folder.
        read(() => this.ports.accountHome(session)),
        // Read at every start and resume, like the MCP servers below, so a skill switched off or approved
        // since the last one applies now. A process that keeps running keeps what it was given.
        read(() => this.ports.skills(session, live.generation, live.driver.nativeSkills === true)).then((skills) => {
          live.skills = skills
          live.skillsOwed = true
          return skills
        }),
        live.driver.loopHooks ? read(() => this.ports.loopHooks(session)) : Promise.resolve(null),
      ])
      live.workspaceId = workspaceId
      const noProviderExecutionHistory = !hasHistory
      const env = this.ports.scopedEnvironment(session, sandboxed)
      const [mcp, readBlock] = await settleAll([
        prepare('mcp.prepare', () => read(() => this.ports.mcpServers(session, env, signal))).then((mcp) => {
          live.retireMcp = mcp.retire ?? null
          return mcp
        }),
        sandboxed
          ? read(() =>
              this.ports.readBlock({
                sessionId: session.id,
                worktree: cwd,
                env,
                skillPaths: [...skills.folders, ...skills.plugins],
              }),
            )
          : Promise.resolve(null),
      ])
      // A warning write is durable work. Join it even if stop aborts the following driver start.
      if (mcp.unavailable.length) await this.ports.mcpUnavailable(session.id, mcp.unavailable)
      const { attendanceInstructions } = await import('./attendanceInstructions')
      const instructions = attendanceInstructions(sessionAttendance(session))
      signal.throwIfAborted()
      const launch = (measureStartup?: MeasureAgentStartup) =>
        live.driver.start({
          cwd,
          env,
          mcpServers: mcp.servers,
          skillFolders: skills.folders,
          skillPlugins: skills.plugins,
          ...(loopHooks ? { loopHooks } : {}),
          ...(readBlock ? { readBlock } : {}),
          ...(accountHome ? { accountHome } : {}),
          noProviderExecutionHistory,
          signal,
          session,
          measureStartup,
          ...(instructions ? { attendanceInstructions: instructions } : {}),
          onEvent: (event) =>
            this.callback(live, () => {
              if (event.type === 'session_metadata') {
                for (const item of [...(event.commands ?? []), ...(event.skills ?? [])]) live.advertised.add(item.name)
              }
              return this.ports.event(session.id, live.generation, event)
            }),
          onClosed: (error) => this.callback(live, () => this.closed(session.id, live, error)),
        })
      const handle = await (startup ? startup.provider(launch) : launch())
      if (!this.owns(live.generation)) {
        await handle.stop()
        throw new Error('The managed agent runtime is shutting down.')
      }
      live.handle = handle
      live.lastActivityAt = Date.now()
      live.reconnectAttempt = 0
      startup?.end('ok')
      this.ports.pump()
      return handle
    } catch (error) {
      startup?.end('error')
      if (error instanceof ProcessRetirementError) live.retirementFailure = error
      if (!this.ports.shuttingDown() && !live.stopping)
        await this.ports.startFailed(session.id, live.admissionTurnId, error)
      throw error
    } finally {
      live.startPromise = null
      if (!live.handle) {
        await this.retireSkills(live)
        await this.retireMcp(live)
      }
      if (!live.handle && !live.stopping && !live.retirementFailure && this.live.get(session.id) === live)
        this.live.delete(session.id)
    }
  }

  // A start's skill folder outlives nothing that reads it: called once its process has stopped, or when
  // the start never got one.
  private async retireSkills(live: LiveSession): Promise<void> {
    const skills = live.skills
    live.skills = null
    await skills?.retire()
  }

  private async retireMcp(live: LiveSession): Promise<void> {
    const retire = live.retireMcp
    live.retireMcp = null
    await retire?.()
  }

  private callback(live: LiveSession, work: () => Promise<void>): Promise<void> {
    if (!this.owns(live.generation)) return Promise.resolve()
    const done = work()
    this.callbacks.add(done)
    live.callbacks.add(done)
    const settled = () => {
      this.callbacks.delete(done)
      live.callbacks.delete(done)
    }
    void done.then(settled, settled)
    return done
  }

  async withHandle<T>(
    generation: ProviderGeneration,
    operation: (handle: AgentDriverSession) => Promise<T>,
  ): Promise<T> {
    const live = this.require(generation)
    if (!this.owns(generation) || !live.handle) throw new Error('Provider session is not connected.')
    return operation(live.handle)
  }
  async withCurrentHandle<T>(
    generation: ProviderGeneration,
    operation: (handle: AgentDriverSession) => Promise<T>,
  ): Promise<T | null> {
    const live = this.live.get(generation.sessionId)
    if (!live || live.generation !== generation || !this.owns(generation) || !live.handle) return null
    return operation(live.handle)
  }
  sendTurn(
    generation: ProviderGeneration,
    request: Parameters<AgentDriverSession['sendTurn']>[0],
    onSuccess: (result: Awaited<ReturnType<AgentDriverSession['sendTurn']>>) => Promise<void>,
    onError: (error: unknown) => Promise<void>,
  ): void {
    const live = this.require(generation)
    if (!this.owns(generation) || !live.handle) throw new Error('Provider session is not connected.')
    // The skills part rides ahead of the first turn after a start, decided now from what the harness has
    // advertised so far. It counts as delivered once that turn has run, and is owed again if the turn
    // failed.
    const skills = live.skillsOwed ? (live.skills?.firstTurn(live.advertised) ?? null) : null
    live.skillsOwed = false
    void live.handle
      .sendTurn(skills?.part ? { ...request, input: [skills.part, ...request.input] } : request)
      .then(async (result) => {
        // A failed report must not turn a finished turn into a failed one.
        if (skills)
          await this.callback(live, () => this.ports.skillsDelivered(generation.sessionId, skills.report)).catch(
            () => undefined,
          )
        await this.callback(live, () => onSuccess(result))
      })
      .catch((error) => {
        if (skills) live.skillsOwed = true
        return this.callback(live, () => onError(error))
      })
  }
  async handleIfPresent<T>(
    sessionId: string,
    operation: (handle: AgentDriverSession) => Promise<T>,
  ): Promise<T | null> {
    const live = this.live.get(sessionId)
    if (!live || !this.owns(live.generation) || !live.handle) return null
    return operation(live.handle)
  }

  private async closed(sessionId: string, live: LiveSession, error?: Error): Promise<void> {
    if (!this.owns(live.generation) || live.closing) return
    if (live.startPromise) {
      live.controller.abort(new Error(this.ports.closeMessage(error)))
      return
    }
    live.closing = true
    try {
      await live.handle?.stop()
    } catch (failure) {
      if (failure instanceof ProcessRetirementError) live.retirementFailure = failure
      throw failure
    }
    await this.retireSkills(live)
    await this.retireMcp(live)
    if (!this.owns(live.generation)) return
    const attempt = live.reconnectAttempt++
    await this.ports.closed(sessionId, live.generation, attempt, error)
    if (!this.owns(live.generation)) return
    live.handle = null
    if (attempt >= RECONNECT_DELAYS_MS.length) {
      this.live.delete(sessionId)
      return
    }
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(timer)
      if (!this.owns(live.generation)) return
      void this.ports
        .session(sessionId)
        .then((session) => (this.owns(live.generation) ? this.ensure(session) : undefined))
        .catch(() => undefined)
    }, RECONNECT_DELAYS_MS[attempt])
    timer.unref?.()
    this.reconnectTimers.add(timer)
  }

  armQuiet(sessionId: string): void {
    const existing = this.quietTimers.get(sessionId)
    if (existing) clearTimeout(existing)
    if (this.ports.shuttingDown()) return
    const timer = setTimeout(() => {
      this.quietTimers.delete(sessionId)
      if (this.ports.shuttingDown()) return
      const sweep = this.ports.quietSweep(sessionId).catch((error) => this.ports.callbackError('quiet', error))
      this.track(sweep)
    }, this.quietMs)
    timer.unref?.()
    this.quietTimers.set(sessionId, timer)
  }
  private armIdleSweep(): void {
    if (this.idleSweepTimer || this.ports.shuttingDown()) return
    this.idleSweepTimer = setInterval(() => this.sweepIdle(), this.idleSweepMs)
    this.idleSweepTimer.unref?.()
  }
  // One sweep at a time, so two can't both stop a process to get under the same memory limit. A start
  // that lands during a sweep is covered by the next one.
  private sweepIdle(): void {
    if (this.idleSweepRunning || this.ports.shuttingDown()) return
    this.idleSweepRunning = true
    this.track(
      this.ports
        .idleSweep()
        .catch((error) => this.ports.callbackError('idle', error))
        .finally(() => {
          this.idleSweepRunning = false
        }),
    )
  }
  armFootprintSample(everyMs: number): void {
    if (this.footprintTimer) return
    this.footprintTimer = setInterval(() => {
      if (!this.ports.shuttingDown()) {
        this.track(this.ports.footprintSample().catch((error) => this.ports.callbackError('footprint', error)))
      }
    }, everyMs)
    this.footprintTimer.unref?.()
  }
  private track(work: Promise<void>): void {
    this.callbacks.add(work)
    void work.finally(() => this.callbacks.delete(work))
  }

  abortAndClearTimers(): void {
    for (const live of this.live.values())
      live.controller.abort(new Error('The managed agent runtime is shutting down.'))
    for (const timer of this.reconnectTimers) clearTimeout(timer)
    this.reconnectTimers.clear()
    for (const timer of this.quietTimers.values()) clearTimeout(timer)
    this.quietTimers.clear()
    if (this.idleSweepTimer) clearInterval(this.idleSweepTimer)
    this.idleSweepTimer = null
    if (this.footprintTimer) clearInterval(this.footprintTimer)
    this.footprintTimer = null
  }
  async stopAll(): Promise<void> {
    const results = await Promise.allSettled(this.ids().map((id) => this.stop(id)))
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure) throw failure.reason
  }
  async joinCallbacks(): Promise<void> {
    await Promise.allSettled([...this.callbacks])
  }
  stop(sessionId: string): Promise<void> {
    const live = this.live.get(sessionId)
    if (!live) return Promise.resolve()
    live.stopping = true
    live.controller.abort(new Error('The managed agent session is stopping.'))
    return (live.stopPromise ??= (async () => {
      await live.startPromise?.catch(() => undefined)
      if (live.retirementFailure) throw live.retirementFailure
      if (live.handle) await live.handle.stop()
      await this.retireSkills(live)
      await this.retireMcp(live)
      await Promise.allSettled([...live.callbacks])
      if (live.retirementFailure) throw live.retirementFailure
      await this.ports.retirementFlush(sessionId)
      if (this.live.get(sessionId) === live) this.live.delete(sessionId)
    })())
  }
}
