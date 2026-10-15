import type { CompiledCoreServices, PluginTelemetry } from '@acorn/plugin-api/node'
import type { AgentNormalizedEvent, AgentSession } from '../../contract/wire.ts'
import {
  AGENT_IDLE_MEMORY_CHOICES,
  AGENT_IDLE_STOP_CHOICES,
  defaultAgentSessionDefaults,
  type AgentSessionDefaults,
} from '../../shared/sessionDefaults'
import { awaitWithSignal } from '../processes/startCancellation'
import { readAgentSessionDefaults } from '../sessionDefaultsStore'
import type { ProcessRow } from './footprint'
import type { ProviderFacts, ProviderGeneration, ProviderSessionLifecycle } from './providerSessionLifecycle'
import { isActiveSubagent } from './stateMachine'
import type { AgentStore } from './store'

// How long a measured folder size is reused. See diskFootprint().
const DISK_FOOTPRINT_MS = 30_000
const GIGABYTE = 1024 ** 3

type ProcessUpkeepDeps = {
  processes: ProviderSessionLifecycle
  store: Pick<
    AgentStore,
    'getSession' | 'pendingRequests' | 'interruptActiveTurn' | 'expirePendingRequests' | 'unfinishedCommands'
  >
  // The attachment and artifact folders, which diskFootprint() measures.
  folders: { attachments: string; artifacts: string }
  core: Pick<CompiledCoreServices, 'prefs' | 'proc'>
  currentUserId(): string | null
  telemetry?: PluginTelemetry
  // How often the idle sweep runs, which is how far past the limit a process can get before it's stopped.
  idleSweepMs: number
  // The engine's shutdown. Once it aborts, nothing is stopped or measured.
  shutdown: AbortSignal
  record(sessionId: string, turnId: string | null, event: AgentNormalizedEvent): Promise<unknown>
  endTurnSpan(turnId: string, outcome: 'interrupted'): void
  pauseGoal(sessionId: string): Promise<void>
  pump(): void
}

/**
 * Stops provider processes nobody can use, and measures what they hold. Each one holds an agent CLI
 * and its MCP servers, hundreds of megabytes, and nothing else stops a session nobody prompts again
 * (docs/managed-agents/operations.md § Idle stop).
 */
export class ProcessUpkeep {
  // The last folder measurement, shared by every caller inside DISK_FOOTPRINT_MS.
  private diskMeasure: { at: number; bytes: Promise<{ attachmentsBytes: number; artifactsBytes: number }> } | null =
    null

  constructor(private readonly deps: ProcessUpkeepDeps) {}

  // Called when the task is archived (core:task-archiving). Each process holds a
  // provider CLI and its MCP servers, and nothing can prompt it until the task is restored. The
  // sessions stay. A restored task resumes them on the next prompt, the same way it does after a
  // restart, so this records what the runtime's reconcile() records.
  async stopTaskSessions(taskId: string): Promise<void> {
    const { processes, store } = this.deps
    const stopping = processes.occupancy().filter((live) => live.taskId === taskId)
    await Promise.all(
      stopping.map(async (live) => {
        const sessionId = live.generation.sessionId
        const turnId = processes.takeActive(live.generation)
        // Cleared before the stop, so the send that fails when the process dies is not retried or
        // recorded as a provider failure.
        await processes.stop(sessionId)
        await store.interruptActiveTurn(sessionId, 'The task was archived while the provider turn was active.')
        if (turnId) await this.deps.pauseGoal(sessionId)
        await store.expirePendingRequests(sessionId)
        if (turnId) this.deps.endTurnSpan(turnId, 'interrupted')
        await this.deps.record(sessionId, null, {
          type: 'session_state',
          state: 'stopped',
          detail:
            'The provider process stopped when this task was archived. Restore the task and send a prompt to resume.',
        })
      }),
    )
  }

  /**
   * Stops each provider process that has been idle past the owner's time limit, then idle ones, longest
   * idle first, while every process together holds more than the owner's memory limit. Returns the
   * sessions it stopped. Read per sweep, so a change in Settings applies to the next one. `list` is a
   * parameter so a test can hand it a fake process table.
   */
  async stopIdleSessions(now = Date.now(), list = () => this.listProcesses()): Promise<string[]> {
    if (this.deps.shutdown.aborted || !this.deps.processes.ids().length) return []
    const { stopIdleAfterMinutes: minutes, stopIdleAboveGigabytes: gigabytes } = await this.ownerDefaults()
    if (this.deps.shutdown.aborted) return []
    const stopped: string[] = []
    if (minutes) {
      const label = AGENT_IDLE_STOP_CHOICES.find((choice) => choice.minutes === minutes)?.label ?? `${minutes} minutes`
      stopped.push(
        ...(await this.stopIdle(
          now - minutes * 60_000,
          `The provider process stopped after ${label} idle to free memory. Send a prompt to resume.`,
        )),
      )
    }
    if (gigabytes) stopped.push(...(await this.stopIdleOverMemory(gigabytes, now, list)))
    return stopped
  }

