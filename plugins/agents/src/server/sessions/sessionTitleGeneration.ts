import { agentProfileRegistry, type CoreServices, type PluginTelemetry } from '@acorn/plugin-api/node'
import { HARNESS_BACKEND_PREFIX } from '@acorn/protocol/modelProviders.ts'
import type { AgentSession } from '../../contract/wire.ts'
import type { EnqueueAgentTurnInput } from '../../shared/schemas'
import type { AgentStore } from './store'
import {
  buildSessionTitlePrompt,
  generationText,
  isSessionTitlePromptEligible,
  normalizeGeneratedSessionTitle,
  SESSION_TITLE_SYSTEM_PROMPT,
} from './sessionTitle'

// Generation runs outside the accepted turn. The bound must allow a second CLI to start while
// still giving shutdown a finite join.
const SESSION_TITLE_TIMEOUT_MS = 30_000

type SessionTitleOperation = {
  controller: AbortController
  promise: Promise<void>
}

type TitleGenerationDependencies = {
  store: Pick<AgentStore, 'requireSession' | 'firstTurn' | 'renameSession'>
  models: CoreServices['models']
  currentUserId(): string | null
  publish(session: AgentSession): void
  telemetry?: PluginTelemetry
}

/** Owns the one-shot title request and its shutdown and deletion joins. */
export class SessionTitleGeneration {
  private readonly operations = new Map<string, SessionTitleOperation>()

  constructor(private readonly deps: TitleGenerationDependencies) {}

  start(session: AgentSession, parts: EnqueueAgentTurnInput['input'], fallback: string): void {
    if (this.operations.has(session.id)) return
    const text = generationText(parts)
    const userId = this.deps.currentUserId()
    const profile = agentProfileRegistry.get(session.profileId)
    if (!isSessionTitlePromptEligible(text) || !userId || !profile?.aiArgv) {
      this.log(session.profileId, profile?.aiArgv && userId ? 'skipped' : 'unavailable', 0, text.length)
      return
    }
    void this.run(session, userId, text, fallback, fallback).catch(() => undefined)
  }

  /** A user rename during generation wins over the generated result. */
  async regenerate(sessionId: string): Promise<AgentSession> {
    const inFlight = this.operations.get(sessionId)
    if (inFlight) await inFlight.promise

    const session = await this.deps.store.requireSession(sessionId)
    const firstTurn = await this.deps.store.firstTurn(sessionId)
    const text = generationText(firstTurn?.input ?? [])
    if (!text) throw new Error('Send a text prompt before regenerating the session title.')

    const userId = this.deps.currentUserId()
    const profile = agentProfileRegistry.get(session.profileId)
    if (!userId || !profile?.aiArgv) {
      this.log(session.profileId, 'unavailable', 0, text.length)
      throw new Error('Title generation is unavailable for this session provider.')
    }
    return this.run(session, userId, text, session.title)
  }

  async stop(): Promise<void> {
    for (const operation of this.operations.values()) operation.controller.abort(new Error('runtime_stop'))
    await Promise.allSettled([...this.operations.values()].map((operation) => operation.promise))
  }

  async cancel(sessionId: string): Promise<void> {
    const operation = this.operations.get(sessionId)
    operation?.controller.abort(new Error('session_deleted'))
    if (operation) await operation.promise
  }

  private run(
    session: AgentSession,
    userId: string,
    text: string,
    expectedTitle: string,
    excludedTitle?: string,
  ): Promise<AgentSession> {
    if (this.operations.has(session.id)) throw new Error('Session title generation is already in progress.')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new Error('session_title_timeout')), SESSION_TITLE_TIMEOUT_MS)
    const work = this.generate(session, userId, text, expectedTitle, excludedTitle, controller)
    const promise = work
      .then(() => undefined, () => undefined)
      .finally(() => {
        clearTimeout(timeout)
        this.operations.delete(session.id)
      })
    this.operations.set(session.id, { controller, promise })
    return work
  }

  private async generate(
    session: AgentSession,
    userId: string,
    text: string,
    expectedTitle: string,
    excludedTitle: string | undefined,
    controller: AbortController,
  ): Promise<AgentSession> {
    const startedAt = Date.now()
    let outcome: 'generated' | 'timeout' | 'unavailable' | 'invalid' | 'superseded' | 'aborted' = 'unavailable'
    try {
      const generated = await this.deps.models.generateText({
        userId,
        backendId: `${HARNESS_BACKEND_PREFIX}${session.profileId}`,
        input: {
          system: SESSION_TITLE_SYSTEM_PROMPT,
          prompt: buildSessionTitlePrompt(text),
          maxOutputTokens: 64,
          signal: controller.signal,
        },
        timeoutMs: SESSION_TITLE_TIMEOUT_MS,
      })
      if (controller.signal.aborted) {
        outcome = /runtime_stop|session_deleted/.test(String(controller.signal.reason)) ? 'aborted' : 'timeout'
        throw controller.signal.reason
      }
      const title = normalizeGeneratedSessionTitle(generated.text, excludedTitle)
      if (!title) {
        outcome = 'invalid'
        throw new Error('The provider did not return a usable session title.')
      }
      const renamed = await this.deps.store.renameSession(session.id, {
        title,
        expectedTitle,
        source: 'generated',
      })
      if (!renamed.changed) {
        outcome = 'superseded'
        return renamed.session
      }
      this.deps.publish(renamed.session)
      outcome = 'generated'
      return renamed.session
    } catch (error) {
      if (controller.signal.aborted) {
        outcome = /runtime_stop|session_deleted/.test(String(controller.signal.reason)) ? 'aborted' : 'timeout'
      }
      throw error
    } finally {
      this.log(session.profileId, outcome, Date.now() - startedAt, text.length)
    }
  }

  private log(
    profileId: string,
    outcome: 'generated' | 'skipped' | 'timeout' | 'unavailable' | 'invalid' | 'superseded' | 'aborted',
    durationMs: number,
    promptChars: number,
  ): void {
    this.deps.telemetry?.event('agents.session-title.generate', { profileId, outcome, durationMs, promptChars })
  }
}
