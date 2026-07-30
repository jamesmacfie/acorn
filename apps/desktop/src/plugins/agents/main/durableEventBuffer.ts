import type { AgentNormalizedEvent } from '../../../core/shared/managedAgents'

export type PendingAgentEvent = {
  sessionId: string
  turnId: string | null
  event: AgentNormalizedEvent
}

type DeltaEvent = Extract<AgentNormalizedEvent, { type: 'assistant_message' | 'reasoning' }>
type BufferedDelta = PendingAgentEvent & { event: DeltaEvent }

const isAppendDelta = (event: AgentNormalizedEvent): event is DeltaEvent =>
  (event.type === 'assistant_message' || event.type === 'reasoning') && event.append === true

const sameStream = (left: BufferedDelta, right: PendingAgentEvent): right is BufferedDelta =>
  isAppendDelta(right.event)
  && left.turnId === right.turnId
  && left.event.type === right.event.type
  && left.event.messageId === right.event.messageId

const takeUtf8Prefix = (text: string, maxBytes: number): [prefix: string, rest: string] => {
  let bytes = 0
  let end = 0
  for (const character of text) {
    const size = Buffer.byteLength(character, 'utf8')
    if (bytes + size > maxBytes) break
    bytes += size
    end += character.length
  }
  return [text.slice(0, end), text.slice(end)]
}

// Serializes provider callbacks per session and coalesces only explicitly append-only display
// deltas. Every other event first flushes the buffered text, preserving protocol order. Commits
// remain small and bounded, and the caller can persist before broadcasting.
export class DurableAgentEventBuffer {
  readonly #buffers = new Map<string, BufferedDelta>()
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>()
  readonly #chains = new Map<string, Promise<void>>()

  constructor(
    private readonly commit: (entry: PendingAgentEvent) => Promise<void>,
    private readonly options: { maxBytes?: number; flushMs?: number } = {},
  ) {}

  accept(entry: PendingAgentEvent): Promise<void> {
    return this.#enqueue(entry.sessionId, async () => {
      if (!isAppendDelta(entry.event)) {
        await this.#flushNow(entry.sessionId)
        await this.commit(entry)
        return
      }
      const existing = this.#buffers.get(entry.sessionId)
      if (!existing || !sameStream(existing, entry)) {
        await this.#flushNow(entry.sessionId)
        this.#buffers.set(entry.sessionId, { ...entry, event: { ...entry.event } })
      } else {
        existing.event.text += entry.event.text
      }
      const maxBytes = Math.max(4, this.options.maxBytes ?? 16 * 1024)
      for (;;) {
        const buffered = this.#buffers.get(entry.sessionId)
        if (!buffered || Buffer.byteLength(buffered.event.text, 'utf8') < maxBytes) break
        const [text, rest] = takeUtf8Prefix(buffered.event.text, maxBytes)
        await this.commit({ ...buffered, event: { ...buffered.event, text } })
        if (rest) buffered.event.text = rest
        else this.#buffers.delete(entry.sessionId)
      }
      if (this.#buffers.has(entry.sessionId)) this.#schedule(entry.sessionId)
    })
  }

  flush(sessionId: string): Promise<void> {
    return this.#enqueue(sessionId, () => this.#flushNow(sessionId))
  }

  async flushAll(): Promise<void> {
    await Promise.all([...new Set([...this.#chains.keys(), ...this.#buffers.keys()])].map((id) => this.flush(id)))
  }

  #schedule(sessionId: string): void {
    if (this.#timers.has(sessionId)) return
    const timer = setTimeout(() => {
      this.#timers.delete(sessionId)
      void this.flush(sessionId)
    }, this.options.flushMs ?? 40)
    this.#timers.set(sessionId, timer)
  }

  async #flushNow(sessionId: string): Promise<void> {
    const timer = this.#timers.get(sessionId)
    if (timer) clearTimeout(timer)
    this.#timers.delete(sessionId)
    const buffered = this.#buffers.get(sessionId)
    if (!buffered) return
    this.#buffers.delete(sessionId)
    await this.commit(buffered)
  }

  #enqueue(sessionId: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.#chains.get(sessionId) ?? Promise.resolve()
    const next = previous.then(operation, operation)
    this.#chains.set(sessionId, next)
    const cleanup = () => {
      if (this.#chains.get(sessionId) === next) this.#chains.delete(sessionId)
    }
    void next.then(cleanup, cleanup)
    return next
  }
}