  /** Stop idle agents now, in Settings > Storage and memory: the sweep's rules with no time limit.
   *  It runs whatever the owner's limit is, Never included, because the owner asked for it. */
  async stopIdleSessionsNow(): Promise<string[]> {
    if (this.deps.shutdown.aborted || !this.deps.processes.ids().length) return []
    return this.stopIdle(
      Date.now(),
      'The provider process was stopped from Settings to free memory. Send a prompt to resume.',
    )
  }

  /**
   * The live sessions, how many of them the idle rules would stop now, and the memory of their process
   * trees. `list` is a parameter so a test can hand it a fake table.
   */
  async processFootprint(
    list: () => Promise<ProcessRow[] | null> = () => this.listProcesses(),
  ): Promise<{ live: number; idle: number; memoryBytes: number | null }> {
    const running = this.deps.processes.occupancy().filter((live) => !live.stopping)
    const now = Date.now()
    let idle = 0
    for (const live of running) {
      if (await this.stoppableIdle(live.generation.sessionId, live.generation, now)) idle++
    }
    if (this.deps.shutdown.aborted) return { live: 0, idle: 0, memoryBytes: null }
    const pids = running.flatMap((live) => (live.pid ? [live.pid] : []))
    const rows = running.length ? await list() : []
    return {
      live: running.length,
      idle,
      memoryBytes: rows ? (await import('./footprint')).processTreeBytes(rows, pids) : null,
    }
  }

  /**
   * Report processFootprint() and idlePastLimit() as four gauges owned by this plugin
   * (docs/telemetry/diagnosis.md § Diagnosing an unresponsive view). Skipped whole while nothing is
   * collecting, because the count runs `ps` through the process broker. Memory is left out when the
   * table could not be read, rather than reported as zero.
   */
  async sampleProcessFootprint(): Promise<void> {
    const telemetry = this.deps.telemetry
    if (!telemetry?.enabled()) return
    const { live, idle, memoryBytes } = await this.processFootprint()
    const idlePastLimit = await this.idlePastLimit()
    if (this.deps.shutdown.aborted) return
    telemetry.gauge('agent.processes.live', live)
    telemetry.gauge('agent.processes.idle', idle)
    telemetry.gauge('agent.processes.idle_past_limit', idlePastLimit)
    if (memoryBytes !== null) telemetry.gauge('agent.processes.memory', memoryBytes)
  }

  /**
   * How many processes the idle rules would stop that have sat past the owner's time limit for longer
   * than a sweep interval. A working sweep has stopped every one of those, so anything above zero means
   * it missed one. Without the interval's grace, a process that crossed the limit a minute ago and is
   * waiting for the next sweep would count.
   */
  async idlePastLimit(now = Date.now()): Promise<number> {
    const { stopIdleAfterMinutes: minutes } = await this.ownerDefaults()
    if (!minutes) return 0
    const before = now - minutes * 60_000 - this.deps.idleSweepMs
    let count = 0
    for (const live of this.deps.processes.occupancy()) {
      if (await this.stoppableIdle(live.generation.sessionId, live.generation, before)) count++
    }
    return count
  }

  /** The size of the attachment and artifact folders. Walking them stats every file, so the answer is
   *  kept for DISK_FOOTPRINT_MS and a page polling every few seconds reuses it. */
  diskFootprint(now = Date.now()): Promise<{ attachmentsBytes: number; artifactsBytes: number }> {
    if (this.diskMeasure && now - this.diskMeasure.at < DISK_FOOTPRINT_MS) return this.diskMeasure.bytes
    const bytes = import('./footprint').then(async ({ directoryBytes }) => {
      const [attachmentsBytes, artifactsBytes] = await Promise.all([
        directoryBytes(this.deps.folders.attachments),
        directoryBytes(this.deps.folders.artifacts),
      ])
      return { attachmentsBytes, artifactsBytes }
    })
    this.diskMeasure = { at: now, bytes }
    return bytes
  }

  private async ownerDefaults(): Promise<AgentSessionDefaults> {
    const userId = this.deps.currentUserId()
    if (!userId) return defaultAgentSessionDefaults()
    return this.readWhileRunning(() => readAgentSessionDefaults(this.deps.core.prefs, userId)).catch(
      (error: unknown) => {
        if (this.deps.shutdown.aborted) return defaultAgentSessionDefaults()
        throw error
      },
    )
  }

