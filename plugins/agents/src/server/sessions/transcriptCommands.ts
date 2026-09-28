import { randomUUID } from 'node:crypto'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import type { AgentNormalizedEvent, AgentProviderDescriptor, AgentSession } from '../../contract/wire.ts'
import { agentTurnInputText } from './runtimeEngine'
import type { AgentStore } from './store'
import { parseAgentTranscript } from './transcriptImport'

type TranscriptDependencies = {
  store: Pick<AgentStore,
    | 'createSession' | 'setController' | 'enqueueTurn' | 'dispatchTurn' | 'startTurn'
    | 'requireSession' | 'setProviderSessionReference' | 'patchSession' | 'exportSnapshot'>
  providers(): Promise<AgentProviderDescriptor[]>
  requireTaskRoot(taskId: string): Promise<string>
  record(sessionId: string, turnId: string | null, event: AgentNormalizedEvent): Promise<void>
  ensureSession(session: AgentSession): Promise<void>
  publish(session: AgentSession): void
}

/** Imports historical turns without executing them and verifies provider ownership separately. */
export class TranscriptCommands {
  constructor(private readonly deps: TranscriptDependencies) {}

  async import(input: {
    taskId: string
    providerId: string
    profileId: string
    title?: string
    content: string
  }): Promise<AgentSession> {
    const provider = (await this.deps.providers()).find((candidate) => candidate.id === input.providerId)
    if (!provider) throw new Error(`Managed provider is not registered: ${input.providerId}`)
    if (provider.profileId !== input.profileId) {
      throw new Error(`Provider '${provider.id}' requires profile '${provider.profileId}'.`)
    }
    await this.deps.requireTaskRoot(input.taskId)
    const parsed = parseAgentTranscript(input.content)
    const session = await this.deps.store.createSession({
      taskId: input.taskId,
      providerId: input.providerId,
      profileId: input.profileId,
      title: input.title ?? parsed.title ?? `Imported ${provider.label} transcript`,
      kind: 'imported',
      config: {
        imported: true,
        importedProviderSessionRef: parsed.providerSessionRef,
        resumeVerified: false,
      },
    }, provider)
    await this.deps.store.setController(session.id, 'external')
    await this.deps.record(session.id, null, {
      type: 'diagnostic',
      level: 'info',
      message: 'Imported transcript. History is read-only until its provider session reference is explicitly verified.',
    })
    for (const imported of parsed.turns) {
      const { turn } = await this.deps.store.enqueueTurn(session.id, {
        input: [{ type: 'text', text: imported.user }],
        source: 'import',
        effectivePolicy: { imported: true },
        idempotencyKey: randomUUID(),
      })
      await this.deps.store.dispatchTurn(turn.id)
      await this.deps.store.startTurn(turn.id)
      await this.deps.record(session.id, turn.id, { type: 'user_message', text: imported.user })
      for (const text of imported.assistant) {
        await this.deps.record(session.id, turn.id, { type: 'assistant_message', text })
      }
      await this.deps.record(session.id, turn.id, { type: 'turn_completed', stopReason: 'imported_history' })
    }
    await this.deps.record(session.id, null, {
      type: 'session_state',
      state: 'stopped',
      detail: 'Imported historical transcript.',
    })
    const imported = await this.deps.store.requireSession(session.id)
    this.deps.publish(imported)
    return imported
  }

  async verifyResume(sessionId: string): Promise<AgentSession> {
    const session = await this.deps.store.requireSession(sessionId)
    if (session.kind !== 'imported') throw new Error('Only imported transcripts require resume verification.')
    const providerSessionRef = session.config.importedProviderSessionRef
    if (typeof providerSessionRef !== 'string' || !providerSessionRef) {
      throw new Error('The imported transcript has no provider session reference.')
    }
    await this.deps.store.setProviderSessionReference(sessionId, providerSessionRef)
    const controlled = await this.deps.store.setController(sessionId, 'acorn')
    try {
      await this.deps.ensureSession(controlled)
    } catch (error) {
      await this.deps.store.setProviderSessionReference(sessionId, null)
      await this.deps.store.setController(sessionId, 'external')
      throw error
    }
    const verified = await this.deps.store.patchSession(sessionId, {
      config: { ...session.config, resumeVerified: true },
    })
    await this.deps.record(sessionId, null, {
      type: 'diagnostic',
      level: 'info',
      message: 'Provider resume reference verified. Acorn now owns the input controller.',
    })
    this.deps.publish(verified)
    return this.deps.store.requireSession(sessionId)
  }

  async export(sessionId: string, format: 'json' | 'markdown'): Promise<string> {
    const snapshot = await this.deps.store.exportSnapshot(sessionId)
    if (format === 'json') return JSON.stringify({ baseline: ACORN_BASELINE, version: 1, exportedAt: Date.now(), ...snapshot }, null, 2)
    const lines = [`# ${snapshot.session.title}`, '', `Provider: ${snapshot.session.providerId}`, '']
    for (const turn of snapshot.turns) {
      lines.push('## User', '', agentTurnInputText(turn), '')
      for (const event of snapshot.events.filter((item) => item.turnId === turn.id)) {
        if (event.event.type === 'assistant_message') lines.push(event.event.text)
        else if (event.event.type === 'tool') lines.push(`- Tool: ${event.event.tool.title} — ${event.event.tool.status ?? 'running'}`)
        else if (event.event.type === 'error') lines.push(`- Error: ${event.event.message}`)
      }
      lines.push('')
    }
    return lines.join('\n')
  }
}
