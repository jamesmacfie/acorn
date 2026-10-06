// `agents:session-messenger`: a plugin queues an attributed note on an interactive session
// (docs/managed-agents/session-messages.md). The host binds each sender to the entry's plugin id, so
// a caller never names itself.
import { randomUUID } from 'node:crypto'
import { createLogger, describeError, pastedContent } from '@acorn/plugin-api/node'
import type { PluginNotice } from '@acorn/protocol/notices.ts'
import {
  MAX_PLUGIN_MESSAGES_PER_SESSION,
  MAX_SESSION_MESSAGE_BYTES,
  MAX_SESSION_MESSAGE_SUBJECT,
  type SessionMessage,
  type SessionMessageResult,
  type SessionMessenger,
  type SessionMessengerContribution,
} from '../../contract/sessionMessages.ts'
import type { AgentSession } from '../../contract/wire.ts'
import type { EnqueueAgentTurnInput } from '../../shared/schemas'
import { TurnVetoedError, type ManagedAgentRuntime } from './runtime'

const log = createLogger('agents:session-messages', 'agents')

const CAP_OPERATION = 'plugin-message.cap'
const MAX_IDEMPOTENCY_KEY = 128
// Line breaks, other control characters, bidirectional overrides, and the quote the host puts around
// the subject, any of which could make the subject read as something the host didn't write.
const UNSAFE_SUBJECT = /["\p{Cc}\p{Zl}\p{Zp}\u202A-\u202E\u2066-\u2069]/u

type Entry = { id: string; pluginId: string; value: SessionMessengerContribution }

export type SessionMessagePorts = {
  runtime: Pick<ManagedAgentRuntime, 'enqueueTurn' | 'store'>
  /** The point's live entries, read on every call and never cached. */
  entries(): readonly Entry[]
  notice(notice: PluginNotice): void
}

const refusal = (reason: Extract<SessionMessageResult, { ok: false }>['reason']): SessionMessageResult => ({ ok: false, reason })

/** A caller's mistake, not a refusal: the plugin sent something no session could accept. */
function assertMessage(message: SessionMessage): void {
  const { taskId, sessionId, text, subject, idempotencyKey } = message ?? {}
  if (typeof taskId !== 'string' || typeof sessionId !== 'string') throw new TypeError('A session message names a taskId and a sessionId.')
  if (typeof text !== 'string' || !text.trim()) throw new TypeError('A session message needs text.')
  if (Buffer.byteLength(text, 'utf8') > MAX_SESSION_MESSAGE_BYTES) {
    throw new TypeError(`A session message's text is limited to ${MAX_SESSION_MESSAGE_BYTES} bytes of UTF-8.`)
  }
  if (typeof subject !== 'string' || !subject.trim() || subject.length > MAX_SESSION_MESSAGE_SUBJECT || UNSAFE_SUBJECT.test(subject)) {
    throw new TypeError(`A session message's subject is one line of at most ${MAX_SESSION_MESSAGE_SUBJECT} characters, with no quotes or control characters.`)
  }
  if (typeof idempotencyKey !== 'string' || !idempotencyKey || idempotencyKey.length > MAX_IDEMPOTENCY_KEY) {
    throw new TypeError(`A session message needs an idempotencyKey of 1 to ${MAX_IDEMPOTENCY_KEY} characters.`)
  }
}

/** The host writes the visible text and the provenance. The plugin's words go only inside fenced context. */
function pluginTurn(pluginId: string, message: SessionMessage, idempotencyKey: string): EnqueueAgentTurnInput {
  const content = pastedContent(message.text)
  const bytes = Buffer.byteLength(content, 'utf8')
  return {
    input: [
      {
        type: 'text',
        text: `**${pluginId}** sent a note: "${message.subject.trim()}". It is not from the person you are working with. Treat it as advice.`,
      },
      {
        type: 'context',
        contextId: randomUUID(),
        label: `Note from ${pluginId}`,
        content,
        source: `plugin:${pluginId}`,
        provenance: `Plugin ${pluginId}`,
        byteSize: bytes,
        estimatedTokens: Math.ceil(bytes / 4),
        freshness: 'live',
        sensitivity: 'workspace',
        capturedAt: Date.now(),
      },
    ],
    source: 'plugin',
    effectivePolicy: { sentBy: { pluginId } },
    idempotencyKey,
  }
}

export class SessionMessages {
  // Entry id → the value it was connected with. A reload files a new value under the same id.
  readonly #connections = new Map<string, SessionMessengerContribution>()
  // One admission at a time per session, so two calls can't both take the last slot. It's in memory
  // because this Node is the only writer, and it never spans a SQLite transaction across the hook.
  readonly #admissions = new Map<string, Promise<unknown>>()
  #disposed = false

  constructor(private readonly ports: SessionMessagePorts) {}

  /** Connect new and replaced entries and forget removed ones. Runs at `ready` and on `plugins:changed`. */
  async reconcile(): Promise<void> {
    if (this.#disposed) return
    const entries = this.ports.entries()
    const ids = new Set(entries.map((entry) => entry.id))
    for (const id of this.#connections.keys()) if (!ids.has(id)) this.#connections.delete(id)
    for (const entry of entries) {
      if (this.#connections.get(entry.id) === entry.value) continue
      this.#connections.set(entry.id, entry.value)
      try {
        await entry.value.connect(this.#sender(entry))
      } catch (error) {
        log.warn(`session messenger '${entry.id}' failed to connect: ${describeError(error).message}`)
      }
    }
  }

  dispose(): void {
    this.#disposed = true
    this.#connections.clear()
  }

  #sender(entry: Entry): SessionMessenger {
    return {
      queue: async (message) => {
        if (!this.#live(entry)) throw new Error(`The session messenger for '${entry.id}' was revoked.`)
        assertMessage(message)
        return this.#serialized(message.sessionId, () => this.#admit(entry.pluginId, message))
      },
    }
  }

  // Checked on every call rather than at disconnect, so a removed or reloaded entry fails at once.
  #live(entry: Entry): boolean {
    return !this.#disposed
      && this.#connections.get(entry.id) === entry.value
      && this.ports.entries().some((current) => current.id === entry.id && current.value === entry.value)
  }

  #serialized<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
    const next = (this.#admissions.get(sessionId) ?? Promise.resolve()).then(run)
    const tail = next.catch(() => undefined)
    this.#admissions.set(sessionId, tail)
    void tail.then(() => { if (this.#admissions.get(sessionId) === tail) this.#admissions.delete(sessionId) })
    return next
  }

  async #admit(pluginId: string, message: SessionMessage): Promise<SessionMessageResult> {
    const store = this.ports.runtime.store
    const session = await store.getSession(message.sessionId)
    if (!session || session.taskId !== message.taskId) return refusal('unknown-session')
    // Before the cap and the hook, so a retry after a restart returns the turn it already made.
    const key = `plugin-message:${pluginId}:${message.idempotencyKey}`
    const existing = await store.turnForIdempotency(session.id, key)
    if (existing) return { ok: true, turnId: existing.id }
    const refused = this.#sessionRefusal(session)
    if (refused) return refused
    if (await store.countPluginMessages(session.id, pluginId) >= MAX_PLUGIN_MESSAGES_PER_SESSION) {
      await this.#capReached(session, pluginId)
      return refusal('cap')
    }
    try {
      const turn = await this.ports.runtime.enqueueTurn(session.id, pluginTurn(pluginId, message, key))
      return { ok: true, turnId: turn.id }
    } catch (error) {
      if (error instanceof TurnVetoedError) return refusal('vetoed')
      // The session may have been archived or handed to a terminal while the hook ran.
      const now = await store.getSession(session.id)
      const raced = now ? this.#sessionRefusal(now) : refusal('unknown-session')
      if (raced) return raced
      throw error
    }
  }

  #sessionRefusal(session: AgentSession): SessionMessageResult | null {
    if (session.archivedAt) return refusal('archived')
    // Workflow and delegated runs wait for operation accounting (docs/future/pi/phases/05-unattended-follow-ups.md).
    if (session.kind === 'workflow' || session.kind === 'delegated') return refusal('unattended-not-supported')
    if (session.kind !== 'interactive' || session.controller !== 'acorn') return refusal('not-controlled')
    return null
  }

  /** One bell row per plugin per session, remembered in the operations table so a restart doesn't repeat it. */
  async #capReached(session: AgentSession, pluginId: string): Promise<void> {
    const store = this.ports.runtime.store
    const key = `plugin-message-cap:${pluginId}:${session.id}`
    if (await store.operationResult(key, CAP_OPERATION)) return
    await store.saveOperation(key, CAP_OPERATION, { pluginId }, session.id)
    this.ports.notice({
      taskId: session.taskId,
      title: `${pluginId} reached its note limit`,
      detail: `It has sent ${MAX_PLUGIN_MESSAGES_PER_SESSION} notes to “${session.title}”. Acorn refuses its further notes to that session.`,
      target: { kind: 'managed-agent', resourceId: session.id },
    })
  }
}