  private async listProcesses(): Promise<ProcessRow[] | null> {
    return (await import('./footprint')).listProcesses(this.deps.core.proc)
  }

  private readWhileRunning<T>(query: () => Promise<T>): Promise<T> {
    this.deps.shutdown.throwIfAborted()
    return awaitWithSignal(query(), this.deps.shutdown)
  }

  /**
   * The session, if the idle rules would stop its process: idle since `before` and nothing living inside
   * the process or waiting on it. That is a turn in flight or queued, a request the owner has not
   * answered, a background subagent or command still running, or a start in progress. Delegation reports and
   * workflow steps reach a session through enqueueTurn, which resumes a stopped one, so those need no
   * exception.
   */
  private async stoppableIdle(
    sessionId: string,
    generation: ProviderGeneration,
    before: number,
  ): Promise<AgentSession | null> {
    if (!this.deps.processes.idleCandidate(sessionId, generation, before)) return null
    const session = await this.deps.store.getSession(sessionId)
    // `failed` too: a turn error leaves the process running, and the next prompt restarts a failed
    // session anyway.
    if (
      this.deps.shutdown.aborted ||
      !session ||
      !['ready', 'failed'].includes(session.runtimeState) ||
      session.queuedTurns > 0
    )
      return null
    if (session.subagents.some(isActiveSubagent)) return null
    // A background command dies with the harness that started it.
    const commands = await this.deps.store.unfinishedCommands({ sessionId })
    if (commands.some((record) => record.event.type === 'tool' && record.event.tool.background)) return null
    // The request rows are the authority here. `ready` is only what the last event projected.
    if ((await this.deps.store.pendingRequests(sessionId)).length) return null
    return session
  }

  // The time limit and the Settings button, which differ only in `before` and in what the transcript says.
  private async stopIdle(before: number, detail: string): Promise<string[]> {
    const stopped: string[] = []
    for (const live of this.deps.processes.occupancy()) {
      if (this.deps.shutdown.aborted) break
      if (await this.stopIfIdle(live, before, detail)) stopped.push(live.generation.sessionId)
    }
    // A prompt that queued behind a stopping process has nothing else to wake it.
    if (stopped.length) this.deps.pump()
    return stopped
  }

  // Each process tree is measured once, and the total drops by a tree as it stops, so the sweep stops
  // only as many as it takes. A busy process keeps running, even when the busy ones alone are over.
  private async stopIdleOverMemory(
    gigabytes: number,
    now: number,
    list: () => Promise<ProcessRow[] | null>,
  ): Promise<string[]> {
    const rows = await list()
    if (!rows || this.deps.shutdown.aborted) return []
    const running = this.deps.processes.occupancy().filter((live) => !live.stopping)
    let { total, trees } = (await import('./footprint')).longestIdleTrees(rows, running)
    const limit = gigabytes * GIGABYTE
    const label = AGENT_IDLE_MEMORY_CHOICES.find((choice) => choice.gigabytes === gigabytes)?.label ?? `${gigabytes} GB`
    const detail = `The provider process stopped to free memory, because agents held more than ${label}. Send a prompt to resume.`
    const stopped: string[] = []
    for (const { live, bytes } of trees) {
      if (total <= limit || this.deps.shutdown.aborted) break
      if (!(await this.stopIfIdle(live, now, detail))) continue
      stopped.push(live.generation.sessionId)
      total -= bytes
    }
    if (stopped.length) this.deps.pump()
    return stopped
  }

  // Stops the process if the idle rules allow it, and says whether it did.
  private async stopIfIdle(live: ProviderFacts, before: number, detail: string): Promise<boolean> {
    const { processes } = this.deps
    const sessionId = live.generation.sessionId
    const session = await this.stoppableIdle(sessionId, live.generation, before)
    if (!session) return false
    // Again, because a prompt could have arrived during the reads.
    if (!processes.idleCandidate(sessionId, live.generation, before)) return false
    // Marked before the record, so the dispatcher leaves this process alone while it is written.
    // Recorded before the stop, so a prompt that lands in between sees `stopped` and takes the resume
    // path rather than queueing behind a process that is about to exit. A failed session's state is
    // left as it is, so the failure still shows.
    if (!processes.markStopping(live.generation)) return false
    if (session.runtimeState === 'ready') {
      await this.deps.record(sessionId, null, { type: 'session_state', state: 'stopped', detail })
    }
    if (processes.current(sessionId)?.generation === live.generation) await processes.stop(sessionId)
    return true
  }
}
